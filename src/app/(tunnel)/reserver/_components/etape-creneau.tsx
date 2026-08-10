"use client";

import { useQuery } from "@tanstack/react-query";
import { fr } from "date-fns/locale";
import { CalendarDays, Wallet } from "lucide-react";
import { useState } from "react";

import { listerCreneaux } from "@/lib/actions/interventions/lister-creneaux";
import type { ForfaitPublic } from "@/lib/db/queries/forfaits";
import { formatDuree, formatPrixEuros } from "@/lib/format";
import type { SuggestionAdresse } from "@/lib/geo/ban";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { CONTENEUR } from "./etapes";

/// Étape 3 du tunnel - écran **C4** (`c4-tunnel-creneau/code.html`).
///
/// La grille se **dérive à la volée** : aucun créneau n'est stocké
/// (Constitution §2.1). Elle se rafraîchit toutes les 30 secondes parce qu'un
/// autre visiteur peut prendre le créneau qu'on regarde - c'est l'une des trois
/// vues où TanStack Query est autorisé (PLAN S1 §6.1).
///
/// ── Géométrie portée
///
///   · bandeau de rappel `rounded-2xl p-6`, forfait en `headline-sm` et adresse
///     en `body-md` dessous (`c4:136-142`) ;
///   · hero `mt-8 mb-4`, titre `headline-xl` 48 px, chapô `body-lg max-w-3xl` ;
///   · deux colonnes **60 / 40** au-delà de `lg`, gouttière 16 px (`c4:149`) ;
///   · calendrier puis créneaux dans la **même** dalle de gauche, comme la
///     maquette (`c4:151-185`) ;
///   · grille de créneaux `grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3`,
///     pastille `px-3 py-2 rounded-lg` en `body-sm` (`c4:177-184`) ;
///   · récapitulatif de droite sur fond `primary`, `rounded-2xl p-6`,
///     `justify-between` pour coller le total en bas (`c4:187`).
///
/// ── Un calendrier navigable, pas une liste de 30 jours
///
/// La première rédaction de cette étape empilait les 30 jours de l'horizon les
/// uns sous les autres : correct, illisible. Le mois se parcourt donc au
/// `Calendar` du catalogue shadcn (CLAUDE.md §Styling le liste), borné à
/// l'horizon réel par `startMonth` / `endMonth`, les jours sans disponibilité
/// désactivés. Les créneaux du jour retenu s'affichent dessous. C'est la
/// structure de la maquette, corrigée du défaut que [[maquettage]] §Notes
/// portage lui reproche - ses heures n'étaient rattachées à aucun jour.
///
/// ── Ce qui ne se porte pas
///
///  1. **La bascule Semaine / Mois** (`c4:154-157`) : la vue mois est la seule
///     que le calendrier rend, et une vue semaine n'ajouterait rien sur un
///     horizon de 30 jours.
///  2. **Le technicien assigné, sa photo et sa note** (`c4:197-207`) : ni avis
///     ni notation en v1, et l'affectation est décidée à la réservation.
///  3. **La liste d'attente en cas de désistement** (`c4:219-222`) : aucune US.

/// 30 secondes, pas 5 : le besoin métier ne réclame pas mieux et l'intervalle
/// long est un choix d'éco-conception (PLAN S1 §6.1).
const INTERVALLE_MS = 30_000;

type EtapeCreneauProps = {
  forfait: ForfaitPublic;
  adresse: SuggestionAdresse;
  zoneId: number;
  creneauChoisi: string | null;
  onChoisir: (debutIso: string) => void;
  onModifierAdresse: () => void;
  idTitre: string;
};

