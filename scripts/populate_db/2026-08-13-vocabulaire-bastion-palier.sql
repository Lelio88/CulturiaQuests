-- Migration one-shot — uniformise le vocabulaire des dialogues sur le lore
--
-- CONTEXTE
-- `docs/lore.md` fixe deux termes : un musée envahi est un **bastion** (jamais un « sanctuaire »,
-- jamais un « donjon ») et l'un de ses niveaux est un **palier** (jamais un « étage »). Les
-- dialogues en base employaient l'ancien vocabulaire.
--
-- ORDRE DES REMPLACEMENTS — il est significatif : les tournures les plus spécifiques d'abord.
-- « à l’étage [DungeonThreshold] du sanctuaire » doit être traité AVANT « à l’étage
-- [DungeonThreshold] », sinon la seconde règle consommerait la première et laisserait un
-- « au palier [DungeonThreshold] du sanctuaire » à moitié converti.
--
-- POURQUOI PAS UN SIMPLE replace('étage','palier')
-- La contraction française l'interdit : « à l’étage » devient « au palier », pas « à l’palier ».
-- Chaque tournure a donc sa règle.
--
-- IDEMPOTENT : `replace` sur une chaîne absente est sans effet, et les clauses WHERE évitent
-- d'écrire des lignes inutilement. Rejouable sans risque.
--
-- USAGE :
--   ssh root@<serveur> "docker exec -i postgres_db_prod psql -U strapi -d strapi" \
--     < scripts/populate_db/2026-08-13-vocabulaire-bastion-palier.sql
--
-- Backup préalable : PG_CONTAINER=postgres_db_prod bash scripts/backup-db.sh

BEGIN;

-- 1. Tournure complète (Toben, Denrick, Bram, Toren)
UPDATE dialogs
SET dialogues = replace(dialogues::text, 'à l’étage [DungeonThreshold] du sanctuaire', 'au palier [DungeonThreshold] du bastion')::jsonb,
    updated_at = NOW()
WHERE dialogues::text LIKE '%à l’étage [DungeonThreshold] du sanctuaire%';

-- 2. Forme ordinale (Marn : « au 7ème étage du sanctuaire »)
UPDATE dialogs
SET dialogues = replace(dialogues::text, 'au [DungeonThreshold]ème étage du sanctuaire', 'au palier [DungeonThreshold] du bastion')::jsonb,
    updated_at = NOW()
WHERE dialogues::text LIKE '%au [DungeonThreshold]ème étage du sanctuaire%';

-- 3. Balise seule, sans mention du lieu (Garen, Malori)
UPDATE dialogs
SET dialogues = replace(dialogues::text, 'à l’étage [DungeonThreshold]', 'au palier [DungeonThreshold]')::jsonb,
    updated_at = NOW()
WHERE dialogues::text LIKE '%à l’étage [DungeonThreshold]%';

-- 4. Pluriel narratif (Garen : « en montant les étages »)
UPDATE dialogs
SET dialogues = replace(dialogues::text, 'les étages', 'les paliers')::jsonb,
    updated_at = NOW()
WHERE dialogues::text LIKE '%les étages%';

-- 5. Le lieu, déterminé (Garen)
UPDATE dialogs
SET dialogues = replace(dialogues::text, 'dans le sanctuaire', 'dans le bastion')::jsonb,
    updated_at = NOW()
WHERE dialogues::text LIKE '%dans le sanctuaire%';

-- 6. Le lieu, indéterminé (Malori, quest_complete)
UPDATE dialogs
SET dialogues = replace(dialogues::text, 'dans un sanctuaire', 'dans un bastion')::jsonb,
    updated_at = NOW()
WHERE dialogues::text LIKE '%dans un sanctuaire%';

-- Contrôle : plus aucune occurrence de l'ancien vocabulaire. Doit renvoyer 0 ligne.
SELECT id, text_type, dialogues::text AS reste
FROM dialogs
WHERE dialogues::text ILIKE '%sanctuaire%'
   OR dialogues::text ILIKE '%étage%'
ORDER BY id;

COMMIT;
