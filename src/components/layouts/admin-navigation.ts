import { CHEMIN_ADMIN_FORFAITS, CHEMIN_ADMIN_PARAMETRES } from "@/lib/routes";

/// Navigation de l'espace d'administration.
///
/// ⚠️ **Elle ne porte que ce qui existe.** La maquette A3 en dessine sept
/// (Overview, Interventions, Users, Catalogs, Zones, Tech Assignments,
/// Settings) : cinq n'ont aucune route, et le tableau de bord est du bloc 2.
/// Un lien mort dans une navigation permanente promet un écran que personne ne
/// livrera. Les entrées s'ajoutent au fil des tâches.
export type SegmentAdmin = "forfaits" | "parametres";

export const NAV_ADMIN: {
  segment: SegmentAdmin;
  href: string;
  libelle: string;
}[] = [
  { segment: "forfaits", href: CHEMIN_ADMIN_FORFAITS, libelle: "Forfaits" },
  {
    segment: "parametres",
    href: CHEMIN_ADMIN_PARAMETRES,
    libelle: "Paramètres",
  },
];
