<template>
  <div class="min-h-screen bg-white flex items-center justify-center p-4">
    <div class="w-full max-w-md p-8">
      <h1 class="text-3xl font-bold font-power text-center mb-6 text-indigo-600">
        Connexion
      </h1>

      <p
        v-if="route.query.confirmed === '1'"
        class="mb-4 p-3 rounded bg-emerald-50 border border-emerald-300 text-sm font-onest text-emerald-800"
        role="status"
      >
        Adresse confirmée : vous pouvez vous connecter.
      </p>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <PixelInput
          v-model="form.identifier"
          type="text"
          label="E-mail ou pseudo"
          placeholder="Entrez votre e-mail ou votre pseudo"
          autocomplete="username"
          :disabled="loading"
        />

        <PixelInput
          v-model="form.password"
          type="password"
          label="Mot de passe"
          placeholder="Entrez votre mot de passe"
          autocomplete="current-password"
          :disabled="loading"
        />

        <!-- Affordance tactile : `underline` est PERMANENT et non plus au survol — il n'y a pas de
             survol sur mobile, or l'app est mobile-first. Sans lui, ce libellé ne se lisait pas
             comme un lien. `min-h-[44px]` + `inline-flex` portent la cible à la taille tactile
             recommandée (elle faisait 13 px de haut). -->
        <div class="flex justify-end -mt-1">
          <NuxtLink
            to="/account/forgot-password"
            class="inline-flex items-center min-h-[44px] px-1 text-sm font-pixel text-indigo-600 underline underline-offset-4 active:text-indigo-800"
          >
            Mot de passe oublié ?
          </NuxtLink>
        </div>

        <div v-if="error" class="text-red-600 text-sm mt-2" role="alert">
          {{ error }}
          <button
            v-if="notConfirmed"
            type="button"
            class="block mt-2 text-indigo-600 underline underline-offset-4 min-h-[44px]"
            :disabled="resending"
            @click="resend"
          >
            {{ resending ? 'Envoi…' : 'Renvoyer le lien de confirmation' }}
          </button>
        </div>
        <p v-if="info" class="text-emerald-700 text-sm" role="status">{{ info }}</p>

        <PixelButton
          type="submit"
          :disabled="loading"
          variant="filled"
          color="indigo"
        >
          {{ loading ? 'Connexion...' : 'Se connecter' }}
        </PixelButton>

        <!-- Application Android seulement : Google refuse les WebView, le greffon natif s'en charge. -->
        <template v-if="google.available.value">
          <div class="flex items-center gap-3 text-xs font-onest text-gray-500" aria-hidden="true">
            <span class="flex-1 h-px bg-gray-200" />ou<span class="flex-1 h-px bg-gray-200" />
          </div>
          <button
            type="button"
            class="w-full min-h-[48px] flex items-center justify-center gap-3 border-2 border-gray-300 rounded-lg bg-white font-onest font-semibold text-gray-800 active:bg-gray-50 disabled:opacity-50"
            :disabled="loading"
            @click="handleGoogle"
          >
            <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            Continuer avec Google
          </button>
        </template>

        <div class="text-center mt-4">
          <p class="text-sm font-pixel">
            Pas encore de compte ?
            <NuxtLink to="/account/register" class="text-indigo-600 hover:underline">
              S'inscrire
            </NuxtLink>
          </p>
        </div>

        <LegalLinks />
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useGuildStore } from '~/stores/guild'
import PixelInput from '~/components/form/PixelInput.vue'
import PixelButton from '~/components/form/PixelButton.vue'

const { login, user, resendConfirmation, signInWithGoogle } = useAuth()
const router = useRouter()
const route = useRoute()
const guildStore = useGuildStore()
const google = useGoogleSignIn()

const form = ref({
  identifier: '',
  password: '',
})

const loading = ref(false)
const error = ref<string | null>(null)
const info = ref<string | null>(null)
const notConfirmed = ref(false)
const resending = ref(false)

// Seules destinations admises après connexion (pas de redirection ouverte vers un site tiers).
const ALLOWED_REDIRECTS = new Set(['/suppression-compte'])

/** Après une session ouverte (mot de passe ou Google) : précharge les données puis entre dans le jeu. */
async function enterGame() {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  if (ALLOWED_REDIRECTS.has(redirect)) {
    await router.push(redirect)
    return
  }
  // Fetch all user data after login (guild + characters, items, quests, etc.)
  if (user.value?.id) {
    await guildStore.fetchAll()
  }
  await router.push('/')
}

const handleSubmit = async () => {
  try {
    loading.value = true
    error.value = null
    info.value = null
    notConfirmed.value = false

    await login(form.value.identifier, form.value.password)
    await enterGame()
  } catch (e: any) {
    notConfirmed.value = e?.data?.data?.code === 'email_not_confirmed'
    error.value = extractApiError(e, 'Une erreur est survenue lors de la connexion.')
  } finally {
    loading.value = false
  }
}

async function handleGoogle() {
  try {
    loading.value = true
    error.value = null
    const idToken = await google.getIdToken()
    if (!idToken) return
    const result = await signInWithGoogle(idToken)
    if ('onboarding' in result) {
      await router.push('/account/google')
      return
    }
    await enterGame()
  } catch (e: any) {
    error.value = extractApiError(e, 'La connexion Google a échoué.')
  } finally {
    loading.value = false
  }
}

async function resend() {
  resending.value = true
  try {
    // L'identifiant saisi peut être un pseudo : le lien ne part que vers une adresse.
    if (form.value.identifier.includes('@')) await resendConfirmation(form.value.identifier)
    info.value = 'Si un compte attend confirmation à cette adresse, un nouveau lien est parti.'
  } catch (e: any) {
    info.value = extractApiError(e, 'Envoi impossible pour le moment.')
  } finally {
    resending.value = false
  }
}

definePageMeta({
  layout: 'blank',
})
</script>
