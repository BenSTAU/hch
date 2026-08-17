import type { Metadata } from "next";
import { CalendarCheck } from "lucide-react";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { requireTech } from "@/lib/auth/permissions";
import { listerHistoriqueTech } from "@/lib/db/queries/interventions";
import { lireJourCivil, lirePage } from "@/lib/interventions/fenetre";
import { CHEMIN_TOURNEE_PASSEES } from "@/lib/routes";
import { FiltrePeriode } from "@/components/features/interventions/filtre-periode";
import { LigneTournee } from "@/components/features/interventions/ligne-tournee";
import { PaginationInterventions } from "@/components/features/interventions/pagination-interventions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

import { EnTeteTournee } from "../_components/en-tete-tournee";

export const metadata: Metadata = {
  title: "Mes interventions passées - HomeCycl'Home",
};

/// Onglet « Historique » - `US-INTERVENTIONS-LISTER-TECH-PASSEES`, promue en v1
/// le 2026-08-12, déclinaison de l'écran **T1**.
///
/// Même modèle que C10 côté client : statuts terminaux, tri `appointment_at
/// DESC`, pagination, filtre par période. Le **filtre par statut** que l'US
/// mentionne reste hors périmètre v1, comme côté client : les deux seules
/// valeurs possibles sont `DONE` et `CANCELLED`, que l'étiquette de chaque
/// ligne porte déjà.
///
/// Comme « Cette semaine » : la lecture est un RSC, le filtre et la pagination
/// vivent dans l'URL. Aucun endpoint POST public n'est donc créé ici, et la
/// garde est `requireTech()`.
///
/// `lireJourCivil` refuse ce qui n'est pas une date réelle - `2026-02-31` passe
/// une regex de format et serait roulé au 3 mars par `Date.UTC`. `lirePage`
/// plancher à 1 et tronque. Une valeur illisible ne fait pas échouer la page :
/// elle ne filtre simplement pas.
export default async function InterventionsPasseesTechPage({
  searchParams,
}: {
  searchParams: Promise<{ du?: string; au?: string; page?: string }>;
}) {
  const [tech, parametres] = await Promise.all([requireTech(), searchParams]);

  const du = lireJourCivil(parametres.du);
  const au = lireJourCivil(parametres.au);

  const historique = await listerHistoriqueTech({
    techId: tech.id,
    ...(du ? { du } : {}),
    ...(au ? { au } : {}),
    page: lirePage(parametres.page),
  });

  return (
    <>
      <EnTeteTournee actif="passees" />

      <header className="flex flex-col gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-tighter text-primary md:text-4xl">
          Historique
        </h1>

        <p>
          <Badge variant="outline" className="gap-1.5 py-1.5">
            <CalendarCheck aria-hidden="true" className="size-4" />
            {historique.total === 0
              ? "Aucune intervention"
              : `${String(historique.total)} intervention${historique.total > 1 ? "s" : ""}`}
          </Badge>
        </p>
      </header>

      <NuqsAdapter>
        <FiltrePeriode />
      </NuqsAdapter>

      <section
        aria-labelledby="titre-historique"
        className="flex flex-col gap-3"
      >
        <h2 id="titre-historique" className="sr-only">
          Mes interventions passées
        </h2>

        {historique.interventions.length === 0 ? (
          // Message explicite, pas une liste vide. Deux situations le
          // produisent - un technicien qui débute, et un filtre trop resserré -
          // et le libellé ne prétend pas les distinguer.
          <Card className="border-dashed">
            <CardContent className="text-center text-muted-foreground">
              Aucune intervention passée sur cette période.
            </CardContent>
          </Card>
        ) : (
          // `<ol>` : l'ordre est l'information, du plus récent au plus ancien.
          <ol className="flex flex-col gap-3">
            {historique.interventions.map((intervention) => (
              <LigneTournee
                key={intervention.id}
                intervention={intervention}
                // Les lignes couvrent des jours quelconques : l'heure seule ne
                // situe rien, contrairement aux deux autres vues.
                dateVisible
              />
            ))}
          </ol>
        )}
      </section>

      <PaginationInterventions
        page={historique.page}
        pages={historique.pages}
        base={CHEMIN_TOURNEE_PASSEES}
        periode={{
          ...(parametres.du ? { du: parametres.du } : {}),
          ...(parametres.au ? { au: parametres.au } : {}),
        }}
      />
    </>
  );
}
