-- Migration 002 de PLAN S2 §6 — configuration société.
--
-- `updated_by` est NULLable, et ce n'est pas un relâchement : c'est ce qui
-- rend l'entité autoportante au seed, donc utilisable comme première entité
-- CRUD du jalon 0 avant qu'aucun administrateur n'ait agi (PLAN S2 §7).

-- CreateTable
CREATE TABLE "app_settings" (
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT,
    "value_type" VARCHAR(20) NOT NULL DEFAULT 'string',
    "description" VARCHAR(255),
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- AddForeignKey
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Énumération en VARCHAR + CHECK, comme en migration 001. `value_type` dit à
-- l'application comment relire `value`, qui est stockée en texte : une valeur
-- inconnue ici produirait un parsing silencieusement faux côté lecture.
ALTER TABLE "app_settings"
  ADD CONSTRAINT "app_settings_value_type_values"
  CHECK ("value_type" IN ('string', 'number', 'boolean', 'json', 'url'));
