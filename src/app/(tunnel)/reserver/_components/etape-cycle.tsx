"use client";

import { useId } from "react";

import { SelecteurCycle } from "@/components/features/cycles/selecteur-cycle";
import type { CycleClient } from "@/lib/db/queries/cycles";

/// Bloc « Vélo concerné » de l'écran **C5**, ajouté le 2026-08-16.
///
/// [[points-ouverts-hch]] §« Personne n'écrit `interventions.cycle_id` en v1 »
/// a été **clos le 2026-08-12** en désignant un seul écrivain : le client, depuis
/// le panneau de `/mes-interventions`, sur les rendez-vous `PLANNED`. Le
/// dictionnaire v2.4 en tire *« reste NULL sur toute intervention venue du
/// tunnel »*. Le sélecteur au tunnel était l'un des trois candidats de
/// l'amendement, et celui qui avait perdu.
///
/// Arbitrage Benjamin du 2026-08-16 : il est promu. Le motif tient en une ligne
/// du vault lui-même - trois US v1 font gérer une liste de vélos, et jusqu'ici
/// aucune intervention n'en désignait un au moment où le client y pense.
/// Write-back sur quatre artefacts, signalé en PR.
///
///  1. **Aucune maquette ne dessine ce bloc.** C5 est forfait, adresse, créneau
///     et panier. Même terrain que la lacune L5 de T-V3-16, même consigne : rien
///     d'inventé au-delà d'un sélecteur et de son état vide.
///  2. **Pas de création de vélo en ligne.** `US-CYCLE-AJOUTER` s'ouvre sur
///     *« Given je suis client authentifié sur `US-CYCLES-LISTER` »* : une
///     seconde surface de création serait un ajout de périmètre non instruit. Et
///     un lien vers `/mon-compte/cycles` ferait sortir du tunnel à
///     l'avant-dernier geste.
///
/// ⚠️ **L'état vide est le cas NORMAL à la première réservation**, pas un cas
/// limite : le seed ne pose aucun vélo (choix assumé de T-V3-16), et un client
/// qui vient de créer son compte au récapitulatif n'en a aucun. Le message le
/// dit sans culpabiliser ni bloquer - le rattachement reste facultatif.
export function EtapeCycle({
  cycles,
  cycleId,
  onChangement,
}: {
  cycles: readonly CycleClient[];
  cycleId: number | null;
  onChangement: (cycleId: number | null) => void;
}) {
  const idTitre = useId();

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2
          id={idTitre}
          className="font-heading text-xl font-bold tracking-[-0.01em]"
        >
          Vélo concerné{" "}
          <span className="text-sm font-normal text-muted-foreground">
            (facultatif)
          </span>
        </h2>
        <p className="text-sm leading-[1.5] text-muted-foreground">
          Le technicien saura lequel préparer. Vous pourrez en changer depuis
          votre espace tant que le rendez-vous n&apos;a pas commencé.
        </p>
      </div>

      {cycles.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Vous n&apos;avez pas encore enregistré de vélo. Vous pourrez en
          ajouter un et le rattacher à ce rendez-vous depuis « Mes vélos », une
          fois la réservation validée.
        </p>
      ) : (
        <SelecteurCycle
          idLibelle={idTitre}
          cycles={cycles}
          valeur={cycleId}
          onChangement={onChangement}
        />
      )}
    </section>
  );
}
