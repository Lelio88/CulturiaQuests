import cronTasks from './cron-tasks';

export default ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('PUBLIC_URL', 'http://localhost:1337'),
  // Derrière un reverse proxy (Caddy en prod) : faire confiance aux en-têtes X-Forwarded-*
  // pour que ctx.ip / ctx.protocol reflètent le client réel (et non la socket interne).
  // Activé par défaut en production ; inactif en dev (accès direct). Cf. audit #8.
  // ⚠️ Strapi 5 lit `server.proxy.koa` : un booléen posé directement sur `proxy` est ignoré
  // sans erreur (c'était le cas jusqu'ici — toutes les IP valaient celle de la socket). Le
  // bootstrap limite ensuite la lecture au dernier maillon de X-Forwarded-For (`maxIpsCount`).
  proxy: {
    koa: env.bool('IS_PROXIED', env('NODE_ENV') === 'production'),
  },
  app: {
    keys: env.array('APP_KEYS'),
  },
  cron: {
    enabled: true,
    tasks: cronTasks,
  },
});
