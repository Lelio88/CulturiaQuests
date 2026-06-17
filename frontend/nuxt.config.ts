// https://nuxt.com/docs/api/configuration/nuxt-config
import path from 'path';

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  future: {
    compatibilityVersion: 4,
  },
  devtools: { enabled: true },
  modules: [
    '@nuxt/eslint',
    '@nuxt/fonts',
    '@nuxt/icon',
    '@pinia/nuxt',
    '@nuxtjs/tailwindcss',
    '@hypernym/nuxt-anime',
    'pinia-plugin-persistedstate/nuxt',
    '@nuxtjs/leaflet',
    'nuxt-charts',
    '@nuxtjs/device',
  ],

  // Configuration pinia-plugin-persistedstate
  // Force localStorage pour éviter l'erreur 431 (cookies trop volumineux)
  piniaPluginPersistedstate: {
    storage: 'localStorage',
  },

  // CSS principal
  css: ['~/assets/css/main.css'],

  // Configuration des fonts avec @nuxt/fonts
  fonts: {
    families: [
      {
        name: 'Onest',
        provider: 'google',
        weights: [400, 500, 600, 700],
      },
      {
        name: 'Jersey 10',
        provider: 'google',
        weights: [400],
      },
      // Neue Power est gérée via @font-face dans main.css
    ],
  },

  // Configuration Tailwind CSS
  tailwindcss: {
    cssPath: '~/assets/css/main.css',
    configPath: 'tailwind.config.ts',
  },

  // Configuration Strapi
  runtimeConfig: {
    strapi: {
      url: 'http://backend:1337', // Internal Docker URL for SSR
    },
    public: {
      strapi: {
        url: 'http://localhost:1337', // Public URL for Client
      },
      allowDesktop: 'true', // Overridden by NUXT_PUBLIC_ALLOW_DESKTOP at runtime
    },
  },
  // NB : @nuxtjs/strapi retiré (migration BFF httpOnly #17). L'auth passe par les routes
  // serveur /api/auth/* + le proxy /api/strapi/* (cookie httpOnly cq_session). On conserve
  // runtimeConfig.strapi.url (proxy SSR) et runtimeConfig.public.strapi.url (URLs média).

  // Configuration de la compilation
  build: {
    transpile: [
      'kdbush', 
      'd3-sankey', 
      'd3-array', 
      'd3-shape', 
      'd3-path', 
      'd3-hierarchy',
      '@unovis/ts', 
      '@unovis/vue'
    ],
  },

  // Configuration Vite
  vite: {
    optimizeDeps: {
      exclude: ['d3-sankey', '@unovis/ts', '@unovis/vue'],
    },
    resolve: {
      alias: {
        // Alias direct vers le fichier source pour contourner les problèmes de package.json
        'd3-sankey': path.resolve(__dirname, 'node_modules/d3-sankey/src/index.js'),
      },
    },
  },

  // Configuration de pinia-plugin-persistedstate
  // Force l'utilisation de localStorage uniquement pour éviter l'erreur 431
  // (Request Header Fields Too Large causée par des cookies trop volumineux)
  piniaPersistedstate: {
    storage: 'localStorage',
  },
})