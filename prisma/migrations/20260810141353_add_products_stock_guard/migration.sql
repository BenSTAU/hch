-- Catalogue produits : la colonne que le dictionnaire n'avait pas, et le
-- second filet du verrou de stock. Les deux appartiennent a T-V3-09.
--
-- 1. `is_active` - miroir exact de `services.is_active` (meme type, meme
-- defaut, meme semantique). Le dictionnaire §products ne listait que six
-- colonnes, alors que deux des trois US du module 4 filtrent dessus mot pour
-- mot : « la liste des produits publies (`products.is_active = true`) » pour le
-- tunnel, « un produit `is_active = true` et `stock > 0` » pour le T+n. Sans
-- elle, la tache ne peut pas satisfaire ses propres criteres d'acceptation.
-- Dictionnaire a corriger en write-back.
--
-- Comme pour les forfaits, deux vues opposees se partagent la meme colonne : la
-- vue publique MASQUE l'inactif, la vue admin le grise. Le filtre appartient
-- donc a la requete, jamais a la vue.
--
-- 2. `products_stock_non_negative` - report explicite de la migration 006, qui
-- a cree la table sans la contrainte parce que T-V3-09 est proprietaire du
-- verrou (`20260808110357_init_catalog/migration.sql:15-16`).
--
-- Double filet, et les deux moities ne se remplacent pas (meme doctrine que le
-- CHECK de `users.email` et que le trigger `check_technician_role()`) :
--
--   · le verrou pessimiste applicatif (`SELECT … FOR UPDATE`, PLAN S2 §5.4)
--     rend l'erreur INTELLIGIBLE - le client lit « Stock insuffisant, quantite
--     maximale : 2 » au lieu d'une violation de contrainte ;
--   · le CHECK rend l'etat IMPOSSIBLE - y compris par le seed, une migration,
--     un correctif manuel en psql, ou un chemin d'ecriture futur qui oublierait
--     le verrou. La vente d'admin de la vague V1 est exactement ce chemin-la.
--
-- Verifie avant ecriture : aucune ligne existante ne viole la contrainte
-- (base de developpement, 2026-08-10).

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- AddCheckConstraint
ALTER TABLE "products"
  ADD CONSTRAINT "products_stock_non_negative" CHECK ("stock" >= 0);
