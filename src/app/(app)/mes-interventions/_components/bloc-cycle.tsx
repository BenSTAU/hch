"use client";

import { Bike } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { rattacherCycle } from "@/lib/actions/cycles/rattacher-cycle";
import type { CycleClient } from "@/lib/db/queries/cycles";
import type { InterventionClient } from "@/lib/db/queries/interventions";
import { CHEMIN_CYCLES } from "@/lib/routes";
import { BadgeTypeCycle } from "@/components/features/cycles/badge-type-cycle";
import { SelecteurCycle } from "@/components/features/cycles/selecteur-cycle";
import { Button } from "@/components/ui/button";

/// Bloc « Vélo concerné » du panneau de détail - le périmètre nouveau de
/// T-V3-16, et le **premier écrivain de `interventions.cycle_id`**.
///
/// ⚠️ **Plus le seul depuis le 2026-08-16** : l'écran C5 du tunnel en désigne
/// un à la réservation. Le sélecteur commun vit dans
/// `components/features/cycles/selecteur-cycle.tsx` ; ce qui reste ici est le
/// câblage de la mutation T+n et la branche de lecture seule.
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
  // « Aucun vélo » n'apprendrait rien - le rattachement est facultatif sur les
  // deux surfaces qui l'écrivent, donc l'absence est un état nominal.
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
        <SelecteurCycle
          idLibelle="bloc-cycle"
          cycles={cycles}
          // La valeur retenue vient du SERVEUR, jamais d'un état local : après
          // la revalidation, c'est `interventions.cycle_id` qui décide de ce
          // qui est coché, donc l'écran ne peut pas mentir sur ce qui est écrit.
          // C'est ce qui distingue cet appelant du tunnel, où rien n'est encore
          // écrit et où la valeur ne peut venir que de l'état local.
          valeur={cycle?.id ?? null}
          onChangement={choisir}
          disabled={enCours}
        />
      )}

      {refus ? (
        <p role="alert" className="text-sm text-destructive">
          {refus}
        </p>
      ) : null}
    </section>
  );
}
