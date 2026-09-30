export default ({ env }) => ({
  geodata: {
    enabled: true,
  },
  // Envoi d'e-mails transactionnels (réinitialisation de mot de passe) via SMTP.
  // Provider = nodemailer, relais Brevo par défaut. Identifiants injectés par env
  // (jamais versionnés). L'expéditeur doit être validé côté Brevo + SPF/DKIM sur le domaine.
  email: {
    config: {
      provider: 'nodemailer',
      providerOptions: {
        host: env('SMTP_HOST', 'smtp-relay.brevo.com'),
        port: env.int('SMTP_PORT', 587),
        auth: {
          user: env('SMTP_USERNAME'),
          pass: env('SMTP_PASSWORD'),
        },
      },
      settings: {
        defaultFrom: env('SMTP_DEFAULT_FROM', 'no-reply@culturiaquests.app'),
        defaultReplyTo: env('SMTP_DEFAULT_REPLY_TO', env('SMTP_DEFAULT_FROM', 'no-reply@culturiaquests.app')),
      },
    },
  },
  'users-permissions': {
    config: {
      // L'inscription est réécrite (src/extensions/users-permissions/lib/registration.ts) : ces
      // champs ne concernent plus que les appels natifs résiduels.
      register: {
        allowedFields: ['date_of_birth'],
      },
      // Sessions révocables : jeton d'accès de 10 min, jeton de rafraîchissement tournant, 14 jours
      // d'inactivité et 30 jours au plus. Le BFF Nuxt garde les deux en cookies httpOnly et
      // renouvelle l'accès en coulisse ; la déconnexion révoque la session côté serveur.
      jwtManagement: 'refresh',
      sessions: {
        accessTokenLifespan: 10 * 60,
        idleRefreshTokenLifespan: 14 * 24 * 60 * 60,
        maxRefreshTokenLifespan: 30 * 24 * 60 * 60,
      },
      // Limite native des routes d'authentification, par adresse IP réelle : le BFF transmet
      // X-Forwarded-For (sans lui, tous les joueurs partageaient le compteur du conteneur Nuxt).
      // Filet large : le BFF applique déjà sa propre limite, par compte et par IP, croissante.
      ratelimit: {
        interval: 60_000,
        max: 20,
      },
    },
  },
});
