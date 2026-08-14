"use client";

import { Bike } from "lucide-react";
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";

import { rattacherCycle } from "@/lib/actions/cycles/rattacher-cycle";
import type { CycleClient } from "@/lib/db/queries/cycles";
import type { InterventionClient } from "@/lib/db/queries/interventions";
import { CHEMIN_CYCLES } from "@/lib/routes";
import { BadgeTypeCycle } from "@/components/features/cycles/badge-type-cycle";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

/// La valeur du détachement. Une chaîne sentinelle et non `""` : Radix traite
/// la chaîne vide comme « aucune option retenue », et le bouton « Aucun vélo »
/// ne pourrait alors jamais s'afficher coché.
const AUCUN = "aucun";

/// Bloc « Vélo concerné » du panneau de détail - le périmètre nouveau de
/// T-V3-16, et le **seul écrivain de `interventions.cycle_id` en v1**.
///
/// ── Une surface qu'aucune maquette ne dessine
///
/// C11 est la page « Mes vélos » ; le rattachement vit ici, dans le panneau de
/// détail de `/mes-interventions`, et **aucune maquette ne le porte** (L5). Rien
/// n'y est donc inventé au-delà d'un sélecteur de vélo et de son état vide :
/// pas de vignette, pas de suggestion, pas d'historique par vélo.
///
/// ── Le détachement fait partie du contrat
///
/// « Aucun vélo » est une entrée du sélecteur, pas un geste séparé. `cycle_id`
/// est NULLable et le rattachement est déclaré facultatif : sans détachement,
/// une erreur de désignation serait définitive, ce qui contredirait
/// « facultatif ».
///
/// ── Aucun état optimiste
///
/// Trois gardes serveur peuvent refuser (propriété de l'intervention, statut,
/// propriété du vélo), et la seconde est atteignable en usage normal : un
/// technicien peut démarrer le rendez-vous pendant que l'onglet est ouvert.
/// Peindre le choix avant la réponse obligerait à le reprendre sous les yeux du
/// client. Même arbitrage que `bloc-produits.tsx`.
export function BlocCycle({
  interventionId,
  cycle,
  cycles,
  modifiable,
}: {
  interventionId: number;
  cycle: InterventionClient["cycle"];
  /// Les vélos du client, lus par la page. Vide sur l'onglet des passées, où
  /// aucun rattachement n'est possible.
  cycles: readonly CycleClient[];
  modifiable: boolean;
}) {
  const [enCours, demarrer] = useTransition();
  const [refus, setRefus] = useState<string | null>(null);

  // Hors `PLANNED`, la ligne est une lecture. Et quand il n'y a rien à lire,
  // il n'y a pas de bloc : sur un rendez-vous terminé sans vélo désigné,
  // « Aucun vélo » n'apprendrait rien - le tunnel n'en demande aucun, c'est
  // l'état de toutes les interventions qui en viennent.
  if (!modifiable) {
    if (!cycle) return null;

    return (
      <section aria-labelledby="bloc-cycle" className="flex flex-col gap-3">
        <h3 id="bloc-cycle" className="text-base font-semibold">
          Vélo concerné
        </h3>
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {cycle.brand}
          {cycle.model ? ` ${cycle.model}` : ""}
          <BadgeTypeCycle type={cycle.type} />
        </p>
      </section>
    );
  }

  function choisir(cycleId: number | null) {
    setRefus(null);
    demarrer(async () => {
      const resultat = await rattacherCycle({ interventionId, cycleId });

      const donnees = resultat?.data;
      if (donnees && !donnees.ok) {
        setRefus(donnees.message);
        return;
      }

      if (resultat?.serverError) setRefus(resultat.serverError);
    });
  }

  return (
    <section aria-labelledby="bloc-cycle" className="flex flex-col gap-3">
      <h3 id="bloc-cycle" className="text-base font-semibold">
        Vélo concerné
      </h3>

      {cycles.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border p-4">
          <p className="text-sm text-muted-foreground">
            Vous n&apos;avez pas encore ajouté de cycle. Enregistrez-en un pour
            indiquer au technicien lequel est concerné.
          </p>
          <Button asChild variant="secondary" size="sm">
            <Link href={CHEMIN_CYCLES}>
              <Bike aria-hidden="true" />
              Ajouter un vélo
            </Link>
          </Button>
        </div>
      ) : (
        <RadioGroup
          aria-labelledby="bloc-cycle"
          // La valeur retenue vient du SERVEUR, jamais d'un état local : après
          // la revalidation, c'est `interventions.cycle_id` qui décide de ce
          // qui est coché, donc l'écran ne peut pas mentir sur ce qui est écrit.
          value={cycle === null ? AUCUN : String(cycle.id)}
          onValueChange={(valeur) => {
            choisir(valeur === AUCUN ? null : Number(valeur));
          }}
          disabled={enCours}
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          <Option valeur={AUCUN} id="cycle-aucun">
            <span className="text-sm font-medium">Aucun vélo</span>
          </Option>

          {cycles.map((candidat) => (
            <Option
              key={candidat.id}
              valeur={String(candidat.id)}
              id={`cycle-${String(candidat.id)}`}
            >
              <span className="min-w-0 text-sm font-medium">
                {candidat.brand}
                {candidat.model ? ` ${candidat.model}` : ""}
              </span>
              <BadgeTypeCycle type={candidat.type} />
            </Option>
          ))}
        </RadioGroup>
      )}

      {refus ? (
        <p role="alert" className="text-sm text-destructive">
          {refus}
        </p>
      ) : null}
    </section>
  );
}

function Option({
  valeur,
  id,
  children,
}: {
  valeur: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <Label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3 transition-colors",
        "hover:border-input",
        "has-[[aria-checked=true]]:border-primary has-[[aria-checked=true]]:bg-primary-fixed/20",
        "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
        "has-[:disabled]:opacity-60",
      )}
    >
      {/* Le bouton radio est masqué visuellement, la dalle entière lui sert
          d'étiquette. `aria-labelledby` pointe sur le libellé visible : Chrome
          ne calcule aucun nom accessible pour un `<button role="radio">`
          étiqueté par un `<label for>`, constaté au navigateur sur C2. */}
      <RadioGroupItem
        id={id}
        value={valeur}
        aria-labelledby={`${id}-libelle`}
        className="sr-only"
      />
      <span id={`${id}-libelle`} className="flex min-w-0 items-center gap-2">
        {children}
      </span>
    </Label>
  );
}
