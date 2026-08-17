import {
  CHEMIN_TOURNEE_A_VENIR,
  CHEMIN_TOURNEE_DU_JOUR,
  CHEMIN_TOURNEE_PASSEES,
} from "@/lib/routes";

/// Les trois vues de l'espace technicien - T-V2-05.
///
/// ⚠️ **Ce n'est pas une invention, c'est un portage inachevé.** La maquette T1
/// dessine déjà ces trois onglets dans sa barre latérale (`code.html:136-147`) :
/// « Aujourd'hui » (`today`), « Cette semaine » (`calendar_view_week`) et
/// « Historique » (`history`). T-V2-01 a porté le **contenu** de T1 et pas sa
/// **navigation**.
///
/// Trois entrées de plus y figurent et ne sont pas portées - « Ma zone »,
/// « Profil », « Aide » : aucune US ne les porte, et la barre de l'espace client
/// n'en pose qu'une pour la même raison (leçon `T-T2-16` d'Argo, aucun lien mort
/// dans une navigation permanente).
///
/// « Cette semaine » mène à `/interventions/a-venir`, et l'écart est voulu : la
/// règle du produit est que la route porte l'identifiant de l'US
/// (`US-INTERVENTIONS-LISTER-TECH-A-VENIR`), pas le libellé de l'onglet. Côté
/// client la coïncidence des deux avait masqué la règle. Argument qui tranche :
/// « semaine » deviendrait faux dès `?jours=30`.
///
/// Données partagées par les deux surfaces qui les rendent - la barre latérale,
/// masquée sous `md`, et les onglets en tête de contenu. Deux listes construites
/// séparément finiraient par diverger sur celle qu'on oublie.

export type CleOnglet = "du-jour" | "a-venir" | "passees";

export const ONGLETS_TOURNEE = [
  { cle: "du-jour", href: CHEMIN_TOURNEE_DU_JOUR, label: "Aujourd'hui" },
  { cle: "a-venir", href: CHEMIN_TOURNEE_A_VENIR, label: "Cette semaine" },
  { cle: "passees", href: CHEMIN_TOURNEE_PASSEES, label: "Historique" },
] as const satisfies readonly {
  cle: CleOnglet;
  href: string;
  label: string;
}[];
