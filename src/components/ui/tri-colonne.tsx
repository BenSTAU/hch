import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";

import { TableHead } from "@/components/ui/table";

export type SensTriColonne = "asc" | "desc";

/// En-tête de colonne triable, sans connaissance du domaine. Comme la
/// pagination, l'état vit dans l'URL et la bascule est un `<Link>` : le tri
/// reste partageable, fonctionne sans JavaScript, et l'en-tête reste serveur.
///
/// `aria-sort` est porté par le `<th>` et non par le lien : c'est la colonne
/// qui est triée, pas le contrôle (RGAA 11, motif ARIA `table`).
export function TriColonne({
  libelle,
  cle,
  triCourant,
  sensCourant,
  base,
  parametres = {},
}: {
  libelle: string;
  /// Clé de tri écrite dans l'URL.
  cle: string;
  triCourant: string;
  sensCourant: SensTriColonne;
  base: string;
  /// Paramètres à conserver dans le lien. La page n'en fait pas partie :
  /// changer de tri ramène en page 1, la ligne cherchée ayant changé de place.
  parametres?: Record<string, string | undefined>;
}) {
  const active = triCourant === cle;
  // Recliquer la colonne active inverse le sens ; une autre colonne démarre
  // toujours en croissant.
  const sensCible: SensTriColonne =
    active && sensCourant === "asc" ? "desc" : "asc";

  const recherche = new URLSearchParams();
  for (const [nom, valeur] of Object.entries(parametres)) {
    if (valeur !== undefined && valeur !== "") recherche.set(nom, valeur);
  }
  recherche.set("tri", cle);
  recherche.set("sens", sensCible);

  const Icone = !active
    ? ArrowUpDown
    : sensCourant === "asc"
      ? ArrowUp
      : ArrowDown;

  return (
    <TableHead
      aria-sort={
        !active ? "none" : sensCourant === "asc" ? "ascending" : "descending"
      }
    >
      <Link
        href={`${base}?${recherche.toString()}`}
        className="inline-flex items-center gap-1.5 font-semibold transition-colors hover:text-primary"
      >
        {libelle}
        <Icone aria-hidden="true" className="size-3.5" />
        {/* Le sens courant n'est signalé que par une icône, qui ne dit rien au
            lecteur d'écran. `aria-sort` le porte déjà sur la colonne, mais pas
            l'effet du clic : c'est ce que ce texte annonce. */}
        <span className="sr-only">
          {sensCible === "asc"
            ? ", trier par ordre croissant"
            : ", trier par ordre décroissant"}
        </span>
      </Link>
    </TableHead>
  );
}
