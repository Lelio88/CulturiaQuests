-- Migration one-shot — donne son dialogue d'apparition en expédition à Malori (#176)
--
-- CONTEXTE
-- La migration 2026-08-13-dungeon-appear-dialogs.sql a doté six PNJ d'un `expedition_appear` en
-- copiant leurs textes de donjon. Malori était la seule des sept à ne pas en avoir : son
-- `quest_description` ne parlait pas de bastion, il n'y avait rien à copier. Le tirage de
-- `startExpedition` portant sur tous les PNJ, elle affichait donc le repli « Un aventurier
-- approche... » une fois sur sept.
--
-- Ce dialogue est ÉCRIT, pas copié : il justifie la présence d'une postière dans un bastion (une
-- tournée qu'elle refuse de laisser inachevée) et reprend sa maladresse assumée. La balise
-- [DungeonThreshold] y est résolue par `npc-interaction.vue` à partir du palier calibré sur
-- l'équipement du joueur.
--
-- IDEMPOTENT : sort sans rien faire si Malori est introuvable ou possède déjà un dialogue
-- d'apparition.
--
-- USAGE :
--   ssh root@<serveur> "docker exec -i postgres_db_prod psql -U strapi -d strapi" \
--     < scripts/populate_db/2026-08-13-malori-expedition-appear.sql
--
-- Backup préalable : PG_CONTAINER=postgres_db_prod bash scripts/backup-db.sh

BEGIN;

DO $migration$
DECLARE
  malori_id  INTEGER;
  sa_locale  VARCHAR;
  nouveau_id INTEGER;
BEGIN
  SELECT n.id INTO malori_id FROM npcs n WHERE n.firstname = 'Malori' LIMIT 1;

  IF malori_id IS NULL THEN
    RAISE NOTICE 'Malori introuvable en base — aucune action.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dialogs d
    JOIN dialogs_npc_lnk l ON l.dialog_id = d.id
    WHERE l.npc_id = malori_id AND d.text_type = 'expedition_appear'
  ) THEN
    RAISE NOTICE 'Malori possède déjà un expedition_appear — aucune action.';
    RETURN;
  END IF;

  -- Aligner la locale sur celle de ses autres dialogues plutôt que de la supposer.
  SELECT d.locale INTO sa_locale
  FROM dialogs d
  JOIN dialogs_npc_lnk l ON l.dialog_id = d.id
  WHERE l.npc_id = malori_id
  LIMIT 1;

  INSERT INTO dialogs (document_id, text_type, dialogues, created_at, updated_at, published_at, locale)
  VALUES (
    md5(random()::text || clock_timestamp()::text),
    'expedition_appear',
    '["[PlayerName] ! Oh, quelle chance de tomber sur toi ici…", "J’avais un pli à remettre en main propre, et — disons que les marches et moi, ça fait deux. Il m’a échappé à l’étage [DungeonThreshold].", "Je peux pas rentrer sans. Ce serait la première fois. Tu veux bien ?"]'::jsonb,
    NOW(), NOW(), NOW(),
    sa_locale
  )
  RETURNING id INTO nouveau_id;

  INSERT INTO dialogs_npc_lnk (dialog_id, npc_id, dialog_ord)
  VALUES (nouveau_id, malori_id, 1);

  RAISE NOTICE 'Dialogue expedition_appear créé pour Malori (dialog id %).', nouveau_id;
END
$migration$;

-- Contrôle : les 7 PNJ doivent désormais avoir les 4 types de dialogues.
SELECT n.firstname, string_agg(d.text_type, ', ' ORDER BY d.text_type) AS dialogues
FROM npcs n
JOIN dialogs_npc_lnk l ON l.npc_id = n.id
JOIN dialogs d ON d.id = l.dialog_id
GROUP BY n.firstname
ORDER BY n.firstname;

COMMIT;
