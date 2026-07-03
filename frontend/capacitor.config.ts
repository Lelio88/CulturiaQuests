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
      // Le splash reste affiché jusqu'à ce que l'app soit prête : app.vue appelle
      // SplashScreen.hide() au montage (évite le flash pendant le chargement du site distant).
      // launchShowDuration = plafond de sécurité : si le web ne se charge pas, le splash se
      // retire quand même au bout de 4 s.
      launchShowDuration: 4000,
      launchAutoHide: true,
      backgroundColor: '#312e81',
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
