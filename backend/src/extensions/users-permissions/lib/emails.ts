/**
 * E-mails d'authentification : gabarits versionnés et avertissement d'inscription en double.
 *
 * Les gabarits de users-permissions vivent dans la base (store du plugin) ; `ensureAuthSettings`
 * les réécrit à chaque démarrage depuis ce fichier, avec les réglages avancés (confirmation
 * obligatoire, pages de retour). Le dépôt fait donc foi : une retouche dans l'admin Strapi est
 * écrasée au déploiement suivant — c'est voulu, pour que la prod soit reproductible (§IV.3).
 *
 * Choix non-évidents :
 * - Le lien de confirmation mène à une **page du jeu** (`/account/confirm`), où le joueur appuie
 *   sur un bouton : un scanner de messagerie qui suit les liens ne confirme donc pas à sa place
 *   un compte créé par quelqu'un d'autre avec son adresse.
 * - Aucun pseudo dans les gabarits : `<%= %>` n'échappe pas le HTML, et le pseudo est saisi
 *   librement. « Bonjour, » suffit.
 * - L'avertissement de doublon est plafonné à un par adresse et par heure, pour que le
 *   formulaire d'inscription ne serve pas à bombarder une boîte.
 *
 * @example
 * await ensureAuthSettings()            // bootstrap
 * await sendDuplicateSignupNotice(email) // inscription avec une adresse déjà prise
 */

const SENDER_NAME = 'CulturiaQuests';
const NOTICE_INTERVAL_MS = 60 * 60 * 1000;
const lastNotice = new Map<string, number>();

export function frontendUrl(): string {
  return (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function layout(title: string, body: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1f2937;line-height:1.5">
<h1 style="font-size:20px;color:#4f46e5">${title}</h1>
${body}
<p style="font-size:12px;color:#6b7280;margin-top:32px">CulturiaQuests — ce message automatique ne reçoit pas de réponse. Contact : heianenterpriseyt@gmail.com</p>
</div>`;
}

function button(href: string, label: string): string {
  return `<p><a href="${href}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${label}</a></p>
<p style="font-size:13px;color:#6b7280">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>${href}</p>`;
}

function confirmationTemplate(front: string): string {
  return layout(
    'Confirmez votre adresse',
    `<p>Bonjour,</p>
<p>Votre compte CulturiaQuests est presque prêt : il reste à confirmer que cette adresse est bien la vôtre.</p>
${button(`${front}/account/confirm?confirmation=<%= CODE %>`, 'Confirmer mon adresse')}
<p>Ce lien reste valable 7 jours ; passé ce délai, l'inscription non confirmée est effacée.</p>
<p>Si vous n'avez pas créé de compte, ignorez ce message : rien ne sera activé.</p>`,
  );
}

function resetTemplate(): string {
  return layout(
    'Réinitialisation du mot de passe',
    `<p>Bonjour,</p>
<p>Une réinitialisation du mot de passe de votre compte CulturiaQuests a été demandée.</p>
${button('<%= URL %>?code=<%= TOKEN %>', 'Choisir un nouveau mot de passe')}
<p>Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.</p>`,
  );
}

function duplicateNoticeTemplate(front: string): string {
  return layout(
    'Vous avez déjà un compte',
    `<p>Bonjour,</p>
<p>Quelqu'un — peut-être vous — a essayé de créer un compte CulturiaQuests avec cette adresse, qui en a déjà un.</p>
<p>Pour y accéder, connectez-vous ; si vous avez oublié votre mot de passe, choisissez « Mot de passe oublié ? » sur l'écran de connexion.</p>
${button(`${front}/account/login`, 'Se connecter')}
<p>Si ce n'était pas vous, ignorez ce message : aucun compte n'a été créé et le vôtre n'a pas changé.</p>`,
  );
}

type TemplateOptions = { from?: { name?: string; email?: string }; response_email?: string; object?: string; message?: string };
type EmailStore = Record<string, { options?: TemplateOptions } | undefined>;

/**
 * Réglages avancés et gabarits users-permissions, alignés sur le dépôt à chaque démarrage.
 * Idempotent : n'écrit que si une valeur diffère.
 */
export async function ensureAuthSettings(): Promise<void> {
  const front = frontendUrl();
  const store = strapi.store({ type: 'plugin', name: 'users-permissions' });

  const advanced = ((await store.get({ key: 'advanced' })) ?? {}) as Record<string, unknown>;
  const wantedAdvanced = {
    ...advanced,
    unique_email: true,
    allow_register: true,
    email_confirmation: true,
    email_confirmation_redirection: `${front}/account/login?confirmed=1`,
    email_reset_password: `${front}/account/reset-password`,
    default_role: advanced.default_role || 'authenticated',
  };
  if (JSON.stringify(wantedAdvanced) !== JSON.stringify(advanced)) {
    await store.set({ key: 'advanced', value: wantedAdvanced });
    strapi.log.info('users-permissions : réglages avancés alignés (confirmation e-mail obligatoire)');
  }

  const emails = ((await store.get({ key: 'email' })) ?? {}) as EmailStore;
  const fromEmail = process.env.SMTP_DEFAULT_FROM;
  const wanted: Record<string, { object: string; message: string }> = {
    email_confirmation: { object: 'Confirmez votre adresse — CulturiaQuests', message: confirmationTemplate(front) },
    reset_password: { object: 'Votre nouveau mot de passe CulturiaQuests', message: resetTemplate() },
  };
  let changed = false;
  for (const [key, template] of Object.entries(wanted)) {
    const current = emails[key]?.options ?? {};
    const next: TemplateOptions = {
      ...current,
      object: template.object,
      message: template.message,
      from: { name: SENDER_NAME, email: fromEmail || current.from?.email },
      response_email: current.response_email ?? '',
    };
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      emails[key] = { ...(emails[key] ?? {}), options: next };
      changed = true;
    }
  }
  if (changed) {
    await store.set({ key: 'email', value: emails });
    strapi.log.info('users-permissions : gabarits e-mail alignés sur le dépôt');
  }
}

/** Prévient le titulaire d'une adresse déjà inscrite ; ne dit rien à l'auteur de la tentative. */
export async function sendDuplicateSignupNotice(email: string): Promise<void> {
  const now = Date.now();
  const previous = lastNotice.get(email);
  if (previous !== undefined && now - previous < NOTICE_INTERVAL_MS) return;
  lastNotice.set(email, now);
  for (const [key, at] of lastNotice) {
    if (now - at >= NOTICE_INTERVAL_MS) lastNotice.delete(key);
  }

  const fromEmail = process.env.SMTP_DEFAULT_FROM;
  const html = duplicateNoticeTemplate(frontendUrl());
  try {
    await strapi.plugin('email').service('email').send({
      to: email,
      from: fromEmail ? `${SENDER_NAME} <${fromEmail}>` : undefined,
      subject: 'Tentative d’inscription avec votre adresse — CulturiaQuests',
      text: html.replace(/<[^>]+>/g, ''),
      html,
    });
  } catch (err) {
    // L'inscription répond pareil dans tous les cas : un échec d'envoi ne se voit que dans les journaux.
    strapi.log.error(`[inscription] avertissement de doublon non envoyé : ${err instanceof Error ? err.message : err}`);
  }
}
