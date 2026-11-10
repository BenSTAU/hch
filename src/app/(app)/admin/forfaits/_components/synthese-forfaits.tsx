import { CircleCheck, History, Wallet } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { SyntheseForfaits } from "@/lib/db/queries/forfaits";
import { formatPrixEuros } from "@/lib/format";
import { cn } from "@/lib/utils";

/// Les trois compteurs de l'en-tête, maquette A3. Aucune US ne les demande ;
/// les notes de portage les classent « trouvaille Stitch à conserver » pour
/// A2, A3 et A4, et ils se calculent sans colonne nouvelle.

export function SyntheseForfaits({ synthese }: { synthese: SyntheseForfaits }) {
  const cartes = [
    {
      cle: "actifs",
      Icone: CircleCheck,
      libelle: "Forfaits actifs",
      valeur: String(synthese.actifs),
      detail: "disponibles à la réservation",
      // La carte du statut courant est mise en avant, trouvaille Stitch
      // commune à A2, A3 et A4.
      accent: true,
    },
    {
      cle: "inactifs",
      Icone: History,
      libelle: "Forfaits désactivés",
      valeur: String(synthese.inactifs),
      detail: "gardés en historique",
      accent: false,
    },
    {
      cle: "moyen",
      Icone: Wallet,
      libelle: "Prix moyen",
      valeur: synthese.prixMoyen ? formatPrixEuros(synthese.prixMoyen) : "-",
      detail: `sur ${String(synthese.actifs)} forfait${synthese.actifs > 1 ? "s" : ""} actif${synthese.actifs > 1 ? "s" : ""}`,
      accent: false,
    },
  ];

  return (
    <ul className="grid gap-4 sm:grid-cols-3">
      {cartes.map(({ cle, Icone, libelle, valeur, detail, accent }) => (
        <li key={cle}>
          <Card
            className={cn(
              "h-full",
              accent && "bg-primary text-primary-foreground",
            )}
          >
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{libelle}</span>
                <Icone aria-hidden="true" className="size-5 opacity-70" />
              </div>
              <span className="font-heading text-3xl font-bold">{valeur}</span>
              <span
                className={cn(
                  "text-xs",
                  accent ? "opacity-80" : "text-muted-foreground",
                )}
              >
                {detail}
              </span>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
