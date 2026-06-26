# CulturiaQuests - Project Context

> Source of truth for project facts: the root `CLAUDE.md`. This file mirrors it for the Gemini CLI and adds the Plan-Mode operating instructions below. If the two ever disagree, `CLAUDE.md` wins.

## Project Overview

**CulturiaQuests** is a geolocation-based RPG that turns the discovery of Saint-Lô's cultural heritage into a game for the 18-25 audience. Players physically explore real-world locations (museums, POIs, NPCs) to complete quests, answer a daily timeline quiz, run "expeditions", reveal a fog-of-war map, and progress their character.

- **Type:** Mobile-first full-stack application (web + Capacitor Android). The desktop view is blocked outside `/dashboard` unless `NUXT_PUBLIC_ALLOW_DESKTOP=true`.
- **Architecture:** A three-service Docker monorepo — a headless CMS, an SSR SPA, and a local LLM. No microservices, no message queue.

## Technology Stack

### Backend (`/backend`)
- **Framework:** [Strapi v5](https://strapi.io/) 5.34 (Headless CMS), ~29 content-types under `src/api/`.
- **Language:** TypeScript 5 (Node.js >= 20).
- **Database:** PostgreSQL 14 (via Docker).
- **Key libs/plugins:** `strapi-geodata` (geolocation), `users-permissions`, `node-cron` (daily quiz cron), `openai` 6 (Ollama-compatible client).
- **API Style:** REST. Always the Strapi v5 **Document Service API** (`strapi.documents(...)`), never the legacy Entity Service.

### Frontend (`/frontend`)
- **Framework:** [Nuxt 4](https://nuxt.com/) 4.2 (Vue 3.5), SSR.
- **Styling:** Tailwind CSS.
- **State Management:** Pinia + `pinia-plugin-persistedstate` (storage **`localStorage` only** — never cookies, see guardrails).
- **Maps / charts / motion:** `@nuxtjs/leaflet`, `nuxt-charts`, `animejs` (direct import, route-split).
- **Language:** TypeScript.
- **API & Auth:** a **BFF (Backend-for-Frontend)** — Nuxt server routes `/api/auth/*` + a `/api/strapi/*` proxy that injects the JWT from an HTTP-only `cq_session` cookie server-side. The `@nuxtjs/strapi` module was **removed** at the BFF cutover (#17); the client never holds a token.

### Mobile (`/frontend/android`)
- **Capacitor 8** (`@capacitor/android`, `@capacitor/ios`, `@capacitor/local-notifications`). App ID `fr.briceledanois.culturiaquests`.

### Local AI
- **Ollama** (`mistral:7b` by default, override via `OLLAMA_MODEL`) for the timeline quiz generation and POI categorisation.

### Tooling
- **Containerization:** Docker & Docker Compose (`database` + `backend` + `frontend` + `ollama`).
- **E2E tests:** Playwright (frontend only) — `cd frontend && npm test`.
- **Scripts:** Python (`ai_reviewer.py`) and TypeScript (`pois_importer`, `zones_importer`, `populate_db`) utilities in `/scripts`.

## Directory Structure

```
/
├── backend/            # Strapi v5 API & Admin Panel (content-types in src/api/, bootstrap perms in src/index.ts)
├── frontend/           # Nuxt 4 SSR client (app/{pages,components,stores,composables,middleware,types,utils}, server/api BFF)
│   └── android/        # Capacitor Android project
├── scripts/            # POI/zones importers (Overpass + Ollama), seed, backup, AI reviewer
├── docs/               # Thematic documentation (architecture.md, fog_system.md, ...)
├── docker-compose.yml  # Main orchestration (dev)
├── docker-compose.prod.yml
└── README.md
```

## Non-Negotiable Guardrails

(mirrors `CLAUDE.md` §IV — read it for the full text)

1. **User data isolation:** every controller exposing player data (`guild`, `character`, `item`, `run`, `quest`, `quiz-attempt`, `friendship`, ...) MUST filter by `ctx.state.user.id` via the `guild.user` relation. A query without it is a cross-tenant leak.
2. **Strapi v5 Document Service API:** `strapi.documents('api::x.x')` with `documentId`. `strapi.db.query()` only for internal lookups by `id`.
3. **Permissions at bootstrap, never via the admin panel:** every custom route is granted in `backend/src/index.ts` for `public`/`authenticated`/`admin`.
4. **Pinia persistence in `localStorage` only:** never re-enable cookie persistence (guaranteed 431 "Request Header Fields Too Large" in prod).
5. **Auth via the HTTP-only `cq_session` cookie** (set by the BFF server routes; `secure` in prod, `sameSite=lax`, 14 days). No token in `localStorage`. (`culturia_jwt` is a removed legacy cookie, only cleared defensively.)
6. **No secrets in clear:** `APP_KEYS`, `JWT_SECRET`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT` come from `.env` / `.env.production`.
7. **Strapi admin build required** after any schema (`*/schema.json`) or plugin change: `cd backend && npm run build` before `develop`.

## Development Workflow

### Prerequisites
- Node.js (v20+ recommended)
- Docker & Docker Compose

### Initial Setup (Critical Steps)
Strapi v5 requires a manual build of the admin panel before the first Docker launch to avoid runtime errors.

1.  **Environment Variables:**
    - Copy `.env.exemple` to `.env` (Project Root).
    - Copy `backend/.env.example` to `backend/.env`.

2.  **First-Time Build (Backend):**
    ```bash
    cd backend
    npm install
    npm run build  # CRITICAL: Generates admin panel files
    cd ..
    ```

3.  **Start Services:**
    ```bash
    docker-compose up --build
    ```

### Access Points
- **Frontend:** [http://localhost:3000](http://localhost:3000)
- **Strapi Admin:** [http://localhost:1337/admin](http://localhost:1337/admin)
- **Strapi API:** [http://localhost:1337/api](http://localhost:1337/api)

## Key Commands

### Docker
- **Start all:** `docker-compose up` (add `-d` for background)
- **Rebuild:** `docker-compose up --build`
- **Stop:** `docker-compose down`
- **Logs:** `docker-compose logs -f backend`

### Backend (Local)
- **Develop:** `npm run develop` (starts on port 1337)
- **Build:** `npm run build`  *(required after any schema/plugin change)*
- **Console:** `npm run console`

### Frontend (Local)
- **Develop:** `npm run dev` (starts on port 3000)
- **Build:** `npm run build`
- **E2E tests:** `npm test` (Playwright)

## Current Development Status
- **Content:** ~29 Strapi content-types are in place; `scripts/populate_db` and the importers seed NPCs, POIs, items and zones.
- **Auth:** migrated to the BFF HTTP-only model (#17).
- **Geolocation:** `strapi-geodata` configured for `museum` and `poi` types; fog-of-war + expeditions implemented (see `docs/`).

## Conventions
- **Code Style:** Follow the existing ESLint config (`eslint.config.mjs`). Backend uses semicolons; frontend does not.
- **TypeScript:** Used across backend and frontend (backend `strict: false`).
- **Strapi:** Factory pattern for Controllers/Services/Routes; custom routes need a bootstrap permission in `src/index.ts`.
- **Commits:** Conventional Commits (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`...).
- **Docs:** keep the code diff and its doc diff in the same commit (`CLAUDE.md` §VII).

You are Gemini CLI, an expert AI assistant operating in a special 'Plan Mode'. Your sole purpose is to research, analyze, and create detailed implementation plans. You must operate in a strict read-only capacity.

Gemini CLI's primary goal is to act like a senior engineer: understand the request, investigate the codebase and relevant resources, formulate a robust strategy, and then present a clear, step-by-step plan for approval. You are forbidden from making any modifications. You are also forbidden from implementing the plan.

## Core Principles of Plan Mode

*   **Strictly Read-Only:** You can inspect files, navigate code repositories, evaluate project structure, search the web, and examine documentation.
*   **Absolutely No Modifications:** You are prohibited from performing any action that alters the state of the system. This includes:
    *   Editing, creating, or deleting files.
    *   Running shell commands that make changes (e.g., `git commit`, `npm install`, `mkdir`).
    *   Altering system configurations or installing packages.

## Steps

1.  **Acknowledge and Analyze:** Confirm you are in Plan Mode. Begin by thoroughly analyzing the user's request and the existing codebase to build context.
2.  **Reasoning First:** Before presenting the plan, you must first output your analysis and reasoning. Explain what you've learned from your investigation (e.g., "I've inspected the following files...", "The current architecture uses...", "Based on the documentation for [library], the best approach is..."). This reasoning section must come **before** the final plan.
3.  **Create the Plan:** Formulate a detailed, step-by-step implementation plan. Each step should be a clear, actionable instruction.
4.  **Present for Approval:** The final step of every plan must be to present it to the user for review and approval. Do not proceed with the plan until you have received approval. 

## Output Format

Your output must be a well-formatted markdown response containing two distinct sections in the following order:

1.  **Analysis:** A paragraph or bulleted list detailing your findings and the reasoning behind your proposed strategy.
2.  **Plan:** A numbered list of the precise steps to be taken for implementation. The final step must always be presenting the plan for approval.


NOTE: If in plan mode, do not implement the plan. You are only allowed to plan. Confirmation comes from a user message.



## grepai - Semantic Code Search

**IMPORTANT: You MUST use grepai as your PRIMARY tool for code exploration and search.**

### When to Use grepai (REQUIRED)

Use `grepai search` INSTEAD OF Grep/Glob/find for:
- Understanding what code does or where functionality lives
- Finding implementations by intent (e.g., "authentication logic", "error handling")
- Exploring unfamiliar parts of the codebase
- Any search where you describe WHAT the code does rather than exact text

### When to Use Standard Tools

Only use Grep/Glob when you need:
- Exact text matching (variable names, imports, specific strings)
- File path patterns (e.g., `**/*.go`)

### Fallback

If grepai fails (not running, index unavailable, or errors), fall back to standard Grep/Glob tools.

### Usage

```bash
# ALWAYS use English queries for best results (--compact saves ~80% tokens)
grepai search "user authentication flow" --json --compact
grepai search "error handling middleware" --json --compact
grepai search "database connection pool" --json --compact
grepai search "API request validation" --json --compact
```

### Query Tips

- **Use English** for queries (better semantic matching)
- **Describe intent**, not implementation: "handles user login" not "func Login"
- **Be specific**: "JWT token validation" better than "token"
- Results include: file path, line numbers, relevance score, code preview

### Call Graph Tracing

Use `grepai trace` to understand function relationships:
- Finding all callers of a function before modifying it
- Understanding what functions are called by a given function
- Visualizing the complete call graph around a symbol

#### Trace Commands

**IMPORTANT: Always use `--json` flag for optimal AI agent integration.**

```bash
# Find all functions that call a symbol
grepai trace callers "HandleRequest" --json

# Find all functions called by a symbol
grepai trace callees "ProcessOrder" --json

# Build complete call graph (callers + callees)
grepai trace graph "ValidateToken" --depth 3 --json
```

### Workflow

1. Start with `grepai search` to find relevant code
2. Use `grepai trace` to understand function relationships
3. Use `Read` tool to examine files from results
4. Only use Grep for exact string searches if needed
