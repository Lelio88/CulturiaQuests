# 🖥️ Infrastructure & Hébergement

Vue d'ensemble de l'hébergement de production de CulturiaQuests. Procédure de déploiement détaillée : [`DEPLOYMENT.md`](./DEPLOYMENT.md).

> ⚠️ **Aucun secret dans ce fichier** (ni ailleurs dans le repo). Les mots de passe, clés privées et jetons vivent **uniquement** dans les **GitHub Secrets** (pour le CI) et le fichier **`.env.production` sur le serveur** (non versionné). Seules figurent ici des informations publiques (IP, clé *publique* SSH, architecture).

---

## Serveur

| Élément | Valeur |
|---|---|
| Hébergeur | **Hetzner Cloud** ([console](https://console.hetzner.cloud/)) |
| Type | **CX32** — Shared vCPU « Cost-Optimized », x86 (Intel/AMD) — 4 vCPU / **8 Go RAM** / 80 Go NVMe |
| Localisation | **Nuremberg** (Allemagne, UE — RGPD) |
| OS | **Ubuntu 24.04 LTS** |
| IP publique | **167.233.156.2** (IPv4) + IPv6 |
| Swap | 4 Go |
| Runtime | Docker + Docker Compose (plugin) |
| Firewall Hetzner | `culturiaquests-web` — entrant **TCP 22 / 80 / 443** uniquement ; sortant : tout autorisé |
| Coût | ~8 €/mois TTC |

### Accès SSH

```bash
ssh root@167.233.156.2
```

Authentification **par clé** (pas de mot de passe). Clé **publique** autorisée sur le serveur :

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICxzIUxAwN0j83achZ3iNzYTLwj1PcezytzrfpeUpdwk
```

> La clé **privée** correspondante (`~/.ssh/id_ed25519` sur la machine de l'admin) n'est **jamais** partagée ni versionnée.

---

## Nom de domaine

- **Domaine racine : _à définir_** — un **seul domaine neutre** (nom/marque) est utilisé pour **tous les projets**, chacun sur son sous-domaine.
- Sous-domaines prévus pour **CulturiaQuests** (à faire pointer vers `167.233.156.2` via des enregistrements DNS **A**) :

| Sous-domaine | Cible | Rôle |
|---|---|---|
| `culturia.<domaine>` | serveur **Nuxt** (port 3000) | Front + BFF (`/api/auth/*`, proxy `/api/strapi/*`) — chargé par le web **et** par l'app mobile (Capacitor `server.url`) |
| `api.culturia.<domaine>` | **Strapi** (port 1337) | API + admin + médias (`/uploads`) |

- **HTTPS** : géré automatiquement par **Caddy** (Let's Encrypt) — un certificat par sous-domaine, sans wildcard.

### Caddy — journalisation et cache

Le `Caddyfile` (`/etc/caddy/Caddyfile`, **hors dépôt**) ne se limite pas au reverse proxy :

| Réglage | Portée | Pourquoi |
|---|---|---|
| Access log JSON | les deux vhosts | Sans lui, un incident utilisateur est indiagnosticable a posteriori : les logs Docker ne remontent qu'au dernier déploiement et ne voient pas les requêtes qui n'atteignent jamais l'app. Fichiers `/var/log/caddy/{culturia,api-culturia}-access.log`, 20 Mio × 5, purge à 30 jours. |
| Masquage d'IP (`ip_mask` /24, /32) | les deux vhosts | Les IP sont des données personnelles et le diagnostic n'a pas besoin d'identifier un joueur. Caddy expurge déjà `Authorization` / `Cookie` / `Set-Cookie`. |
| `Cache-Control: public, max-age=31536000, immutable` | `api.culturia…/uploads/*` | Les médias Strapi ont un nom **hashé** à l'upload : une URL donnée ne change jamais de contenu. Sans ce réglage, Strapi renvoyait `max-age=0`, sans ETag, en ignorant `If-Modified-Since` → retéléchargement intégral à chaque affichage. |
| `Cache-Control: public, max-age=604800` | `culturia…/assets/*` | Visuels du jeu servis par Nuxt (~19 Mo : badges, PNJ, cartes). **Volontairement ni `immutable` ni un an** : ces noms de fichiers ne sont **pas** hashés (`Theodric.webp` le reste après remplacement), un cache long figerait l'ancien visuel chez les joueurs sans moyen de purge. Les bundles `/_nuxt/*`, eux, sont déjà versionnés par Nuxt et servis en `immutable`. |

Toute modification passe par `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` **avant** `systemctl reload caddy` — un Caddyfile invalide fait tomber les deux sites.

⚠️ **`validate` ne teste pas l'ouverture des fichiers de log.** Une config peut être déclarée
« Valid configuration » puis faire échouer le reload sur `permission denied`. Pire : `caddy validate`
lancé **en root** instancie les modules de log et crée les fichiers manquants en `root:root 0600`,
alors que le daemon tourne en `caddy` (`User=caddy`) — il ne peut alors plus les ouvrir. Les fichiers
de `/var/log/caddy/` doivent préexister en `caddy:caddy 640`.

Un reload refusé est **sans coupure** (l'ancienne config reste active en mémoire), mais il laisse le
Caddyfile sur disque désynchronisé : au prochain `restart`/reboot, Caddy refuserait de démarrer et
les deux sites tomberaient. Toujours restaurer la sauvegarde après un reload échoué.

---

## Architecture déployée (option A)

L'app mobile est une **webview du serveur Nuxt déployé** (option A) : elle charge `https://culturia.<domaine>`, ce qui préserve le BFF et le cookie httpOnly `cq_session`.

Quatre conteneurs Docker (`docker-compose.prod.yml`), derrière **Caddy** (reverse proxy + TLS) :

| Service | Rôle | Exposition |
|---|---|---|
| `database` | PostgreSQL 14 | interne uniquement |
| `backend` | Strapi v5 (API, admin, médias) | `127.0.0.1:1337` → Caddy `api.culturia.<domaine>` |
| `frontend` | Nuxt SSR (front + BFF) | `127.0.0.1:3000` → Caddy `culturia.<domaine>` |
| `ollama` | LLM local (`mistral:7b`, cron quiz) | interne uniquement (jamais exposé) |

---

## Déploiement

- **Premier déploiement / migration de données** : sur le serveur, `./install-prod.sh <backup.tar.gz>` (build + démarre + restaure la base et les uploads depuis une sauvegarde).
- **Déploiements suivants** : push sur la branche **`release`** → GitHub Actions (`.github/workflows/deploy.yml`) : SSH → `git pull` → génère `.env.production` depuis les secrets → `docker compose up --build`.
- Détails complets, Caddy, variables : **[`DEPLOYMENT.md`](./DEPLOYMENT.md)**.

### Secrets requis (jamais dans le repo)

Stockés dans **GitHub → Settings → Secrets** et/ou `.env.production` sur le serveur :

- **Connexion CI** : `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_PATH`
- **App** : `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD`, `APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET`, `ENCRYPTION_KEY`
- **Front** : `NUXT_PUBLIC_STRAPI_URL` = `https://api.culturia.<domaine>`
- **Signature Android** : `frontend/android/keystore.properties` + `release.jks` (locaux, gitignorés)

---

## Observabilité

Ce qui est disponible pour diagnostiquer un incident, et jusqu'où ça remonte :

| Source | Commande | Profondeur |
|---|---|---|
| Access logs HTTP | `tail -f /var/log/caddy/culturia-access.log` (ou `api-culturia-…`) | 30 jours |
| Logs applicatifs | `docker logs -f nuxt_frontend_prod` / `strapi_backend_prod` | **depuis le dernier déploiement seulement** — un push sur `release` recrée les conteneurs et efface l'historique |
| Base | `docker exec postgres_db_prod psql -U strapi -d strapi` | — |

Le domaine est `heianenterprise.com` : substituer partout à `<domaine>` ci-dessus.
