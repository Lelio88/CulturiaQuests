<script setup lang="ts">
/**
 * Politique de confidentialité — un traitement par ligne (donnée, finalité, base légale, durée),
 * comme l'exige le guide de conformité du conteneur (§A2).
 *
 * Invariant : chaque ligne décrit ce que le code fait réellement. Toute nouvelle donnée
 * collectée, tout nouveau prestataire ou toute durée changée se reporte ici **et** dans la
 * déclaration « Sécurité des données » de Google Play. Une modification substantielle change
 * aussi `TERMS_VERSION` (backend/src/utils/account-rules.ts), ce qui redemande l'acceptation.
 */
definePageMeta({
  layout: 'blank',
})
useSeoMeta({ title: 'Politique de confidentialité — CulturiaQuests' })

interface Processing {
  data: string
  purpose: string
  basis: string
  retention: string
}

const processings: Processing[] = [
  {
    data: 'Compte : adresse e-mail, pseudo, mot de passe (enregistré haché, jamais en clair), date de naissance, date et version des CGU acceptées',
    purpose: 'Créer et sécuriser votre compte, vérifier l’âge minimum (15 ans), garder la preuve de l’acceptation des CGU',
    basis: 'Exécution du contrat',
    retention: 'Tant que le compte existe. Une inscription dont l’adresse n’est jamais confirmée est effacée au bout de 7 jours',
  },
  {
    data: 'Connexion avec Google (application Android) : l’identifiant de votre compte Google et son adresse e-mail',
    purpose: 'Vous connecter sans mot de passe ; rattacher ce compte Google à votre compte CulturiaQuests de même adresse',
    basis: 'Exécution du contrat (vous le demandez)',
    retention: 'Tant que le compte existe',
  },
  {
    data: 'Données de jeu : guilde, personnages, objets, or et expérience, progression par zone, quêtes, expéditions dans les musées (lieu et dates), badges',
    purpose: 'Faire fonctionner le jeu et votre progression',
    basis: 'Exécution du contrat',
    retention: 'Tant que le compte existe',
  },
  {
    data: 'Lieux visités : les points d’intérêt dont vous avez ouvert le coffre, avec la date de la dernière ouverture et leur nombre',
    purpose: 'Récompenser vos visites et éviter qu’un même coffre soit ouvert en boucle',
    basis: 'Exécution du contrat',
    retention: 'Tant que le compte existe',
  },
  {
    data: 'Quiz quotidien : vos réponses, votre score, le temps passé',
    purpose: 'Calculer vos récompenses et le classement du jour',
    basis: 'Exécution du contrat',
    retention: 'Tant que le compte existe',
  },
  {
    data: 'Fonctions sociales : demandes d’amis et amis, publications (le partage d’une expédition) et mentions « J’aime »',
    purpose: 'Jouer avec d’autres joueurs ; vos publications, votre pseudo et votre guilde sont visibles des autres joueurs',
    basis: 'Exécution du contrat',
    retention: 'Jusqu’à ce que vous les supprimiez, ou avec le compte',
  },
  {
    data: 'Photo de profil (facultative)',
    purpose: 'Personnaliser votre profil, visible des autres joueurs',
    basis: 'Consentement (vous choisissez d’en mettre une)',
    retention: 'Jusqu’à ce que vous la retiriez, ou avec le compte',
  },
  {
    data: 'E-mails de service : votre adresse, pour confirmer votre compte, réinitialiser votre mot de passe, ou vous prévenir qu’une inscription a été tentée avec votre adresse',
    purpose: 'Sécuriser votre compte',
    basis: 'Exécution du contrat',
    retention: 'Brevo garde un journal des envois (adresse, date, aperçu du message) sans limite de durée',
  },
  {
    data: 'Journal de connexions : la date et l’heure de chaque connexion',
    purpose: 'Sécurité du compte et statistiques internes de fréquentation',
    basis: 'Intérêt légitime (protéger le service et les comptes)',
    retention: '6 mois, puis effacé automatiquement',
  },
  {
    data: 'Limitation des tentatives : l’identifiant saisi et l’adresse IP, en mémoire du serveur seulement',
    purpose: 'Freiner qui essaierait de deviner un mot de passe',
    basis: 'Intérêt légitime (protéger les comptes)',
    retention: 'Une heure au plus après la dernière tentative ; rien n’est écrit en base',
  },
  {
    data: 'Journaux techniques du serveur : adresse IP tronquée (les derniers chiffres effacés), date, page demandée, réponse',
    purpose: 'Diagnostiquer une panne ou un abus',
    basis: 'Intérêt légitime (faire fonctionner le service)',
    retention: '30 jours',
  },
  {
    data: 'Demandes d’exercice de vos droits (« Demander mes données ») : date et état de la demande',
    purpose: 'Suivre et prouver la réponse à votre demande',
    basis: 'Obligation légale',
    retention: 'Tant que le compte existe',
  },
  {
    data: 'Modération : si un compte est suspendu ou change de rôle, l’action, sa date et le joueur visé',
    purpose: 'Garder la trace des décisions de modération',
    basis: 'Intérêt légitime (sécurité du service)',
    retention: 'Tant que le service existe ; le lien vers le joueur est retiré quand son compte est supprimé',
  },
]

