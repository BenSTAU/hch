-- Migration 010 de PLAN S2 §6 — anti-double-réservation.
--
-- Le rafraîchissement de la grille toutes les 30 secondes ne règle PAS la
-- course : deux `POST` à 200 ms d'écart passent tous deux la validation
-- applicative avant que le premier ne commite. C'est la base qui arbitre.
--
-- `EXCLUDE USING gist` et non `UNIQUE (tech_id, appointment_at)` : un forfait
-- de 30 min à 10:00 et un de 60 min à 10:15 ont deux `appointment_at` distincts
-- et se chevauchent pourtant. Ce qu'il faut refuser est l'intersection des
-- plages, pas l'égalité des débuts.

-- `btree_gist` fournit à GiST les classes d'opérateurs des types scalaires.
-- Sans elle, `tech_id WITH =` échoue : GiST ne sait pas comparer un `uuid` par
-- égalité, il n'indexe nativement que des types géométriques et des plages.
-- Seule `postgis` était créée jusqu'ici (migration 001).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- La plage est GÉNÉRÉE, donc toujours cohérente avec ses deux sources — aucun
-- code applicatif ne peut l'oublier ni la contredire.
--
-- Elle lit `duration_snapshot` et NON `services.duration`, pour deux raisons
-- qui se cumulent :
--
--   · une sous-requête est interdite dans une expression de génération, qui
--     doit être immuable. C'est ce que prescrivait PLAN S2 §5.1, et ça n'aurait
--     pas compilé ;
--   · le repli par trigger, que le même §5.1 proposait, était ACTIVEMENT
--     dangereux. Si un administrateur fait passer un forfait de 60 à 90 min, un
--     `UPDATE` ultérieur sur une intervention déjà planifiée rejouerait le
--     trigger et déplacerait sa fenêtre de non-chevauchement — sur un
--     rendez-vous confirmé, sans que personne le demande. Le prix est figé pour
--     cette raison exacte (Constitution §4.1) ; la durée a la même propriété et
--     ne l'était pas.
--
-- Bornes `'[)'` : deux interventions qui se touchent exactement ne se
-- chevauchent pas. `src/lib/creneaux/derivation.ts` applique la même
-- convention — si les deux divergeaient, la grille proposerait un créneau que
-- cette contrainte refuserait au dernier écran du tunnel.
-- L'addition passe explicitement par UTC, et ce détour n'est pas décoratif :
-- `timestamptz + interval` est marqué **STABLE** par PostgreSQL, donc interdit
-- ici. Le motif est que l'arithmétique en jours et en mois dépend du `TimeZone`
-- de session — « +1 jour » ne fait pas 24 heures la nuit d'une bascule.
--
-- `timestamptz AT TIME ZONE 'UTC'` avec un fuseau LITTÉRAL est, lui, immuable :
-- il ne consulte aucun réglage de session. On descend donc en heure murale
-- UTC, on ajoute les minutes — immuable sur un `timestamp` sans fuseau — et on
-- remonte. Le résultat est identique à l'addition directe pour un intervalle en
-- minutes, mais il compile.
ALTER TABLE "interventions"
  ADD COLUMN "reservation_range" TSTZRANGE
  GENERATED ALWAYS AS (
    tstzrange(
      "appointment_at",
      (("appointment_at" AT TIME ZONE 'UTC')
        + ("duration_snapshot" * INTERVAL '1 minute')) AT TIME ZONE 'UTC',
      '[)'
    )
  ) STORED;

-- Le filtre exclut `DONE` et `CANCELLED` : un créneau libéré par une annulation
-- redevient réservable. Sans lui, une annulation bloquerait le créneau pour
-- toujours.
ALTER TABLE "interventions"
  ADD CONSTRAINT "no_double_booking"
  EXCLUDE USING gist (
    "tech_id" WITH =,
    "reservation_range" WITH &&
  )
  WHERE ("status" IN ('PLANNED', 'IN_PROGRESS'));
