/**
 * Service de génération automatique du quiz quotidien.
 *
 * - 10 questions au total (TOTAL_QUESTIONS).
 * - Timeline générées par Ollama (best-effort : 0 à 3 selon disponibilité).
 * - QCM piochés dans OpenQuizzDB (fichiers JSON locaux) pour compléter jusqu'à 10.
 * - Historique anti-répétition PERSISTÉ EN BASE (quiz_questions.source_id) : survit à un
 *   rebuild/redeploy du conteneur, contrairement à l'ancien fichier used-questions.json qui
 *   vivait dans la couche image éphémère et était réinitialisé à chaque déploiement (#73).
 * - Rattrapage robuste (#74) : une session 'failed' ou 'generating' zombie (process tué avant
 *   complétion) est recyclée à la demande via un claim atomique, au lieu de bloquer le quiz
 *   toute la journée.
 *
 * Anti-répétition — deux régimes distincts, et c'est volontaire :
 * - **QCM OpenQuizzDB** : dédupliqués sur l'historique COMPLET (~1800 questions en stock, soit
 *   plus de 250 jours). Quand le corpus s'épuise, le repli n'autorise que les questions absentes
 *   des QCM_RECYCLE_GUARD_DAYS derniers jours : le cycle redevient possible sans jamais reposer
 *   une question à quelques jours d'intervalle.
 * - **Timeline Ollama** : dédupliquées sur une FENÊTRE GLISSANTE (TIMELINE_DEDUP_WINDOW_DAYS), pas
 *   sur l'historique complet. Un 7B a un répertoire d'événements limité : le dédupliquer « à vie »
 *   ferait tomber la production de timeline à zéro au bout de quelques mois, et le quiz
 *   deviendrait 100 % QCM. La clé est `tl_<tag>_<réponse>` et non un hash du texte, afin que deux
 *   formulations du même événement (même année, même thème) soient reconnues comme un doublon.
 *
 * Invariants :
 * - 1 seule session par jour (contrainte UNIQUE sur quiz_sessions.date) ; getTodaySession ne
 *   renvoie qu'une session 'completed'.
 * - source_id est renseigné sur TOUTES les questions : `<quizId>_<difficulté>_<id>` pour les QCM,
 *   `tl_<tag>_<réponse>` pour les timeline. Les deux espaces de noms ne peuvent pas se collisionner
 *   (préfixe `tl_`), ce qui permet un historique unique en base.
 * - Une timeline rejetée n'ampute jamais le quiz : les QCM complètent toujours jusqu'à
 *   TOTAL_QUESTIONS (un quiz peut donc être 10 QCM + 0 timeline, jamais 9 questions).
 */

import fs from 'fs';
import path from 'path';
import { getParisDateKey } from '../../../utils/quiz-date';
import { normalizeAnswer } from '../../../utils/quiz-answer';
import { shuffleArray } from '../../../utils/array';

// ─── Types ───────────────────────────────────────────────────────────

interface SelectedQuiz {
  id: number;
  theme: string;
  tag: string;
}

interface SelectedQuizzesConfig {
  quizzes: SelectedQuiz[];
}

interface OpenQuizzDBQuestion {
  id: number;
  question: string;
  propositions: string[];
  réponse: string;
  anecdote: string;
}

interface DifficultyLevels {
  débutant?: OpenQuizzDBQuestion[] | Record<string, OpenQuizzDBQuestion>;
  confirmé?: OpenQuizzDBQuestion[] | Record<string, OpenQuizzDBQuestion>;
  expert?: OpenQuizzDBQuestion[] | Record<string, OpenQuizzDBQuestion>;
}

interface OpenQuizzDBFile {
  thème: string;
  quizz: DifficultyLevels & {
    // Certains fichiers ont une couche langue : quizz.fr.débutant
    fr?: DifficultyLevels;
  };
}

interface GeneratedQuestion {
  question_text: string;
  question_type: 'qcm' | 'timeline';
  correct_answer: string;
  options: string[] | null;
  timeline_range: { min: number; max: number } | null;
  explanation: string;
  tagName: string;
  // Clé de déduplication persistée : ID de la question source OpenQuizzDB (QCM) ou null (timeline Ollama).
  source_id: string | null;
}

// ─── Constantes ──────────────────────────────────────────────────────

