import { defineStore } from 'pinia'
import type {
  QuizQuestion,
  QuizAttempt,
  QuizSubmitResult,
  LeaderboardEntry,
  GetTodayQuizResponse,
  SubmitQuizResponse,
  LeaderboardResponse,
  GetAttemptResponse,
} from '~/types/quiz'
import type { QuizAnswer } from '~/types/quiz'

/**
 * Store du quiz quotidien : pilote une session de quiz (questions, navigation,
 * réponses, soumission) et expose le leaderboard du jour.
 *
 * Choix non-évidents :
 * - Écrit en setup store (comme les autres stores du projet) ; converti depuis l'Options API (#47).
 * - La date de la session (`sessionDate`) est décidée par le backend (fenêtre
 *   Europe/Paris) : le front ne la calcule jamais, il l'affiche telle quelle.
 * - Le statut HTTP d'erreur est lu en priorité sur `e.statusCode` car les appels
 *   transitent par le proxy BFF (repli sur les anciennes formes Strapi).
 * - Garde de réentrance sur `submitQuiz` (flag `submitting`) pour bloquer un
 *   double-submit (double-clic / requêtes concurrentes).
 *
 * Invariants :
 * - La persistance localStorage est PARTIELLE et MANUELLE (clé `quiz_current_session` :
 *   sessionId, answers, currentIndex, startTime) — délibérément PAS via pinia-plugin-persistedstate,
 *   car la restauration est SESSION-SCOPÉE : `loadSavedAnswers` ne restaure que si le `sessionId`
 *   sauvegardé correspond à la session courante, sinon il purge le cache (sans quoi, au changement
 *   de jour, d'anciennes réponses seraient restaurées sur une nouvelle session). Un plugin de
 *   persistance ne sait pas répliquer cette garde.
 * - Aucune persistance en cookie (cf. CLAUDE.md, risque d'erreur 431).
 * - Le localStorage est vidé après soumission réussie ou si le quiz est déjà complété.
 *
 * Usage canonique :
 *   const quiz = useQuizStore()
 *   await quiz.fetchTodayQuiz()
 *   quiz.selectAnswer('B'); quiz.nextQuestion()
 *   if (quiz.isComplete) await quiz.submitQuiz()
 */
