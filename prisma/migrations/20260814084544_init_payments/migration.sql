-- CreateTable
CREATE TABLE "payments" (
    "id" SERIAL NOT NULL,
    "intervention_id" INTEGER NOT NULL,
    "amount_snapshot" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "method" VARCHAR(10),
    "status" VARCHAR(10) NOT NULL DEFAULT 'PAID',
    "paid_at" TIMESTAMP(6),
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_intervention_id_key" ON "payments"("intervention_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_intervention_id_fkey" FOREIGN KEY ("intervention_id") REFERENCES "interventions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Énumérations en VARCHAR + CHECK, motif des migrations 001 et 002.
--
-- `CHECK` désigne ici le chèque, pas la contrainte : homonymie héritée du
-- dictionnaire §payments, qui fixe les trois valeurs de Constitution §2.3.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_method_values"
  CHECK ("method" IN ('CB', 'CASH', 'CHECK'));

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_status_values"
  CHECK ("status" IN ('PAID', 'UNPAID'));

-- ⚠️ AUCUN CHECK CROISÉ « status=PAID implique method et paid_at renseignés ».
--
-- Ce n'est pas un oubli : le dictionnaire §payments le range explicitement en
-- « Server Action + zod schema, pas en CHECK SQL (piège Prisma non exprimable
-- en DSL) ». Un CHECK posé ici vivrait hors du schéma Prisma, donc hors de
-- `prisma migrate diff`, et chaque introspection ultérieure proposerait de le
-- retirer. La validation fait foi dans `src/lib/validations/paiements.ts` et
-- dans `cloturerInterventionDuTech`, et un test la couvre sur les deux branches.
