<template>
  <div class="min-h-screen bg-white flex items-center justify-center p-4">
    <div class="w-full max-w-lg p-8">
      <!-- Inscription envoyée : le compte n'est utilisable qu'après confirmation de l'adresse.
           Même écran si l'adresse était déjà inscrite (anti-énumération). -->
      <div v-if="pending" class="space-y-5 text-center">
        <h1 class="text-3xl font-bold font-pixel mb-2 text-indigo-600">Vérifiez vos e-mails</h1>
        <p class="font-onest text-gray-700 leading-relaxed">
          Si l'adresse <strong>{{ form.email }}</strong> peut recevoir un compte, un lien de
          confirmation vient d'y être envoyé. Suivez-le, puis connectez-vous.
        </p>
        <p class="font-onest text-sm text-gray-600">
          Rien reçu après quelques minutes ? Regardez dans les indésirables, ou renvoyez le lien.
          Sans confirmation, l'inscription est effacée au bout de 7 jours.
        </p>
        <p v-if="resendInfo" class="font-onest text-sm text-emerald-700" role="status">{{ resendInfo }}</p>
        <div class="flex flex-col gap-3 pt-2">
          <PixelButton type="button" variant="outline" color="indigo" :disabled="resending" @click="resend">
            {{ resending ? 'Envoi…' : 'Renvoyer le lien' }}
          </PixelButton>
          <NuxtLink to="/account/login" class="font-pixel text-indigo-600 underline underline-offset-4">
            Aller à la connexion
          </NuxtLink>
        </div>
      </div>

      <template v-else>
      <h1 class="text-3xl font-bold font-pixel text-center mb-6 text-indigo-600">
        Inscription
      </h1>

      <!-- Progress Indicator -->
      <ProgressIndicator
        :current-step="currentStep"
        :total-steps="totalSteps"
        :step-titles="stepTitles"
      />

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <!-- Step 1: Account Information -->
        <div v-if="currentStep === 1" class="space-y-4">
          <PixelInput
            v-model="form.username"
            type="text"
            label="Nom d'utilisateur"
            placeholder="Entrez votre nom d'utilisateur"
            :disabled="loading"
            required
          />

          <PixelInput
            v-model="form.email"
            type="email"
            label="Email"
            placeholder="Entrez votre email"
            :disabled="loading"
            required
          />

          <PixelInput
            v-model="form.password"
            type="password"
            label="Mot de passe"
            placeholder="Entrez votre mot de passe"
            autocomplete="new-password"
            :disabled="loading"
            required
          />
          <p class="text-xs font-onest text-gray-600 -mt-2">
            8 caractères minimum, avec au moins une lettre et un chiffre.
          </p>

          <PixelInput
            v-model="form.passwordConfirm"
            type="password"
            label="Confirmer le mot de passe"
            placeholder="Confirmez votre mot de passe"
            :disabled="loading"
            required
          />

          <PixelInput
            v-model="form.dateOfBirth"
            type="date"
            label="Date de naissance"
            :disabled="loading"
            required
          />
          <p v-if="dateOfBirthError" class="text-red-500 text-xs font-pixel -mt-2">
            {{ dateOfBirthError }}
          </p>

          <div class="flex items-start gap-3 pt-1">
            <PixelCheckbox
              v-model="form.cguAccepted"
              aria-labelledby="cgu-label"
              :disabled="loading"
            />
            <p id="cgu-label" class="text-sm font-pixel text-gray-700 leading-snug pt-0.5">
              J'ai lu et j'accepte les
              <button
                type="button"
                class="text-indigo-600 underline hover:text-indigo-800"
                @click="showCgu = true"
              >
                Conditions Générales d'Utilisation
              </button>
            </p>
          </div>
        </div>

        <!-- Step 2: Guild, Character & Icon -->
        <div v-if="currentStep === 2" class="space-y-4">
          <PixelInput
            v-model="form.guildName"
            type="text"
            label="Nom de la guilde"
            placeholder="Entrez le nom de votre guilde"
            :disabled="loading"
            required
          />

          <PixelInput
            v-model="form.firstname"
            type="text"
            label="Prénom du personnage"
            placeholder="Entrez le prénom de votre personnage"
            :disabled="loading"
            required
          />

          <PixelInput
            v-model="form.lastname"
            type="text"
            label="Nom du personnage"
            placeholder="Entrez le nom de votre personnage"
            :disabled="loading"
            required
          />

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
        </div>

        <!-- Error Message -->
        <Alert :message="error ?? undefined" variant="error" />

        <!-- Navigation Buttons -->
        <div class="flex gap-3 pt-4">
          <PixelButton
            v-if="currentStep > 1"
            type="button"
            :disabled="loading"
            variant="filled"
            color="indigo"
            class="flex-1 !text-white"
            @click="previousStep"
          >
            Précédent
          </PixelButton>

          <PixelButton
            v-if="currentStep < totalSteps"
            type="button"
            :disabled="loading || !canProceed"
            variant="filled"
            color="indigo"
            class="flex-1"
            @click="nextStep"
          >
            Suivant
          </PixelButton>

          <PixelButton
            v-if="currentStep === totalSteps"
            type="submit"
            :disabled="loading || !canProceed"
            variant="filled"
            color="indigo"
            class="flex-1"
          >
            {{ loading ? 'Inscription en cours...' : 'S\'inscrire' }}
          </PixelButton>
        </div>

        <div class="text-center mt-4">
          <p class="text-sm font-pixel">
            Déjà un compte ?
            <NuxtLink to="/account/login" class="text-indigo-600 hover:underline">
              Se connecter
            </NuxtLink>
          </p>
        </div>

        <!-- Mention d'information (guide conformité §A4) : qui, pourquoi, combien de temps. -->
        <p class="text-xs font-onest text-gray-600 leading-relaxed pt-2">
          Ces informations servent à créer votre compte et à faire fonctionner le jeu ; la date de
          naissance vérifie l'âge minimum (15 ans). Elles sont conservées tant que le compte existe.
          Détails et droits :
          <NuxtLink to="/politique-confidentialite" class="text-indigo-600 underline">politique de confidentialité</NuxtLink>.
        </p>
      </form>
      </template>
    </div>

    <!-- CGU Overlay -->
    <OverlayPanel v-if="showCgu" @close="showCgu = false">
      <CguContent />
    </OverlayPanel>
  </div>
