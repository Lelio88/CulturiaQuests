/**
 * Contenu du tutoriel d'accueil, joué au premier lancement (#175).
 *
 * Séparé de la mécanique (`stores/tutorial.ts`) et du rendu (`components/tutorial/`) pour que le
 * texte se réécrive sans toucher au code : c'est le fichier à ouvrir pour ajuster le ton, le lore
 * ou l'ordre des explications.
 *
 * Deux natures d'étape :
 * - `target: null` → étape narrative, la bulle du PNJ occupe le centre de l'écran (lore, accueil).
 * - `target: '<clé>'` → étape guidée, l'élément portant `data-tutorial="<clé>"` est détouré dans le
 *   masque et la bulle se place à côté. Si l'élément est absent du DOM (page différente, footer
 *   masqué), l'étape retombe automatiquement en mode narratif — elle n'est jamais bloquante.
 *
 * Invariants :
 * - Toute clé `target` utilisée ici doit exister comme attribut `data-tutorial` dans un composant,
 *   sinon l'étape perd son ancrage visuel (sans casser le tutoriel).
 * - **Le narrateur ne se nomme jamais.** Le guide est le maître de guilde sortant, dont l'identité
 *   reste à arrêter (#177) ; ne pas lui donner de nom ici permet de changer le personnage et ses
 *   visuels sans réécrire une ligne de dialogue.
 *
 * Repères de lore respectés ici — le joueur est le NOUVEAU maître de guilde, pas une recrue :
 * royaume de Culturia, en guerre depuis des décennies ; Monarque, souveraine que nul n'a vue et
 * dont certains doutent de l'existence ; des brèches ouvertes dans les musées, d'où sortent des
 * monstres qui s'attaquent à la culture elle-même ; des expéditions envoyées dans ces bastions,
 * que l'on MONTE palier après palier (jamais « descendre ») ; des héros vieillissants, premiers à
 * avoir affronté les brèches, et des civils dont les récits se débloquent dans le journal.
 */

export interface TutorialStep {
  /** Identifiant stable de l'étape (sert à reprendre le tutoriel où il s'est arrêté). */
  id: string
  /** Clé `data-tutorial` de l'élément à détourer, ou `null` pour une étape narrative. */
  target: string | null
  /**
   * Expression du PNJ. `neutre` désigne le portrait par défaut, dont le fichier porte le NOM du
   * personnage (`Bram.webp`, `Theodric.webp`…) : la valeur reste générique pour qu'un changement
   * de narrateur ne touche pas ces données. Les autres correspondent au nom de fichier tel quel.
   */
  mood: 'neutre' | 'Quest' | 'Reflechi' | 'Succes'
  /** Lignes affichées successivement dans la bulle. */
  lines: string[]
}

/**
 * PNJ narrateur du tutoriel. Doit exister dans `public/assets/npc/<nom>/`.
 *
 * ⚠️ Bram est un PLACEHOLDER technique : ses visuels existaient déjà. Le narrateur retenu est
 * **Théodric Vaelmont, dit « le Vieux Maître »**, le maître de guilde sortant — il ne manque que
 * ses visuels (#177).
 *
 * Pour basculer, une fois `public/assets/npc/Theodric/` peuplé : passer cette constante à
 * `'Theodric'`. **C'est le seul changement à faire.** Les étapes ci-dessous ne référencent aucun
 * nom (le portrait par défaut est désigné par `neutre`, résolu dans `TutorialOverlay`), et aucune
 * réplique ne nomme le narrateur.
 */
