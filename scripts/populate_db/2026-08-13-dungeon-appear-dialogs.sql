-- Migration one-shot — donne un dialogue d'apparition en expédition aux PNJ « donjon » (#176)
--
-- CONTEXTE
-- Six dialogues décrivent une mission de donjon (« j'ai perdu ceci à l'étage [DungeonThreshold] du
-- sanctuaire ») mais sont typés `quest_description`. Ce type est affiché par QuestBox, pour les
-- quêtes de POI, où aucun palier n'existe : la balise ne pouvait pas être résolue et s'affichait
-- brute au joueur.
--
-- Leur place est `expedition_appear`, le type que `npc-interaction.vue` affiche quand un PNJ surgit
-- pendant une expédition — le seul contexte où un `target_threshold` existe et où la balise se
-- résout (cf. `run.ts`, palier désormais calibré sur l'équipement du joueur).
--
-- POURQUOI DUPLIQUER ET NON DÉPLACER
-- `selectNpcs` ne retient que les PNJ possédant un `quest_description`, et il n'y a que 7 PNJ en
-- base. Retyper les six en priverait la génération de quêtes quotidiennes, qui n'aurait plus qu'un
-- seul donneur. On copie donc, et les `quest_description` d'origine restent en place.
--
-- EFFET DE BORD BÉNÉFIQUE
-- Aucun `expedition_appear` n'existait en base : tout PNJ apparaissant en expédition affichait le
-- texte de repli « Un aventurier approche... » (`run.ts`). Ces six PNJ auront enfin une réplique.
--
-- IDEMPOTENT : un PNJ disposant déjà d'un `expedition_appear` est ignoré. Rejouable sans risque.
--
-- USAGE (depuis le poste de dev, sans déployer) :
--   ssh root@<serveur> "docker exec -i postgres_db_prod psql -U strapi -d strapi" \
--     < scripts/populate_db/2026-08-13-dungeon-appear-dialogs.sql
--
-- Faire un backup avant : bash scripts/backup-db.sh

BEGIN;

DO $migration$
DECLARE
  source_row RECORD;
  nouveau_id INTEGER;
  total INTEGER := 0;
BEGIN
  FOR source_row IN
    SELECT d.dialogues, d.locale, lnk.npc_id
    FROM dialogs d
    JOIN dialogs_npc_lnk lnk ON lnk.dialog_id = d.id
    WHERE d.text_type = 'quest_description'
      AND d.dialogues::text LIKE '%[DungeonThreshold]%'
      -- Garde d'idempotence : ce PNJ n'a pas encore de dialogue d'apparition.
      AND NOT EXISTS (
        SELECT 1
        FROM dialogs autre
        JOIN dialogs_npc_lnk lnk2 ON lnk2.dialog_id = autre.id
        WHERE lnk2.npc_id = lnk.npc_id
          AND autre.text_type = 'expedition_appear'
      )
  LOOP
    -- `document_id` : Strapi v5 exige un identifiant de document unique. Un md5 fait l'affaire,
    -- le format n'étant pas contraint côté applicatif.
    INSERT INTO dialogs (document_id, text_type, dialogues, created_at, updated_at, published_at, locale)
    VALUES (
      md5(random()::text || clock_timestamp()::text),
      'expedition_appear',
      source_row.dialogues,
      NOW(), NOW(), NOW(),
      source_row.locale
    )
    RETURNING id INTO nouveau_id;

    INSERT INTO dialogs_npc_lnk (dialog_id, npc_id, dialog_ord)
    VALUES (nouveau_id, source_row.npc_id, 1);

    total := total + 1;
  END LOOP;

  RAISE NOTICE 'Dialogues expedition_appear créés : %', total;
END
$migration$;

-- Contrôle : autant d'expedition_appear que de PNJ « donjon », et aucune balise orpheline hors
-- des quest_description d'origine.
SELECT text_type, count(*) AS dialogues, count(DISTINCT lnk.npc_id) AS npcs
FROM dialogs d
LEFT JOIN dialogs_npc_lnk lnk ON lnk.dialog_id = d.id
GROUP BY text_type
ORDER BY text_type;

COMMIT;
