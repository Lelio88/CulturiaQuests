-- Migration one-shot — réécrit les quest_description qui décrivaient un donjon (#176)
--
-- CONTEXTE
-- Six dialogues envoyaient le joueur « à l'étage [DungeonThreshold] du sanctuaire », alors qu'une
-- quête se valide en visitant DEUX points d'intérêt sur le terrain (`poi_a` / `poi_b`) : le texte
-- décrivait une mécanique qui n'existe pas, et la balise n'y était pas résoluble.
--
-- Ces mêmes textes ont été copiés en `expedition_appear` par la migration précédente
-- (2026-08-13-dungeon-appear-dialogs.sql), où le donjon a du sens et où le palier s'affiche.
-- Les deux versions divergent donc à partir d'ici, volontairement.
--
-- CE QUI EST CONSERVÉ
-- La voix de chaque personnage, l'objet perdu, et les formules qui les caractérisent (le sarcasme
-- de Toben, la métaphore marine de Marn, les traditions de Bram, les remords de Toren). Seul le
-- LIEU change : le sanctuaire cède la place à deux haltes sur le terrain.
--
-- IDEMPOTENT : la clause `LIKE '%[DungeonThreshold]%'` ne matche plus après application.
--
-- USAGE :
--   ssh root@<serveur> "docker exec -i postgres_db_prod psql -U strapi -d strapi" \
--     < scripts/populate_db/2026-08-13-quest-description-terrain.sql
--
-- Backup préalable : PG_CONTAINER=postgres_db_prod bash scripts/backup-db.sh

BEGIN;

-- 36 — Garen le Chasseur : la bête rare
UPDATE dialogs SET dialogues = '["Ah, [PlayerName]… quelle galère, je suis dans un pétrin pas possible…", "J’ai levé une bête rare ce matin et elle m’a filé entre les doigts. Elle rôde quelque part dehors, j’en suis sûr.", "J’ai relevé deux endroits où elle est passée. Va y jeter un œil pour moi ? Une bête, ça repasse toujours par où ça a marché."]'::jsonb, updated_at = NOW()
WHERE id = 36 AND text_type = 'quest_description' AND dialogues::text LIKE '%[DungeonThreshold]%';

-- 38 — Toben le Meunier : le schéma de moulin
UPDATE dialogs SET dialogues = '["[PlayerName], t’arrives pile quand je suis en train de me demander si y’aurait pas quelqu’un pour m’aider.", "J’ai égaré un schéma de moulin, un de mes plans les plus précis. Il a dû s’envoler pendant ma tournée — j’ai posé mes sacs à deux endroits, forcément c’est là.", "Va me le récupérer… si tu arrives à ne pas le faire tomber comme un enfant."]'::jsonb, updated_at = NOW()
WHERE id = 38 AND text_type = 'quest_description' AND dialogues::text LIKE '%[DungeonThreshold]%';

-- 40 — Denrick le Forgeron : le prototype de lame
UPDATE dialogs SET dialogues = '["[PlayerName], j’ai un service à te demander… et crois-moi, si mes jambes valaient encore ce qu’elles valaient, je le ferais moi-même.", "J’ai laissé tomber un prototype d’une nouvelle lame pendant ma livraison. Elle est restée en chemin, à l’une des deux haltes que j’ai faites. Si quelqu’un la ramasse avant toi, je sais pas si je pourrais la reconstruire.", "Je t’en prie aide moi à la récupérer !"]'::jsonb, updated_at = NOW()
WHERE id = 40 AND text_type = 'quest_description' AND dialogues::text LIKE '%[DungeonThreshold]%';

-- 42 — Marn le Pêcheur : la canne fétiche
UPDATE dialogs SET dialogues = '["[PlayerName] ! Hé, t’es dispo une minute ? J’vais avoir besoin d’une main qui a pas peur de se mouiller.", "J’ai perdu ma canne à pêche fétiche. Elle a glissé du chariot entre deux haltes, quand j’ai trébuché comme un idiot. J’y tiens énormément..", "Ramène-la-moi, je t’en prie ? Et fais gaffe… ces rues avalent les choses plus vite que la mer avale un secret."]'::jsonb, updated_at = NOW()
WHERE id = 42 AND text_type = 'quest_description' AND dialogues::text LIKE '%[DungeonThreshold]%';

-- 44 — Bram le Boucher : le couteau de la communauté
UPDATE dialogs SET dialogues = '["[PlayerName], viens ici un instant. J’ai besoin de quelqu’un de fiable pour une tâche délicate.", "Un couteau spécial que je conserve pour la communauté a été mal rangé… il est resté sur l’une de mes deux tournées du matin. La lame va s’émousser si personne ne le ramasse au plus vite.", "Récupère-le et ramène-le intact. Les traditions valent parfois plus que n’importe quelle épée."]'::jsonb, updated_at = NOW()
WHERE id = 44 AND text_type = 'quest_description' AND dialogues::text LIKE '%[DungeonThreshold]%';

-- 46 — Toren l’Architecte : la pierre angulaire
UPDATE dialogs SET dialogues = '["[PlayerName], approche. J’ai besoin de quelqu’un qui ne perd pas le fil de ses plans.", "Une pierre angulaire gravée, essentielle pour la stabilité d’un projet de monument, a été égarée entre deux chantiers. Si elle est endommagée, tout s’effondrera… littéralement.", "Récupère-la intacte. Chaque angle mal positionné ici pourrait me hanter plus longtemps que mes propres erreurs passées."]'::jsonb, updated_at = NOW()
WHERE id = 46 AND text_type = 'quest_description' AND dialogues::text LIKE '%[DungeonThreshold]%';

-- Contrôle : plus aucune balise de palier hors des expedition_appear, où elle est résolue.
SELECT text_type, count(*) AS avec_balise
FROM dialogs
WHERE dialogues::text LIKE '%[DungeonThreshold]%'
GROUP BY text_type
ORDER BY text_type;

COMMIT;