export const TUTORIAL_NPC = 'Bram'

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    target: null,
    mood: 'neutre',
    lines: [
      "Te voilà. J'ai attendu longtemps quelqu'un pour reprendre cette guilde.",
      "Mes mains ne tiennent plus une carte bien longtemps, alors elles vont te la tendre.",
      "Écoute-moi une dernière fois, et après, la guilde sera la tienne.",
    ],
  },
  {
    id: 'lore',
    target: null,
    mood: 'Reflechi',
    lines: [
      "Culturia est en guerre depuis des décennies. Assez pour que les enfants d'alors soient devenus vieux.",
      "Ça a commencé par des brèches. Elles ne se sont pas ouvertes au hasard : on les a ouvertes. Dans nos musées.",
      "Et ce qui en sort ne pille rien. Les toiles restent aux murs — c'est le souvenir de ce qu'elles racontent qui s'en va.",
      "On dit que Monarque veille sur nous. Personne ne l'a jamais vue. Certains doutent même qu'elle existe.",
      "Il ne reste plus grand-chose de son armée. Alors le trône a signé des chartes, et confié les brèches aux guildes.",
      "Celle-ci est la tienne, désormais.",
    ],
  },
  {
    id: 'map',
    target: 'map',
    mood: 'Quest',
    lines: [
      "Voilà le royaume. Ce point, c'est toi — ta position réelle, pas un pion qu'on pousse du doigt.",
      "Le reste est vierge : nos cartes ne montrent que ce que la guilde a arpenté. Marche, et le relevé se fera de lui-même.",
    ],
  },
  {
    id: 'poi',
    target: 'map',
    mood: 'Quest',
    lines: [
      "Ces marqueurs sont nos ancrages. Des lieux où le souvenir tient encore, et que la guilde entretient pour qu'il tienne demain.",
      "On y laisse aussi de quoi se ravitailler. Pour l'ouvrir, sois sur place : à moins de cinquante mètres. La terre ne se laisse pas raconter d'histoires.",
      "Une cache vidée se regarnit en un jour. Repasse demain.",
    ],
  },
  {
    id: 'expedition',
    target: 'map',
    mood: 'Reflechi',
    lines: [
      "Les musées, eux, sont devenus des bastions. Une brèche y est ouverte, et la vermine y campe.",
      "On n'y entre pas seul. Tu enverras des compagnons, et ils monteront palier après palier vers le cœur de la brèche.",
      "Ne te fais pas d'illusions : on ne la referme pas. On la contient, on gagne du temps, et on y retourne.",
      "Mais plus ils montent, plus ce qu'ils arrachent à l'oubli a de la valeur.",
    ],
  },
  {
    id: 'guild',
    target: 'guild',
    mood: 'neutre',
    lines: [
      "Ta guilde t'attend ici. Tes compagnons, ton or, ton renom.",
      "Chaque expédition la fait grandir, et une guilde qui grandit attire du monde.",
      "Le bourg autour vit de nous, et nous vivons de lui. Prends le temps d'écouter ses gens : ils ont plus à raconter qu'il n'y paraît.",
    ],
  },
  {
    id: 'equipment',
    target: 'equipement',
    mood: 'Quest',
    lines: [
      "N'envoie jamais quelqu'un là-haut les mains nues. Arme, casque, charme.",
      "Le plus gros vient des bastions eux-mêmes. Pour le reste, va voir Denrick à la forge : il refait des lames depuis qu'il a cessé d'en porter.",
      "Chaque pièce a son affinité. Accorde-la à ce que le bastion protège, et tes compagnons en reviendront bien plus chargés.",
    ],
  },
  {
    id: 'quiz',
    target: 'social',
    mood: 'Reflechi',
    lines: [
      "Ici, les autres maîtres de guilde. Et les questions du jour.",
      "Ça peut sembler un jeu. Ça n'en est pas un : ce que ces monstres viennent effacer, c'est exactement ce que tu retiens là.",
      "Dix questions par jour. Tiens la cadence et ta série grandit. Manque un jour, elle repart de zéro.",
    ],
  },
  {
    id: 'journal',
    target: 'stories',
    mood: 'Succes',
    lines: [
      "Ton journal. Ce ne sont pas tes notes : ce sont leurs mots à eux, recueillis un à un.",
      "Tu y trouveras aussi les héros des premières brèches. Ils sont vieux, à présent, et quelques-uns ne répondront plus. Ces pages sont tout ce qu'il en reste.",
      "C'est le vrai butin, maître de guilde. Le reste se dépense.",
      "Voilà. Je n'ai plus rien à t'apprendre que la route ne t'apprendra mieux.",
      "Va. Culturia t'attend.",
    ],
  },
]
