import cronTasks from './cron-tasks';

export default ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('PUBLIC_URL', 'http://localhost:1337'),
  // Derrière un reverse proxy (Caddy en prod) : faire confiance aux en-têtes X-Forwarded-*
  // pour que ctx.ip / ctx.protocol reflètent le client réel (et non la socket interne).
  // Activé par défaut en production ; inactif en dev (accès direct). Cf. audit #8.
  proxy: env.bool('IS_PROXIED', env('NODE_ENV') === 'production'),
  app: {
    keys: env.array('APP_KEYS'),
  },
  cron: {
    enabled: true,
    tasks: cronTasks,
  },
});
