import { defineStore } from 'pinia'
import type {
  QuizQuestion,
  QuizAnswer,
  QuizAttempt,
  QuizSubmitResult,
  LeaderboardEntry,
  GetTodayQuizResponse,
  SubmitQuizResponse,
  LeaderboardResponse,
  GetAttemptResponse,
} from '~/types/quiz'

interface QuizState {
  // Session
  sessionId: string | null
  sessionDate: string | null
  questions: QuizQuestion[]

  // Progression
  currentIndex: number
  answers: Record<string, string>
  quizFinished: boolean
  startTime: number
  finishedAt: number

  // Résultats
  submitResult: QuizSubmitResult | null
  alreadyCompleted: boolean
  existingAttempt: QuizAttempt | null

  // Leaderboard
  leaderboard: LeaderboardEntry[]

  // UI State
  loading: boolean
  submitting: boolean
  leaderboardLoading: boolean
  error: string | null
}

/**
 * Store du quiz quotidien : pilote une session de quiz (questions, navigation,
 * réponses, soumission) et expose le leaderboard du jour.
 *
 * Choix non-évidents :
 * - Seul store du projet écrit en Options API (les autres sont en setup store).
 * - La date de la session (`sessionDate`) est décidée par le backend (fenêtre
 *   Europe/Paris) : le front ne la calcule jamais, il l'affiche telle quelle.
 * - Le statut HTTP d'erreur est lu en priorité sur `e.statusCode` car les appels
 *   transitent par le proxy BFF (repli sur les anciennes formes Strapi).
 * - Garde de réentrance sur `submitQuiz` (flag `submitting`) pour bloquer un
 *   double-submit (double-clic / requêtes concurrentes).
 *
 * Invariants :
 * - La persistance localStorage est PARTIELLE et manuelle (clé
 *   `quiz_current_session` : sessionId, answers, currentIndex, startTime) — il
 *   n'y a pas de plugin de persistance Pinia ici. Les réponses ne sont restaurées
 *   que si `sessionId` correspond à la session courante, sinon le cache est purgé.
 * - Aucune persistance en cookie (cf. CLAUDE.md, risque d'erreur 431).
 * - Le localStorage est vidé après soumission réussie ou si le quiz est déjà
 *   complété pour la journée.
 *
 * Usage canonique :
 *   const quiz = useQuizStore()
 *   await quiz.fetchTodayQuiz()
 *   quiz.selectAnswer('B'); quiz.nextQuestion()
 *   if (quiz.isComplete) await quiz.submitQuiz()
 */