/// Clé de jour dans le fuseau du **navigateur**, conformément à PLAN S2 T5 :
/// la base est en UTC, l'affichage suit le lecteur. Composée à la main plutôt
/// que par `toISOString`, qui repasserait en UTC et décalerait d'un jour les
/// créneaux du soir.
function cleJour(date: Date): string {
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear())}-${mois}-${jour}`;
}

function grouperParJour(creneaux: string[]): Map<string, string[]> {
  const parJour = new Map<string, string[]>();

  for (const iso of creneaux) {
    const cle = cleJour(new Date(iso));
    const existants = parJour.get(cle);
    if (existants) existants.push(iso);
    else parJour.set(cle, [iso]);
  }

  return parJour;
}

const heure = new Intl.DateTimeFormat("fr-FR", { timeStyle: "short" });

const jourLong = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const dateComplete = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "full",
  timeStyle: "short",
});

export function EtapeCreneau({
  forfait,
  adresse,
  zoneId,
  creneauChoisi,
  onChoisir,
  onModifierAdresse,
  idTitre,
}: EtapeCreneauProps) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["creneaux", forfait.id, zoneId],
    queryFn: async () => {
      // La `queryFn` appelle une **Server Action**, pas un Route Handler :
      // CLAUDE.md §Data fetching interdit qu'un Client Component lise par
      // Route Handler.
      const resultat = await listerCreneaux({ serviceId: forfait.id, zoneId });

      if (resultat?.serverError) throw new Error(resultat.serverError);

      const donnees = resultat?.data;
      if (!donnees) throw new Error("Réponse inattendue du serveur.");
      if (!donnees.ok) throw new Error(donnees.message);

      return donnees.creneaux;
    },
    refetchInterval: INTERVALLE_MS,
    // Onglet en arrière-plan : on cesse d'interroger. Charge serveur, batterie
    // et bande passante - l'anti-patron nommé par la convention axe 03 §12.
    refetchIntervalInBackground: false,
  });

  return (
    <div className={cn(CONTENEUR, "flex flex-col gap-3 pt-6")}>
      <div className="flex flex-col items-start justify-between gap-2 rounded-2xl bg-secondary p-4 md:flex-row md:items-center">
        <div>
          <p className="font-heading text-lg font-bold tracking-[-0.01em] text-primary">
            {forfait.label} · {formatDuree(forfait.duration)} ·{" "}
            {formatPrixEuros(forfait.price)}
          </p>
          <p className="text-sm text-muted-foreground">{adresse.label}</p>
        </div>
        <Button
          type="button"
          variant="link"
          // Même motif qu'en C3 : un complément `sr-only` se collerait au texte
          // sans séparateur dans le nom accessible.
          aria-label="Modifier l'adresse"
          className="h-auto p-0 text-sm font-semibold tracking-[0.05em] underline"
          onClick={onModifierAdresse}
        >
          Modifier
        </Button>
      </div>

      {/* Hero resserré : la maquette pose un titre de 48 px et `mt-8 mb-4`
          (`c4:144-147`), qui à eux seuls mangeaient 200 px de haut. L'écran doit
          tenir sur une hauteur de fenêtre - un calendrier qu'on fait défiler
          pour voir ses propres créneaux perd l'intérêt d'être un calendrier.
          Arbitré au navigateur le 2026-08-10. */}
      <section className="mt-2">
        <h1
          id={idTitre}
          className="mb-1 font-heading text-[2rem] leading-[1.2] font-bold tracking-[-0.03em]"
        >
          Choisissez votre créneau
        </h1>
        <p className="max-w-3xl text-base leading-[1.6] text-muted-foreground">
          Voici les disponibilités de nos techniciens dans votre secteur pour
          une intervention de {formatDuree(forfait.duration)}.
        </p>
      </section>

      <div className="flex w-full flex-col gap-4 lg:flex-row">
        <div className="w-full rounded-2xl bg-card p-4 shadow-sm lg:w-[60%]">
          {/* Les trois états se départagent ici, où TanStack Query les rend
              exclusifs : passer `data` à l'enfant sans avoir écarté les deux
              premiers le lui donnerait en `string[] | undefined`. */}
          {isPending ? (
            <CalendrierSquelette />
          ) : isError ? (
            <p role="alert" className="text-base text-destructive">
              {error instanceof Error
                ? error.message
                : "Impossible de charger les créneaux, réessayez."}
            </p>
          ) : (
            <Calendrier
              creneaux={data}
              creneauChoisi={creneauChoisi}
              onChoisir={onChoisir}
            />
          )}
        </div>

        <div className="flex w-full flex-col justify-between gap-6 rounded-2xl bg-primary p-6 text-primary-foreground lg:w-[40%]">
          <div>
            <h2 className="mb-4 font-heading text-xl font-bold tracking-[-0.01em]">
              Récapitulatif du créneau
            </h2>

            <div className="flex items-start gap-3">
              <CalendarDays
                aria-hidden="true"
                className="mt-1 size-5 shrink-0 text-primary-fixed"
              />
              {creneauChoisi ? (
                <p className="text-lg leading-[1.6] font-semibold first-letter:uppercase">
                  {dateComplete.format(new Date(creneauChoisi))}
                </p>
              ) : (
                <p className="text-base leading-[1.6] text-primary-fixed">
                  Aucun créneau retenu pour l&apos;instant.
                </p>
              )}
            </div>
          </div>

          <div>
            <Separator className="bg-primary-foreground/20" />
            <div className="mt-4 flex items-end justify-between">
              {/* « Total **estimé** » dans la maquette (`c4:211`, `c5:334`).
                  Le prix est figé au moment de la réservation
                  (Constitution §4.1) : il n'est pas estimé, il est celui qui
                  sera payé. Le mot part. */}
              <span className="text-base">Total</span>
              <span className="font-heading text-2xl font-bold tracking-[-0.02em] text-tertiary-fixed">
                {formatPrixEuros(forfait.price)}
              </span>
            </div>
            <p className="mt-1 flex items-center justify-end gap-1.5 text-right text-sm text-primary-fixed">
              <Wallet aria-hidden="true" className="size-4" />
              Paiement sur place, après l&apos;intervention.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/// L'attente prend la forme du calendrier qu'elle annonce plutôt qu'une ligne
/// de texte : c'est ce que le `skeleton` du catalogue sert à faire, et ça évite
/// le saut de mise en page au premier rendu.
function CalendrierSquelette() {
  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <p role="status" className="sr-only">
        Recherche des créneaux disponibles…
      </p>
      <Skeleton className="h-64 w-full shrink-0 rounded-xl sm:w-64" />
      <div className="grid flex-1 grid-cols-3 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((cellule) => (
          <Skeleton key={cellule} className="h-9 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

function Calendrier({
  creneaux,
  creneauChoisi,
  onChoisir,
}: {
  creneaux: string[];
  creneauChoisi: string | null;
  onChoisir: (debutIso: string) => void;
}) {
  const [jourChoisi, setJourChoisi] = useState<Date | undefined>(undefined);

  if (creneaux.length === 0) {
    // Message explicite et non un calendrier vide : `US-INTERVENTION-RESERVER`
    // le nomme pour l'horizon de 30 jours.
    return (
      <p role="status" className="text-base text-muted-foreground">
        Aucun créneau disponible dans les 30 prochains jours.
      </p>
    );
  }

  const parJour = grouperParJour(creneaux);
  const premierIso = creneaux[0] ?? "";
  const dernierIso = creneaux[creneaux.length - 1] ?? "";

  // Le jour affiché se DÉDUIT : jour cliqué, sinon jour du créneau déjà retenu,
  // sinon premier jour disponible. Le recopier dans un état obligerait à le
  // resynchroniser à chaque rafraîchissement du polling.
  const jourAffiche = jourChoisi ?? new Date(creneauChoisi ?? premierIso);
  const cleAffichee = cleJour(jourAffiche);
  const heuresDuJour = parJour.get(cleAffichee) ?? [];

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      {/* `w-fit` et non `w-full` : la classe `day` de la primitive est en
          `aspect-square h-full w-full`, donc une cellule prend le SEPTIÈME de
          la largeur disponible et se fait aussi haute que large. Étalé sur la
          colonne de 60 %, ça donnait des cases de 90 px et un écran qui
          débordait. La largeur suit maintenant `--cell-size`, réglé à 36 px. */}
      <Calendar
        mode="single"
        locale={fr}
        selected={jourAffiche}
        onSelect={setJourChoisi}
        defaultMonth={jourAffiche}
        startMonth={new Date(premierIso)}
        endMonth={new Date(dernierIso)}
        showOutsideDays={false}
        // Un jour sans créneau n'est pas cliquable : c'est ce qui remplace le
        // défilement d'une liste de 30 jours dont la plupart étaient vides.
        disabled={(date) => !parJour.has(cleJour(date))}
        className="mx-auto shrink-0 p-0 [--cell-size:--spacing(8)] sm:mx-0"
      />

      <Separator orientation="vertical" className="hidden sm:block" />
      <Separator className="sm:hidden" />

      <section className="flex min-w-0 flex-1 flex-col gap-3">
        {/* `h2` et non `h3` : le seul titre au-dessus est le `h1` de l'écran,
            et sauter un niveau est une violation `heading-order` qu'`axe` a
            relevée. La hiérarchie n'a pas de niveau intermédiaire à porter. */}
        <h2 className="text-sm font-semibold tracking-[0.05em] text-muted-foreground uppercase">
          {jourLong.format(jourAffiche)}
        </h2>

        {heuresDuJour.length === 0 ? (
          <p role="status" className="text-base text-muted-foreground">
            Aucun créneau ce jour-là. Choisissez une autre date dans le
            calendrier.
          </p>
        ) : (
          /* Hauteur bornée et défilement interne : un jour ouvré porte une
             vingtaine de créneaux, qui pousseraient la barre d'action hors de
             l'écran. Le défilement reste local à la liste. */
          <ul className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
            {heuresDuJour.map((iso) => {
              const choisi = iso === creneauChoisi;
              return (
                <li key={iso}>
                  <button
                    type="button"
                    // `aria-pressed` et non une simple classe : sans lui, un
                    // lecteur d'écran ne distingue pas le créneau retenu des
                    // autres (RGAA 7.1).
                    aria-pressed={choisi}
                    className={cn(
                      "w-full rounded-lg px-2 py-1.5 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                      choisi
                        ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2"
                        : "border border-border text-foreground hover:bg-secondary",
                    )}
                    onClick={() => {
                      onChoisir(iso);
                    }}
                  >
                    {heure.format(new Date(iso))}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
