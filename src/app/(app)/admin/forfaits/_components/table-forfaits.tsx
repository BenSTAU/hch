import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TriColonne } from "@/components/ui/tri-colonne";
import type { ForfaitAdmin } from "@/lib/db/queries/forfaits";
import { formatDuree, formatPrixEuros } from "@/lib/format";
import { CHEMIN_ADMIN_FORFAITS, cheminAdminForfait } from "@/lib/routes";
import type { SensTriForfaits, TriForfaits } from "@/lib/validations/forfaits";
import { cn } from "@/lib/utils";

/// Tableau du catalogue - `US-FORFAIT-LISTER`.
///
/// ⚠️ **Un tableau, là où la maquette A3 dessine des cartes.** La SPEC commande
/// la structure (liste paginée, tri sur trois colonnes), la maquette commande
/// le style. Le tri par colonne avec `aria-sort` n'a pas d'équivalent sur une
/// grille de cartes, et les maquettes A1, A2 et A6 sont déjà des tableaux.
/// Écart tracé dans le body de PR.
///
/// Les inactifs restent VISIBLES et grisés, là où la vitrine les masque.
export function TableForfaits({
  forfaits,
  tri,
  sens,
}: {
  forfaits: ForfaitAdmin[];
  tri: TriForfaits;
  sens: SensTriForfaits;
}) {
  return (
    <Table>
      <caption className="sr-only">
        Catalogue des forfaits, triable par nom, prix et durée
      </caption>
      <TableHeader>
        <TableRow>
          <TriColonne
            libelle="Nom"
            cle="label"
            triCourant={tri}
            sensCourant={sens}
            base={CHEMIN_ADMIN_FORFAITS}
          />
          <TriColonne
            libelle="Durée"
            cle="duration"
            triCourant={tri}
            sensCourant={sens}
            base={CHEMIN_ADMIN_FORFAITS}
          />
          <TriColonne
            libelle="Prix"
            cle="price"
            triCourant={tri}
            sensCourant={sens}
            base={CHEMIN_ADMIN_FORFAITS}
          />
          <TableHead>Statut</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {forfaits.map((forfait) => (
          <TableRow
            key={forfait.id}
            className={cn(!forfait.isActive && "text-muted-foreground")}
          >
            <TableCell>
              <Link
                href={cheminAdminForfait(forfait.id)}
                className="font-semibold hover:text-primary hover:underline"
              >
                {forfait.label}
              </Link>
              {forfait.description ? (
                <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                  {forfait.description}
                </p>
              ) : null}
            </TableCell>
            <TableCell>{formatDuree(forfait.duration)}</TableCell>
            <TableCell>{formatPrixEuros(forfait.price)}</TableCell>
            <TableCell>
              {/* Le gris seul ne distingue pas un forfait retiré de la vente
                  pour qui ne perçoit pas les contrastes de couleur
                  (RGAA 3.1) : le badge porte l'information en toutes
                  lettres. */}
              {forfait.isActive ? (
                <Badge variant="secondary">Actif</Badge>
              ) : (
                <Badge variant="outline">Désactivé</Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
