-- Migration 001 de PLAN S2 §6 — socle d'identité.
--
-- PostGIS est activée ici, dans la toute première migration, bien avant la
-- migration 003 qui posera les premières colonnes géographiques : Prisma ne
-- crée jamais l'extension lui-même, et une migration qui référence
-- `geography` sur une base sans extension échoue sans dire pourquoi.
-- Idempotente, donc sans effet sur la base de développement où l'image
-- postgis l'a déjà créée au premier démarrage.
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(180) NOT NULL,
    "firstname" VARCHAR(100) NOT NULL,
    "lastname" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "roles" VARCHAR(20)[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_providers" (
    "id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "provider_uid" VARCHAR(255),
    "password_hash" VARCHAR(255),
    "access_token" TEXT,
    "refresh_token" TEXT,
    "expires_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "purpose" VARCHAR(30) NOT NULL,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "used_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "auth_providers_user_id_provider_key" ON "auth_providers"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_hash_key" ON "verification_tokens"("token_hash");

-- AddForeignKey
ALTER TABLE "auth_providers" ADD CONSTRAINT "auth_providers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Ce que le DSL Prisma ne sait pas exprimer, ajouté à la main.
-- ─────────────────────────────────────────────────────────────────────────

-- Le dictionnaire donne `roles VARCHAR[]` NOT NULL. Prisma émet les listes
-- scalaires sans NOT NULL — un utilisateur sans aucun rôle passerait, et rien
-- côté base ne l'attraperait.
ALTER TABLE "users" ALTER COLUMN "roles" SET NOT NULL;

-- Format E.164 strict (PLAN S2 T4) : `+` puis 8 à 15 chiffres, le premier non
-- nul. La validation Zod côté formulaire se contourne par un appel direct à la
-- Server Action ; cette contrainte-ci, non.
ALTER TABLE "users"
  ADD CONSTRAINT "users_phone_e164_format"
  CHECK ("phone" ~ '^\+[1-9][0-9]{7,14}$');

-- Énumérations tenues en VARCHAR + CHECK plutôt qu'en type ENUM Postgres :
-- retirer une valeur d'un ENUM demande un ALTER TYPE et une migration
-- dédiée, ce que le projet a déjà payé une fois en retirant CONFIRMED.
ALTER TABLE "auth_providers"
  ADD CONSTRAINT "auth_providers_provider_values"
  CHECK ("provider" IN ('local', 'google', 'apple'));

ALTER TABLE "verification_tokens"
  ADD CONSTRAINT "verification_tokens_purpose_values"
  CHECK ("purpose" IN ('email_verification', 'password_reset'));
