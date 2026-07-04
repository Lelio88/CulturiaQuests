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
          'script-src': [
            "'self'",
            "'unsafe-inline'",
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
      origin: [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'capacitor://localhost', // Capacitor iOS
        'http://localhost', // Capacitor Android (http)
        'https://localhost', // Capacitor Android (https)
        'ionic://localhost', // Ionic (si utilisé)
        // Frontend PRODUCTION (Hetzner) : origine du web ET de la WebView Capacitor (Option A =
        // server.url distant). INDISPENSABLE : sans cette entrée, les fetch directs client→Strapi
        // (poiStore/museumStore → api.culturia…/api/{pois,museums}) sont bloqués par CORS →
        // stores vides → aucun marqueur sur la carte. Ne pas retirer.
        'https://culturia.heianenterprise.com',
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
