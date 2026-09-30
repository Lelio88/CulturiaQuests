<script setup lang="ts">
/**
 * Confirmation d'adresse : page d'arrivée du lien reçu par e-mail.
 *
 * La confirmation ne part qu'au clic sur le bouton, jamais au chargement : les messageries qui
 * ouvrent les liens pour les analyser ne confirment donc pas un compte à la place du titulaire
 * de l'adresse (quelqu'un d'autre a pu s'inscrire avec elle).
 */
import PixelButton from '~/components/form/PixelButton.vue'

definePageMeta({ layout: 'blank' })

const route = useRoute()
const { confirmEmail } = useAuth()
const code = computed(() => (typeof route.query.confirmation === 'string' ? route.query.confirmation : ''))
const state = ref<'idle' | 'loading' | 'done'>('idle')
const error = ref<string | null>(null)

async function confirm() {
  state.value = 'loading'
  error.value = null
  try {
    await confirmEmail(code.value)
    state.value = 'done'
  } catch (e: any) {
    error.value = extractApiError(e, 'Confirmation impossible pour le moment.')
    state.value = 'idle'
  }
}
</script>

<template>
  <div class="min-h-screen bg-white flex items-center justify-center p-4">
    <main class="w-full max-w-md p-8 space-y-5 text-center">
      <h1 class="text-3xl font-bold font-power text-indigo-600">Confirmer votre adresse</h1>

      <template v-if="state === 'done'">
        <p class="font-onest text-gray-700" role="status">
          Adresse confirmée ! Connectez-vous dans l'application, ou ici même.
        </p>
        <NuxtLink to="/account/login">
          <PixelButton variant="filled" color="indigo">Se connecter</PixelButton>
        </NuxtLink>
      </template>

      <template v-else-if="code">
        <p class="font-onest text-gray-700">
          Appuyez sur le bouton pour activer votre compte CulturiaQuests.
        </p>
        <p v-if="error" class="text-red-600 text-sm font-onest" role="alert">{{ error }}</p>
        <PixelButton variant="filled" color="indigo" :disabled="state === 'loading'" @click="confirm">
          {{ state === 'loading' ? 'Confirmation…' : 'Confirmer mon adresse' }}
        </PixelButton>
      </template>

      <p v-else class="font-onest text-gray-700" role="alert">
        Ce lien est incomplet. Ouvrez-le directement depuis l'e-mail reçu, ou connectez-vous pour en
        demander un nouveau.
      </p>

      <LegalLinks class="pt-6" />
    </main>
  </div>
</template>
