-- Unicite du nom d'un forfait ACTIF - `US-FORFAIT-AJOUTER` §Cas d'erreur,
-- « Un forfait actif portant ce nom existe deja », repris par
-- `US-FORFAIT-MODIFIER`.
--
-- Le filet applicatif seul ne tient pas, et ce n'est pas une precaution de
-- principe : on ne peut pas verrouiller une ligne qui n'existe pas encore.
-- Deux creations concurrentes du meme nom lisent toutes deux « aucun
-- homonyme », et toutes deux ecrivent. C'est la base qui arbitre, comme pour
-- l'anti-double-reservation de la migration 010.
--
-- PARTIEL, et c'est la regle metier elle-meme : un forfait retire de la vente
-- garde son nom (Constitution §4.1, l'historique est preserve), et ce nom doit
-- pouvoir etre repris par un forfait actif. Un `UNIQUE (label)` simple
-- interdirait de recreer un forfait apres l'avoir desactive.
--
-- Non exprimable dans le DSL Prisma, qui ne connait pas les index partiels :
-- comme les CHECK des migrations 002, 003 et 009, il vit en SQL et le schema
-- le signale en commentaire.
--
-- ⚠️ Le dictionnaire de donnees ne porte AUCUNE unicite sur `services`
-- (§services, six colonnes). Divergence remontee avant ecriture, tranchee le
-- 2026-11-09 : le MCD passe en v2.8 au write-back.
CREATE UNIQUE INDEX "services_label_active_key"
    ON "services" ("label")
    WHERE "is_active";
