<script setup lang="ts">
/**
 * Suppression du compte depuis le web — l'URL déclarée à Google Play (profil M du guide).
 *
 * Accessible sur ordinateur (exemptée de `DesktopGate`) et sans avoir accepté de nouvelles CGU
 * (exemptée de `01-terms.global.ts`) : on doit toujours pouvoir partir. Explique ce qui est
 * effacé, puis, une fois connecté, supprime le compte après confirmation écrite (« SUPPRIMER »),
 * pour qu'un appui accidentel ne suffise pas.
 */
import PixelButton from '~/components/form/PixelButton.vue'
import PixelInput from '~/components/form/PixelInput.vue'

definePageMeta({ layout: 'blank' })
useSeoMeta({ title: 'Supprimer son compte — CulturiaQuests' })

const route = useRoute()
const { user } = useAuth()
const { deleteAccount, loading, error } = useDeleteAccount()
const confirmation = ref('')
const done = computed(() => route.query.done === '1')

async function remove() {
  if (confirmation.value.trim().toUpperCase() !== 'SUPPRIMER') return
  await deleteAccount('/suppression-compte?done=1')
}
</script>

<template>
  <div class="min-h-screen bg-white p-6">
    <main class="w-full max-w-2xl mx-auto space-y-6 font-onest text-gray-700">
      <h1 class="text-3xl font-bold font-power text-indigo-600 text-center pt-[env(safe-area-inset-top)]">
        Supprimer son compte CulturiaQuests
      </h1>

      <p v-if="done" class="p-4 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-800" role="status">
        Votre compte et les données qui lui étaient rattachées ont été supprimés.
      </p>

      <section class="space-y-2">
        <h2 class="text-lg font-bold text-gray-800">Ce qui est effacé</h2>
        <p>
          Immédiatement et définitivement : le compte (adresse, pseudo, date de naissance, mot de
          passe, avatar), la guilde, les personnages et objets, la progression, les lieux visités,
          les quêtes et expéditions, les réponses aux quiz, les amitiés, les publications et le
          journal de connexions. Les sauvegardes de la base, qui peuvent encore les contenir, sont
          écrasées au bout de 30 jours au plus.
        </p>
      </section>

      <section class="space-y-2">
        <h2 class="text-lg font-bold text-gray-800">Trois façons de le faire</h2>
        <ul class="list-disc pl-5 space-y-1">
          <li>Dans l'application : onglet <strong>Guilde</strong>, roue dentée (<strong>Paramètres</strong>), puis <strong>Supprimer mon compte</strong>.</li>
          <li>Sur cette page, après vous être connecté avec votre e-mail et votre mot de passe.
            Compte créé avec Google, sans mot de passe ? Choisissez « Mot de passe oublié ? » pour
            en définir un, ou passez par l'application.</li>
          <li>Par e-mail à <a href="mailto:heianenterpriseyt@gmail.com" class="text-indigo-600 underline">heianenterpriseyt@gmail.com</a>,
            depuis l'adresse du compte : la suppression est faite sous un mois au plus.</li>
        </ul>
      </section>

      <section v-if="!done" class="space-y-4 p-4 border-2 border-red-200 rounded-lg">
        <template v-if="user">
          <p>Connecté en tant que <strong>{{ user.username }}</strong>.</p>
          <PixelInput
            v-model="confirmation"
            label="Pour confirmer, écrivez SUPPRIMER"
            autocomplete="off"
            :disabled="loading"
          />
          <p v-if="error" class="text-red-600 text-sm" role="alert">{{ error }}</p>
          <PixelButton
            variant="filled"
            color="red"
            :disabled="loading || confirmation.trim().toUpperCase() !== 'SUPPRIMER'"
            @click="remove"
          >
            {{ loading ? 'Suppression…' : 'Supprimer définitivement mon compte' }}
          </PixelButton>
        </template>
        <template v-else>
          <p>Connectez-vous pour supprimer votre compte depuis cette page.</p>
          <NuxtLink :to="{ path: '/account/login', query: { redirect: '/suppression-compte' } }">
            <PixelButton variant="filled" color="indigo">Se connecter</PixelButton>
          </NuxtLink>
        </template>
      </section>

      <LegalLinks />
    </main>
  </div>
</template>
