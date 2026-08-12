import type { Metadata } from "next";
import { CalendarCheck, Clock } from "lucide-react";
import Link from "next/link";

import { requireTech } from "@/lib/auth/permissions";
import { jourLocal } from "@/lib/creneaux/horaires";
import {
  listerTourneeAVenir,
  type InterventionTournee,
} from "@/lib/db/queries/interventions";
import { formatDureeCumulee, formatJourLong } from "@/lib/format";
import {
  FENETRES_JOURS,
  lireFenetre,
  type FenetreJours,
} from "@/lib/interventions/fenetre";
import { CHEMIN_TOURNEE_A_VENIR } from "@/lib/routes";
import { LigneTournee } from "@/components/features/interventions/ligne-tournee";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { EnTeteTournee } from "../_components/en-tete-tournee";

export const metadata: Metadata = {
  title: "Mes interventions à venir - HomeCycl'Home",
};

/// Onglet « Cette semaine » - `US-INTERVENTIONS-LISTER-TECH-A-VENIR`, promue en
/// v1 le 2026-08-12, déclinaison de l'écran **T1**.
///
/// ── Pas de TanStack Query ici, et ce n'est pas un oubli
///
/// PLAN S1 §6.1 n'autorise le polling que sur **trois vues** du produit, dont
/// une seule est technicien : la tournée du jour. Une lecture RSC suffit ici -
/// personne ne regarde la semaine prochaine en attendant qu'elle change.
/// Conséquence directe : **cette vue n'expose aucune Server Action**, donc
/// aucun endpoint POST public de plus. La garde est `requireTech()` ci-dessous,
/// et un test fige l'absence d'action.
///
/// ── Le sélecteur 7 j / 30 j
///
/// « (7 j / 30 j) » est écrit dans le récit de l'US. Le paramètre est
/// **énuméré**, pas une date libre : ça supprime la surface de validation au
/// lieu de la garder, et `lireFenetre` retombe sur 7 devant n'importe quoi
/// d'autre. Deux liens plutôt qu'un contrôle client - la sélection est une
/// adresse, donc partageable, et elle fonctionne sans JavaScript.
///
/// `searchParams` est une promesse en Next 16, et il est typé comme tel.
export default async function InterventionsAVenirTechPage({
  searchParams,
}: {
  searchParams: Promise<{ jours?: string }>;
}) {
  const [tech, parametres] = await Promise.all([requireTech(), searchParams]);

  const jours = lireFenetre(parametres.jours);

  // L'horloge est fixée **une fois** : la fenêtre listée et les libellés
  // affichés doivent venir du même instant, sinon un rendu à cheval sur minuit
  // titrerait une plage et en listerait une autre.
  const interventions = await listerTourneeAVenir({
    techId: tech.id,
    aujourdhui: jourLocal(new Date()),
    jours,
  });

  const minutes = interventions.reduce(
    (somme, intervention) => somme + intervention.durationSnapshot,
    0,
  );

  return (
    <>
      <EnTeteTournee actif="a-venir" />

      <header className="flex flex-col gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-tighter text-primary md:text-4xl">
          Les {jours} prochains jours
        </h1>

        <p className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="gap-1.5 py-1.5">
            <CalendarCheck aria-hidden="true" className="size-4" />
            {interventions.length === 0
              ? "Aucune intervention"
              : `${String(interventions.length)} intervention${interventions.length > 1 ? "s" : ""}`}
          </Badge>

          {minutes > 0 && (
            <Badge variant="outline" className="gap-1.5 py-1.5">
              <Clock aria-hidden="true" className="size-4" />
              {formatDureeCumulee(minutes)} de travail estimé
            </Badge>
          )}
        </p>

        <SelecteurFenetre courante={jours} />
      </header>

      {interventions.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="text-center text-muted-foreground">
            Aucune intervention prévue sur les {jours} prochains jours.
          </CardContent>
        </Card>
      ) : (
        // Groupées par journée civile : sans ça, une liste de trente jours est
        // un mur de lignes où rien ne dit où commence demain. Le titre de jour
        // porte la date, donc les lignes n'ont pas à la répéter.
        grouperParJour(interventions).map((journee) => (
          <section
            key={journee.cle}
            aria-labelledby={`jour-${journee.cle}`}
            className="flex flex-col gap-3"
          >
            <h2
              id={`jour-${journee.cle}`}
              className="font-heading text-lg font-bold tracking-tighter first-letter:uppercase"
            >
              {journee.libelle}
            </h2>

            {/* `<ol>` et non `<ul>` : l'ordre chronologique EST l'information,
                c'est la tournée dans l'ordre où elle se fera. */}
            <ol className="flex flex-col gap-3">
              {journee.interventions.map((intervention) => (
                <LigneTournee
                  key={intervention.id}
                  intervention={intervention}
                />
              ))}
            </ol>
          </section>
        ))
      )}
    </>
  );
}

/// Les deux fenêtres, en liens.
///
/// `Button` de shadcn avec `asChild`, et non un `ToggleGroup` : chaque choix est
/// une **adresse**, donc un `<a>`. Le pattern `Slot` de Radix donne l'apparence
/// du bouton à un lien, ce qui est exactement le cas d'usage d'`asChild`. Rien à
/// hydrater, et la sélection survit au partage de l'URL comme au retour arrière.
function SelecteurFenetre({ courante }: { courante: FenetreJours }) {
  return (
    <nav aria-label="Période affichée">
      <ul className="flex items-center gap-2">
        {FENETRES_JOURS.map((fenetre) => {
          const active = fenetre === courante;

          return (
            <li key={fenetre}>
              <Button
                asChild
                size="sm"
                variant={active ? "default" : "secondary"}
              >
                <Link
                  href={`${CHEMIN_TOURNEE_A_VENIR}?jours=${String(fenetre)}`}
                  // `aria-current` et non `aria-pressed` : ce sont des liens
                  // vers deux vues, pas un interrupteur à deux états.
                  aria-current={active ? "true" : undefined}
                >
                  {fenetre} jours
                </Link>
              </Button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/// Regroupe des lignes déjà triées par journée civile de `Europe/Paris`.
///
/// Le groupement se fait sur `jourLocal` et non sur les dix premiers caractères
/// de l'ISO : celle-ci est en UTC, donc un rendez-vous du 14 août à 00 h 30 à
/// Paris tomberait dans le groupe du 13.
function grouperParJour(interventions: readonly InterventionTournee[]): {
  cle: string;
  libelle: string;
  interventions: InterventionTournee[];
}[] {
  const journees: {
    cle: string;
    libelle: string;
    interventions: InterventionTournee[];
  }[] = [];

  for (const intervention of interventions) {
    const instant = new Date(intervention.appointmentAt);
    const jour = jourLocal(instant);
    const cle = `${String(jour.annee)}-${String(jour.mois).padStart(2, "0")}-${String(jour.jour).padStart(2, "0")}`;

    const derniere = journees.at(-1);
    if (derniere?.cle === cle) {
      derniere.interventions.push(intervention);
      continue;
    }

    journees.push({
      cle,
      libelle: formatJourLong(instant),
      interventions: [intervention],
    });
  }

  return journees;
}