// process.cwd() = racine du backend (/opt/app en Docker, ./backend en local)
const DATA_DIR = path.join(process.cwd(), 'src', 'data', 'openquizzdb');
const SELECTED_QUIZZES_PATH = path.join(DATA_DIR, 'selected-quizzes.json');

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'mistral:7b';

// Nombre total de questions par quiz quotidien. Les questions timeline (Ollama) sont
// best-effort ; les QCM (OpenQuizzDB) complètent pour toujours atteindre ce total.
const TOTAL_QUESTIONS = 10;

// Au-delà de ce délai, une session restée en statut 'generating' est considérée ZOMBIE
// (process tué/redémarré avant complétion) et peut être recyclée par le rattrapage. La fenêtre
// de génération réelle est de ~40s au pire (3 retries Ollama × 8s + backoff 2s+4s), 5 min couvre
// largement sans risquer de doubler une génération réellement en cours. #74
const STALE_GENERATING_MS = 5 * 60 * 1000;

/** Fenêtre de déduplication des questions timeline (cf. §Anti-répétition de l'en-tête). */
const TIMELINE_DEDUP_WINDOW_DAYS = 60;

/** Ancienneté minimale avant qu'un QCM redevienne piochable une fois le corpus épuisé. */
const QCM_RECYCLE_GUARD_DAYS = 30;

/** Nombre d'années récemment utilisées listées au modèle comme interdites. */
const RECENT_YEARS_IN_PROMPT = 25;

const VALID_TAGS = ['Art', 'History', 'Make', 'Nature', 'Science', 'Society'] as const;

/**
 * Tranches de périodes tirées au sort à chaque génération.
 *
 * Sans contrainte de période, un 7B converge invariablement vers la même poignée de dates
 * canoniques (1789, 1492, 1969). Imposer une fenêtre force l'exploration d'autres époques et
 * constitue le principal levier de variété — davantage que la température.
 */
const PERIOD_WINDOWS: ReadonlyArray<{ min: number; max: number; label: string }> = [
  { min: 1000, max: 1400, label: 'Moyen Âge' },
  { min: 1400, max: 1600, label: 'Renaissance' },
  { min: 1600, max: 1800, label: 'époque moderne' },
  { min: 1800, max: 1900, label: 'XIXe siècle' },
  { min: 1900, max: 1960, label: 'première moitié du XXe siècle' },
  { min: 1960, max: 2025, label: 'époque contemporaine' },
];

/**
 * Construit la commande du jour pour Ollama.
 *
 * Trois sources de variation, parce qu'un prompt figé produit des questions figées :
 * thèmes imposés (rotation déterministe sur la date), période imposée (tirage aléatoire), et
 * liste d'années explicitement interdites (celles déjà tombées récemment).
 *
 * Note : l'exemple de structure JSON utilise volontairement des valeurs FICTIVES (`AAAA`). Une
 * année réelle dans l'exemple est massivement recopiée par les petits modèles — la version
 * précédente montrait « 1789 » et récoltait la Révolution française à répétition.
 *
 * @param themes - Thèmes imposés pour les 3 questions
 * @param period - Fenêtre temporelle imposée
 * @param forbiddenYears - Années déjà utilisées récemment
 */
