<script setup lang="ts">
/**
 * Liens vers les pages légales, en pied des écrans d'entrée (accueil, connexion, écran
 * « mobile uniquement », suppression de compte). La politique doit être joignable depuis chaque
 * page publique (guide conformité §A1) — c'est aussi ce que vérifie Google pour la marque.
 */
defineProps<{ tone?: 'light' | 'dark' }>()
</script>

<template>
  <nav
    aria-label="Informations légales"
    :class="['text-xs font-onest text-center', tone === 'dark' ? 'text-indigo-100' : 'text-gray-600']"
  >
    <NuxtLink to="/politique-confidentialite" class="underline underline-offset-2">Confidentialité</NuxtLink>
    <span aria-hidden="true"> · </span>
    <NuxtLink to="/CGU" class="underline underline-offset-2">CGU</NuxtLink>
    <span aria-hidden="true"> · </span>
    <NuxtLink to="/mentions-legales" class="underline underline-offset-2">Mentions légales</NuxtLink>
    <span aria-hidden="true"> · </span>
    <NuxtLink to="/suppression-compte" class="underline underline-offset-2">Supprimer son compte</NuxtLink>
  </nav>
</template>
