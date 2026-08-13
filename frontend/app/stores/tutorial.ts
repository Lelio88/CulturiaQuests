import { defineStore } from 'pinia'
import { TUTORIAL_STEPS, type TutorialStep } from '~/data/tutorial-steps'

/**
 * Store du tutoriel d'accueil (#175).
 *
 * Pilote l'avancement du didacticiel joué au premier lancement : quelle étape est affichée, si le
 * joueur l'a terminé ou passé, et s'il l'a relancé depuis les réglages.
 *
 * Choix non-évidents :
 * - **Progression persistée par identifiant d'étape** (`lastStepId`) et non par index : insérer ou
 *   réordonner une étape dans `tutorial-steps.ts` ne doit pas téléporter au mauvais endroit les
 *   joueurs qui avaient interrompu le tutoriel.
 * - **`isCompleted` couvre aussi l'abandon.** Un joueur qui passe le tutoriel ne doit pas le revoir
 *   à chaque lancement ; il le relance explicitement via `restart()`.
 * - **Persistance localStorage** comme tout le reste des stores : la persistance cookie est
 *   proscrite dans ce projet (erreur 431).
 *
 * Invariant : `start()` est sans effet si le tutoriel a déjà été terminé ou passé — c'est ce qui
 * garantit qu'il ne se déclenche qu'au tout premier lancement. Seul `restart()` outrepasse.
 *
 * @example
 * const tutorial = useTutorialStore()
 * tutorial.start()   // no-op si déjà vu
 * tutorial.next()    // étape suivante, termine si c'était la dernière
 */
export const useTutorialStore = defineStore('tutorial', () => {
  // State
  const isActive = ref(false)
  const isCompleted = ref(false)
  const lastStepId = ref<string | null>(null)

  // Getters
  const steps = computed<TutorialStep[]>(() => TUTORIAL_STEPS)

  const currentIndex = computed(() => {
    if (!lastStepId.value) return 0
    const index = steps.value.findIndex(s => s.id === lastStepId.value)
    // Étape disparue d'une version à l'autre → on reprend au début plutôt que de bloquer.
    return index === -1 ? 0 : index
  })

  const currentStep = computed<TutorialStep | null>(
    () => (isActive.value ? steps.value[currentIndex.value] ?? null : null)
  )

  const isLastStep = computed(() => currentIndex.value >= steps.value.length - 1)

  const progress = computed(() => ({
    current: currentIndex.value + 1,
    total: steps.value.length,
  }))

  // Actions

  /** Démarre le tutoriel. Sans effet s'il a déjà été terminé ou passé. */
  function start() {
    if (isCompleted.value || isActive.value) return
    if (steps.value.length === 0) return
    if (!lastStepId.value) lastStepId.value = steps.value[0]!.id
    isActive.value = true
  }

  /** Passe à l'étape suivante, ou termine le tutoriel si c'était la dernière. */
  function next() {
    if (!isActive.value) return
    if (isLastStep.value) {
      finish()
      return
    }
    lastStepId.value = steps.value[currentIndex.value + 1]!.id
  }

  /** Revient à l'étape précédente (sans effet sur la première). */
  function previous() {
    if (!isActive.value || currentIndex.value === 0) return
    lastStepId.value = steps.value[currentIndex.value - 1]!.id
  }

  /** Termine le tutoriel : il ne se relancera plus seul. */
  function finish() {
    isActive.value = false
    isCompleted.value = true
    lastStepId.value = null
  }

  /** Abandon volontaire. Même effet que `finish` — le joueur ne veut plus le voir. */
  function skip() {
    finish()
  }

  /** Relance le tutoriel depuis le début, à la demande explicite du joueur. */
  function restart() {
    isCompleted.value = false
    lastStepId.value = steps.value[0]?.id ?? null
    isActive.value = steps.value.length > 0
  }

  return {
    // State
    isActive,
    isCompleted,
    lastStepId,
    // Getters
    steps,
    currentStep,
    currentIndex,
    isLastStep,
    progress,
    // Actions
    start,
    next,
    previous,
    finish,
    skip,
    restart,
  }
}, {
  // Seule la mémoire du « déjà vu » mérite d'être persistée : `isActive` ne l'est pas, pour qu'un
  // rechargement en plein tutoriel ne rouvre pas l'overlay par surprise au prochain démarrage.
  persist: {
    pick: ['isCompleted', 'lastStepId'],
  },
})
