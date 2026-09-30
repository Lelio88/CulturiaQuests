<script setup lang="ts">
/**
 * Fin d'inscription après une première connexion Google (application Android).
 *
 * Google fournit l'adresse, vérifiée ; il manque le pseudo, la date de naissance (15 ans
 * minimum), l'acceptation des CGU, la guilde et le personnage. Le compte n'est créé qu'à la
 * validation de cet écran : un abandon ne laisse rien en base. Le jeton qui prouve la connexion
 * Google vit 15 minutes dans un cookie httpOnly posé par le BFF.
 */
import PixelInput from '~/components/form/PixelInput.vue'
import PixelButton from '~/components/form/PixelButton.vue'
import PixelCheckbox from '~/components/form/PixelCheckbox.vue'
import IconPicker from '~/components/form/IconPicker.vue'
import Alert from '~/components/form/Alert.vue'
import OverlayPanel from '~/components/ui/OverlayPanel.vue'
import CguContent from '~/components/legal/CguContent.vue'
import { useCharacterStore } from '~/stores/character'
import { useGuildStore } from '~/stores/guild'

definePageMeta({ layout: 'blank' })

const { completeGoogleRegistration } = useAuth()
const characterStore = useCharacterStore()
const guildStore = useGuildStore()
const router = useRouter()
const config = useRuntimeConfig()

const form = ref({
  username: '',
  dateOfBirth: '',
  cguAccepted: false,
  guildName: '',
  firstname: '',
  lastname: '',
  iconId: null as number | null,
})
const loading = ref(false)
const error = ref<string | null>(null)
const expired = ref(false)
const showCgu = ref(false)

const dateOfBirthError = computed(() => birthDateError(form.value.dateOfBirth))
const canSubmit = computed(() =>
  Boolean(
    form.value.username &&
      form.value.dateOfBirth &&
      !dateOfBirthError.value &&
      form.value.cguAccepted &&
      form.value.guildName &&
      form.value.firstname &&
      form.value.lastname &&
      form.value.iconId,
  ),
)

const icons = computed(() => characterStore.availableIcons)
const iconsLoading = computed(() => characterStore.iconsLoading)
const iconsError = computed(() => characterStore.iconsError)
function loadIcons() {
  return characterStore.fetchCharacterIcons()
}
function getIconUrl(icon: any): string {
  if (!icon?.url) return ''
  return icon.url.startsWith('/') ? `${config.public.strapi.url}${icon.url}` : icon.url
}
onMounted(loadIcons)

async function submit() {
  if (!canSubmit.value) return
  loading.value = true
  error.value = null
  try {
    await completeGoogleRegistration({
      username: form.value.username,
      date_of_birth: form.value.dateOfBirth,
      terms_accepted: form.value.cguAccepted,
      guildName: form.value.guildName,
      firstname: form.value.firstname,
      lastname: form.value.lastname,
      iconId: form.value.iconId,
    })
    await guildStore.fetchAll()
    await router.push('/')
  } catch (e: any) {
    expired.value = e?.data?.data?.code === 'onboarding_expired'
    error.value = extractApiError(e, 'L’inscription n’a pas pu aboutir.')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-white flex items-center justify-center p-4">
    <main class="w-full max-w-lg p-6">
      <h1 class="text-3xl font-bold font-pixel text-center mb-2 text-indigo-600">Bienvenue !</h1>
      <p class="font-onest text-gray-700 text-center mb-6">
        Votre compte Google est reconnu. Il reste à créer votre aventurier.
      </p>

      <form class="space-y-4" @submit.prevent="submit">
        <PixelInput v-model="form.username" label="Pseudo" placeholder="3 à 30 caractères" :disabled="loading" required />
        <PixelInput v-model="form.dateOfBirth" type="date" label="Date de naissance" :disabled="loading" required />
        <p v-if="dateOfBirthError" class="text-red-600 text-xs font-pixel -mt-2">{{ dateOfBirthError }}</p>

        <PixelInput v-model="form.guildName" label="Nom de la guilde" :disabled="loading" required />
        <PixelInput v-model="form.firstname" label="Prénom du personnage" :disabled="loading" required />
        <PixelInput v-model="form.lastname" label="Nom du personnage" :disabled="loading" required />
        <IconPicker
          v-model="form.iconId"
          :items="icons"
          :loading="iconsLoading"
          :error="iconsError"
          :disabled="loading"
          label="Choisissez l'icône de votre personnage"
          :get-image-url="getIconUrl"
          @retry="loadIcons"
        />

        <div class="flex items-start gap-3 pt-1">
          <PixelCheckbox v-model="form.cguAccepted" aria-labelledby="google-cgu-label" :disabled="loading" />
          <p id="google-cgu-label" class="text-sm font-pixel text-gray-700 leading-snug pt-0.5">
            J'ai lu et j'accepte les
            <button type="button" class="text-indigo-600 underline" @click="showCgu = true">
              Conditions Générales d'Utilisation
            </button>
          </p>
        </div>

        <Alert :message="error ?? undefined" variant="error" />
        <NuxtLink v-if="expired" to="/account/login" class="block text-center font-pixel text-indigo-600 underline">
          Revenir à la connexion
        </NuxtLink>

        <PixelButton type="submit" variant="filled" color="indigo" :disabled="loading || !canSubmit">
          {{ loading ? 'Création…' : 'Commencer l’aventure' }}
        </PixelButton>

        <p class="text-xs font-onest text-gray-600 leading-relaxed">
          Votre adresse Google sert d'identifiant ; la date de naissance vérifie l'âge minimum
          (15 ans). Ces informations sont conservées tant que le compte existe. Détails et droits :
          <NuxtLink to="/politique-confidentialite" class="text-indigo-600 underline">politique de confidentialité</NuxtLink>.
        </p>
      </form>
    </main>

    <OverlayPanel v-if="showCgu" @close="showCgu = false">
      <CguContent />
    </OverlayPanel>
  </div>
</template>
