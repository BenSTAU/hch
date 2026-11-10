import Link from "next/link";

import { cn } from "@/lib/utils";

/// Pagination par liens, sans connaissance du domaine. Née en
/// `features/interventions/` pour C10 et l'historique technicien, montée ici à
/// son deuxième usage (le catalogue des forfaits), règle des 2 usages.
///
/// Des `<Link>` plutôt que `nuqs` : la navigation reste fonctionnelle sans
/// JavaScript, chaque page est un lien atteignable au clavier, et le composant
/// reste serveur, donc hors du paquet envoyé au navigateur. L'état vit bien
/// dans l'URL, ce que CLAUDE.md §State management exige.
export function Pagination({
  page,
  pages,
  base,
  parametres = {},
  libelle,
}: {
  page: number;
  pages: number;
  /// Chemin de la liste paginée.
  base: string;
  /// Les paramètres d'URL à conserver d'une page à l'autre - filtres, tri.
  /// Les perdre afficherait la page 2 d'une autre liste que celle regardée.
  parametres?: Record<string, string | undefined>;
  /// Ce que la navigation pagine, pour `aria-label`. Deux paginations sur un
  /// même écran doivent être distinguables au lecteur d'écran.
  libelle: string;
}) {
  if (pages <= 1) return null;

  const lien = (cible: number): string => {
    const recherche = new URLSearchParams();
    for (const [cle, valeur] of Object.entries(parametres)) {
      if (valeur !== undefined && valeur !== "") recherche.set(cle, valeur);
    }
    if (cible > 1) recherche.set("page", String(cible));

    const requete = recherche.toString();
    return requete ? `${base}?${requete}` : base;
  };

  return (
    <nav aria-label={libelle} className="flex justify-end">
      <ul className="flex items-center gap-1">
        {Array.from({ length: pages }, (_, index) => index + 1).map((cible) => {
          const courante = cible === page;

          return (
            <li key={cible}>
              <Link
                href={lien(cible)}
                aria-current={courante ? "page" : undefined}
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg text-sm font-medium transition-colors",
                  courante
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary",
                )}
              >
                {cible}
                <span className="sr-only">
                  {courante ? " (page courante)" : ""}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
