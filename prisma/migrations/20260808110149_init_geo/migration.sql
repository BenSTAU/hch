-- Migration 004 de PLAN S2 §6 — socle géographique.
--
-- Rang 004 et non 003 : `init_audit_logs` a pris le 003 en T-J0-05, la
-- première Server Action qui écrit l'audit y naissant. Les rangs suivants ont
-- tous décalé d'un (amendement PLAN S2 du 2026-08-06).
--
-- `geography` et non `geometry`, sectorisation en `ST_Covers` et non
-- `ST_Contains` — tranché au cadrage amont V3 du 2026-08-08. `ST_Contains` n'a
-- aucune signature `geography` (doc PostGIS §13.4), `ST_Covers` inclut la
-- frontière, et la seule opération métrique de la v1 (superficie en km²) rend
-- des m² sous `geography` contre des degrés carrés sous `geometry(4326)`.
--
-- L'extension PostGIS est créée en tête de la migration 001, bien avant cette
-- migration-ci : Prisma ne la crée jamais lui-même, et une migration qui
-- référence `geography` sur une base sans extension échoue sans dire pourquoi.

-- AlterTable
--
-- Dette de la migration 001, portée en DoD par T-V3-01 depuis le 2026-08-05.
-- `phone` avait été créée NOT NULL en suivant la colonne Attributs du
-- dictionnaire, qui contredisait sa propre Description sur la même ligne
-- (« NULL sur droit à l'oubli »). PLAN S2 §T6 en fait une décision : `phone`
-- vaut NULL après pseudonymisation. Sans ce relâchement, T-V3-12 est
-- inapplicable. Le CHECK E.164 posé en 001 n'est pas concerné, il passe sur
-- NULL.
--
-- Migration RELÂCHANTE, donc compatible avec la règle expand/contract : une
-- image précédente restaurée par rollback continue de fonctionner face à ce
-- schéma.
ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL;

-- CreateTable
CREATE TABLE "cities" (
    "id" SERIAL NOT NULL,
    "zip_code" VARCHAR(10) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "department" VARCHAR(100),
    "region" VARCHAR(100),

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "color" VARCHAR(7),
    "area" geography(Polygon, 4326) NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" SERIAL NOT NULL,
    "street" VARCHAR(255) NOT NULL,
    "city_id" INTEGER NOT NULL,
    "location" geography(Point, 4326) NOT NULL,
    "user_id" UUID,
    "label" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cities_zip_code_city_key" ON "cities"("zip_code", "city");

-- CreateIndex
CREATE UNIQUE INDEX "zones_name_key" ON "zones"("name");

-- CreateIndex
CREATE INDEX "zones_area_idx" ON "zones" USING GIST ("area");

-- CreateIndex
CREATE INDEX "addresses_location_idx" ON "addresses" USING GIST ("location");

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
