<template>
  <div class="min-h-screen bg-white flex items-center justify-center p-4">
    <div class="w-full max-w-md p-8">
      <h1 class="text-3xl font-bold font-power text-center mb-6 text-indigo-600">
        Nouveau mot de passe
      </h1>

      <!-- Code absent de l'URL (lien tronqué / accès direct) -->
      <div v-if="!code" class="space-y-4 text-center">
        <p class="text-sm font-pixel text-gray-700 leading-relaxed">
          Lien de réinitialisation invalide ou incomplet. Veuillez relancer la procédure.
        </p>
        <NuxtLink
          to="/account/forgot-password"
          class="inline-block text-indigo-600 hover:underline font-pixel text-sm"
        >
          Renvoyer un lien
        </NuxtLink>
      </div>

      <form v-else class="space-y-4" @submit.prevent="handleSubmit">
        <PixelInput
          v-model="password"
          type="password"
          label="Nouveau mot de passe"
          placeholder="Entrez un nouveau mot de passe"
          :disabled="loading"
        />

        <PixelInput
          v-model="passwordConfirm"
          type="password"
          label="Confirmer le mot de passe"
          placeholder="Confirmez le mot de passe"
          :disabled="loading"
        />

        <div v-if="error" class="text-red-500 text-sm mt-2">
          {{ error }}
        </div>

        <PixelButton
          type="submit"
          :disabled="loading || !canSubmit"
          variant="filled"
          color="indigo"
          class="w-full"
        >
          {{ loading ? 'Réinitialisation...' : 'Réinitialiser' }}
        </PixelButton>

        <div class="text-center mt-4">
          <NuxtLink to="/account/login" class="text-sm font-pixel text-indigo-600 hover:underline">
            Retour à la connexion
          </NuxtLink>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import PixelInput from '~/components/form/PixelInput.vue'
import PixelButton from '~/components/form/PixelButton.vue'

const { resetPassword } = useAuth()
const route = useRoute()
const router = useRouter()

// Le code de réinitialisation est passé en query par le lien de l'e-mail.
const code = computed(() => (typeof route.query.code === 'string' ? route.query.code : ''))

const password = ref('')
const passwordConfirm = ref('')
const loading = ref(false)
const error = ref<string | null>(null)

const canSubmit = computed(
  () => password.value.length >= 6 && password.value === passwordConfirm.value
)

const handleSubmit = async () => {
  error.value = null
  if (password.value.length < 6) {
    error.value = 'Le mot de passe doit contenir au moins 6 caractères.'
    return
  }
  if (password.value !== passwordConfirm.value) {
    error.value = 'Les mots de passe ne correspondent pas.'
    return
  }
  try {
    loading.value = true
    // Succès → le BFF a posé le cookie de session (auto-login) → redirection accueil.
    await resetPassword(code.value, password.value, passwordConfirm.value)
    await router.push('/')
  } catch (e: any) {
    error.value = extractApiError(e, 'Lien invalide ou expiré. Renvoyez un e-mail de réinitialisation.')
  } finally {
    loading.value = false
  }
}

definePageMeta({
  layout: 'blank',
})
</script>
