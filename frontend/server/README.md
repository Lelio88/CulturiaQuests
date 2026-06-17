# BFF httpOnly — socle (issue #17, phase 1)

Objectif : passer le JWT d'un cookie **lisible par le JavaScript** (`culturia_jwt`, posé par
`@nuxtjs/strapi`) à un cookie **HTTP-ONLY** détenu côté serveur Nuxt, afin qu'un vol de token
par XSS devienne impossible. Cela impose un **BFF** (Backend-For-Frontend) : le serveur Nuxt
détient le token et relaie les appels vers Strapi.

## Ce que contient ce socle (phase 1 — ADDITIF, ne casse rien)

Ces routes serveur Nitro sont **nouvelles et non encore câblées** dans les stores/pages.
L'application continue de fonctionner comme avant (via `@nuxtjs/strapi`). On peut donc merger
et **tester ce socle isolément** avant la migration.

| Route | Rôle |
|---|---|
| `POST /api/auth/login` | `{ identifier, password }` → Strapi `/auth/local` ; pose le cookie httpOnly `cq_session` ; renvoie `{ user }` (jamais le JWT) |
| `POST /api/auth/register` | relaie vers Strapi `/auth/local/register` (valide date_of_birth) ; pose `cq_session` ; renvoie `{ user }` |
| `POST /api/auth/logout` | efface `cq_session` |
| `GET /api/auth/me` | lit `cq_session` → Strapi `/users/me?populate=role` |
| `ANY /api/strapi/<chemin>` | proxy authentifié : relaie vers Strapi `/api/<chemin>` en injectant `Authorization: Bearer` côté serveur |

Cookie **dédié** `cq_session` (httpOnly, `secure` en prod, `sameSite=lax`, 14 j) — volontairement
distinct de `culturia_jwt` pour **cohabiter sans conflit** pendant la migration.

## Tester le socle (avant migration)

Avec l'app lancée (`docker-compose up`), un utilisateur de test existant :

```bash
# Login → doit renvoyer { user } et poser un cookie Set-Cookie: cq_session=...; HttpOnly
curl -i -c jar.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"test@culturia.com","password":"TestPassword123!"}'

# Me (utilise le cookie httpOnly)
curl -s -b jar.txt http://localhost:3000/api/auth/me | jq .

# Proxy authentifié (ex. la guilde du joueur)
curl -s -b jar.txt http://localhost:3000/api/strapi/guilds | jq .

# Logout
curl -i -b jar.txt -X POST http://localhost:3000/api/auth/logout
```

Vérifier que `cq_session` est bien **HttpOnly** (non lisible via `document.cookie` dans la console).

## Phase 2 — migration (PRs suivantes, à faire une fois le socle validé)

1. **Auth** : remplacer `useStrapiAuth().login/logout` et `useStrapiUser()` par des appels à
   `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`. Mettre à jour `stores/guild.ts`,
   les pages `account/login.vue`, `account/register.vue`, `useLogout.ts`, le middleware d'auth.
2. **Appels API** : router `useStrapiClient()` (ou un nouveau composable `useApi()`) vers
   `/api/strapi/<chemin>` au lieu de l'URL Strapi directe. ~18 stores + composables.
3. **Consolidation** : une fois tout migré, supprimer la config cookie client de `@nuxtjs/strapi`
   (ou retirer le module si plus utilisé) et, si souhaité, renommer `cq_session` → `culturia_jwt`.
4. **Upload multipart** : traiter `uploadAvatar` (flux binaire) — le proxy actuel cible le JSON.
5. **Durcissement complémentaire** : CSP stricte, `sameSite=strict` si compatible avec les flux.

## ⚠️ Vérification

Ce socle n'a **pas pu être exécuté** dans l'environnement de dev de l'assistant (pas d'app
lancée). Avant merge, lancer `cd frontend && npm run build` (compilation Nitro des routes) puis
les tests `curl` ci-dessus.
