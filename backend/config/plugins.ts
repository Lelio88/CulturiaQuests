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
      register: {
        allowedFields: ['date_of_birth'],
      },
    },
  },
});
