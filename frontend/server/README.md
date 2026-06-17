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

## Phase 2 — migration (RÉALISÉE)

1. ✅ **Auth** : `account/login.vue`, `register.vue`, `useLogout.ts`, `useAdmin.ts`, middlewares →
   `useAuth()` (`/api/auth/*`). Enforcement SSR activé (hydratation via `plugins/auth.ts`).
2. ✅ **Appels API** : `useStrapiClient()` → `useApi()` (proxy `/api/strapi/*`) sur tous les
   stores/composables/pages. `useApi` sérialise les params avec `qs` (notation Strapi) et le
   proxy forwarde le query string brut.
3. ✅ **Cutover** : `@nuxtjs/strapi` retiré de `nuxt.config.ts` (modules + bloc `strapi`),
   nettoyage `culturia_jwt` (`storage.ts`, page RGPD). `runtimeConfig.strapi.url` (proxy SSR)
   et `public.strapi.url` (média) conservés. Le paquet npm `@nuxtjs/strapi` reste en dépendance
   dormante (non chargé) — sa désinstallation + promotion de `qs` en dépendance directe est un
   nettoyage cosmétique trivial à part.
4. **Upload avatar** : l'avatar est en base64-JSON (pas de multipart) → passe par le proxy tel quel.
5. **Durcissement restant (optionnel)** : CSP stricte, `sameSite=strict` si compatible (à tester
   sur deep-links + reset-password).

## ⚠️ Vérification

Ce socle n'a **pas pu être exécuté** dans l'environnement de dev de l'assistant (pas d'app
lancée). Avant merge, lancer `cd frontend && npm run build` (compilation Nitro des routes) puis
les tests `curl` ci-dessus.