export const useQuizStore = defineStore('quiz', {
  state: (): QuizState => ({
    sessionId: null,
    sessionDate: null,
    questions: [],
    currentIndex: 0,
    answers: {},
    quizFinished: false,
    startTime: 0,
    finishedAt: 0,
    submitResult: null,
    alreadyCompleted: false,
    existingAttempt: null,
    leaderboard: [],
    loading: false,
    submitting: false,
    leaderboardLoading: false,
    error: null,
  }),

  getters: {
    currentQuestion: (state): QuizQuestion | null =>
      state.questions[state.currentIndex] || null,

    selectedAnswer(): string | null {
      const q = this.currentQuestion
      return q ? this.answers[q.documentId] || null : null
    },

    answeredCount: (state): number =>
      Object.keys(state.answers).length,

    isComplete(): boolean {
      return this.answeredCount === this.questions.length && this.questions.length > 0
    },

    timeSpentSeconds: (state): number =>
      state.finishedAt > 0 ? Math.round((state.finishedAt - state.startTime) / 1000) : 0,
  },

  actions: {
    async fetchTodayQuiz() {
      const client = useApi()
      this.loading = true
      this.error = null
      this.alreadyCompleted = false
      this.existingAttempt = null

      try {
        const res = await client<GetTodayQuizResponse>('/quiz-attempts/today', { method: 'GET' })

        if (res.data.alreadyCompleted) {
          this.alreadyCompleted = true
          this.existingAttempt = res.data.attempt || null
          // Nettoyer le localStorage si le quiz est déjà complété
          this.clearSavedAnswers()
        } else {
          this.sessionId = res.data.sessionId || null
          this.sessionDate = res.data.date || null
          this.questions = res.data.questions || []
          this.resetQuizState()
          // Restaurer les réponses sauvegardées si elles existent
          this.loadSavedAnswers()
        }

        await this.fetchLeaderboard()
      } catch (e: unknown) {
        const error = e as any
        // Via le proxy BFF, le statut est sur e.statusCode (repli sur les anciennes formes).
        const status = error?.statusCode ?? error?.error?.status ?? error?.data?.error?.status
        if (status === 404) {
          this.error = "Aucun quiz disponible pour aujourd'hui. Revenez plus tard !"
        } else {
          this.error = extractApiError(error, 'Erreur')
        }
      } finally {
        this.loading = false
      }
    },

    async fetchLeaderboard() {
      const client = useApi()
      this.leaderboardLoading = true

      try {
        const res = await client<LeaderboardResponse>('/quiz-attempts/leaderboard', { method: 'GET' })
        this.leaderboard = res.data || []
      } catch (e: unknown) {
        console.error('Leaderboard error:', e)
      } finally {
        this.leaderboardLoading = false
      }
    },

    async submitQuiz() {
      // Garde de réentrance : empêche un double-submit (double-clic / requêtes concurrentes)
      if (this.submitting) return
      if (!this.sessionId) {
        this.error = 'Session non trouvée'
        return
      }

      const client = useApi()
      this.submitting = true
      this.error = null

      try {
        const formattedAnswers: QuizAnswer[] = this.questions.map((q) => ({
          questionId: q.documentId,
          answer: this.answers[q.documentId] || '',
        }))

        const res = await client<SubmitQuizResponse>('/quiz-attempts/submit', {
          method: 'POST',
          body: {
            sessionId: this.sessionId,
            answers: formattedAnswers,
            timeSpentSeconds: this.timeSpentSeconds,
          },
        })

        this.submitResult = res.data
        // Nettoyer le localStorage après soumission réussie
        this.clearSavedAnswers()
        await this.fetchLeaderboard()
      } catch (e: unknown) {
        this.error = extractApiError(e, 'Erreur lors de la soumission')
      } finally {
        this.submitting = false
      }
    },

    async fetchResults(documentId: string) {
      const client = useApi()
      this.loading = true
      this.error = null

      try {
        const res = await client<GetAttemptResponse>(`/quiz-attempts/${documentId}`, {
          method: 'GET',
          params: {
            populate: {
              guild: { fields: ['quiz_streak'] }
            }
          }
        })

        const data = res.data
        this.submitResult = {
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
        this.error = extractApiError(e, 'Erreur lors du chargement des résultats')
      } finally {
        this.loading = false
      }
    },

    // Navigation
    selectAnswer(answer: string) {
      const q = this.currentQuestion
      if (this.quizFinished || !q) return
      this.answers[q.documentId] = answer
      // Sauvegarder automatiquement dans localStorage
      this.saveAnswers()
    },

    nextQuestion() {
      if (this.currentIndex < this.questions.length - 1) {
        this.currentIndex++
        this.saveAnswers()
      } else {
        this.quizFinished = true
        this.finishedAt = Date.now()
        this.saveAnswers()
      }
    },

    prevQuestion() {
      if (this.currentIndex > 0) {
        this.currentIndex--
        this.saveAnswers()
      }
    },

    goBackToQuestions() {
      this.quizFinished = false
    },

    // Reset
    resetQuizState() {
      this.currentIndex = 0
      this.answers = {}
      this.quizFinished = false
      this.submitResult = null
      this.startTime = Date.now()
      this.finishedAt = 0
    },

    resetAll() {
      this.clearSavedAnswers()
      this.$reset()
    },

    // LocalStorage management
    saveAnswers() {
      if (!this.sessionId) return
      try {
        const data = {
          sessionId: this.sessionId,
          answers: this.answers,
          currentIndex: this.currentIndex,
          startTime: this.startTime,
        }
        localStorage.setItem('quiz_current_session', JSON.stringify(data))
      } catch (e) {
        console.warn('Failed to save quiz answers to localStorage:', e)
      }
    },

    loadSavedAnswers() {
      if (!this.sessionId) return
      try {
        const saved = localStorage.getItem('quiz_current_session')
        if (!saved) return

        const data = JSON.parse(saved)
        // Vérifier que c'est la même session
        if (data.sessionId === this.sessionId) {
          this.answers = data.answers || {}
          this.currentIndex = data.currentIndex || 0
          this.startTime = data.startTime || Date.now()
        } else {
          // Session différente, nettoyer
          this.clearSavedAnswers()
        }
      } catch (e) {
        console.warn('Failed to load quiz answers from localStorage:', e)
        this.clearSavedAnswers()
      }
    },

    clearSavedAnswers() {
      try {
        localStorage.removeItem('quiz_current_session')
      } catch (e) {
        console.warn('Failed to clear quiz answers from localStorage:', e)
      }
    },
  },
})
