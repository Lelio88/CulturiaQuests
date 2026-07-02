export default ({ env }) => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET'),
    sessions: {
      // Durées en SECONDES : Strapi fait `Number(valeur) * 1000` (cf. session-manager).
      // Des strings comme '90d'/'7d' donnaient `Number('90d') = NaN` → date d'expiration
      // invalide → 500 « Failed to create admin refresh session » au login. Toujours des nombres.
      maxRefreshTokenLifespan: 90 * 24 * 60 * 60, // 90 jours
      maxSessionLifespan: 7 * 24 * 60 * 60, // 7 jours
    },
  },
  apiToken: {
    salt: env('API_TOKEN_SALT'),
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT'),
    },
  },
  secrets: {
    encryptionKey: env('ENCRYPTION_KEY'),
  },
  flags: {
    nps: env.bool('FLAG_NPS', true),
    promoteEE: env.bool('FLAG_PROMOTE_EE', true),
  },
});
