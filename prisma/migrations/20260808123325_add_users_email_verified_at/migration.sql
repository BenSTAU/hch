-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified_at" TIMESTAMP(6);

-- Reprise des comptes existants. Sans elle, les trois comptes du seed — deux
-- administrateurs et un technicien, créés sans aucun jeton de vérification —
-- resteraient à NULL, donc « jamais activés », donc éligibles à un renvoi
-- d'activation depuis le formulaire public.
--
-- Portée : `is_active = true` uniquement. Un compte inactif est soit une
-- inscription jamais activée (NULL correct), soit un compte fermé par un
-- administrateur — cas qui n'existe pas encore, l'écran de désactivation
-- appartenant à la vague V1. Signalé dans le body de PR plutôt que devine.
UPDATE "users"
   SET "email_verified_at" = NOW()
 WHERE "is_active" = true
   AND "email_verified_at" IS NULL;
