<template>
  <div class="min-h-screen bg-white p-6">
    <div class="w-full max-w-2xl mx-auto">

      <!-- En-tête -->
      <div class="mb-8 text-center pt-[env(safe-area-inset-top)]">
        <h1 class="text-3xl font-bold font-power text-indigo-600 mb-2">
          Mentions Légales
        </h1>
        <p class="text-sm text-gray-500 font-pixel">
          Dernière mise à jour : 18 février 2026
        </p>
      </div>

      <!-- Sections -->
      <div class="space-y-8 font-onest text-gray-700">

        <!-- 1. Éditeur -->
        <section>
          <h2 class="text-lg font-bold font-pixel text-indigo-600 mb-3 border-b border-indigo-100 pb-2">
            1. Éditeur de l'application
          </h2>
          <div class="p-4 bg-gray-50 rounded-lg text-sm space-y-1">
            <p><strong>Éditeur</strong> : Lelio Buton</p>
            <p><strong>Statut</strong> : personne physique éditant l'application à titre non professionnel</p>
            <p><strong>Email de contact</strong> : heianenterpriseyt@gmail.com</p>
            <p class="text-gray-500 mt-2">Conformément à l'article 6-III-2 de la LCEN, l'éditeur non professionnel peut préserver l'anonymat de son adresse postale auprès du public ; ses coordonnées sont détenues par l'hébergeur (section 3) et communicables sur réquisition de l'autorité judiciaire.</p>
          </div>
        </section>

        <!-- 2. Directeur de la publication -->
        <section>
          <h2 class="text-lg font-bold font-pixel text-indigo-600 mb-3 border-b border-indigo-100 pb-2">
            2. Directeur de la publication
          </h2>
          <p class="leading-relaxed">
            Le directeur de la publication est <strong>Lelio Buton</strong>, en qualité d'éditeur de l'application.
          </p>
        </section>

        <!-- 3. Hébergeur -->
        <section>
          <h2 class="text-lg font-bold font-pixel text-indigo-600 mb-3 border-b border-indigo-100 pb-2">
            3. Hébergeur
          </h2>
          <div class="p-4 bg-gray-50 rounded-lg text-sm space-y-1">
            <p><strong>Raison sociale</strong> : Hetzner Online GmbH</p>
            <p><strong>Adresse</strong> : Industriestr. 25, 91710 Gunzenhausen, Allemagne</p>
            <p><strong>Téléphone</strong> : +49 (0)9831 505-0</p>
            <p><strong>Site web</strong> : https://www.hetzner.com</p>
          </div>
        </section>

        <!-- 4. Propriété intellectuelle -->
        <section>
          <h2 class="text-lg font-bold font-pixel text-indigo-600 mb-3 border-b border-indigo-100 pb-2">
            4. Propriété intellectuelle
          </h2>
          <p class="leading-relaxed">
            L'ensemble des éléments constituant l'application CulturiaQuests (design, graphismes, code source,
            textes, personnages, quêtes, mécaniques de jeu) est la propriété exclusive de Lelio Buton
            ou de ses concédants de licence, et est protégé par les lois françaises et internationales relatives
            au droit d'auteur et à la propriété intellectuelle.
          </p>
          <p class="leading-relaxed mt-2">
            Toute reproduction, distribution ou utilisation non autorisée de ces éléments est strictement interdite.
          </p>
        </section>

        <!-- 5. Données personnelles -->
        <section>
          <h2 class="text-lg font-bold font-pixel text-indigo-600 mb-3 border-b border-indigo-100 pb-2">
            5. Données personnelles
          </h2>
          <p class="leading-relaxed">
            Pour toute information relative à la collecte et au traitement des données personnelles, veuillez
            consulter notre <NuxtLink to="/politique-confidentialite" class="text-indigo-600 underline hover:text-indigo-800">Politique de confidentialité</NuxtLink>.
          </p>
        </section>

        <!-- 6. Conditions générales d'utilisation -->
        <section>
          <h2 class="text-lg font-bold font-pixel text-indigo-600 mb-3 border-b border-indigo-100 pb-2">
            6. Conditions générales d'utilisation
          </h2>
          <p class="leading-relaxed">
            L'utilisation de l'application CulturiaQuests est soumise à l'acceptation de nos
            <NuxtLink to="/CGU" class="text-indigo-600 underline hover:text-indigo-800">Conditions Générales d'Utilisation</NuxtLink>.
          </p>
        </section>

        <!-- 7. Contact -->
        <section>
          <h2 class="text-lg font-bold font-pixel text-indigo-600 mb-3 border-b border-indigo-100 pb-2">
            7. Contact
          </h2>
          <p class="leading-relaxed">
            Pour toute question relative aux mentions légales, vous pouvez nous contacter à l'adresse :
            <span class="text-indigo-600">heianenterpriseyt@gmail.com</span>.
          </p>
        </section>

      </div>

      <!-- Bouton retour -->
      <div class="mt-12 mb-6 flex justify-center">
        <button
          class="text-sm font-pixel text-indigo-600 hover:underline flex items-center gap-2"
          @click="$router.back()"
        >
          ← Retour
        </button>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'blank',
})
</script>
