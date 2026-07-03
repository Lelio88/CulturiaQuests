<template>
  <div class="min-h-screen bg-white flex items-center justify-center p-4">
    <div class="w-full max-w-md p-8">
      <h1 class="text-3xl font-bold font-power text-center mb-6 text-indigo-600">
        Mot de passe oublié
      </h1>

      <!-- Confirmation générique (anti-énumération : on ne révèle pas si l'e-mail existe) -->
      <div v-if="sent" class="space-y-4 text-center">
        <p class="text-sm font-pixel text-gray-700 leading-relaxed">
          Si un compte existe pour cette adresse, un e-mail contenant un lien de
          réinitialisation vient d'être envoyé. Pensez à vérifier vos spams.
        </p>
        <NuxtLink
          to="/account/login"
          class="inline-block text-indigo-600 hover:underline font-pixel text-sm"
        >
          Retour à la connexion
        </NuxtLink>
      </div>

      <form v-else class="space-y-4" @submit.prevent="handleSubmit">
        <p class="text-sm font-pixel text-gray-600 leading-relaxed mb-2">
          Entrez l'adresse e-mail de votre compte. Nous vous enverrons un lien pour
          définir un nouveau mot de passe.
        </p>

        <PixelInput
          v-model="email"
          type="email"
          label="Email"
          placeholder="Entrez votre email"
          :disabled="loading"
        />

        <div v-if="error" class="text-red-500 text-sm mt-2">
          {{ error }}
        </div>

        <PixelButton
          type="submit"
          :disabled="loading || !email"
          variant="filled"
          color="indigo"
          class="w-full"
        >
          {{ loading ? 'Envoi...' : 'Envoyer le lien' }}
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

const { forgotPassword } = useAuth()

const email = ref('')
const loading = ref(false)
const sent = ref(false)
const error = ref<string | null>(null)

const handleSubmit = async () => {
  if (!email.value) return
  try {
    loading.value = true
    error.value = null
    await forgotPassword(email.value)
    sent.value = true
  } catch (e: any) {
    // Le BFF renvoie normalement toujours un succès ; une erreur ici est réseau/serveur.
    error.value = extractApiError(e, 'Une erreur est survenue. Réessayez plus tard.')
  } finally {
    loading.value = false
  }
}

definePageMeta({
  layout: 'blank',
})
</script>
