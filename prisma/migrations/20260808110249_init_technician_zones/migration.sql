-- Migration 005 de PLAN S2 §6 — affectation des techniciens aux zones.
--
-- Association pure, sans attribut. C'est elle qui rend le pool de créneaux non
-- vide : les disponibilités se dérivent du planning des techniciens affectés à
-- la zone du client (Constitution §2.1), jamais d'une table de disponibilités.

-- CreateTable
CREATE TABLE "technician_zones" (
    "user_id" UUID NOT NULL,
    "zone_id" INTEGER NOT NULL,

    CONSTRAINT "technician_zones_pkey" PRIMARY KEY ("user_id","zone_id")
);

-- AddForeignKey
ALTER TABLE "technician_zones" ADD CONSTRAINT "technician_zones_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_zones" ADD CONSTRAINT "technician_zones_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Ce que le DSL Prisma ne sait pas exprimer, ajouté à la main.
-- ─────────────────────────────────────────────────────────────────────────

-- Second filet de PLAN S2 §5.3 : le porteur d'une affectation DOIT être un
-- technicien actif. Le premier filet est le garde de la Server Action
-- d'affectation, qui naîtra en V1 admin — celui-ci tient face à un script de
-- maintenance ou à une migration hâtive, que la Server Action ne voit pas.
--
-- Prisma ne gère aucun trigger : ce bloc est écrit à la main et le restera.
-- `CREATE OR REPLACE` le rend rejouable.
CREATE OR REPLACE FUNCTION check_technician_role()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.user_id
      AND 'ROLE_TECH' = ANY(roles)
      AND is_active = true
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'User % does not have ROLE_TECH or is not active', NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- `DROP` puis `CREATE` plutôt que `CREATE OR REPLACE TRIGGER` : cette dernière
-- forme n'existe qu'à partir de PostgreSQL 14, et le projet ne fixe nulle part
-- de plancher de version au-delà du tag `postgis/postgis:16-3.4`. La paire
-- reste idempotente sans dépendre de cette syntaxe.
DROP TRIGGER IF EXISTS trg_check_technician_zones_role ON "technician_zones";

CREATE TRIGGER trg_check_technician_zones_role
  BEFORE INSERT OR UPDATE ON "technician_zones"
  FOR EACH ROW EXECUTE FUNCTION check_technician_role();
