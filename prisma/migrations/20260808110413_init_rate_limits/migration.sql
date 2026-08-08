-- Migration 014 de PLAN S2 §6 — compteurs anti-abus.
--
-- Rang 014 appliqué AVANT les rangs 007 à 013, qui n'existent pas encore.
-- Sans conséquence, et c'est le motif du rang détaché : la table n'a aucune
-- clé étrangère, donc rien à ordonner. L'insérer dans la chaîne aurait décalé
-- tous les rangs suivants — geste qui a déjà coûté quatre corrections en
-- cascade le 2026-08-06.
--
-- AUCUNE clé étrangère, et c'est le cœur de la décision (PLAN S4 §11.2). Un
-- compteur porté par `users` n'aurait pas de ligne pour un email inconnu :
-- « trop de tentatives » ne s'afficherait que pour les comptes existants, ce
-- qui en fait un oracle d'énumération — la fuite exacte que le durcissement à
-- temps constant de T-J0-04 a fermée, rouverte par une autre porte.
--
-- Trois usages, tous par email, aucun par IP : `login:<email>` 5 / 15 min,
-- `reset:<email>` 3 / 24 h, `activation:<email>` 3 / 24 h.

-- CreateTable
CREATE TABLE "rate_limits" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "attempted_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_limits_key_attempted_at_idx" ON "rate_limits"("key", "attempted_at");
