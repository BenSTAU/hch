import Link from "next/link";

import { cn } from "@/lib/utils";

/// Pagination de l'historique — **C10**.
///
/// `US-INTERVENTIONS-LISTER-CLIENT-PASSEES` demande une « liste paginée ». La
/// taille de page (dix) n'est écrite dans aucun artefact, elle vit dans
/// `TAILLE_PAGE_PASSEES`.
///
/// ── Des liens, pas `nuqs`
///
/// CLAUDE.md §State impose l'URL pour la pagination, et c'est bien ce que fait
/// ce composant : chaque page est une adresse. Il le fait par des `<Link>`
/// plutôt que par un état client, pour trois raisons qui vont dans le même
/// sens - la navigation reste fonctionnelle sans JavaScript, chaque page est
/// atteignable au clavier comme un lien ordinaire, et un composant **serveur**
/// n'ajoute rien au paquet envoyé au navigateur.
///
/// Les paramètres de période sont recopiés dans chaque lien : les perdre en
/// changeant de page afficherait la page 2 d'une autre liste que celle qu'on
/// regarde.
export function PaginationPassees({
  page,
  pages,
  periode,
}: {
  page: number;
  pages: number;
  periode: { du?: string; au?: string };
}) {
  if (pages <= 1) return null;

  const lien = (cible: number): string => {
    const parametres = new URLSearchParams();
    if (periode.du) parametres.set("du", periode.du);
    if (periode.au) parametres.set("au", periode.au);
    if (cible > 1) parametres.set("page", String(cible));
    const requete = parametres.toString();
    return requete
      ? `/mes-interventions/passees?${requete}`
      : "/mes-interventions/passees";
  };

  return (
    <nav aria-label="Pagination de l'historique" className="flex justify-end">
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