export const useQuizStore = defineStore('quiz', () => {
  // ─── State ───────────────────────────────────────────────────────────
  // Session
  const sessionId = ref<string | null>(null)
  const sessionDate = ref<string | null>(null)
  const questions = ref<QuizQuestion[]>([])

  // Progression
  const currentIndex = ref(0)
  const answers = ref<Record<string, string>>({})
  const quizFinished = ref(false)
  const startTime = ref(0)
  const finishedAt = ref(0)

  // Résultats
  const submitResult = ref<QuizSubmitResult | null>(null)
  const alreadyCompleted = ref(false)
  const existingAttempt = ref<QuizAttempt | null>(null)

  // Leaderboard
  const leaderboard = ref<LeaderboardEntry[]>([])

  // UI State
  const loading = ref(false)
  const submitting = ref(false)
  const leaderboardLoading = ref(false)
  const error = ref<string | null>(null)

  // ─── Getters ─────────────────────────────────────────────────────────
  const currentQuestion = computed<QuizQuestion | null>(
    () => questions.value[currentIndex.value] || null
  )

  const selectedAnswer = computed<string | null>(() => {
    const q = currentQuestion.value
    return q ? answers.value[q.documentId] || null : null
  })

  const answeredCount = computed(() => Object.keys(answers.value).length)

  const isComplete = computed(
    () => answeredCount.value === questions.value.length && questions.value.length > 0
  )

  const timeSpentSeconds = computed(() =>
    finishedAt.value > 0 ? Math.round((finishedAt.value - startTime.value) / 1000) : 0
  )

  // ─── Actions ─────────────────────────────────────────────────────────
  async function fetchTodayQuiz() {
    const client = useApi()
    loading.value = true
    error.value = null
    alreadyCompleted.value = false
    existingAttempt.value = null

    try {
      const res = await client<GetTodayQuizResponse>('/quiz-attempts/today', { method: 'GET' })

      if (res.data.alreadyCompleted) {
        alreadyCompleted.value = true
        existingAttempt.value = res.data.attempt || null
        // Nettoyer le localStorage si le quiz est déjà complété
        clearSavedAnswers()
      } else {
        sessionId.value = res.data.sessionId || null
        sessionDate.value = res.data.date || null
        questions.value = res.data.questions || []
        resetQuizState()
        // Restaurer les réponses sauvegardées si elles existent
        loadSavedAnswers()
      }

      await fetchLeaderboard()
    } catch (e: unknown) {
      const err = e as any
      // Via le proxy BFF, le statut est sur e.statusCode (repli sur les anciennes formes).
      const status = err?.statusCode ?? err?.error?.status ?? err?.data?.error?.status
      if (status === 404) {
        error.value = "Aucun quiz disponible pour aujourd'hui. Revenez plus tard !"
      } else {
        error.value = extractApiError(err, 'Erreur')
      }
    } finally {
      loading.value = false
    }
  }

  async function fetchLeaderboard() {
    const client = useApi()
    leaderboardLoading.value = true

    try {
      const res = await client<LeaderboardResponse>('/quiz-attempts/leaderboard', { method: 'GET' })
      leaderboard.value = res.data || []
    } catch (e: unknown) {
      console.error('Leaderboard error:', e)
    } finally {
      leaderboardLoading.value = false
    }
  }

  async function submitQuiz() {
    // Garde de réentrance : empêche un double-submit (double-clic / requêtes concurrentes)
    if (submitting.value) return
    if (!sessionId.value) {
      error.value = 'Session non trouvée'
      return
    }

    const client = useApi()
    submitting.value = true
    error.value = null

    try {
      const formattedAnswers: QuizAnswer[] = questions.value.map((q) => ({
        questionId: q.documentId,
        answer: answers.value[q.documentId] || '',
      }))

      const res = await client<SubmitQuizResponse>('/quiz-attempts/submit', {
        method: 'POST',
        body: {
          sessionId: sessionId.value,
          answers: formattedAnswers,
          timeSpentSeconds: timeSpentSeconds.value,
        },
      })

      submitResult.value = res.data
      // Nettoyer le localStorage après soumission réussie
      clearSavedAnswers()
      await fetchLeaderboard()
    } catch (e: unknown) {
      error.value = extractApiError(e, 'Erreur lors de la soumission')
    } finally {
      submitting.value = false
    }
  }

  async function fetchResults(documentId: string) {
    const client = useApi()
    loading.value = true
    error.value = null

    try {
      const res = await client<GetAttemptResponse>(`/quiz-attempts/${documentId}`, {
        method: 'GET',
        params: {
          populate: {
            guild: { fields: ['quiz_streak'] },
          },
        },
      })

      const data = res.data
      submitResult.value = {
        attempt: {
          documentId: data.documentId,
          score: data.score,
          completed_at: data.completed_at,
        },
        score: data.score,
        rewards: data.rewards || { tier: 'bronze', gold: 0, exp: 0, items: [] },
        detailedAnswers: (data as any).answers || [],
        newStreak: data.guild?.quiz_streak || 0,
      }
    } catch (e: unknown) {
      error.value = extractApiError(e, 'Erreur lors du chargement des résultats')
    } finally {
      loading.value = false
    }
  }

  // Navigation
  function selectAnswer(answer: string) {
    const q = currentQuestion.value
    if (quizFinished.value || !q) return
    answers.value[q.documentId] = answer
    // Sauvegarder automatiquement dans localStorage
    saveAnswers()
  }

  function nextQuestion() {
    if (currentIndex.value < questions.value.length - 1) {
      currentIndex.value++
      saveAnswers()
    } else {
      quizFinished.value = true
      finishedAt.value = Date.now()
      saveAnswers()
    }
  }

  function prevQuestion() {
    if (currentIndex.value > 0) {
      currentIndex.value--
      saveAnswers()
    }
  }

  function goBackToQuestions() {
    quizFinished.value = false
  }

  // Reset
  function resetQuizState() {
    currentIndex.value = 0
    answers.value = {}
    quizFinished.value = false
    submitResult.value = null
    startTime.value = Date.now()
    finishedAt.value = 0
  }

  function resetAll() {
    clearSavedAnswers()
    // Réinitialisation manuelle (les setup stores n'ont pas de $reset)
    sessionId.value = null
    sessionDate.value = null
    questions.value = []
    currentIndex.value = 0
    answers.value = {}
    quizFinished.value = false
    startTime.value = 0
    finishedAt.value = 0
    submitResult.value = null
    alreadyCompleted.value = false
    existingAttempt.value = null
    leaderboard.value = []
    loading.value = false
    submitting.value = false
    leaderboardLoading.value = false
    error.value = null
  }

  // LocalStorage management (session-scopé : cf. invariants du JSDoc)
  function saveAnswers() {
    if (!sessionId.value) return
    try {
      const data = {
        sessionId: sessionId.value,
        answers: answers.value,
        currentIndex: currentIndex.value,
        startTime: startTime.value,
      }
      localStorage.setItem('quiz_current_session', JSON.stringify(data))
    } catch (e) {
      console.warn('Failed to save quiz answers to localStorage:', e)
    }
  }

  function loadSavedAnswers() {
    if (!sessionId.value) return
    try {
      const saved = localStorage.getItem('quiz_current_session')
      if (!saved) return

      const data = JSON.parse(saved)
      // Vérifier que c'est la même session
      if (data.sessionId === sessionId.value) {
        answers.value = data.answers || {}
        currentIndex.value = data.currentIndex || 0
        startTime.value = data.startTime || Date.now()
      } else {
        // Session différente, nettoyer
        clearSavedAnswers()
      }
    } catch (e) {
      console.warn('Failed to load quiz answers from localStorage:', e)
      clearSavedAnswers()
    }
  }

  function clearSavedAnswers() {
    try {
      localStorage.removeItem('quiz_current_session')
    } catch (e) {
      console.warn('Failed to clear quiz answers from localStorage:', e)
    }
  }

  return {
    // State
    sessionId,
    sessionDate,
    questions,
    currentIndex,
    answers,
    quizFinished,
    startTime,
    finishedAt,
    submitResult,
    alreadyCompleted,
    existingAttempt,
    leaderboard,
    loading,
    submitting,
    leaderboardLoading,
    error,
    // Getters
    currentQuestion,
    selectedAnswer,
    answeredCount,
    isComplete,
    timeSpentSeconds,
    // Actions
    fetchTodayQuiz,
    fetchLeaderboard,
    submitQuiz,
    fetchResults,
    selectAnswer,
    nextQuestion,
    prevQuestion,
    goBackToQuestions,
    resetQuizState,
    resetAll,
    saveAnswers,
    loadSavedAnswers,
    clearSavedAnswers,
  }
})
