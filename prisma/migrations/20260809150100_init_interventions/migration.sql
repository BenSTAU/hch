-- Migration 008 de PLAN S2 §6 — le cœur métier.
--
-- Trois tables : `interventions`, le pivot vers lequel tout converge ;
-- `intervention_products`, la vente additionnelle indissociable du service
-- (Constitution §2.6, alimentée par T-V3-09) ; `photos`, la preuve terrain
-- horodatée (§2.5, alimentée par T-V3-10).
--
-- Deux écarts au dictionnaire v2.2, tous deux arbitrés le 2026-08-09 et
-- inscrits en v2.4 :
--
--   · `cycle_id` passe de NN à NULL. `cycle_id NN` rendait la réservation
--     guest impossible : `cycles.user_id` est NN, un guest n'a pas de ligne
--     `users`, alors que `client_id` et `guest_email` autorisent
--     explicitement l'intervention sans compte. Les deux ne pouvaient pas être
--     vrais ensemble. RIEN N'ÉCRIT cette colonne en v1 — qui la remplira n'est
--     pas tranché, et l'inventer serait un ajout de périmètre non instruit.
--
--   · `duration_snapshot` apparaît. Miroir exact de `price_snapshot` : elle
--     fige la durée du forfait à la réservation. Sans elle, la colonne générée
--     de la migration 010 devrait lire `services.duration`, et la fenêtre de
--     non-chevauchement d'un rendez-vous déjà confirmé se déplacerait le jour
--     où l'administrateur retouche le catalogue.
--
-- Les trois horodatages métier sont en `timestamptz`, exception écrite à
-- PLAN S2 T5. Deux motifs cumulés : le cast `timestamp -> timestamptz` est
-- STABLE, donc interdit dans l'expression générée de la 010 ; et une
-- convention UTC portée par l'application ne protège que les écritures qui
-- passent par elle — or c'est la seule colonne du projet sur laquelle une
-- contrainte SQL raisonne.

-- CreateTable
CREATE TABLE "interventions" (
    "id" SERIAL NOT NULL,
    "status" VARCHAR(50) NOT NULL,
    "appointment_at" TIMESTAMPTZ(6) NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "cancellation_reason" TEXT,
    "price_snapshot" DECIMAL(10,2) NOT NULL,
    "duration_snapshot" INTEGER NOT NULL,
    "tech_comment" TEXT,
    "is_comment_public" BOOLEAN NOT NULL DEFAULT false,
    "client_id" UUID,
    "guest_email" VARCHAR(180),
    "tech_id" UUID NOT NULL,
    "address_id" INTEGER NOT NULL,
    "cycle_id" INTEGER,
    "service_id" INTEGER NOT NULL,

    CONSTRAINT "interventions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intervention_products" (
    "intervention_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_snapshot" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "intervention_products_pkey" PRIMARY KEY ("intervention_id","product_id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" SERIAL NOT NULL,
    "url" VARCHAR(255) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "uploaded_by_user_id" UUID,
    "guest_email" VARCHAR(255),
    "intervention_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
--
-- Le rattachement post-inscription cherche « les réservations de cet email
-- restées sans compte ». Sans index, chaque activation balaie la table.
CREATE INDEX "interventions_guest_email_client_id_idx" ON "interventions"("guest_email", "client_id");

-- CreateIndex
--
-- La dérivation des créneaux lit « les interventions de CE technicien dans
-- CETTE fenêtre », à l'ouverture de la grille puis toutes les 30 secondes.
CREATE INDEX "interventions_tech_id_appointment_at_idx" ON "interventions"("tech_id", "appointment_at");

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_tech_id_fkey" FOREIGN KEY ("tech_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intervention_products" ADD CONSTRAINT "intervention_products_intervention_id_fkey" FOREIGN KEY ("intervention_id") REFERENCES "interventions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intervention_products" ADD CONSTRAINT "intervention_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_intervention_id_fkey" FOREIGN KEY ("intervention_id") REFERENCES "interventions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Énumérations en VARCHAR + CHECK, motif des migrations 001 et 002.
--
-- Quatre valeurs, pas cinq : `CONFIRMED` est basculé v2 (audit du 2026-07-06).
ALTER TABLE "interventions"
  ADD CONSTRAINT "interventions_status_values"
  CHECK ("status" IN ('PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED'));

ALTER TABLE "photos"
  ADD CONSTRAINT "photos_type_values"
  CHECK ("type" IN ('BEFORE', 'AFTER'));

-- Une intervention doit être rattachable à quelqu'un : un client inscrit, ou
-- l'email d'un guest qui deviendra ce client. Sans les deux, la ligne n'a ni
-- destinataire de confirmation, ni clé de rattachement — elle est
-- irrécupérable.
--
-- Les deux ENSEMBLE restent licites, et c'est voulu : après rattachement,
-- `client_id` est renseigné et `guest_email` demeure comme trace de l'origine.
ALTER TABLE "interventions"
  ADD CONSTRAINT "interventions_requester_present"
  CHECK ("client_id" IS NOT NULL OR "guest_email" IS NOT NULL);

-- Exactement UN des deux auteurs, jamais les deux, jamais aucun. Le
-- dictionnaire la qualifie de contrainte applicative ; elle est doublée ici
-- parce qu'une règle qui ne vit que dans l'application ne protège que les
-- écritures qui passent par elle (PLAN S2 §5, doctrine du double filet).
ALTER TABLE "photos"
  ADD CONSTRAINT "photos_single_author"
  CHECK (("uploaded_by_user_id" IS NULL) <> ("guest_email" IS NULL));
