# CulturiaQuests — Architecture

Document de référence (description pure de l'état courant). Le `CLAUDE.md` racine y pointe pour tout détail technique non tenable en moins de 100 lignes.

Annexes thématiques déjà présentes dans `docs/` : `admin-dashboard.md`, `api_statistics.md`, `content_sync.md`, `dialog_variables.md`, `fog_system.md`, `items.md`, `npc_quests_structure.md`, `quest_store.md`, `statistics_store.md`, `stores.md`, `typography.md`, `zone_display_system.md`, `zones_importer.md`.

---

## 1. Vue d'ensemble

CulturiaQuests est un monolithe distribué en trois services orchestrés par Docker Compose : un CMS headless (Strapi v5), un frontend SSR (Nuxt 4) et un LLM local (Ollama). Le frontend est aussi packagé en application Android via Capacitor. PostgreSQL 14 est la seule base de données ; il n'y a pas de cache externe, pas de file de messages, pas de worker dédié — les jobs périodiques (génération quotidienne du quiz) tournent dans le process Strapi via `node-cron`.

La couche métier vit côté Strapi (controllers + services), pas côté Nuxt. Le frontend orchestre l'UX, hydrate des stores Pinia depuis l'API, et gère la géolocalisation + le fog-of-war côté client.

## 2. Topologie ASCII

```
┌───────────────────────────────────────────────────────────────────────────┐
│                          docker-compose.yml                                │
│                                                                            │
│  ┌─────────────────┐    ┌──────────────────┐    ┌────────────────────┐    │
│  │ Browser / WebView│    │   nuxt_frontend   │    │   strapi_backend    │    │
│  │ (mobile-first +  │◀──▶│   :3000  (Nuxt 4) │◀──▶│   :1337  (Strapi 5) │    │
│  │  Capacitor APK)  │    │   SSR + Pinia +   │    │   29 content-types  │    │
│  │                  │    │   localStorage    │    │   bootstrap perms   │    │
│  └─────────────────┘    │   leaflet, charts │    │   node-cron (quiz)  │    │
│                          └──────────────────┘    └─────────┬──────────┘    │
│                                  │                          │               │
│                                  │  SSR via                 │  pg driver    │
│                                  │  http://backend:1337     │               │
│                                  │  (réseau interne)        ▼               │
│                                  │              ┌──────────────────────┐    │
│                                  │              │     postgres_db       │   │
│                                  │              │     :5432  (PG 14)    │   │
│                                  │              └──────────────────────┘    │
│                                  │                                          │
│                                  │  Browser → http://localhost:1337         │
│                                  ▼                                          │
│                          ┌──────────────────┐                              │
│                          │      ollama       │                              │
│                          │  :11434  (LLM)   │                              │
│                          │  mistral:7b       │                              │
│                          └──────────────────┘                              │
└───────────────────────────────────────────────────────────────────────────┘

   Cookie de session HTTP-only « cq_session » (sameSite=lax, secure=true en prod, 14 jours)
   Pinia → localStorage (jamais en cookie — limite 431 atteinte sinon)
```

## 3. Catalogue des content-types Strapi

29 modules sous `backend/src/api/<name>/` : **26 content-types persistés** (avec `content-types/<name>/schema.json`) + 3 endpoints service-only sans entité (`admin-dashboard`, `statistic`, `user-settings`). Chaque dossier suit la structure Strapi standard : `content-types/` (si persisté), `controllers/`, `routes/`, `services/`.

### Entités cœur (boucle de jeu)

| Content-type | Rôle | Custom controller / service notable |
|---|---|---|
| `guild` | Guilde joueur (1 par user). Champs : `name`, `gold`, `exp` (biginteger), `scrap`, `quiz_streak`, `debug_mode`, `equipped_badge_ids` (json — badges équipés, max 4, IDs synthétiques de zones). | `find/findOne` filtrent par `user.id`. `setup()` crée guild + character + starter items. `delete()` propage via `deleteGuildWithRelations()`. `badgeSummary()` (GET `/guilds/:documentId/badge-summary`) expose les badges d'une guilde aux autres joueurs (données badge uniquement). `equipBadges()` (PUT `/guilds/badges/equip`) valide la sélection contre les progressions complétées (#54). |
| `character` | Personnage jouable rattaché à une guilde. | `getCharacterIcons()` expose les icônes du media folder `characters/`. Bootstrap : `createStarterItems()` génère arme + casque + charme. |
| `item` | Inventaire (slot : weapon / helmet / charm). Champs : `level`, `index_damage`, `rarity` (FK), `tags`. | `getItemIcons()` + `generateRandomItem(guildId, maxFloor)` (loot drops). |
| `rarity` | Référentiel : basic / common / rare / epic / legendary. | Multiplicateurs DPS hardcodés dans `run.service` : 1 / 1.5 / 2 / 3 / 5. |
| `run` | Expédition (session de combat). | `startExpedition`, `endExpedition`, `getActiveRun` (voir flux §6). |
| `museum` | Lieu d'expédition (lat/lng + `radius` mètres, défaut 50). | — |
| `poi` | Point d'intérêt OSM enrichi (lat/lng, tags). | Import via `scripts/pois_importer` (Overpass + Ollama). |
| `tag` | Catégories : Histoire, Art, Sciences, Nature, Société, Savoir-Faire. | Référencé par `poi`, `item`, `quiz-question`. |
| `npc` | PNJ avec arbres de dialogues. | Sélection aléatoire lors d'expédition (chance 1/5). |
| `dialog` | Texte d'un PNJ. Types : `quest_description`, `expedition_appear`, `expedition_fail`, `quest_complete`, `journal_entries`. | — |
| `quest` | Quête liée à un PNJ. | `generateDaily()` (LLM). |
| `visit` | Trace de visite musée + ouverture coffre. | `openChest()` distribue les récompenses. |

### Zones administratives & progression (fog-of-war)

| Content-type | Rôle |
|---|---|
| `region` / `department` / `comcom` | Hiérarchie française avec géométrie GeoJSON (importée via `scripts/zones_importer`). |
| `progression` | Snapshot guild × zone (région / département / comcom). Alimente le fog-of-war côté client. |

### Quiz quotidien

| Content-type | Rôle |
|---|---|
| `quiz-session` | 1 session par jour. Statut : `pending` / `generating` / `completed` / `failed`. Générée par cron à minuit Europe/Paris. |
| `quiz-question` | 10 questions par session, mélangées. Timeline Ollama **best-effort** (0 à 3 selon disponibilité), QCM OpenQuizzDB complètent pour toujours atteindre 10. `source_id` (privé) = clé d'anti-répétition persistée en base. |
| `quiz-attempt` | Tentative joueur. Score 0-2150 (MAX_QUIZ_SCORE = 200 × QCM + 250 × timeline). Tier : bronze < 1000 < silver < 1400 < gold < 1800 ≤ platinum. |

### Social, admin, GDPR

| Content-type | Rôle |
|---|---|
| `player-friendship` | Amitiés entre **guildes** (requester / receiver, status `pending`/`accepted`/`rejected`). |
| `friendship` | Legacy — amitiés entre character et PNJ (utilisé pour `expedition_entry_unlocked`). |
| `post` | Feed social (création, likes). |
| `badge` | Content-type **dormant** (réservé à de futurs badges curés). Les badges de zone sont dérivés des `progressions` (`is_completed`, serveur-autoritatif) et la sélection équipée est persistée dans `guild.equipped_badge_ids` ; les relations `unlocked_badges`/`equipped_badges` ne sont pas utilisées (#54). |
| `user-settings` | Avatar uploadé, paramètres user. |
| `admin-dashboard` | Service API only (pas d'entité). Endpoints overview / players / map / economy / expeditions / quiz analytics / social / connection / GDPR. |
| `admin-action-log` | Audit log moderation (block/unblock, role change). |
| `connection-log` | Tracking des connexions utilisateurs. |
| `gdpr-request` | Demandes d'export / suppression RGPD. |
| `statistic` | Endpoint custom `getSummary()` (pas d'entité persistée). |

## 4. Infrastructure partagée

### Backend (`backend/`)

| Dossier / fichier | Rôle |
|---|---|
| `config/database.ts` | Config Postgres / SQLite / MySQL via env vars. Postgres en dev/prod. |
| `config/middlewares.ts` | CORS (allowlist incluant les origines Capacitor `capacitor://localhost`, `http://localhost`, `https://localhost`). Body parser 6mb. CSP étendue pour tuiles Leaflet (OSM, CartoDB). |
| `config/cron-tasks.ts` | Crons `node-cron`. Actuel : `generate-daily-quiz` à minuit Europe/Paris. |
| `config/server.ts`, `admin.ts`, `api.ts`, `plugins.ts` | Configs Strapi standard. |
| `src/index.ts` | **Bootstrap permissions**. Idempotent (vérifie avant create). Définit `public`, `authenticated`, `admin`. Le rôle `admin` est cloné depuis `authenticated` + endpoints `admin-dashboard.*`. |
| `src/api/<name>/` | Un content-type par dossier (29 au total). |
| `src/data/openquizzdb/` | Banque de QCM offline (fichiers JSON par thème) + `selected-quizzes.json` (config). Anti-répétition persistée en base via `quiz_questions.source_id` (plus de fichier `used-questions.json` qui était perdu à chaque redeploy). Présence des données vérifiée au bootstrap (log d'erreur explicite si absentes). |

### Frontend (`frontend/app/`)

| Dossier | Rôle |
|---|---|
| `pages/` | Routing fichier-based. Routes publiques : `/`, `/account/login`, `/account/register`, `/CGU`, `/mentions-legales`, `/politique-confidentialite`. Toutes les autres exigent auth. Dashboard admin sous `/dashboard/`. |
| `stores/` | 18 stores Pinia (guild, character, inventory, run, quest, visit, friendship, fog, progression, zone, museum, npc, poi, quiz, statistics, admin, badge, playerFriendship). Tous persistent en `localStorage` via `persist: { pick: [...] }`. |
| `composables/` | 14 composables : `useGeolocation`, `useMapInteraction`, `useDrawerLogic`, `useDamageCalculator`, `useChestState`, `useChestAnimation`, `useFooterVisibility`, `useUserAvatar`, `useAdmin`, `useLogout`, `useZoneCompletion`, `useDeleteAccount`, `useGdprRequest`, `useNotifications`. |
| `middleware/00-device-check.global.ts` | **Global**. Redirige desktop → page d'accueil sauf si `NUXT_PUBLIC_ALLOW_DESKTOP=true` ou route `/dashboard/*`. Vérifie aussi auth pour les routes non publiques (redirige vers `/account/login`). |
| `middleware/admin.ts` | Garde-route admin (vérifie le rôle via `useStrapiUser().role`). |
| `layouts/` | `default` (header/footer game), `blank` (login/register), `dashboard` (admin), `test` (pages dev). |
| `types/` | 18 types TypeScript miroirs des content-types Strapi (`character.ts`, `guild.ts`, `item.ts`, …). |
| `utils/` | `geometry.ts` (point-in-polygon, distances), `geolocation.ts`, `storage.ts`, `strapiHelpers.ts`, `guildLevel.ts` (formule niveau = `√(exp / 75) + 1`). |

### Scripts (`scripts/`)

| Script | Rôle |
|---|---|
| `generate-quiz-questions.ts` | Génération manuelle d'une session quiz (alternative au cron). Flags `--save`, `--force`. |
| `pois_importer/` | Import POI depuis Overpass API (OSM) + catégorisation Ollama. Génère JSON dans `exports/`. |
| `zones_importer/` | Import régions / départements / comcom depuis GeoJSON Etalab. Hiérarchie respectée. |
| `populate_db/` | Seed initial (NPCs, items, POIs, dialogs). |
| `download-openquizzdb.ts` + `list-openquizzdb-themes.ts` | Outils pour gérer la banque OpenQuizzDB offline. |
| `seed-gallery.js` | Bulk-génération d'items avec icônes média lib. |
| `backup-db.sh` / `restore-db.sh` | `.tar.gz` PG dump + média. |
| `ai_reviewer.py` | GitHub Action — review IA sur push `main`/`develop`, post Discord. |
| `export-content.sh` / `import-content.sh` | Strapi content transfer. |

## 5. Règles de couplage

| Couche | Peut importer | Ne doit jamais importer |
|---|---|---|
| `backend/src/api/<x>/controllers/` | `services/x`, autres services via `strapi.service(...)`, `strapi.documents(...)`, `strapi.db.query(...)`. | Du code frontend, des modules `app/`, des fichiers `frontend/`. |
| `backend/src/api/<x>/services/` | `strapi.documents(...)`, `strapi.db.query(...)`, autres services par DI implicite. | Le `ctx` Koa (réservé aux controllers). |
| `frontend/app/stores/` | `useStrapiClient()`, autres stores, types. | `process.env` direct (utiliser `useRuntimeConfig()`). |
| `frontend/app/composables/` | Stores Pinia, autres composables, utils. | `localStorage` direct (passer par Pinia persist). |
| `frontend/app/pages/` & `components/` | Stores, composables, types, utils. | `strapi.db.query` (réservé backend). |
| Tout fichier | Variables d'env via `useRuntimeConfig()` (frontend) ou `process.env` (backend). | Tokens d'API en dur, JWT en dur. |

## 6. Flux typique d'une requête : `POST /api/runs/startExpedition`

Exemple end-to-end représentatif (auth + validation métier + interaction multi-service).

1. **Browser / Capacitor WebView** envoie `POST /api/strapi/runs/startExpedition` (proxy BFF same-origin) avec body `{ museumDocumentId, userLat, userLng }`. Le serveur Nuxt lit le cookie HTTP-only `cq_session` et relaie vers Strapi `POST /api/runs/startExpedition` en injectant l'en-tête `Authorization: Bearer` (le cookie n'est jamais exposé au JavaScript).
2. **CORS middleware** (`strapi::cors`) vérifie l'origine contre l'allowlist (`http://localhost:3000`, `capacitor://localhost`, etc.). Refus si non listée.
3. **CSP / security middleware** (`strapi::security`) ajoute les headers de sécurité.
4. **Strapi router** matche la route custom `runs/startExpedition` définie dans `backend/src/api/run/routes/01-custom-run.ts`.
5. **Permissions middleware** (users-permissions plugin) vérifie que le rôle de l'utilisateur (lu via JWT) a la permission `api::run.run.startExpedition` (accordée au rôle `authenticated` par `backend/src/index.ts`).
6. **`run.controller.startExpedition(ctx)`** :
   - Récupère `ctx.state.user` (injecté par le plugin auth). Rejet 401 si absent.
   - Lit `ctx.request.body`, valide les champs requis.
   - Charge la guilde du user : `strapi.db.query('api::guild.guild').findOne({ where: { user: user.id } })`. **C'est ici que l'isolation cross-tenant est appliquée.**
   - Charge le musée via Document Service : `strapi.documents('api::museum.museum').findOne({ documentId })`.
   - **Validation de proximité** (bypass si `guild.debug_mode`) — distance Haversine `getDistanceFromLatLonInM`. Refus si > `museum.radius` (défaut 50m).
   - Vérifie qu'aucune `run` active n'existe (`date_end IS NULL`) + cooldown 10 minutes depuis la dernière `run` terminée.
   - Délègue les calculs au service : `runService.calculateGuildDPS(guild.documentId)` (somme `base × level × rarity_multiplier` sur tous les items équipés).
   - Roll PNJ 1/5 (0% si cooldown actif). Si tirage gagnant : charge tous les NPCs, en pick un au hasard, lit son dialogue `text_type='expedition_appear'`, fixe `target_threshold ∈ [5, 15]`.
   - Crée la `run` via Document Service : `date_start = now`, `dps`, `museum`, `npc`, `guild`, `target_threshold`, etc.
   - Retourne `{ run, questRolled, dialog, npc }`.
7. **Strapi serializer** transforme la réponse, applique `sanitizeOutput` (retire les champs privés).
8. **Browser** reçoit le JSON. Le store `useRunStore` met à jour son state, la page `/expedition` démarre son timer client-side.

`endExpedition` suit le même squelette + calcul `totalDamage = elapsedSeconds × dps`, `tier = floor(log(totalDamage/100) / log(1.5)) + 2`, rewards `gold = tier*250 + totalDamage/100`, XP avec courbe gaussienne centrée sur 300s (variance 180s, min 10%).

## 7. Patterns imposés

### Backend Strapi v5

- **Factory pattern** : `factories.createCoreController('api::x.x', ({ strapi }) => ({...}))` et `factories.createCoreService(...)`. Override des méthodes CRUD pour injecter le filtre `user.id`.
- **Document Service > Entity Service** : `strapi.documents('api::x.x').findMany/findOne/create/update`. Référencer les entités par `documentId` (string), jamais l'ID numérique côté API publique.
- **`strapi.db.query()`** : autorisé pour les lookups internes par `id` numérique (ex: lookup guild depuis user.id), pour les requêtes complexes avec `populate` imbriqué, et pour les updates atomiques. Ne **jamais** exposer un `id` numérique côté API.
- **Permissions au bootstrap, idempotent** : `grantPermissions(strapi, roleId, actions, roleName)` dans `src/index.ts` — vérifie l'existence avant `create`. Ajouter une nouvelle action custom = ajouter une ligne ici et rien d'autre.
- **Sanitize en sortie** : tout retour de controller passe par `this.sanitizeOutput(entity, ctx)` puis `this.transformResponse(...)`. Respecter ce pipeline.
- **Sanitize en entrée** : utiliser `this.sanitizeQuery(ctx)` avant d'ajouter le filtre user.id, **pas** lire `ctx.query` directement.
- **Auto-doc des packages** : tout nouveau service publie un JSDoc en tête expliquant les choix non-évidents. Cf. `quiz-attempt/services/quiz-attempt.ts` (constantes `TIER_THRESHOLDS`, `TIER_REWARDS`, `QCM_POINTS` extraites en tête).

### Frontend Nuxt 4

- **`useStrapiClient()` pour l'API**, pas de `fetch` brut. Le client embarque le JWT cookie automatiquement.
- **Pinia + Composition API** : `defineStore('name', () => { ... }, { persist: { pick: [...] } })`. Toujours déclarer `pick` pour ne pas persister les flags `loading` / `error`.
- **Hydratation centralisée** : `useGuildStore().fetchAll()` peuple tous les stores liés (character, inventory, quest, visit, run, friendship, progression) en un seul appel avec `populate` imbriqué. Évite les cascades de requêtes au login.
- **Lecture defensive du shape Strapi** : `guild.value?.gold ?? guild.value?.attributes?.gold ?? 0` — Strapi v5 a aplati la structure mais certaines réponses peuvent encore retourner `attributes`. Toujours fournir un fallback `0` / `''`.
- **SSR vs CSR** : `runtimeConfig.strapi.url = 'http://backend:1337'` (interne Docker, utilisé par le SSR), `runtimeConfig.public.strapi.url = 'http://localhost:1337'` (utilisé par le browser). Ne **jamais** inverser.

### BFF httpOnly — le JWT soustrait au JavaScript

Objectif : soustraire le JWT au JavaScript. Le token vit dans un cookie **HTTP-ONLY** (`cq_session`) détenu côté serveur Nuxt, et tous les appels passent par un **BFF** (Backend-For-Frontend) same-origin.

- **Routes serveur** (`frontend/server/api/`) :
  - `POST /api/auth/login|register`, `POST /api/auth/logout`, `GET /api/auth/me` : auth ; posent/lisent/effacent le cookie httpOnly `cq_session`, ne renvoient jamais le JWT au client.
  - `POST /api/auth/forgot-password` : relaie `{ email }` vers Strapi ; renvoie **toujours** `{ ok: true }` (anti-énumération — n'indique jamais si l'e-mail existe). `POST /api/auth/reset-password` : relaie `{ code, password, passwordConfirmation }`, pose `cq_session` en cas de succès (auto-login). Nécessite un **provider e-mail** configuré (`backend/config/plugins.ts` → nodemailer/SMTP Brevo, identifiants via env `SMTP_*`) + l'URL de reset réglée dans l'admin Strapi (Settings → Users & Permissions → Advanced → « Reset password page » = `https://culturia.heianenterprise.com/account/reset-password`). Permissions `auth.forgotPassword`/`auth.resetPassword` accordées au rôle Public au bootstrap. Pages front : `/account/forgot-password`, `/account/reset-password` (publiques dans le middleware). Sur mobile, un **App Link** (`app/plugins/deeplinks.client.ts` via `@capacitor/app` + `AndroidManifest` `autoVerify` sur `culturia.heianenterprise.com/account/reset-password` + `frontend/public/.well-known/assetlinks.json`) ouvre le lien de reset directement dans l'app ; fallback navigateur si la vérification échoue. `assetlinks.json` doit lister le SHA-256 du certificat **Google Play App Signing** (en plus de l'upload key) pour les installs Play.
  - `ANY /api/strapi/<chemin>` : proxy authentifié — relaie vers Strapi `/api/<chemin>` en injectant `Authorization: Bearer` côté serveur. Garde `!jwt` (401), **défense CSRF** (origine same-origin exigée sur POST/PUT/PATCH/DELETE), mapping d'erreur robuste. **Exception** : une allowlist `PUBLIC_GET_PATHS` (GET uniquement, ex. `character-icons`) est relayée **sans session** — routes accordées au rôle Public côté Strapi, consommées avant authentification (écran d'inscription → choix de l'icône). Sans cookie, aucun en-tête `Authorization` n'est envoyé (Strapi applique ses permissions Public).
- **Endpoint backend `GET /api/users/me-with-role`** (extension users-permissions) : variante de `/users/me` qui **peuple le `role`** (le `me` natif le retire au `sanitizeQuery`), requis par les checks admin du front. Permission `plugin::users-permissions.user.meWithRole` accordée au bootstrap (`authenticated`, héritée par `admin`).
- **Front (`useApi` / `useAuth` / `plugins/auth.ts`)** : `useApi()` (compatible `useStrapiClient`) route vers le proxy ; `useAuth()` remplace `useStrapiUser/Auth` ; le plugin hydrate l'user en SSR (gate sur présence du cookie). Le fetcher SSR utilise `useRequestFetch()` pour propager le cookie httpOnly.
- **Périmètre** : le JWT vit uniquement dans le cookie HTTP-only `cq_session` (BFF). `@nuxtjs/strapi` est **entièrement retiré** — modules de `nuxt.config.ts` **et** dépendance `package.json`. `runtimeConfig.strapi.url` (proxy SSR) et `public.strapi.url` (URLs média) sont conservés. Le logout efface défensivement un éventuel cookie `culturia_jwt` legacy. Détail : `frontend/server/README.md`.

### Conventions cross-cutting

- **Coordonnées GPS** : `lat`/`lng` (jamais `latitude`/`longitude`). Défaut Saint-Lô = `(49.1167, -1.0833)`.
- **Distance** : Haversine via fonction utilitaire (backend : inline dans `run.controller` ; frontend : `utils/geolocation.ts`). Toujours en mètres pour la logique métier, kilomètres pour l'affichage.
- **`exp` est un `biginteger`** côté schema Strapi → string côté DB → manipulation via `BigInt()` côté service. Cf. `quiz-attempt.service.applyRewardsToGuild`.
- **Score quiz** : `tier = determineTier(score)` puis `rewards` aléatoires dans `[goldMin, goldMax]`. Une refonte du barème touche `quiz-attempt.service` uniquement.

## 8. Anti-patterns à éviter

- ❌ **Requête Strapi sans filtre user** dans un controller custom — fuite cross-tenant garantie. Toujours passer par `ctx.state.user.id` + relation `guild.user`.
- ❌ **Réimplémenter le lookup guilde-par-utilisateur inline** (`strapi.db.query('api::guild.guild').findOne({ where: { user: { id } } })`) — utiliser le helper unique `getUserGuild(strapi, userId, { select?, populate? })` (`backend/src/utils/guild-helpers.ts`). Point unique pour l'invariant d'isolation, évite la dérive du format de filtre (`user: user.id` vs `user: { id }`).
- ❌ **Persistance Pinia en cookie** — provoque l'erreur HTTP 431 (Request Header Fields Too Large) dès que l'inventaire dépasse quelques dizaines d'items. Configuration figée dans `nuxt.config.ts` (`storage: 'localStorage'`).
- ❌ **Token JWT en `localStorage` côté frontend** — le JWT vit uniquement dans le cookie HTTP-only `cq_session`, posé et lu côté serveur par le BFF Nuxt (jamais accessible au JavaScript).
- ❌ **Permissions ajoutées via le panel admin Strapi** — non versionnées, perdues au prochain rebuild. Tout passe par `backend/src/index.ts`.
- ❌ **`strapi.entityService.*`** — déprécié en Strapi v5. Utiliser `strapi.documents(...)`.
- ❌ **Mutation d'un objet store Pinia depuis un composant** — toujours passer par une action du store (immutabilité du state public).
- ❌ **Hardcoder un endpoint Strapi avec `http://localhost:1337`** côté SSR — utiliser `useRuntimeConfig().strapi.url`. Idem côté browser avec `.public.strapi.url`.
- ❌ **Importer un module Capacitor (`@capacitor/*`) au top-level d'un store Pinia** — casse le SSR. Importer dans une action, après un check `process.client`.
- ❌ **Supposer qu'une session `completed` peut être régénérée par le cron/rattrapage** — `generateDailyQuiz` skip une session `completed`, mais **recycle** automatiquement une session `failed`/`pending` ou `generating` zombie (> 5 min) via un claim atomique (rattrapage si le serveur était down à minuit, #74). Le re-run manuel via `generate-quiz-questions.ts --force` reste pour forcer une régénération d'une session `completed`.
- ❌ **`check-then-create` non sérialisé sur une clé métier concurrente** (ex: première visite d'un POI, génération de quêtes quotidiennes) — deux requêtes simultanées créent des doublons (double loot, double jeu de quêtes). Les contraintes UNIQUE composites sont impossibles sur les tables `_lnk` de Strapi. Utiliser `withAdvisoryLock(strapi, clé, fn)` (`backend/src/utils/db-lock.ts`, verrou consultatif PostgreSQL) autour du get-or-create. Cf. `visit.controller.openChest` (#66), `quest.controller.generateDaily` (#67).
- ❌ **Migration de schéma sans `npm run build`** — l'admin panel cesse de fonctionner avec l'erreur cryptique « reading 'tours' undefined ». Solution : `rm -rf backend/{.strapi,dist,node_modules}` puis `npm install && npm run build`.

## 9. Stratégie de test

| Niveau | Outillage | Couverture |
|---|---|---|
| Unit | **Vitest** câblé (`backend/package.json` → `npm test` / `test:watch`), suites à écrire pour les services purs (`run.service.calculateRewards`, `quiz-attempt.service.calculateScore`, `utils/geometry.ts`, `utils/guildLevel.ts`). | Cible **80%** sur la logique métier (cf. `~/.claude/rules/common/testing.md`). |
| Integration backend | Aucun en place. Strapi expose un harness `strapi/factories` utilisable mais non câblé. | À introduire pour les controllers à filtre `user.id` (vérifier l'isolation). |
| E2E frontend | Playwright (`frontend/playwright.config.ts`, scripts `npm test` / `npm run test:ui`). | Flows critiques à couvrir : login → guild setup → expedition → chest, quiz daily, friendship request. |

Quand un bug est ouvert sur la logique métier, **écrire le test avant le fix** (RED → GREEN → IMPROVE) — voir `~/.claude/rules/common/testing.md`.

## 10. Stratégie de déploiement

| Environnement | Compose | Cible | Notes |
|---|---|---|---|
| Dev local | `docker-compose.yml` | tous services (db + backend + frontend + ollama) | Hot reload via volume mount + `CHOKIDAR_USEPOLLING=true`. |
| Production | `docker-compose.prod.yml` + `.env.production` | db + backend uniquement (frontend servi séparément ou via Capacitor APK) | Backend bindé à `127.0.0.1` derrière reverse proxy. Secrets via GitHub Secrets injectés en `.env.production`. |

Déploiement automatisé : `.github/workflows/deploy.yml` se déclenche sur push vers la branche `release`. SSH vers la VM cible, `docker compose up -d --build`, attente health check `/admin`, notification Discord (succès / échec).

Hors deploy : `.github/workflows/ai_review.yml` poste une review IA sur Discord lors d'un push `main`/`develop`.

## 11. Dépendances externes critiques

| Dépendance | Usage | Risque & mitigation |
|---|---|---|
| **OpenStreetMap (Overpass API)** | Import POI via `scripts/pois_importer/`. | Rate limit côté Overpass — l'import est offline, déclenché à la main. Ne **jamais** appeler Overpass depuis Strapi en runtime. |
| **OpenQuizzDB** | Banque de QCM (fichiers JSON locaux dans `backend/src/data/openquizzdb/`). | Fichiers commités dans le repo. Anti-répétition persistée en base (`quiz_questions.source_id`, survit aux redeploys). Repioche dans l'ensemble complet quand le corpus est presque épuisé. |
| **Ollama (LLM local)** | Génération des questions timeline du quiz quotidien (best-effort) + catégorisation POI à l'import. | Si Ollama indisponible : le service `quiz-generator` skip les timeline (3 retries avec backoff exponentiel) et **complète à 10 QCM** OpenQuizzDB — le quiz reste complet, jamais dégradé. Aucune dépendance bloquante en runtime API. |
| **Etalab (GeoJSON France)** | Source des géométries région / département / comcom. | Import offline via `scripts/zones_importer`. Données stables. |
| **Capacitor (Android)** | Packaging mobile. | App ID `com.culturiaquests.app`. Scheme HTTPS. Build via Gradle standard. |
| **Discord webhook** | Notifications CI/CD. | `DISCORD_WEBHOOK_URL` en secret GitHub. Pas critique — si down, pas d'impact prod. |

## 12. Variables d'environnement (résumé)

Fichier `.env` à la racine pour Docker Compose (cf. `.env.exemple`) :

| Variable | Rôle |
|---|---|
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_PORT` | Credentials Postgres. |
| `PORT` | Port Strapi (défaut 1337). |
| `NUXT_PORT` | Port Nuxt (défaut 3000). |
| `APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET` | Secrets Strapi. **Toujours en `.env`, jamais en dur**. |
| `OLLAMA_MODEL` | Modèle Ollama (défaut `mistral:7b` en dev et en prod ; override possible, ex. `mistral-nemo:12b`, si le serveur a la RAM/GPU). |
| `OLLAMA_BASE_URL` | URL Ollama (défaut `http://ollama:11434` en Docker). |
| `NUXT_PUBLIC_API_URL` | URL publique de l'API pour le browser (défaut `http://localhost:1337`). |
| `NUXT_PUBLIC_ALLOW_DESKTOP` | `true` pour autoriser le desktop hors `/dashboard`. Défaut `true` en dev. |

En production, `.env.production` ajoute les mêmes variables avec valeurs de prod + `NODE_ENV=production`.
