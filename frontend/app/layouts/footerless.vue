<!-- Layout sans AppFooter pour le parcours quiz plein écran (social/quiz/*).
     Volontairement identique à `blank` (aucun chrome partagé) : formalise le nom `footerless`
     que ces pages référençaient déjà, ce qui supprime les erreurs TS2322 + le warning Nuxt
     « Invalid layout » et fige le comportement (avant : fallback no-layout implicite). -->
<template>
  <div>
    <slot />
  </div>
</template>
