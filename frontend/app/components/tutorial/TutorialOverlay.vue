<template>
  <Teleport to="body">
    <Transition name="tutorial-fade">
      <div
        v-if="step"
        class="fixed inset-0 z-[10001] flex flex-col"
        role="dialog"
        aria-modal="true"
        :aria-label="`Tutoriel, étape ${progress.current} sur ${progress.total}`"
      >
        <!-- Masque sombre. Quatre bandes plutôt qu'un box-shadow géant : le trou laisse
             l'élément visible ET cliquable, sans capter les événements à sa place. -->
        <template v-if="hole">
          <div class="tutorial-mask" :style="{ top: 0, left: 0, right: 0, height: px(hole.top) }" @click="next" />
          <div class="tutorial-mask" :style="{ top: px(hole.bottom), left: 0, right: 0, bottom: 0 }" @click="next" />
          <div class="tutorial-mask" :style="{ top: px(hole.top), left: 0, width: px(hole.left), height: px(hole.height) }" @click="next" />
          <div class="tutorial-mask" :style="{ top: px(hole.top), left: px(hole.right), right: 0, height: px(hole.height) }" @click="next" />
          <div
            class="pointer-events-none absolute rounded-xl border-2 border-yellow-400 transition-all duration-300"
            :style="{ top: px(hole.top), left: px(hole.left), width: px(hole.width), height: px(hole.height) }"
          />
        </template>
        <div v-else class="tutorial-mask absolute inset-0" @click="next" />

        <!-- Bulle du PNJ : sous la cible si elle est en haut de l'écran, au-dessus sinon, pour ne
             jamais recouvrir ce qu'on est en train de montrer. -->
        <div
          class="absolute left-0 right-0 px-3 pointer-events-none"
          :style="bubblePosition"
        >
          <div class="flex items-end gap-2 pointer-events-auto tutorial-bubble">
            <img
              :src="npcImage"
              :alt="`${TUTORIAL_NPC}, guide du tutoriel`"
              class="w-20 h-28 rounded-xl object-cover object-top border-2 border-indigo-400 flex-shrink-0"
            >
            <div class="bg-indigo-900/90 border border-indigo-500/40 rounded-2xl rounded-bl-none p-3 flex-1 backdrop-blur-sm shadow-xl">
              <p class="font-onest text-sm leading-snug text-white min-h-[2.5rem]">{{ currentLine }}</p>

              <div class="flex items-center justify-between mt-3 gap-2">
                <span class="text-[10px] text-white/40 tabular-nums">{{ progress.current }} / {{ progress.total }}</span>
                <div class="flex items-center gap-2">
                  <button
                    class="text-[11px] text-white/50 hover:text-white/80 transition-colors px-2 py-1"
                    @click="skip"
                  >
                    Passer
                  </button>
                  <button
                    class="text-xs font-medium bg-yellow-400 text-black rounded-lg px-3 py-1.5 hover:bg-yellow-300 transition-colors"
                    @click="next"
                  >
                    {{ isFinalLine ? 'Terminer' : 'Suivant' }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { useTutorialStore } from '~/stores/tutorial'
import { TUTORIAL_NPC } from '~/data/tutorial-steps'

/**
 * Rendu du tutoriel d'accueil : masque sombre, détourage de l'élément expliqué, et bulle du PNJ.
 *
 * Choix non-évidents :
 * - **Le masque est fait de quatre bandes** entourant la cible, et non d'un unique voile avec
 *   `box-shadow`. C'est ce qui laisse la cible réellement visible et cliquable : le joueur peut
 *   toucher ce qu'on lui montre au lieu d'être derrière une vitre.
 * - **Une étape avance ligne par ligne**, pas d'un bloc : les explications se lisent au rythme du
 *   joueur, comme dans les dialogues du jeu.
 * - **Repli systématique en mode narratif** si l'élément ciblé est absent du DOM (mauvaise page,
 *   footer masqué, rendu pas encore fait) : le tutoriel continue au centre de l'écran plutôt que
 *   de pointer le vide ou de se bloquer.
 *
 * Invariant : la position du trou est recalculée à chaque changement d'étape ET au redimensionnement
 * / défilement — un ancrage figé se décale dès que la carte bouge.
 */

const tutorial = useTutorialStore()

const step = computed(() => tutorial.currentStep)
const progress = computed(() => tutorial.progress)

const lineIndex = ref(0)
const hole = ref<{ top: number; left: number; width: number; height: number; right: number; bottom: number } | null>(null)

const currentLine = computed(() => step.value?.lines[lineIndex.value] ?? '')
const isFinalLine = computed(
  () => tutorial.isLastStep && lineIndex.value >= (step.value?.lines.length ?? 1) - 1
)

const npcImage = computed(() => {
  const mood = step.value?.mood ?? TUTORIAL_NPC
  return `/assets/npc/${TUTORIAL_NPC}/${mood}.webp`
})

// Bulle sous la cible quand celle-ci occupe le haut de l'écran, au-dessus sinon.
const bubblePosition = computed(() => {
  if (!hole.value) return { top: '50%', transform: 'translateY(-50%)' }
  const viewportHeight = window.innerHeight
  return hole.value.bottom < viewportHeight / 2
    ? { top: `${hole.value.bottom + 16}px` }
    : { bottom: `${viewportHeight - hole.value.top + 16}px` }
})

function px(value: number): string {
  return `${value}px`
}

function measureTarget(): void {
  const key = step.value?.target
  if (!key || !import.meta.client) {
    hole.value = null
    return
  }
  const el = document.querySelector(`[data-tutorial="${key}"]`)
  if (!el) {
    hole.value = null // cible absente → étape narrative
    return
  }
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) {
    hole.value = null // élément masqué (display:none, opacité nulle)
    return
  }
  const pad = 6
  hole.value = {
    top: Math.max(r.top - pad, 0),
    left: Math.max(r.left - pad, 0),
    width: r.width + pad * 2,
    height: r.height + pad * 2,
    right: r.right + pad,
    bottom: r.bottom + pad,
  }
}

function next(): void {
  const lines = step.value?.lines ?? []
  if (lineIndex.value < lines.length - 1) {
    lineIndex.value++
    return
  }
  lineIndex.value = 0
  tutorial.next()
}

function skip(): void {
  tutorial.skip()
}

// Nouvelle étape → on repart de la première ligne et on remesure après le rendu.
watch(step, () => {
  lineIndex.value = 0
  nextTick(measureTarget)
})

onMounted(() => {
  measureTarget()
  window.addEventListener('resize', measureTarget, { passive: true })
  // `capture` : la carte Leaflet défile dans son propre conteneur, pas sur window.
  window.addEventListener('scroll', measureTarget, { passive: true, capture: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', measureTarget)
  window.removeEventListener('scroll', measureTarget, { capture: true })
})
</script>

<style scoped>
.tutorial-mask {
  position: absolute;
  background: rgb(0 0 0 / 0.72);
  backdrop-filter: blur(1px);
  transition: all 0.3s ease;
}

.tutorial-bubble {
  animation: tutorialFadeInUp 0.3s ease-out forwards;
}

@keyframes tutorialFadeInUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.tutorial-fade-enter-active,
.tutorial-fade-leave-active {
  transition: opacity 0.25s ease;
}

.tutorial-fade-enter-from,
.tutorial-fade-leave-to {
  opacity: 0;
}
</style>
