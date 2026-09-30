export default [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          // Pas de 'unsafe-inline' : l'admin Strapi 5 n'en a pas besoin (vérifié sur l'accueil, le
          // gestionnaire de contenu et le greffon geodata). Les CDN restent pour Leaflet (geodata).
          'script-src': [
            "'self'",
            'cdn.jsdelivr.net',
            'unpkg.com',
            'https://*.basemaps.cartocdn.com',
          ],
          'media-src': [
            "'self'",
            'data:',
            'blob:',
            'market-assets.strapi.io',
            'https://tile.openstreetmap.org',
            'https://*.tile.openstreetmap.org',
            'https://*.basemaps.cartocdn.com',
          ],
          'img-src': [
            "'self'",
            'data:',
            'blob:',
            'market-assets.strapi.io',
            'strapi.io',
            'https://*.tile.openstreetmap.org',
            'https://*.basemaps.cartocdn.com',
            'https://unpkg.com/leaflet@1.9.4/dist/images/',
          ],
        },
      },
    },
  },
  {
    name: 'strapi::cors',
    config: {
      // En production, une seule origine : le front (web ET WebView Capacitor, qui charge le site
      // distant — `server.url`). Les origines locales ne servent qu'au développement : en prod,
      // elles autorisaient n'importe quelle page servie sur un poste (localhost) à lire les
      // réponses de l'API. Les stores passent par le proxy BFF (server→server, sans CORS) ; cette
      // entrée couvre les chargements directs résiduels (médias via config.public.strapi.url).
      origin: process.env.NODE_ENV === 'production'
        ? ['https://culturia.heianenterprise.com']
        : [
          'http://localhost:3000',
          'http://127.0.0.1:3000',
          'capacitor://localhost', // Capacitor iOS
          'http://localhost', // Capacitor Android (http)
          'https://localhost', // Capacitor Android (https)
        ],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      headers: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
      keepHeaderOnError: true,
    },
  },
  // 'strapi::poweredBy' retiré (#19) : n'émet plus l'en-tête X-Powered-By: Strapi (fingerprinting).
  'strapi::query',
  {
    name: 'strapi::body',
    config: {
      jsonLimit: '6mb',
      formLimit: '6mb',
    },
  },
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
