# BFF (serveur Nuxt)

Le navigateur ne parle qu'au serveur Nuxt ; celui-ci garde les jetons de session Strapi en cookies
httpOnly et relaie les appels. Description complète (sessions révocables, limitation des
tentatives, anti-énumération, connexion Google, CSP) : [`docs/architecture.md`](../../docs/architecture.md),
section « BFF httpOnly ».

| Dossier | Contenu |
|---|---|
| `api/auth/` | Connexion, inscription, confirmation d'adresse, mot de passe oublié, Google, déconnexion, `/me` |
| `api/strapi/[...path].ts` | Proxy authentifié vers l'API de contenu Strapi |
| `middleware/10-session.ts` | Renouvelle le jeton d'accès avant tout handler |
| `plugins/content-security-policy.ts` | CSP à nonce des pages rendues |
| `utils/` | Session et cookies, limitation des tentatives, garde-fous communs |

Tester localement : `npm run test:unit` (logique pure), puis un parcours complet contre une pile
locale (Strapi + base jetable + Mailpit pour lire les e-mails).
