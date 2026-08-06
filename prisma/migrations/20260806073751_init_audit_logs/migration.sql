-- Migration 003 de PLAN S2 §6 — journal d'audit.
--
-- PLAN S2 §6 la plaçait en rang 009. Elle est avancée ici parce que la même
-- section pose la condition qui l'exige : « doit exister avant les Server
-- Actions qui écrivent l'audit ». La première d'entre elles est la
-- modification de la configuration société (T-J0-05), que PLAN S2 §7 fait
-- explicitement passer par ce journal en v1 — `entity_type='app_settings'`,
-- en attendant `app_settings_history` en v2.
--
-- Conséquence : `init_geo` à `init_payments` décalent d'un rang. Signalé pour
-- writeback vers S2 §6.

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" VARCHAR(255) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "actor_id" UUID NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Ce que le DSL Prisma ne sait pas exprimer, ajouté à la main.
-- ─────────────────────────────────────────────────────────────────────────

-- Énumération en VARCHAR + CHECK, comme en migrations 001 et 002. Le
-- dictionnaire donne les quatre valeurs et les qualifie d'« extensible » :
-- ajouter une action se fait par un ALTER de cette contrainte, pas par un
-- ALTER TYPE.
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_action_values"
  CHECK ("action" IN ('CREATE', 'UPDATE', 'DELETE', 'ANONYMIZE'));

-- `entity_type` et `entity_id` désignent la cible sans FK — SQL ne supporte
-- pas les clés étrangères polymorphiques. Rien ne garantit donc l'existence
-- de la cible ; ce qu'on peut garantir, c'est qu'aucune des deux colonnes
-- n'est vide, faute de quoi la trace ne désigne rien du tout et le journal
-- devient inexploitable par l'index (entity_type, entity_id).
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_entity_not_blank"
  CHECK (length(btrim("entity_type")) > 0 AND length(btrim("entity_id")) > 0);
