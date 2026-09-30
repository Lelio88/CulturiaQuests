<script setup lang="ts">
/**
 * Réacceptation des CGU quand leur version change (`terms_outdated` renvoyé par /me).
 *
 * Le middleware `01-terms.global.ts` y conduit tout joueur connecté dont la version acceptée
 * n'est plus la courante. L'acceptation (date et version) est enregistrée côté serveur ; refuser
 * laisse deux sorties : se déconnecter, ou supprimer son compte.
 */
import PixelButton from '~/components/form/PixelButton.vue'
import { useGuildStore } from '~/stores/guild'

definePageMeta({ layout: 'blank' })

const { user, acceptTerms } = useAuth()
const { logout } = useLogout()
const guildStore = useGuildStore()
const router = useRouter()
const loading = ref(false)
const error = ref<string | null>(null)

async function accept() {
  loading.value = true
  error.value = null
  try {
    await acceptTerms(String(user.value?.terms_current_version ?? ''))
    await guildStore.fetchAll()
    await router.push('/')
  } catch (e: any) {
    error.value = extractApiError(e, 'Enregistrement impossible pour le moment.')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-white flex items-center justify-center p-4">
    <main class="w-full max-w-lg p-6 space-y-5">
      <h1 class="text-3xl font-bold font-pixel text-center text-indigo-600">Nos conditions ont changé</h1>
      <p class="font-onest text-gray-700 leading-relaxed">
        Pour continuer à jouer, merci de prendre connaissance des nouvelles
        <NuxtLink to="/CGU" class="text-indigo-600 underline">conditions générales d'utilisation</NuxtLink>
        et de la
        <NuxtLink to="/politique-confidentialite" class="text-indigo-600 underline">politique de confidentialité</NuxtLink>.
      </p>
      <div class="p-4 bg-gray-50 rounded-lg text-sm font-onest text-gray-700 space-y-2">
        <p class="font-bold text-gray-800">En bref :</p>
        <ul class="list-disc pl-5 space-y-1">
          <li>une nouvelle inscription se confirme désormais par e-mail ;</li>
          <li>la connexion reste ouverte jusqu'à 30 jours, et « Se déconnecter » la coupe vraiment ;</li>
          <li>dans l'application Android, on peut se connecter avec son compte Google ;</li>
          <li>la politique détaille chaque donnée, sa durée de conservation et nos prestataires (dont l'envoi des e-mails).</li>
        </ul>
      </div>
      <p v-if="error" class="text-red-600 text-sm font-onest" role="alert">{{ error }}</p>
      <PixelButton variant="filled" color="indigo" :disabled="loading" @click="accept">
        {{ loading ? 'Enregistrement…' : 'J’accepte les nouvelles conditions' }}
      </PixelButton>
      <p class="text-sm font-onest text-gray-600 text-center">
        Vous ne les acceptez pas ?
        <button type="button" class="text-indigo-600 underline min-h-[44px]" @click="logout()">Se déconnecter</button>
        ou
        <NuxtLink to="/suppression-compte" class="text-indigo-600 underline">supprimer mon compte</NuxtLink>.
      </p>
    </main>
  </div>
</template>
