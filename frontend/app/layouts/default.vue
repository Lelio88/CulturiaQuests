<template>
    <div>
        <slot />
        <!-- <div class="h-12"></div> -->
        <AppFooter class="fixed bottom-0 left-0 right-0 z-50"/>
        <!-- Tutoriel d'accueil (#175). Monté ici plutôt que dans une page : ses étapes pointent le
             footer, présent sur tout ce layout. Il ne s'affiche que si le store l'a activé, et le
             déclenchement se fait depuis la carte (cf. pages/map.vue). -->
        <TutorialOverlay />
    </div>
</template>