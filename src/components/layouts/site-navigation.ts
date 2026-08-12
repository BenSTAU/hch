import {
  CHEMIN_ADMIN_PARAMETRES,
  CHEMIN_ESPACE_CLIENT,
  CHEMIN_TOURNEE_DU_JOUR,
} from "@/lib/routes";
import { ROLE_ADMIN, ROLE_TECH, hasRole } from "@/lib/auth/roles";

/// Navigation de la coquille publique - l'en-tête et le pied de page la
/// partagent, et les pages légales de T-V3-12 en héritent.
///
/// ⚠️ **La nav des maquettes ne se porte pas telle quelle.** C1 et C13 en
/// portent deux versions différentes, et [[maquettage]] §Notes portage en cite
/// une troisième et une quatrième - aucune des quatre n'est celle du produit :
///
///   · C1 (`code.html:212-215`) : Expertise · Tarifs · Zone d'intervention ·
///     **Avis** ;
///   · C13 (`code.html:134-137`) : Réparations · Tarifs · Avis · **Contact**.
///
/// « Avis » ne correspond à aucune US v1 - il n'y a pas de fonctionnalité
/// d'avis - et « Contact » contredit Constitution §1.2, qui écarte le rappel
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

/// Entrée de l'espace technicien - T-V2-05.
///
/// Une seule, vers la tournée du jour, alors que l'espace en compte trois : les
/// deux autres vues sont atteintes par les onglets en tête de contenu, et la
/// barre latérale de l'espace les porte aussi. Poser les trois ici ferait de la
/// barre du site un doublon de celle de l'espace.
export const NAV_ESPACE_TECH = [
  { href: CHEMIN_TOURNEE_DU_JOUR, label: "Ma tournée" },
] as const;

/// Entrée du back-office, livrée depuis T-J0-05 mais qu'aucune navigation ne
/// proposait : un administrateur connecté voyait « Mes interventions » et
/// devait taper l'URL de son propre espace.
export const NAV_ESPACE_ADMIN = [
  { href: CHEMIN_ADMIN_PARAMETRES, label: "Administration" },
] as const;

/// L'espace de travail d'un compte - ce que le menu utilisateur propose.
///
/// Un discriminant plutôt qu'un composant d'icône : une référence de composant
/// ne traverse pas la frontière serveur → client, et `UserMenu` est une feuille
/// cliente. Il fait la correspondance avec son icône, le libellé et le chemin
/// voyagent avec.
export type EspacePrincipal = "client" | "tech" | "admin";

/// La navigation à rendre, selon les rôles de la session.
///
/// ── Les rôles, et non plus un booléen (T-V2-05)
///
/// Elle prenait `connecte: boolean`, donc rendait `NAV_ESPACE_CLIENT` à toute
/// session ouverte : un technicien voyait « Mes interventions » pointant
/// l'espace d'un client, et **aucun lien vers sa tournée**. C'est la lecture
/// large de Constitution §3.1, clarifiée le 2026-08-12, qui l'interdit
/// désormais - et depuis T-V2-05 cet espace lui répond 403.
///
/// ⚠️ **Le rôle le plus large gagne, même règle d'ordre que `afterLoginPath`.**
/// `users.roles` est un `VARCHAR[]` : rien n'interdit à un administrateur de
/// porter aussi `ROLE_TECH`. Sans cet ordre, la destination dépendrait de
/// l'ordre d'insertion en base.
///
/// Les trois ancres publiques restent pour tout le monde : ce sont des sections
/// de la landing, pas un espace de travail, et aucune source ne demande de les
/// retirer à un technicien.
///
/// Une seule fonction pour la barre desktop et le panneau mobile : les deux
/// surfaces doivent porter les mêmes entrées, et deux listes construites
/// séparément finiraient par diverger sur celle qu'on oublie.
export function navigationPrincipale(
  roles: readonly string[] | null,
): readonly { href: string; label: string }[] {
  if (!roles) return NAV_PUBLIQUE;

  if (hasRole(roles, ROLE_ADMIN)) return [...NAV_PUBLIQUE, ...NAV_ESPACE_ADMIN];
  if (hasRole(roles, ROLE_TECH)) return [...NAV_PUBLIQUE, ...NAV_ESPACE_TECH];

  return [...NAV_PUBLIQUE, ...NAV_ESPACE_CLIENT];
}

/// L'entrée d'espace du menu utilisateur - même règle d'ordre, même motif.
///
/// `user-menu.tsx` pointait `CHEMIN_ESPACE_CLIENT` en dur pour tout le monde :
/// le menu d'un technicien proposait donc l'espace client, qui lui répond
/// désormais 403. Un lien qui mène à un refus est pire qu'un lien absent.
export function espacePrincipal(roles: readonly string[]): {
  espace: EspacePrincipal;
  href: string;
  label: string;
} {
  if (hasRole(roles, ROLE_ADMIN)) {
    return { espace: "admin", ...NAV_ESPACE_ADMIN[0] };
  }
  if (hasRole(roles, ROLE_TECH)) {
    return { espace: "tech", ...NAV_ESPACE_TECH[0] };
  }
  return { espace: "client", ...NAV_ESPACE_CLIENT[0] };
}

/// Le technicien et l'administrateur ne se voient pas proposer de réserver.
///
/// ⚠️ **La route `/reserver` reste OUVERTE**, et ce n'est pas une demi-mesure :
/// Constitution §3.2 veut le tunnel explorable sans compte, donc y poser un 403
/// par rôle contredirait un second axiome. Ce qui disparaît est l'appel à
/// l'action dans une navigation d'employé, pas l'accès. Un test E2E fige
/// l'ouverture de la route pour un technicien.
export function reservationProposee(roles: readonly string[] | null): boolean {
  if (!roles) return true;
  return !hasRole(roles, ROLE_ADMIN) && !hasRole(roles, ROLE_TECH);
}

/// Les trois pages d'`US-RGPD`, dans le triplet tranché par [[s4-nf-transverses|
/// PLAN S4]] §4.2 - celui qui fait foi contre les trois autres qui circulaient.
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
/// matcher de `src/proxy.ts:35` couvre `/client/:path*` - un visiteur anonyme
/// qui clique « Réserver » y serait redirigé vers `/connexion`, ce qui contredit
/// Constitution §3.2, « la réservation précède l'inscription ». Tranché le
/// 2026-08-09, les deux ADR sont à amender au write-back.
export const CHEMIN_RESERVATION = "/reserver";