</template>

<script setup lang="ts">
import { useCharacterStore } from '~/stores/character'
import PixelInput from '~/components/form/PixelInput.vue'
import PixelButton from '~/components/form/PixelButton.vue'
import PixelCheckbox from '~/components/form/PixelCheckbox.vue'
import ProgressIndicator from '~/components/form/ProgressIndicator.vue'
import IconPicker from '~/components/form/IconPicker.vue'
import Alert from '~/components/form/Alert.vue'
import OverlayPanel from '~/components/ui/OverlayPanel.vue'
import CguContent from '~/components/legal/CguContent.vue'

const { register, resendConfirmation } = useAuth()
const characterStore = useCharacterStore()
const config = useRuntimeConfig()

// Helper function to format icon URLs
function getIconUrl(icon: any): string {
  if (!icon || !icon.url) return ''

  // Si l'URL commence par /, ajouter le base URL de Strapi
  if (icon.url.startsWith('/')) {
    return `${config.public.strapi.url}${icon.url}`
  }

  // Sinon retourner l'URL telle quelle
  return icon.url
}

// Multi-step form state
const currentStep = ref(1)
const totalSteps = 2
const stepTitles = [
  'Informations de compte',
  'Guilde, personnage et icône'
]

const form = ref({
  username: '',
  email: '',
  password: '',
  passwordConfirm: '',
  dateOfBirth: '',
  cguAccepted: false,
  guildName: '',
  firstname: '',
  lastname: '',
  iconId: null as number | null
})

const loading = ref(false)
const error = ref<string | null>(null)
const showCgu = ref(false)
const pending = ref(false)
const resending = ref(false)
const resendInfo = ref<string | null>(null)

