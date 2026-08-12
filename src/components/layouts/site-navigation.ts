import { CHEMIN_ESPACE_CLIENT } from "@/lib/routes";

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

/// Entrée de l'espace client, ajoutée en T-V3-10.
///
/// Elle ne s'affiche **que pour une session ouverte** : proposer « Mes
/// interventions » à un visiteur anonyme l'enverrait sur le formulaire de
/// connexion, ce qui est une promesse tenue de travers.
///
/// Elle double délibérément l'entrée du menu utilisateur. Le menu est le
/// chemin que `US-COMPTE-DECONNECTER` §Contexte impose pour la déconnexion, mais
/// il faut l'ouvrir pour voir ce qu'il contient : l'espace client est la
/// destination la plus fréquente d'un client connecté, elle mérite d'être
/// atteignable sans ce geste.
export const NAV_ESPACE_CLIENT = [
  { href: CHEMIN_ESPACE_CLIENT, label: "Mes interventions" },
] as const;

/// La navigation à rendre, selon qu'une session est ouverte ou non.
///
/// Une seule fonction pour la barre desktop et le panneau mobile : les deux
/// surfaces doivent porter les mêmes entrées, et deux listes construites
/// séparément finiraient par diverger sur celle qu'on oublie.
export function navigationPrincipale(
  connecte: boolean,
): readonly { href: string; label: string }[] {
  return connecte ? [...NAV_PUBLIQUE, ...NAV_ESPACE_CLIENT] : NAV_PUBLIQUE;
}

/// Les trois pages d'`US-RGPD`, dans le triplet tranché par [[s4-nf-transverses|
/// PLAN S4]] §4.2 — celui qui fait foi contre les trois autres qui circulaient.
/// La maquette C13 écrit « CGV » : c'est `/accessibilite` qui la remplace, elle
/// porte la déclaration RGAA formelle.
///
/// Les trois routes sont **livrées** par T-V3-12 ; le pied de page les posait
/// depuis T-V3-13, où elles répondaient encore 404.
///
/// Chemins nommés plutôt que littéraux dans les pages : `PageLegale` marque
/// l'onglet actif en comparant sa route à cette liste, et deux littéraux qui
/// doivent rester égaux finissent par diverger (cf. `src/lib/routes.ts`).
export const CHEMIN_MENTIONS_LEGALES = "/mentions-legales";
export const CHEMIN_POLITIQUE_CONFIDENTIALITE = "/politique-confidentialite";
export const CHEMIN_ACCESSIBILITE = "/accessibilite";

export const LIENS_LEGAUX = [
  { href: CHEMIN_MENTIONS_LEGALES, label: "Mentions légales" },
  {
    href: CHEMIN_POLITIQUE_CONFIDENTIALITE,
    label: "Politique de confidentialité",
  },
  { href: CHEMIN_ACCESSIBILITE, label: "Accessibilité" },
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
