<script setup lang="ts">
/**
 * Garde-fou « mobile uniquement ».
 *
 * CulturiaQuests est un RPG géolocalisé pensé pour le smartphone ; sur ordinateur le jeu n'est
 * pas jouable (et la géoloc n'a pas de sens). Ce composant global affiche un overlay plein écran
 * bloquant dès qu'on détecte un desktop.
 *
 * Choix non-évidents :
 * - Détection via `useDevice().isDesktop` (User-Agent) : barrière UX à ~99 %. Un UA mobile spoofé
 *   (mode responsive) peut passer — assumé : c'est un garde-fou d'expérience, pas une sécurité dure
 *   (le jeu exige de toute façon la géolocalisation réelle).
 * - Bypass développement via `NUXT_PUBLIC_ALLOW_DESKTOP=true` (runtimeConfig.public.allowDesktop),
 *   aligné sur le middleware `00-device-check.global.ts` qui laisse rendre la route sur desktop en
 *   comptant précisément sur cet overlay pour l'UI.
 * - Routes exemptées : le back-office admin (`/dashboard/*`, utilisable sur desktop), la connexion
 *   (`/account/login` — l'admin doit pouvoir se connecter sur desktop pour atteindre le dashboard)
 *   et les pages légales (doivent rester lisibles sur desktop : examinateurs, crawler).
 *
 * Invariant : rendu SSR-safe (isDesktop dérivé du UA côté serveur) → l'overlay est présent dès le
 * HTML initial, avant hydratation.
 *
 * @example
 * // Monté une seule fois, globalement, dans app.vue :
 * // <DesktopGate />
 */
const { isDesktop } = useDevice()
const config = useRuntimeConfig()
const route = useRoute()

const EXEMPT_PREFIXES = ['/dashboard']
const EXEMPT_EXACT = ['/account/login', '/politique-confidentialite', '/mentions-legales', '/CGU']

const allowDesktop = computed(() => String(config.public.allowDesktop) === 'true')
const isExempt = computed(
  () => EXEMPT_PREFIXES.some((p) => route.path.startsWith(p)) || EXEMPT_EXACT.includes(route.path),
)
const showGate = computed(() => isDesktop && !allowDesktop.value && !isExempt.value)
</script>

<template>
  <div
    v-if="showGate"
    class="fixed inset-0 z-[9999] flex items-center justify-center bg-gradient-to-br from-indigo-950 via-indigo-800 to-indigo-950 p-6 text-center"
  >
    <div class="flex max-w-md flex-col items-center gap-6">
      <img
        src="/assets/android/icon-foreground.png"
        alt="CulturiaQuests"
        class="h-28 w-28 drop-shadow-lg"
      >
      <div class="flex items-center gap-3 text-white/90">
        <Icon name="mdi:cellphone" size="34" />
        <Icon name="mdi:arrow-right-thin" size="24" class="opacity-60" />
        <Icon name="mdi:map-marker-radius" size="34" />
      </div>
      <h1 class="font-power text-3xl text-white">Disponible sur mobile</h1>
      <p class="font-onest leading-relaxed text-indigo-100">
        CulturiaQuests est une aventure géolocalisée qui se joue en explorant, ton smartphone à la
        main. Le jeu n'est pas disponible sur ordinateur.
      </p>
      <p class="font-onest text-sm text-indigo-200">Ouvre ce lien sur ton téléphone :</p>
      <div
        class="rounded-full border border-white/20 bg-white/10 px-5 py-2 font-pixel text-sm text-white"
      >
        culturia.heianenterprise.com
      </div>
    </div>
  </div>
</template>