function buildTimelinePrompt(
  themes: string[],
  period: { min: number; max: number; label: string },
  forbiddenYears: string[]
): string {
  const forbiddenLine = forbiddenYears.length > 0
    ? `\n- INTERDIT : ne propose aucune question dont la réponse est l'une de ces années déjà posées : ${forbiddenYears.join(', ')}`
    : '';

  return `Génère exactement 3 questions de type "timeline" culturelles en français.
Pour chaque question, l'utilisateur doit deviner une année.

Exigences :
- Les 3 questions portent respectivement sur ces thèmes, dans cet ordre : ${themes.join(', ')}
- Le tag de chaque question doit être exactement le thème imposé ci-dessus
- L'année correcte doit se situer entre ${period.min} et ${period.max} (${period.label})
- Choisis des événements PRÉCIS et peu évidents, pas les grands classiques scolaires${forbiddenLine}
- La plage (min/max) doit encadrer la réponse avec une marge raisonnable
- Inclure une brève explication

Retourne UNIQUEMENT un objet JSON valide avec cette structure exacte (AAAA = année à remplacer) :
{
  "questions": [
    {
      "question": "En quelle année ... ?",
      "tag": "${themes[0]}",
      "correctAnswer": "AAAA",
      "timelineRange": {"min": AAAA, "max": AAAA},
      "explanation": "Explication courte"
    }
  ]
}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function loadSelectedQuizzes(): SelectedQuizzesConfig {
  if (!fs.existsSync(SELECTED_QUIZZES_PATH)) {
    throw new Error(`Fichier de sélection non trouvé : ${SELECTED_QUIZZES_PATH}`);
  }
  return JSON.parse(fs.readFileSync(SELECTED_QUIZZES_PATH, 'utf-8'));
}

/**
 * Charge l'ensemble des IDs de questions source OpenQuizzDB déjà utilisées, dérivé directement
 * de la base (quiz_questions.source_id non nul). Remplace l'ancien used-questions.json : cet
 * historique est désormais persistant (survit à un rebuild/redeploy) puisqu'il vit dans la même
 * table que les questions générées. #73
 */
async function loadUsedSourceIds(): Promise<Set<string>> {
  const rows = await strapi.db.query('api::quiz-question.quiz-question').findMany({
    where: { source_id: { $notNull: true } },
    select: ['source_id'],
  });
  return new Set(
    rows
      .map((r: { source_id: string | null }) => r.source_id)
      .filter((id): id is string => Boolean(id))
  );
}

/**
 * IDs de questions source utilisés depuis `days` jours (fenêtre glissante).
 *
 * `createdAt` est la bonne colonne : une question est créée le jour de la génération de sa
 * session. Passer par la relation session→date imposerait une jointure pour un résultat identique.
 */
async function loadRecentSourceIds(days: number): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await strapi.db.query('api::quiz-question.quiz-question').findMany({
    where: { source_id: { $notNull: true }, createdAt: { $gte: cutoff } },
    select: ['source_id'],
  });
  return new Set(
    rows
      .map((r: { source_id: string | null }) => r.source_id)
      .filter((id): id is string => Boolean(id))
  );
}

/**
 * Années des questions timeline récemment posées, pour les interdire au modèle.
 */
async function loadRecentTimelineYears(limit: number): Promise<string[]> {
  const rows = await strapi.db.query('api::quiz-question.quiz-question').findMany({
    where: { question_type: 'timeline' },
    select: ['correct_answer'],
    orderBy: { createdAt: 'desc' },
    limit,
  });
  return [...new Set(
    rows
      .map((r: { correct_answer: string | null }) => r.correct_answer)
      .filter((a): a is string => Boolean(a))
  )];
}

/**
 * Clé de déduplication d'une question timeline.
 *
 * Volontairement construite sur (tag, réponse) et NON sur le texte : « En quelle année a débuté la
 * Révolution française ? » et « En quelle année la Révolution française a-t-elle commencé ? » sont
 * la même question pour le joueur, et un hash de texte les distinguerait. Le revers assumé est le
 * faux positif — deux événements distincts du même thème la même année sont vus comme un doublon,
 * et le second est simplement remplacé par un QCM.
 */
function makeTimelineId(tag: string, answer: string): string {
  return `tl_${tag}_${normalizeAnswer(answer)}`;
}

/**
 * Sélectionne `count` thèmes distincts pour le jour donné.
 *
 * Permutation DÉTERMINISTE dérivée de la date, et non tirage aléatoire : un rattrapage ou une
 * régénération du même jour doit reproduire la même commande, sinon deux exécutions du même quiz
 * partiraient sur des consignes différentes.
 *
 * Une simple rotation modulaire (`(dayIndex * count + i) % 6`) a été écartée : avec 6 thèmes pris
 * 3 par 3, elle ne produit que deux triplets qui alternent indéfiniment. Le mélange complet ouvre
 * les 20 combinaisons. Il n'y a volontairement AUCUNE garantie que deux jours consécutifs soient
 * disjoints : la variété thématique est un levier de diversité, pas le garde-fou anti-répétition —
 * celui-ci est la déduplication par `source_id`.
 */
function pickThemesForDay(dateKey: string, count: number): string[] {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dayIndex = Math.floor(Date.UTC(y, m - 1, d) / (24 * 60 * 60 * 1000));

  // Fisher-Yates seedé par le jour. Le générateur est un splitmix32 et non un LCG classique :
  // les bits de poids faible d'un LCG ont une période très courte, et comme `% (i + 1)` ne lit
  // QUE ces bits-là, deux jours consécutifs retombaient sur la même permutation (observé sur
  // 2026-08-25 / 2026-08-26). Aucun usage cryptographique ici, seulement du mélange cosmétique.
  const pool: string[] = [...VALID_TAGS];
  let seed = dayIndex >>> 0;
  const nextRandom = (): number => {
    seed = (seed + 0x9e3779b9) | 0;
    let t = seed ^ (seed >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return t >>> 0;
  };
  for (let i = pool.length - 1; i > 0; i--) {
    const j = nextRandom() % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, count);
}

/**
 * Nettoie le JSON mal formé d'OpenQuizzDB (parcours caractère par caractère)
 */
function sanitizeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    let text = raw;
    text = text.replace(/"difficulté"\s*:\s*(\d+\s*\/\s*\d+)/g, '"difficulté": "$1"');
    text = text.replace(/\}(\s*)\{/g, '},$1{');

    let result = '';
    let inString = false;
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      const code = text.charCodeAt(i);
      if (inString) {
        if (ch === '\\') {
          const next = text[i + 1];
          if (next === "'") { result += "'"; i += 2; }
          else if ('"\\/bfnrtu'.includes(next)) { result += ch + next; i += 2; }
          else { result += '\\\\'; i += 1; }
        } else if (ch === '"') {
          let la = i + 1;
          while (la < text.length && ' \n\r'.includes(text[la])) la++;
          const ns = text[la];
          if (ns === ':' || ns === ',' || ns === '}' || ns === ']' || ns === undefined) {
            result += ch; inString = false;
          } else { result += '\\"'; }
          i += 1;
        }
        else if (code < 0x20 || code === 0x7F) { i += 1; }
        else { result += ch; i += 1; }
      } else {
        if (ch === '"') { inString = true; }
        result += ch;
        i += 1;
      }
    }
    return JSON.parse(result);
  }
}

function makeQuestionId(quizId: number, difficulty: string, questionId: number): string {
  return `${quizId}_${difficulty}_${questionId}`;
}

async function callOllama(prompt: string, retries = 3): Promise<unknown> {
  const url = `${OLLAMA_BASE_URL}/api/generate`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt,
          format: 'json',
          stream: false,
          options: { temperature: 0.7 },
        }),
        // Borne chaque tentative. Configurable via OLLAMA_TIMEOUT_MS : l'inférence CPU dépasse
        // souvent 8s → 0 question timeline (prod neuve). Défaut prudent conservé pour le dev.
        // Cf. audit #4. En prod, docker-compose fixe OLLAMA_TIMEOUT_MS (ex. 120000).
        signal: AbortSignal.timeout(Number(process.env.OLLAMA_TIMEOUT_MS) || 8000),
      });

      if (!response.ok) {
        throw new Error(`Ollama HTTP ${response.status}`);
      }

      const data = await response.json() as { response: string };
      return JSON.parse(data.response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      strapi.log.warn(`[quiz-generator] Ollama tentative ${attempt}/${retries} échouée : ${message}`);

      if (attempt < retries) {
        // Backoff exponentiel : 2s, 4s, 8s
        await new Promise((resolve) => setTimeout(resolve, 2000 * Math.pow(2, attempt - 1)));
      }
    }
  }

  return null;
}

// ─── Fonctions principales ───────────────────────────────────────────

function pickOpenQuizzDBQuestions(
  count: number,
  usedIds: Set<string>,
  recentIds: Set<string>
): GeneratedQuestion[] {
  const config = loadSelectedQuizzes();

  // Collecter toutes les questions disponibles depuis les quiz sélectionnés
  interface AvailableQuestion {
    id: string;
    quizId: number;
    tag: string;
    question: OpenQuizzDBQuestion;
  }

  let allQuestions: AvailableQuestion[] = [];

  for (const quiz of config.quizzes) {
    const filePath = path.join(DATA_DIR, `openquizzdb_${quiz.id}.json`);
    if (!fs.existsSync(filePath)) {
      strapi.log.warn(`[quiz-generator] Fichier manquant : openquizzdb_${quiz.id}.json`);
      continue;
    }

    try {
      const data = sanitizeJson(fs.readFileSync(filePath, 'utf-8')) as OpenQuizzDBFile;

      // Gérer les deux formats : quizz.débutant ou quizz.fr.débutant
      const levels = data.quizz.fr || data.quizz;

      const difficultyKeys = ['débutant', 'confirmé', 'expert'] as const;

      for (const diffKey of difficultyKeys) {
        const questionsRaw = (levels as DifficultyLevels)[diffKey];
        if (!questionsRaw) continue;

        // Gérer tableau ou objet avec clés numérotées
        const questions: OpenQuizzDBQuestion[] = Array.isArray(questionsRaw)
          ? questionsRaw
          : Object.values(questionsRaw);

        for (const q of questions) {
          if (!q.question || !q.propositions || !q.réponse) continue;
          const qId = makeQuestionId(quiz.id, diffKey, q.id);
          allQuestions.push({
            id: qId,
            quizId: quiz.id,
            tag: quiz.tag,
            question: q,
          });
        }
      }
    } catch (err) {
      strapi.log.warn(`[quiz-generator] Erreur lecture openquizzdb_${quiz.id}.json : ${(err as Error).message}`);
    }
  }

  if (allQuestions.length === 0) {
    throw new Error('Aucune question OpenQuizzDB disponible. Vérifiez les fichiers téléchargés et selected-quizzes.json.');
  }

  // Filtrer les questions déjà utilisées (historique persistant en base, #73). Les source_id
  // des picks sont écrits sur les quiz_questions créées par generateDailyQuiz → pas d'écriture ici.
  let available = allQuestions.filter((q) => !usedIds.has(q.id));

  // Corpus épuisé : le cycle devient inévitable, mais il ne doit pas ramener la question d'hier.
  // On rouvre donc d'abord aux seules questions absentes des QCM_RECYCLE_GUARD_DAYS derniers jours
  // — une question ne peut ainsi jamais revenir à moins d'un mois d'intervalle.
  if (available.length < count) {
    const beyondGuard = allQuestions.filter((q) => !recentIds.has(q.id));
    strapi.log.info(
      `[quiz-generator] Corpus épuisé (${usedIds.size} vues / ${allQuestions.length} disponibles), ` +
      `repioche hors des ${QCM_RECYCLE_GUARD_DAYS} derniers jours (${beyondGuard.length} éligibles)`
    );
    // Garde-fou : si même cette réserve est insuffisante (corpus réduit ou fenêtre trop large),
    // on rouvre tout plutôt que de livrer un quiz incomplet.
    available = beyondGuard.length >= count ? beyondGuard : allQuestions;
    if (beyondGuard.length < count) {
      strapi.log.warn(
        `[quiz-generator] Réserve hors-garde insuffisante (${beyondGuard.length} < ${count}), repioche dans l'ensemble complet`
      );
    }
  }

  // Piocher aléatoirement
  const picked = shuffleArray(available).slice(0, count);

  // Transformer au format quiz-question Strapi
  return picked.map((q) => {
    // Mélanger les propositions pour varier la position de la bonne réponse
    const shuffledOptions = shuffleArray(q.question.propositions);

    // Aligner correct_answer sur la proposition EXACTE affichée : OpenQuizzDB peut
    // fournir une `réponse` non byte-identique à une proposition (espaces/casse/accents),
    // ce qui rendrait la bonne réponse inatteignable au scoring (égalité stricte).
    const matched = shuffledOptions.find(
      (opt) => normalizeAnswer(opt) === normalizeAnswer(q.question.réponse)
    );
    if (!matched) {
      strapi.log.warn(
        `[quiz-generator] Réponse absente des propositions (quiz ${q.quizId}, "${q.question.réponse}")`
      );
    }

    return {
      question_text: q.question.question,
      question_type: 'qcm' as const,
      correct_answer: matched || q.question.réponse,
      options: shuffledOptions,
      timeline_range: null,
      explanation: q.question.anecdote || '',
      tagName: q.tag,
      source_id: q.id,
    };
  });
}

