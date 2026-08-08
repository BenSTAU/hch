-- Migration 006 de PLAN S2 §6 — catalogue des forfaits et des produits.
--
-- ⚠️ PLAN S2 §6 range encore cette migration en « Vague V1 admin ». C'est
-- stale : le seed du référentiel de T-V3-01 en dépend, et sans forfaits le
-- tunnel de réservation n'a rien à vendre. Signalé pour write-back.
--
-- Deux colonnes tranchées ici faute de marqueur au dictionnaire, qui les
-- déclare sans NN ni NULL — divergence remontée avant écriture :
--   · `service_price_history.service_id` NOT NULL — une ligne d'historique
--     sans forfait ne veut rien dire ;
--   · `service_price_history.changed_by` NULL — un changement de prix peut
--     venir d'un seed ou d'une migration, qui n'ont pas d'auteur. Même
--     traitement que `app_settings.updated_by`, « NULL si seed initial ».
--
-- Pas de CHECK sur `products.stock` : le garde anti-négatif est un verrou
-- pessimiste applicatif (PLAN S2 §5.4), et il appartient à T-V3-09.

-- CreateTable
CREATE TABLE "product_categories" (
    "id" SERIAL NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "icon" VARCHAR(50),

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" SERIAL NOT NULL,
    "label" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "duration" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_price_history" (
    "id" SERIAL NOT NULL,
    "service_id" INTEGER NOT NULL,
    "old_price" DECIMAL(10,2) NOT NULL,
    "new_price" DECIMAL(10,2) NOT NULL,
    "changed_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by" UUID,

    CONSTRAINT "service_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "category_id" INTEGER,
    "label" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_label_key" ON "product_categories"("label");

-- CreateIndex
CREATE INDEX "service_price_history_service_id_idx" ON "service_price_history"("service_id");

-- AddForeignKey
ALTER TABLE "service_price_history" ADD CONSTRAINT "service_price_history_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_price_history" ADD CONSTRAINT "service_price_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