interface Recipient {
  name: string
  role: string
  where: string
}

const recipients: Recipient[] = [
  {
    name: 'Hetzner Online GmbH',
    role: 'Hébergement des serveurs et de la base de données',
    where: 'Nuremberg (Allemagne, Union européenne)',
  },
  {
    name: 'Brevo (Sendinblue SAS)',
    role: 'Envoi des e-mails de service',
    where: 'France (Union européenne)',
  },
  {
    name: 'Google (Google Ireland Limited)',
    role: 'Connexion avec Google, dans l’application Android seulement. Le site web ne charge rien chez Google',
    where: 'Peut traiter aux États-Unis : Google LLC est certifiée au Data Privacy Framework UE–États-Unis',
  },
  {
    name: 'Fondation OpenStreetMap',
    role: 'Fond de carte : les images de la carte sont chargées depuis ses serveurs, qui voient l’adresse IP de votre appareil. Rien d’autre ne leur est transmis',
    where: 'Royaume-Uni, pays reconnu par la Commission européenne comme offrant une protection adéquate ; ses serveurs passent par le réseau Fastly (États-Unis, certifié au Data Privacy Framework)',
  },
]
</script>

<template>
  <div class="min-h-screen bg-white p-6">
    <div class="w-full max-w-2xl mx-auto">

      <div class="mb-8 text-center pt-[env(safe-area-inset-top)]">
        <h1 class="text-3xl font-bold font-power text-indigo-600 mb-2">
          Politique de confidentialité
        </h1>
        <p class="text-sm text-gray-500 font-pixel">
          Dernière mise à jour : 1er octobre 2026
        </p>
      </div>

      <div class="space-y-8 font-onest text-gray-700">

        <section>
          <h2 class="text-lg font-bold font-pixel text-indigo-600 mb-3 border-b border-indigo-100 pb-2">
            1. Qui traite vos données
          </h2>
          <p class="leading-relaxed">
            Le responsable du traitement est <strong>Lelio Buton</strong>, qui édite CulturiaQuests à titre
            personnel et non professionnel. Pour toute question sur vos données :
            <a href="mailto:heianenterpriseyt@gmail.com" class="text-indigo-600 underline">heianenterpriseyt@gmail.com</a>.
            Aucun délégué à la protection des données n'est désigné, sa désignation n'étant pas requise
            pour un éditeur individuel.
          </p>
        </section>

        <section>
          <h2 class="text-lg font-bold font-pixel text-indigo-600 mb-3 border-b border-indigo-100 pb-2">
            2. Ce que nous traitons, pourquoi et combien de temps
          </h2>
          <div class="space-y-3">
            <div v-for="item in processings" :key="item.data" class="p-3 bg-gray-50 rounded-lg text-sm space-y-1">
              <p class="font-bold text-gray-800">{{ item.data }}</p>
              <p><span class="font-semibold">Pourquoi :</span> {{ item.purpose }}</p>
              <p><span class="font-semibold">Base légale :</span> {{ item.basis }}</p>
              <p><span class="font-semibold">Durée :</span> {{ item.retention }}</p>
            </div>
          </div>
          <p class="leading-relaxed mt-3 text-sm">
            Les sauvegardes de la base, faites chaque nuit, peuvent encore contenir des données
            supprimées : elles sont écrasées au bout de 30 jours au plus.
          </p>
        </section>

        <section>
          <h2 class="text-lg font-bold font-pixel text-indigo-600 mb-3 border-b border-indigo-100 pb-2">
            3. Votre position
          </h2>
          <p class="leading-relaxed">
            Le jeu utilise la position de votre appareil, avec votre accord (demandé par votre téléphone
            ou votre navigateur, et retirable à tout moment dans leurs réglages), seulement quand
            l'application est ouverte :
          </p>
          <ul class="list-disc pl-5 space-y-1 text-sm leading-relaxed mt-2">
            <li>pour vous situer sur la carte et révéler les zones explorées : le tracé de vos déplacements
              reste sur votre appareil et n'est jamais envoyé ;</li>
            <li>pour vérifier que vous êtes bien sur place quand vous ouvrez un coffre ou lancez une
              expédition : la position est alors envoyée au serveur, comparée à celle du lieu, puis
              oubliée.</li>
          </ul>
          <p class="leading-relaxed mt-2">
            Ce qui est conservé, c'est la liste des lieux où vous avez ouvert un coffre ou mené une
            expédition, avec leurs dates (voir le tableau ci-dessus). Sans accès à la position, vous
            pouvez toujours parcourir la carte, mais pas ouvrir de coffre.
          </p>
        </section>

        <section>
          <h2 class="text-lg font-bold font-pixel text-indigo-600 mb-3 border-b border-indigo-100 pb-2">
            4. Qui y a accès
          </h2>
          <p class="leading-relaxed mb-3">
            L'éditeur, pour faire fonctionner le jeu, et les prestataires suivants, qui traitent les
            données pour son compte et selon ses instructions. Aucune donnée n'est vendue ni utilisée
            à des fins publicitaires.
          </p>
          <div class="space-y-3">
            <div v-for="item in recipients" :key="item.name" class="p-3 bg-gray-50 rounded-lg text-sm space-y-1">
              <p class="font-bold text-gray-800">{{ item.name }}</p>
              <p>{{ item.role }}</p>
              <p class="text-gray-600">{{ item.where }}</p>
            </div>
          </div>
          <p class="leading-relaxed mt-3 text-sm">
            Les questions du quiz sont rédigées par un modèle d'intelligence artificielle installé sur nos
            propres serveurs : il ne reçoit aucune donnée vous concernant.
          </p>
        </section>

        <section>
          <h2 class="text-lg font-bold font-pixel text-indigo-600 mb-3 border-b border-indigo-100 pb-2">
            5. Âge minimum
          </h2>
          <p class="leading-relaxed">
            CulturiaQuests est réservé aux personnes de 15 ans et plus. La date de naissance demandée à
            l'inscription sert à le vérifier ; une inscription en dessous de cet âge est refusée.
          </p>
        </section>

        <section>
          <h2 class="text-lg font-bold font-pixel text-indigo-600 mb-3 border-b border-indigo-100 pb-2">
            6. Vos droits
          </h2>
          <p class="leading-relaxed mb-2">
            Vous pouvez à tout moment accéder à vos données, les faire rectifier ou effacer, en demander
            une copie dans un format réutilisable, vous opposer à un traitement fondé sur l'intérêt
            légitime, en demander la limitation, et retirer un consentement donné (position, photo de
            profil).
          </p>
          <ul class="list-disc pl-5 space-y-1 text-sm leading-relaxed">
            <li><strong>Copie de vos données</strong> : onglet Guilde, Paramètres, « Demander mes données » ; vous la recevez
              par e-mail sous un mois au plus.</li>
            <li><strong>Suppression du compte</strong> : onglet Guilde, Paramètres, « Supprimer mon compte », ou depuis un
              navigateur sur <NuxtLink to="/suppression-compte" class="text-indigo-600 underline">la page de suppression</NuxtLink>.
              Tout est effacé immédiatement : compte, guilde, progression, lieux visités, publications,
              amitiés, photo.</li>
            <li>Pour tout autre droit : <a href="mailto:heianenterpriseyt@gmail.com" class="text-indigo-600 underline">heianenterpriseyt@gmail.com</a>,
              réponse sous un mois.</li>
          </ul>
          <p class="leading-relaxed mt-3">
            Si vous estimez que vos droits ne sont pas respectés, vous pouvez adresser une réclamation à la
            <strong>CNIL</strong> (3 place de Fontenoy, TSA 80715, 75334 Paris Cedex 07 —
            <a href="https://www.cnil.fr" target="_blank" rel="noopener" class="text-indigo-600 underline">www.cnil.fr</a>).
          </p>
        </section>

        <section>
          <h2 class="text-lg font-bold font-pixel text-indigo-600 mb-3 border-b border-indigo-100 pb-2">
            7. Cookies et stockage sur votre appareil
          </h2>
          <p class="leading-relaxed mb-3">
            Uniquement ce qui est nécessaire au fonctionnement du jeu : aucun cookie publicitaire, aucune
            mesure d'audience, aucun traceur. Ces éléments sont exemptés de consentement (recommandations
            de la CNIL), d'où l'absence de bandeau.
          </p>
          <ul class="list-disc pl-5 space-y-1 text-sm leading-relaxed">
            <li><strong>Cookies de session</strong> (<code>cq_session</code>, <code>cq_refresh</code>,
              <code>cq_device</code>) : ils vous gardent connecté 30 jours au plus (14 jours sans
              utilisation). Illisibles par les scripts de la page ; la déconnexion les efface et coupe la
              session sur le serveur.</li>
            <li><strong>Cookie d'inscription Google</strong> (<code>cq_google_onboarding</code>, application
              Android) : 15 minutes, le temps de finir votre inscription.</li>
            <li><strong>Stockage local</strong> : l'état du jeu (inventaire, progression affichée, tracé de
              vos déplacements sur la carte). Il reste sur votre appareil et est vidé à la déconnexion.</li>
            <li><strong>Cache de la carte</strong> : le contour des régions et des communes, pour afficher la
              carte plus vite. Il ne contient rien qui vous concerne.</li>
          </ul>
        </section>

        <section>
          <h2 class="text-lg font-bold font-pixel text-indigo-600 mb-3 border-b border-indigo-100 pb-2">
            8. Sécurité
          </h2>
          <ul class="list-disc pl-5 space-y-1 text-sm leading-relaxed">
            <li>Communications chiffrées (HTTPS), serveurs dans l'Union européenne.</li>
            <li>Mots de passe hachés (bcrypt), 8 caractères au moins avec lettres et chiffres.</li>
            <li>Sessions courtes et révocables ; tentatives de connexion limitées.</li>
            <li>Chaque joueur n'accède qu'à ses propres données de compte.</li>
          </ul>
          <p class="leading-relaxed mt-2 text-sm">
            En cas de fuite de données vous concernant, la CNIL est prévenue sous 72 heures, et vous aussi
            si le risque est élevé.
          </p>
        </section>

        <section>
          <h2 class="text-lg font-bold font-pixel text-indigo-600 mb-3 border-b border-indigo-100 pb-2">
            9. Modifications
          </h2>
          <p class="leading-relaxed">
            Si cette politique change de façon importante, vous en êtes informé à votre prochaine
            connexion, et invité à accepter la nouvelle version.
          </p>
        </section>

      </div>

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
