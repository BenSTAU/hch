import {
  CHEMIN_ADMIN_PARAMETRES,
  CHEMIN_ESPACE_CLIENT,
  CHEMIN_TOURNEE_DU_JOUR,
} from "@/lib/routes";
import { ROLE_ADMIN, ROLE_TECH, hasRole } from "@/lib/auth/roles";

/// Navigation de la coquille publique - l'en-tête et le pied de page la
/// partagent.
///
/// ⚠️ Ni « Avis » ni « Contact », que les maquettes C1 et C13 portent : le
/// premier ne correspond à aucune US, le second ouvre le rappel humain que
/// Constitution §1.2 écarte. Détail dans [[maquettage]] §Notes portage.
export const NAV_PUBLIQUE = [
  { href: "/#forfaits", label: "Nos forfaits" },
  { href: "/#fonctionnement", label: "Comment ça marche" },
  { href: "/#zone", label: "Zone desservie" },
] as const;

/// Espace client. Affichée pour une session ouverte seulement : la proposer à
/// un anonyme l'enverrait sur le formulaire de connexion.
///
/// Elle double délibérément l'entrée du menu utilisateur, qu'il faut ouvrir
/// pour voir - c'est la destination la plus fréquente d'un client connecté.
export const NAV_ESPACE_CLIENT = [
  { href: CHEMIN_ESPACE_CLIENT, label: "Mes interventions" },
] as const;

/// Espace technicien. Une seule entrée alors que l'espace en compte trois : les
/// deux autres vues vivent dans sa barre latérale, et les poser ici ferait de
/// la barre du site un doublon.
export const NAV_ESPACE_TECH = [
  { href: CHEMIN_TOURNEE_DU_JOUR, label: "Ma tournée" },
] as const;

/// Back-office.
export const NAV_ESPACE_ADMIN = [
  { href: CHEMIN_ADMIN_PARAMETRES, label: "Administration" },
] as const;

/// Un discriminant plutôt qu'une référence de composant : celle-ci ne traverse
/// pas la frontière serveur → client, et `UserMenu` est une feuille cliente.
export type EspacePrincipal = "client" | "tech" | "admin";

/// La navigation à rendre, selon les rôles de la session.
///
/// ⚠️ **Le rôle le plus large gagne, même règle d'ordre que `afterLoginPath`.**
/// `users.roles` est un `VARCHAR[]` : sans cet ordre, la destination dépendrait
/// de l'ordre d'insertion en base. Un test relie les deux modules, que rien ne
/// relie au compilateur.
///
/// Les trois ancres publiques restent pour tout le monde : ce sont des sections
/// de la landing, pas un espace de travail.
///
/// Une seule fonction pour la barre desktop et le panneau mobile - deux listes
/// construites séparément divergeraient sur celle qu'on oublie.
export function navigationPrincipale(
  roles: readonly string[] | null,
): readonly { href: string; label: string }[] {
  if (!roles) return NAV_PUBLIQUE;

  if (hasRole(roles, ROLE_ADMIN)) return [...NAV_PUBLIQUE, ...NAV_ESPACE_ADMIN];
  if (hasRole(roles, ROLE_TECH)) return [...NAV_PUBLIQUE, ...NAV_ESPACE_TECH];

  return [...NAV_PUBLIQUE, ...NAV_ESPACE_CLIENT];
}

/// L'entrée d'espace du menu utilisateur - même règle d'ordre. Un lien qui mène
/// à un refus est pire qu'un lien absent.
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

/// ⚠️ **La route `/reserver` reste OUVERTE.** Constitution §3.2 veut le tunnel
/// explorable sans compte : ce qui disparaît est l'appel à l'action dans une
/// navigation d'employé, pas l'accès. Un E2E fige l'ouverture.
export function reservationProposee(roles: readonly string[] | null): boolean {
  if (!roles) return true;
  return !hasRole(roles, ROLE_ADMIN) && !hasRole(roles, ROLE_TECH);
}

/// Les trois pages d'`US-RGPD`, triplet tranché par [[s4-nf-transverses|PLAN
/// S4]] §4.2. Nommées plutôt que littérales : `PageLegale` marque l'onglet
/// actif en comparant sa route à cette liste.
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

/// Tunnel de réservation.
///
/// ⚠️ **`/reserver` et non `/client/reserver`** : le matcher de `src/proxy.ts`
/// couvre `/client/:path*` et redirigerait un visiteur anonyme vers
/// `/connexion`, contre Constitution §3.2. ADR-006 §10 et ADR-014 §5 écrivent
/// l'inverse et sont à amender au write-back.
export const CHEMIN_RESERVATION = "/reserver";