/**
 * Génère les questions timeline du jour via Ollama, puis écarte les doublons.
 *
 * Best-effort à double titre : Ollama peut être indisponible (0 question), et les questions déjà
 * posées récemment sont rejetées. Le manque est toujours comblé par des QCM côté appelant — on
 * préfère un quiz 100 % QCM à un quiz qui repose la question d'hier.
 *
 * @param count - Nombre de questions souhaitées
 * @param dateKey - Jour de la session (pilote la rotation des thèmes)
 * @param recentIds - source_id timeline utilisés dans la fenêtre de déduplication
 */
async function generateTimelineQuestions(
  count: number,
  dateKey: string,
  recentIds: Set<string>
): Promise<GeneratedQuestion[]> {
  strapi.log.info(`[quiz-generator] Génération de ${count} questions timeline via Ollama (${OLLAMA_MODEL})...`);

  const themes = pickThemesForDay(dateKey, count);
  const period = PERIOD_WINDOWS[Math.floor(Math.random() * PERIOD_WINDOWS.length)];
  const forbiddenYears = await loadRecentTimelineYears(RECENT_YEARS_IN_PROMPT);

  strapi.log.info(
    `[quiz-generator] Commande timeline — thèmes : ${themes.join(', ')} | période : ${period.label} | ${forbiddenYears.length} années interdites`
  );

  const prompt = buildTimelinePrompt(themes, period, forbiddenYears);

  const result = await callOllama(prompt) as { questions?: Array<{
    question: string;
    tag: string;
    correctAnswer: string;
    timelineRange: { min: number; max: number };
    explanation: string;
  }> } | null;

  if (!result || !result.questions || !Array.isArray(result.questions)) {
    strapi.log.warn('[quiz-generator] Ollama indisponible ou réponse invalide, skip des questions timeline');
    return [];
  }

  const accepted: GeneratedQuestion[] = [];
  // Déduplication intra-batch : rien n'empêche le modèle de livrer deux fois le même événement
  // dans une seule réponse.
  const batchIds = new Set<string>();
  let rejected = 0;

  for (const q of result.questions) {
    if (accepted.length >= count) break;
    if (!q?.question || q.correctAnswer === undefined || q.correctAnswer === null) continue;

    const tagName = VALID_TAGS.includes(q.tag as typeof VALID_TAGS[number]) ? q.tag : 'History';
    const correctAnswer = String(q.correctAnswer);
    const sourceId = makeTimelineId(tagName, correctAnswer);

    if (recentIds.has(sourceId) || batchIds.has(sourceId)) {
      rejected++;
      continue;
    }
    batchIds.add(sourceId);

    accepted.push({
      question_text: q.question,
      question_type: 'timeline' as const,
      correct_answer: correctAnswer,
      options: null,
      timeline_range: q.timelineRange || { min: period.min, max: period.max },
      explanation: q.explanation || '',
      tagName,
      source_id: sourceId,
    });
  }

  if (rejected > 0) {
    strapi.log.info(`[quiz-generator] ${rejected} timeline écartée(s) (déjà posée(s) récemment) — complétées par des QCM`);
  }

  return accepted;
}

