-- Migration 008 de PLAN S2 §6 — le cœur métier.
--
-- Trois tables : `interventions`, le pivot vers lequel tout converge ;
-- `intervention_products`, la vente additionnelle indissociable du service
-- (Constitution §2.6, alimentée par T-V3-09) ; `photos`, la preuve terrain
-- horodatée (§2.5, alimentée par T-V3-10).
--
-- **La validation exige un compte** — Constitution §3.2 alignée le 2026-08-09,
-- restauration de la décision B6 Q2 du 2026-07-06. Le tunnel s'explore sans
-- compte, mais rien ne s'écrit ici avant que le visiteur soit inscrit, activé
-- et connecté. Conséquences directes sur ces trois tables :
--
--   · `interventions.client_id` est **NOT NULL**, et `guest_email` n'existe
--     pas. Aucune intervention sans compte ne peut exister, donc aucune clé de
--     rattachement n'a d'objet ;
--   · `photos.uploaded_by_user_id` est **NOT NULL**, et `guest_email` non plus.
--     La contrainte « exactement un des deux auteurs » disparaît avec la
--     colonne, faute de second candidat.
--
-- `addresses.user_id` reste nullable : sa migration (004) est mergée depuis la
-- PR #23. Vestige assumé — plus rien n'y écrit NULL.
--
-- Deux écarts au dictionnaire v2.2, arbitrés le 2026-08-09 et inscrits en v2.4 :
--
--   · `cycle_id` est NULL. Le motif n'est plus le visiteur anonyme mais
--     l'absence d'US : les quatre écrans du tunnel n'ont aucune étape vélo, et
--     les trois US cycles s'ouvrent sur « Given je suis client authentifié ».
--     RIEN N'ÉCRIT cette colonne en v1 — qui la remplira n'est pas tranché, et
--     l'inventer serait un ajout de périmètre non instruit.
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
    "client_id" UUID NOT NULL,
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
    "uploaded_by_user_id" UUID NOT NULL,
    "intervention_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
--
-- La dérivation des créneaux lit « les interventions de CE technicien dans
-- CETTE fenêtre », à l'ouverture de la grille puis toutes les 30 secondes.
CREATE INDEX "interventions_tech_id_appointment_at_idx" ON "interventions"("tech_id", "appointment_at");

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "photos" ADD CONSTRAINT "photos_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
