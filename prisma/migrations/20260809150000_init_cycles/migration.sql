-- Migration 007 de PLAN S2 §6 — vélos des clients.
--
-- Écrite par T-V3-08 et non par T-V3-07, à qui PLAN S2 §6 l'attribuait :
-- `interventions.cycle_id` la référence par clé étrangère, et T-V3-07 est
-- marquée [P] sacrifiable en rang 3. Le chemin critique ne peut pas dépendre
-- d'une tâche supprimable. T-V3-07 garde le CRUD des cycles.
--
-- `user_id` est NOT NULL et le reste. Aucune US ne fait posséder un vélo à un
-- visiteur anonyme — les trois US cycles s'ouvrent sur « Given je suis client
-- authentifié », et les quatre écrans du tunnel n'ont aucune étape vélo. C'est
-- `interventions.cycle_id` qui a cédé à NULL, pas cette colonne-ci
-- (dictionnaire v2.4, amendement du 2026-08-09).

-- CreateTable
CREATE TABLE "cycles" (
    "id" SERIAL NOT NULL,
    "brand" VARCHAR(100) NOT NULL,
    "model" VARCHAR(100),
    "type" VARCHAR(50) NOT NULL,
    "year" INTEGER,
    "user_id" UUID NOT NULL,

    CONSTRAINT "cycles_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Énumération en VARCHAR + CHECK, motif des migrations 001 et 002.
ALTER TABLE "cycles"
  ADD CONSTRAINT "cycles_type_values"
  CHECK ("type" IN ('CLASSIC', 'ELECTRIC', 'CARGO'));
