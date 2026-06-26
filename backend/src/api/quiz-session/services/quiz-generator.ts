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
 * Invariants :
 * - 1 seule session par jour (contrainte UNIQUE sur quiz_sessions.date) ; getTodaySession ne
 *   renvoie qu'une session 'completed'.
 * - source_id n'est renseigné QUE sur les QCM OpenQuizzDB (clé de déduplication). Les timeline
 *   Ollama ont source_id = null.
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

const TIMELINE_PROMPT = `Génère exactement 3 questions de type "timeline" culturelles en français.
Pour chaque question, l'utilisateur doit deviner une année.

Exigences :
- Questions variées : histoire, art, sciences, nature, société ou savoir-faire
- Chaque question doit avoir un tag parmi : Art, History, Make, Nature, Science, Society
- L'année correcte doit être entre 1000 et 2025
- La plage (min/max) doit encadrer la réponse avec une marge raisonnable
- Inclure une brève explication

Retourne UNIQUEMENT un objet JSON valide avec cette structure exacte :
{
  "questions": [
    {
      "question": "En quelle année ... ?",
      "tag": "History",
      "correctAnswer": "1789",
      "timelineRange": {"min": 1700, "max": 1850},
      "explanation": "Explication courte"
    }
  ]
}`;

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
        // Borne chaque tentative (évite un hang indéfini, notamment via la génération
        // à la demande déclenchée depuis une requête GET).
        signal: AbortSignal.timeout(8000),
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

function pickOpenQuizzDBQuestions(count: number, usedIds: Set<string>): GeneratedQuestion[] {
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

  // Corpus presque épuisé : on repioche dans l'ensemble complet (cycle). La répétition devient
  // alors inévitable mais le tirage reste aléatoire chaque jour.
  if (available.length < count) {
    strapi.log.info(`[quiz-generator] Corpus presque épuisé (${usedIds.size} questions déjà vues / ${allQuestions.length} disponibles), repioche dans l'ensemble complet`);
    available = allQuestions;
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

async function generateTimelineQuestions(count: number): Promise<GeneratedQuestion[]> {
  strapi.log.info(`[quiz-generator] Génération de ${count} questions timeline via Ollama (${OLLAMA_MODEL})...`);

  const result = await callOllama(TIMELINE_PROMPT) as { questions?: Array<{
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

  const validTags = ['Art', 'History', 'Make', 'Nature', 'Science', 'Society'];

  return result.questions.slice(0, count).map((q) => ({
    question_text: q.question,
    question_type: 'timeline' as const,
    correct_answer: String(q.correctAnswer),
    options: null,
    timeline_range: q.timelineRange || { min: 1800, max: 2025 },
    explanation: q.explanation || '',
    tagName: validTags.includes(q.tag) ? q.tag : 'History',
    source_id: null,
  }));
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
      // Historique anti-répétition persistant (#73) : dérivé de la base (source_id), jamais d'un fichier.
      const usedIds = await loadUsedSourceIds();

      // 1. Questions timeline via Ollama (best-effort : 0 à 3 selon disponibilité)
      const timelineQuestions = await generateTimelineQuestions(3);
      strapi.log.info(`[quiz-generator] ${timelineQuestions.length} timeline générées via Ollama`);

      // 2. QCM OpenQuizzDB : compléter pour TOUJOURS atteindre TOTAL_QUESTIONS. Si Ollama
      // est indisponible (0 timeline), on pioche d'autant plus de QCM plutôt que de livrer
      // un quiz dégradé à 7 questions au score maximal incohérent.
      const qcmQuestions = pickOpenQuizzDBQuestions(TOTAL_QUESTIONS - timelineQuestions.length, usedIds);
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
