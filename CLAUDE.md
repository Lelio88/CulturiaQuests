# CulturiaQuests — Contexte d'Opération et Garde-Fous Agentiques

Résolvez les problèmes sans introduire de régression ni de dette technique architecturale.

## I. Finalité

**Application** : CulturiaQuests — RPG géolocalisé pour faire découvrir le patrimoine culturel de Saint-Lô aux 18-25 ans.
**Objectif métier** : transformer l'exploration culturelle locale en aventure ludique (POI, musées, PNJ, quêtes, quiz quotidien, expéditions, fog-of-war, dashboard admin).
**Public cible** : mobile-first (web + Capacitor Android). Le desktop est bloqué hors `/dashboard` sauf `NUXT_PUBLIC_ALLOW_DESKTOP=true`.

## II. Architecture

**Modèle** : monorepo Docker à trois services — **headless CMS** (Strapi v5 / PostgreSQL) + **SPA SSR** (Nuxt 4 / Pinia) + **LLM local** (Ollama). Pas de microservices ; pas de file de messages.

**Détails complets** (topologie, content-types, flux d'une requête, anti-patterns, stratégie de tests) : voir [`docs/architecture.md`](./docs/architecture.md).

Topologie rapide :
- `backend/` — API Strapi v5 (29 content-types sous `src/api/`, bootstrap permissions, cron quiz)
- `frontend/` — Nuxt 4 (`app/{pages,components,stores,composables,middleware,types,utils}`)
- `frontend/android/` — projet Capacitor (App ID `com.culturiaquests.app`)
- `scripts/` — importers POI/zones (Overpass + Ollama), seed, backup, AI reviewer
- `docs/` — documentation thématique (api_statistics, fog_system, zones_importer, etc.)

## III. Pile Technologique

*Versions contraintes par `backend/package.json` et `frontend/package.json`. N'introduisez aucune dépendance alternative sans approbation.*

- **Backend** : Strapi 5.34.0, TypeScript 5, Node ≥ 20, PostgreSQL 14, `node-cron` 4, `openai` 6, `strapi-geodata`, `@strapi/provider-email-nodemailer` (SMTP Brevo — reset password)
- **Frontend** : Nuxt 4.2, Vue 3.5, Pinia + `pinia-plugin-persistedstate` (storage `localStorage`), `@nuxtjs/leaflet` (⚠️ `use-global-leaflet: true` requis — sinon le clustering casse le rendu, cf. `docs/zone_display_system.md`), `leaflet.markercluster` (regroupement des POI/musées au zoom ≥ 11, fallback layerGroup), `@nuxtjs/device`, `@nuxt/icon`, `nuxt-charts`, `animejs` (import direct route-splitté). Auth via BFF (cf. §IV.5) : le module `@nuxtjs/strapi` a été retiré des modules au cutover #17 (paquet conservé en dépendance mais non utilisé) ; `@hypernym/nuxt-anime` a été désinstallé.
- **Mobile** : Capacitor 8 (`@capacitor/android`, `@capacitor/ios`, `local-notifications`, `@capacitor/app` pour les deep-links / App Links)
- **Tests E2E** : Playwright (configuré côté frontend uniquement)
- **IA** : Ollama (`mistral:7b` par défaut en dev **et** en prod ; override possible via `OLLAMA_MODEL`, ex. `mistral-nemo:12b`, si le serveur dispose de la RAM/GPU) pour quiz timeline + catégorisation POI
- **Infra** : Docker Compose (`database` Postgres alpine + `backend` + `frontend` + `ollama`)

## IV. Garde-Fous non négociables

1. **Isolation utilisateur obligatoire** — tout controller exposant des données joueur (`guild`, `character`, `item`, `run`, `quest`, `quiz-attempt`, `friendship`, etc.) **doit** filtrer par `ctx.state.user.id` via la relation `guild.user`. Cf. `guild.controller.find()` et `run.controller.find()`. Une requête sans ce filtre est une fuite cross-tenant.
2. **Strapi v5 Document Service API** — utiliser `strapi.documents('api::x.x')` avec `documentId`, jamais l'ancien Entity Service. `strapi.db.query()` reste autorisé pour les lookups internes par `id`.
3. **Permissions accordées au bootstrap, jamais via le panel admin** — toute nouvelle route custom doit être ajoutée à `backend/src/index.ts` pour les rôles `public`/`authenticated`/`admin`. Le rôle `admin` hérite de tout `authenticated` + des endpoints `admin-dashboard.*`.
4. **Persistance Pinia en `localStorage` uniquement** — ne **jamais** réactiver la persistance cookie (erreur 431 Request Header Fields Too Large garantie sur la prod). Configuration figée dans `nuxt.config.ts` (`storage: 'localStorage'`).
5. **JWT via cookie HTTP-only nommé `cq_session`** — posé/lu par les routes serveur BFF (`frontend/server/api/auth/*`), jamais exposé au JavaScript. Aucun token en `localStorage`. Le cookie est `secure` en prod, `sameSite: 'lax'`, durée 14 jours. (`culturia_jwt`, l'ancien cookie de `@nuxtjs/strapi`, a été retiré au cutover #17 ; il n'est plus qu'effacé défensivement au logout.)
6. **Pas de secrets en clair** — `APP_KEYS`, `JWT_SECRET`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT` viennent de `.env` (racine) ou `.env.production` (CI/CD). Voir [common/security.md](~/.claude/rules/common/security.md).
7. **Build admin Strapi obligatoire** — après toute modification de schéma (`*/schema.json`) ou installation de plugin, `cd backend && npm run build` est requis avant `develop`.

## V. Flux de Travail (Explore → Plan → Code → Verify)

1. **Exploration** — lire les fichiers adjacents (controller voisin, schema correspondant) pour calquer les patterns. Pour les fonctionnalités existantes, consulter aussi `docs/<topic>.md`.
2. **Planification** — pour tout changement non trivial (nouveau content-type, refonte d'un flux, ajout d'un middleware), soumettre l'approche à l'utilisateur avant d'écrire du code.
3. **Implémentation** — code minimal. Pour un nouveau content-type backend : générer `schema.json`, `controllers/x.ts` (factory pattern), `services/x.ts` (factory pattern), `routes/01-custom.ts` si endpoints customs, puis ajouter les permissions dans `backend/src/index.ts`.
4. **Vérification** — backend : `cd backend && npm run build` ; frontend : `cd frontend && npm run build` ; full-stack : `docker-compose up --build` puis test manuel sur `http://localhost:3000`.

**Auto-documentation des packages (règle transverse)** — tout nouveau service Strapi, store Pinia ou composable Nuxt **doit** publier en tête un JSDoc qui couvre : (1) ce que fait le module en une phrase, (2) les choix non-évidents et leur motivation (ex: « score timeline utilise une fonction par paliers car la pénalité linéaire n'est pas perçue comme juste à distance > 20 ans »), (3) les invariants à préserver, (4) un exemple d'usage canonique si l'API n'est pas évidente. Cf. `useGeolocation.ts` pour la qualité de référence.

## VI. Commandes de Développement

```bash
# Démarrage complet (recommandé)
docker-compose up --build -d                 # tous les services (db + backend + frontend + ollama)
docker-compose logs -f backend               # suivre les logs
docker-compose down                          # arrêter

# Backend Strapi (port 1337)
cd backend && npm install && npm run build   # première fois ou après changement schema
cd backend && npm run develop                # dev hot-reload

# Frontend Nuxt (port 3000)
cd frontend && npm install && npm run dev

# Tests E2E frontend
cd frontend && npm test                      # Playwright

# Base de données
bash scripts/backup-db.sh                    # backup PG + media
bash scripts/restore-db.sh backups/initial_data.tar.gz

# Génération quiz manuelle (admin)
npx tsx scripts/generate-quiz-questions.ts --save

# Production
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

## VII. Maintenance documentaire

**Règle d'or** : le diff du code et le diff de la doc correspondante doivent être dans **le même commit**.

| Modification | Fichier à mettre à jour |
|---|---|
| Nouveau content-type Strapi | `docs/architecture.md` (catalogue) + permissions dans `backend/src/index.ts` |
| Nouvel endpoint custom | `backend/src/index.ts` (permissions) + `docs/architecture.md` (flux requête si non trivial) |
| Changement de schéma BDD | `schema.json` + relancer `npm run build` + `docs/architecture.md` si invariant impacté |
| Nouveau store Pinia / composable | JSDoc en tête + `docs/stores.md` si pattern partagé |
| Ajout de dépendance critique | Section III + `package.json` correspondant |
| Nouvel anti-pattern découvert | Section « Anti-patterns » de `docs/architecture.md` |
| Migration de données (one-shot) | Script dans `scripts/populate_db/` + mention dans `docs/architecture.md` |

## VIII. Contexte de Session

- **Dernier focus** : —
- **Focus immédiat** : —
