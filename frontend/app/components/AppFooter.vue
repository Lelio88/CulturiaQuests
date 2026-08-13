<template>
  <div 
    v-show="isFooterVisible"
    class="fixed bottom-0 w-full bg-black/75 text-white flex justify-around pt-3 pb-6 z-[10000] transition-opacity duration-300"
    :class="{ 'opacity-0 pointer-events-none': !isFooterVisible }">

    <NuxtLink
      v-for="item in navItems"
      :key="item.name"
      :to="item.path"
      :data-tutorial="item.tutorialKey"
      class="flex flex-col items-center gap-1 opacity-60 hover:opacity-100 transition-opacity w-20"
      active-class="opacity-100 text-yellow-400">
      <Icon :name="item.icon" class="w-6 h-6 bg-white"/>
      <span class="text-xs font-medium">{{ item.name }}</span>
    </NuxtLink>

  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useFooterVisibility } from '~/composables/useFooterVisibility'

// `tutorialKey` : ancre du tutoriel d'accueil (#175). Doit rester alignée sur les `target` de
// `~/data/tutorial-steps.ts` — la renommer ici fait perdre son détourage à l'étape correspondante.
const navItems = ref([
  { name: 'Journaux', icon: 'bx:bxs-book-bookmark', path: '/stories', tutorialKey: 'stories' },
  { name: 'Équipement', icon: 'bx-bx-shield-quarter', path: '/equipement', tutorialKey: 'equipement' },
  { name: 'Carte', icon: 'bx:bxs-map-alt', path: '/map', tutorialKey: 'carte' },
  { name: 'Social', icon: 'bx:bxs-user-account', path: '/social', tutorialKey: 'social' },
  // bxs-home-alt-2 n'existe pas dans BoxIcons (seule la variante outline bx-home-alt-2 existe) :
  // repli sur la maison pleine, cohérente avec les autres icônes solides de la barre.
  { name: 'Guilde', icon: 'bx:bxs-home', path: '/guild', tutorialKey: 'guild' },
])

const { isFooterVisible } = useFooterVisibility()
</script>

<style scoped>
/* Petite astuce : Nuxt ajoute automatiquement la classe 'router-link-active' 
  sur le lien de la page en cours.
  J'ai utilisé la prop 'active-class' ci-dessus pour gérer ça proprement via Tailwind.
*/
</style>