// ─── Service Strapi ──────────────────────────────────────────────────

export default {
  async generateDailyQuiz() {
    const today = getParisDateKey();
    strapi.log.info(`[quiz-generator] Démarrage de la génération du quiz pour ${today}`);

    // Vérifier si une session existe déjà pour aujourd'hui
    const existingSession = await strapi.db.query('api::quiz-session.quiz-session').findOne({
      where: { date: today },
    });

    let session: any;

    if (existingSession) {
      if (existingSession.generation_status === 'completed') {
        strapi.log.info(`[quiz-generator] Session déjà complétée pour ${today}, skip`);
        return;
      }

      // Rattrapage (#74) : une session 'failed' / 'pending', ou 'generating' ZOMBIE (process tué
      // avant complétion, ex. downtime couvrant minuit), doit être recyclée — sinon getTodaySession
      // renvoie null toute la journée (404 permanent). Claim ATOMIQUE : la session n'est recyclée
      // que si elle est 'failed'/'pending' OU 'generating' périmée. Deux rattrapages concurrents se
      // sérialisent (un seul obtient count === 1) ; une génération réellement en cours (statut
      // 'generating' frais) n'est jamais doublée.
      const staleCutoff = new Date(Date.now() - STALE_GENERATING_MS);
      const claim = await strapi.db.query('api::quiz-session.quiz-session').updateMany({
        where: {
          id: existingSession.id,
          $or: [
            { generation_status: { $in: ['failed', 'pending'] } },
            { generation_status: 'generating', updatedAt: { $lt: staleCutoff } },
          ],
        },
        data: { generation_status: 'generating', generation_error: null },
      });

      if (!claim || claim.count === 0) {
        strapi.log.info(`[quiz-generator] Session ${today} en statut "${existingSession.generation_status}" non recyclable (génération active ou concurrente), skip`);
        return;
      }

      strapi.log.info(`[quiz-generator] Recyclage de la session ${today} (statut précédent : ${existingSession.generation_status})`);
      // Purger les questions partielles/orphelines de la tentative précédente avant de régénérer.
      await strapi.db.query('api::quiz-question.quiz-question').deleteMany({
        where: { session: { id: existingSession.id } },
      });
      session = existingSession;
    } else {
      // Créer la session en status "generating". La colonne `date` est UNIQUE : si une
      // génération concurrente (cron + rattrapage à la demande) la crée au même moment,
      // la seconde lève une violation de contrainte → on s'arrête proprement.
      try {
        session = await strapi.documents('api::quiz-session.quiz-session').create({
          data: {
            date: today,
            generation_status: 'generating',
          },
        });
      } catch (err) {
        // La création peut échouer car une génération concurrente a déjà créé la session
        // (contrainte unique sur `date`). On ne traite ce cas comme "skip" QUE si une session
        // existe désormais ; sinon c'est une vraie erreur qu'on propage.
        const concurrent = await strapi.db.query('api::quiz-session.quiz-session').findOne({
          where: { date: today },
          select: ['id'],
        });
        if (concurrent) {
          strapi.log.info(`[quiz-generator] Génération concurrente détectée pour ${today}, skip`);
          return;
        }
        throw err;
      }
    }

    try {
      // Historique anti-répétition persistant (#73) : dérivé de la base (source_id), jamais d'un
      // fichier. Deux portées : complète pour les QCM, glissante pour les timeline et pour le
      // repli de fin de corpus (cf. §Anti-répétition en tête de fichier).
      const usedIds = await loadUsedSourceIds();
      const recentTimelineIds = await loadRecentSourceIds(TIMELINE_DEDUP_WINDOW_DAYS);
      const recentQcmIds = await loadRecentSourceIds(QCM_RECYCLE_GUARD_DAYS);

      // 1. Questions timeline via Ollama (best-effort : 0 à 3 selon disponibilité ET unicité)
      const timelineQuestions = await generateTimelineQuestions(3, today, recentTimelineIds);
      strapi.log.info(`[quiz-generator] ${timelineQuestions.length} timeline retenues`);

      // 2. QCM OpenQuizzDB : compléter pour TOUJOURS atteindre TOTAL_QUESTIONS. Si Ollama
      // est indisponible (0 timeline), on pioche d'autant plus de QCM plutôt que de livrer
      // un quiz dégradé à 7 questions au score maximal incohérent.
      const qcmQuestions = pickOpenQuizzDBQuestions(
        TOTAL_QUESTIONS - timelineQuestions.length,
        usedIds,
        recentQcmIds
      );
      strapi.log.info(`[quiz-generator] ${qcmQuestions.length} QCM piochés depuis OpenQuizzDB`);

      // Combiner et mélanger
      const allQuestions = shuffleArray([...qcmQuestions, ...timelineQuestions]);

      if (allQuestions.length === 0) {
        throw new Error('Aucune question générée');
      }

      // Récupérer les tags depuis la base
      const tags = await strapi.db.query('api::tag.tag').findMany({});
      const tagMap = new Map(tags.map((t: { documentId: string; name: string }) => [t.name, t.documentId]));

      // Créer les questions en base
      for (let i = 0; i < allQuestions.length; i++) {
        const q = allQuestions[i];
        const tagDocumentId = tagMap.get(q.tagName) || null;

        if (!tagDocumentId) {
          strapi.log.warn(`[quiz-generator] Tag "${q.tagName}" non trouvé en base`);
        }

        await strapi.documents('api::quiz-question.quiz-question').create({
          data: {
            question_text: q.question_text,
            question_type: q.question_type,
            order: i + 1,
            correct_answer: q.correct_answer,
            options: q.options,
            timeline_range: q.timeline_range,
            explanation: q.explanation,
            session: session.documentId,
            tag: tagDocumentId,
            source_id: q.source_id,
          },
        });
      }

      // Mettre à jour la session comme completed
      await strapi.documents('api::quiz-session.quiz-session').update({
        documentId: session.documentId,
        data: {
          generation_status: 'completed',
          generated_at: new Date().toISOString(),
        },
      });

      strapi.log.info(
        `[quiz-generator] Quiz du ${today} généré avec succès : ${qcmQuestions.length} QCM + ${timelineQuestions.length} timeline`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      strapi.log.error(`[quiz-generator] Erreur lors de la génération : ${message}`);

      // Marquer la session comme failed
      await strapi.documents('api::quiz-session.quiz-session').update({
        documentId: session.documentId,
        data: {
          generation_status: 'failed',
          generation_error: message,
        },
      });
    }
  },
};
