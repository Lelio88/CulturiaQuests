import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.culturiaquests.app',
  appName: 'CulturiaQuests',
  webDir: '.output/public',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    cleartext: false,
    // Option A (#54) : en PROD, l'app mobile charge le serveur Nuxt déployé (BFF + cookie httpOnly
    // cq_session) au lieu d'un bundle statique sans backend. Défini au build mobile via CAP_SERVER_URL
    // (ex: CAP_SERVER_URL=https://app.<domaine> npx cap sync android). Non défini (web/dev) → bundle
    // local (webDir), comportement inchangé.
    ...(process.env.CAP_SERVER_URL ? { url: process.env.CAP_SERVER_URL } : {}),
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#1a1a1a',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_notify',
      iconColor: '#4F46E5',
      sound: 'default',
    },
  },
};

export default config;
