-- Second filet de la normalisation de `users.email` — dette reportée de
-- T-J0-04 vers T-V3-03.
--
-- Le premier filet est applicatif : `normalizeEmail()` (src/lib/auth/email.ts),
-- appelé par `createLocalAccount`. Il suffit tant que toutes les écritures
-- passent par lui — et c'est précisément ce qu'aucune consigne ne garantit dans
-- six mois, quand l'invitation d'utilisateur de la vague V1 et le compte OAuth
-- de T-V3-04 écriront eux aussi dans cette colonne.
--
-- Ce que la contrainte protège : `users.email` est une VARCHAR sous index
-- unique ORDINAIRE, comparée octet par octet par Postgres. « Camille@… » et
-- « camille@… » y sont deux lignes distinctes, donc deux comptes pour une seule
-- personne, dont un seul se connectera jamais — le schéma Zod de la connexion
-- abaisse la casse à la lecture.
--
-- La forme canonique est exactement celle de `normalizeEmail` : trim, puis
-- minuscules. Vérifié avant écriture : aucune ligne existante ne la viole
-- (base de développement, 2026-08-09).
--
-- Écarté : `citext`. L'extension rendrait l'index insensible à la casse sans
-- normaliser la donnée stockée — deux personnes verraient deux orthographes de
-- la même adresse dans leurs emails. Et elle ajouterait une extension Postgres
-- aux quatre environnements pour un problème que trois lignes de SQL règlent.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_normalized"
  CHECK ("email" = lower(btrim("email")));
