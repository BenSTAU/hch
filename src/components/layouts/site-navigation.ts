/// Navigation de la coquille publique — l'en-tête et le pied de page la
/// partagent, et les pages légales de T-V3-12 en hériteront.
///
/// ⚠️ **La nav des maquettes ne se porte pas telle quelle.** C1 et C13 en
/// portent deux versions différentes, et [[maquettage]] §Notes portage en cite
/// une troisième et une quatrième — aucune des quatre n'est celle du produit :
///
///   · C1 (`code.html:212-215`) : Expertise · Tarifs · Zone d'intervention ·
///     **Avis** ;
///   · C13 (`code.html:134-137`) : Réparations · Tarifs · Avis · **Contact**.
///
/// « Avis » ne correspond à aucune US v1 — il n'y a pas de fonctionnalité
/// d'avis — et « Contact » contredit Constitution §1.2, qui écarte le rappel
/// humain intermédiaire. Les trois items retenus sont les seuls dont le contenu
/// existe réellement, et ils sont ancrés sur les sections de la landing.
/// Tranché le 2026-08-09, à répercuter au vault.
export const NAV_PUBLIQUE = [
  { href: "/#forfaits", label: "Nos forfaits" },
  { href: "/#fonctionnement", label: "Comment ça marche" },
  { href: "/#zone", label: "Zone desservie" },
] as const;

/// Les trois pages d'`US-RGPD`, dans le triplet tranché par [[s4-nf-transverses|
/// PLAN S4]] §4.2 — celui qui fait foi contre les trois autres qui circulaient.
/// La maquette C13 écrit « CGV » : c'est `/accessibilite` qui la remplace, elle
/// porte la déclaration RGAA formelle.
///
/// ⚠️ Ces trois routes **n'existent pas encore** : elles arrivent avec T-V3-12.
/// Le pied de page les pose parce que la DoD de T-V3-13 l'exige, et parce qu'un
/// pied de page légal qui apparaît une tâche plus tard est un pied de page qu'on
/// oublie de câbler.
export const LIENS_LEGAUX = [
  { href: "/mentions-legales", label: "Mentions légales" },
  { href: "/politique-confidentialite", label: "Politique de confidentialité" },
  { href: "/accessibilite", label: "Accessibilité" },
] as const;

/// Entrée du tunnel de réservation (T-V3-08).
///
/// ⚠️ **`/reserver` et non `/client/reserver`**, contre [[adr-006-archi-applicative-hch|
/// ADR-006]] §10 et [[adr-014-testing-hch|ADR-014]] §5 (GP-02). Motif : le
/// matcher de `src/proxy.ts:35` couvre `/client/:path*` — un visiteur anonyme
/// qui clique « Réserver » y serait redirigé vers `/connexion`, ce qui contredit
/// Constitution §3.2, « la réservation précède l'inscription ». Tranché le
/// 2026-08-09, les deux ADR sont à amender au write-back.
///
/// La route répond 404 jusqu'à T-V3-08.
export const CHEMIN_RESERVATION = "/reserver";