const passwordError = computed(() => passwordRuleError(form.value.password))

// Âge minimum (15 ans) : confort de saisie, la règle fait foi côté serveur.
const dateOfBirthError = computed(() => birthDateError(form.value.dateOfBirth))

// Validation for each step
const canProceed = computed(() => {
  switch (currentStep.value) {
    case 1:
      return !!(
        form.value.username &&
        form.value.email &&
        form.value.password &&
        form.value.passwordConfirm &&
        form.value.dateOfBirth &&
        !dateOfBirthError.value &&
        !passwordError.value &&
        form.value.cguAccepted
      )
    case 2:
      return !!(
        form.value.guildName &&
        form.value.firstname &&
        form.value.lastname &&
        form.value.iconId
      )
    default:
      return false
  }
})

// Navigation functions
function nextStep() {
  error.value = null

  // Validate current step
  if (currentStep.value === 1) {
    if (passwordError.value) {
      error.value = passwordError.value
      return
    }
    if (form.value.password !== form.value.passwordConfirm) {
      error.value = 'Les mots de passe ne correspondent pas'
      return
    }
  }

  if (canProceed.value && currentStep.value < totalSteps) {
    currentStep.value++
  }
}

function previousStep() {
  error.value = null
  if (currentStep.value > 1) {
    currentStep.value--
  }
}

// Catalogue d'icônes : vues DÉRIVÉES du store, jamais une copie figée. Une copie prise une fois
// dans onMounted ne se mettrait pas à jour après un réessai, et le bouton « Réessayer » n'aurait
// aucun effet visible alors même que le rechargement aurait réussi.
const icons = computed(() => characterStore.availableIcons)
const iconsLoading = computed(() => characterStore.iconsLoading)
const iconsError = computed(() => characterStore.iconsError)

function loadIcons() {
  return characterStore.fetchCharacterIcons()
}

onMounted(loadIcons)

const handleSubmit = async () => {
  // Si on n'est pas sur la dernière étape, avancer au lieu de soumettre
  if (currentStep.value < totalSteps) {
    if (canProceed.value) {
      nextStep()
    }
    return
  }

  // Soumission finale
  try {
    loading.value = true
    error.value = null

    // Validation du mot de passe
    if (form.value.password !== form.value.passwordConfirm) {
      error.value = 'Les mots de passe ne correspondent pas'
      loading.value = false
      return
    }

    // Validation de l'icône
    if (!form.value.iconId) {
      error.value = 'Veuillez sélectionner une icône pour votre personnage'
      loading.value = false
      return
    }

    // Compte, guilde et personnage en une requête ; le joueur confirme ensuite son adresse.
    await register({
      username: form.value.username,
      email: form.value.email,
      password: form.value.password,
      date_of_birth: form.value.dateOfBirth,
      terms_accepted: form.value.cguAccepted,
      guildName: form.value.guildName,
      firstname: form.value.firstname,
      lastname: form.value.lastname,
      iconId: form.value.iconId,
    })
    pending.value = true
  } catch (e: any) {
    error.value = extractApiError(e, 'Une erreur est survenue lors de l\'inscription.')
  } finally {
    loading.value = false
  }
}

async function resend() {
  resending.value = true
  resendInfo.value = null
  try {
    await resendConfirmation(form.value.email)
    resendInfo.value = 'Si un compte attend confirmation à cette adresse, un nouveau lien est parti.'
  } catch (e: any) {
    resendInfo.value = extractApiError(e, 'Envoi impossible pour le moment.')
  } finally {
    resending.value = false
  }
}

definePageMeta({
  layout: 'blank',
})
</script>

<style scoped>
.pixel-notch {
  clip-path: polygon(
    0px 6px, 6px 6px, 6px 0px,
    calc(100% - 6px) 0px, calc(100% - 6px) 6px, 100% 6px,
    100% calc(100% - 6px), calc(100% - 6px) calc(100% - 6px), calc(100% - 6px) 100%,
    6px 100%, 6px calc(100% - 6px), 0px calc(100% - 6px)
  );
}
</style>
