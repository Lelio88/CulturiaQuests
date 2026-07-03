<script setup lang="ts">
import { useZoneStore } from '~/stores/zone'

const zoneStore = useZoneStore()
const { createChannels, scheduleQuizNotification, setupNotificationListeners } = useNotifications()

onMounted(async () => {
  // Masque le splash natif dès que l'app est montée → le splash reste affiché pendant tout le
  // chargement du site distant (webview) puis se retire quand le contenu est prêt (pas de flash).
  // No-op sur web ; imports dynamiques pour rester SSR-safe.
  if (import.meta.client) {
    const { Capacitor } = await import('@capacitor/core')
    if (Capacitor.isNativePlatform()) {
      const { SplashScreen } = await import('@capacitor/splash-screen')
      void SplashScreen.hide()
    }
  }

  // Préchargement des données cartographiques (Zones) en arrière-plan
  // Stratégie Offline-First : IndexedDB ou API
  zoneStore.init()

  // Initialisation des notifications locales (no-op sur web)
  await createChannels()
  await setupNotificationListeners()
  await scheduleQuizNotification()
})
</script>

<template>
  <div>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <!-- Garde-fou « mobile uniquement » : overlay bloquant sur desktop (hors dashboard/login/légal). -->
    <DesktopGate />
  </div>
</template>