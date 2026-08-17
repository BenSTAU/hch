import { CheckCircle2, CircleSlash, Clock3 } from "lucide-react";

import type { InterventionDetail } from "@/lib/db/queries/interventions";
import { formatHeure } from "@/lib/format";
import { BoutonDemarrer } from "@/components/features/interventions/bouton-demarrer";
import { EtiquetteStatut } from "@/components/features/interventions/ligne-tournee";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { ModaleCloture } from "./modale-cloture";

/// Bloc « Statut actuel » de la maquette **T2**, et hub d'actions de
/// `US-INTERVENTION-AFFICHER`.
///
/// La SPEC §Cas nominal donne trois jeux : `PLANNED` propose « Démarrer
/// intervention », `IN_PROGRESS` propose le dépôt de photos et la clôture,
/// `DONE` et `CANCELLED` sont en lecture seule.
///
/// ⚠️ **Le jeu d'`IN_PROGRESS` est incomplet, et c'est un écart assumé** : la
/// clôture arrive avec T-V2-03, « Déposer des photos » est
/// `US-INTERVENTION-PHOTOS-DEPOSER` et n'est pas livrée. Le bouton
/// manquant n'est pas posé désactivé : ce serait le bouton inerte que la DoD
/// interdit nommément, et c'est le raisonnement qui avait déjà laissé les
/// lignes de T-V2-01 non cliquables tant que cette route-ci n'existait pas.
///
/// Le jalon daté reste affiché **sous** l'action, et il vient de la maquette
/// elle-même (« Intervention démarrée à 13:32 »). Un écran qui dit où il en est
/// renseigne, et l'heure de démarrage est ce que le technicien relit au moment
/// de clôturer.
///
/// « Arrivée prévue entre 13:30 et 13:40 » suppose une fenêtre d'arrivée de dix
/// minutes qui n'existe dans aucune US, aucun champ et aucun calcul : chiffre
/// inventé, même famille que le « 12 km au total » retiré de T1. Et la
/// référence « #INT-2026-1042 » est un format inventé, quand l'identifiant réel
/// est le SERIAL déjà présent dans l'URL.
export function HubStatut({
  intervention,
}: {
  intervention: InterventionDetail;
}) {
  return (
    <Card
      className={cn(
        "gap-0 py-0",
        // Le bloc est en primary plein dans T2 sur le statut d'ARRIVÉE, celui
        // où le technicien ouvre l'écran en descendant de vélo. `IN_PROGRESS`
        // porte désormais une action lui aussi, et reste pourtant neutre :
        // l'aplat primary y mettrait un bouton primary sur fond primary, et
        // T4 traite déjà l'emphase de la clôture dans sa propre modale. Sur
        // `DONE` et `CANCELLED`, plus rien n'attend.
        intervention.status === "PLANNED" &&
          "border-primary bg-primary text-primary-foreground",
      )}
    >
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[0.6875rem] font-bold tracking-[0.08em] uppercase">
            Statut actuel
          </h2>
          <EtiquetteStatut statut={intervention.status} />
        </div>

        <CorpsStatut intervention={intervention} />
      </CardContent>
    </Card>
  );
}

/// Le corps du bloc, statut par statut.
///
/// `switch` sur les quatre valeurs plutôt qu'une cascade de ternaires : un
/// statut ajouté au CHECK SQL sans branche ici tombe sur le repli, qui ne ment
/// pas et ne propose rien.
function CorpsStatut({ intervention }: { intervention: InterventionDetail }) {
  switch (intervention.status) {
    case "PLANNED":
      return (
        <>
          <p className="text-sm">
            Rendez-vous à {formatHeure(intervention.appointmentAt)}. Démarrez
            l&apos;intervention une fois sur place.
          </p>
          <BoutonDemarrer interventionId={intervention.id} />
        </>
      );

    case "IN_PROGRESS":
      return (
        <>
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Clock3 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              {/* `startedAt` est renseigné par la transition. Le repli couvre
                  les lignes passées en `IN_PROGRESS` autrement que par cette
                  action - une correction en base, un jeu de test - plutôt que
                  d'afficher « démarrée à Invalid Date ». */}
              {intervention.startedAt
                ? `Intervention démarrée à ${formatHeure(intervention.startedAt)}.`
                : "Intervention en cours."}
            </span>
          </p>

          {/* Le total descend en prop, il n'est pas re-dérivé par la modale
              (cadrage du plancher V2, D9) : `projeterDetail` le calcule déjà,
              forfait plus la somme des `unit_price_snapshot × quantité`. */}
          <ModaleCloture
            interventionId={intervention.id}
            total={intervention.total}
          />
        </>
      );

    case "DONE":
      return (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>Intervention terminée.</span>
        </p>
      );

    case "CANCELLED":
      return (
        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <CircleSlash aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <div className="flex flex-col gap-1">
            <span>Intervention annulée.</span>
            {/* Le motif est le seul contenu utile d'une ligne annulée, et il est
                saisi par le client (`US-INTERVENTION-ANNULER-CLIENT`, motif
                obligatoire). Il aide le technicien à comprendre sa journée. */}
            {intervention.cancellationReason ? (
              <span className="text-foreground">
                Motif : {intervention.cancellationReason}
              </span>
            ) : null}
          </div>
        </div>
      );

    default:
      return (
        <p className="text-sm text-muted-foreground">
          Statut inconnu : aucune action disponible.
        </p>
      );
  }
}
