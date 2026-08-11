-- Journal d'audit : `LOGIN` et `LOGOUT` ajoutes a l'enumeration.
--
-- Report de T-V3-03 ([PR #20]). ADR-005 code litteralement
-- `writeAuditLog({ …, action: 'LOGIN' })` dans son flux de connexion, et
-- ADR-014 §5 fait de `GP-01` le lieu ou cet audit se verifie - mais la
-- migration 003 borne la colonne a quatre valeurs, et T-V3-03 n'a donc ecrit
-- ni l'un ni l'autre.
--
-- Ce n'est PAS l'ADR qui etait perime. Le dictionnaire §audit_logs qualifiait
-- deja l'enumeration d'« extensible » : c'est cette migration-ci qui a fige en
-- dur ce que le modele laissait ouvert. Dictionnaire amende en v2.3 le
-- 2026-08-09, les deux ADR avaient raison.
--
-- Portee, et la nuance compte : Constitution §4.2 vise « toute action
-- ADMINISTRATIVE sensible ». Une connexion n'en est pas une, c'est un
-- evenement de securite. `entity_type` vaudra donc `session` et non `users`,
-- comme ADR-005 l'ecrit deja. Corollaire conserve : creer un compte n'est pas
-- administrer, T-V3-02 avait tranche « pas d'audit a l'inscription » sur ce
-- meme raisonnement et cette decision reste valide.
--
-- Un CHECK en VARCHAR et non un ENUM Postgres, comme aux migrations 001, 002
-- et 003 : l'etendre est un `ALTER` de contrainte, pas un `ALTER TYPE`. C'est
-- exactement ce que « extensible » voulait dire.
--
-- Verifie avant ecriture : aucune ligne existante ne porte une action hors des
-- quatre valeurs d'origine (base de developpement, 2026-08-10).

ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_action_values";

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_action_values"
  CHECK ("action" IN ('CREATE', 'UPDATE', 'DELETE', 'ANONYMIZE', 'LOGIN', 'LOGOUT'));
