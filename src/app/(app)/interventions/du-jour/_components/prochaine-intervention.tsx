import { Clock } from "lucide-react";

import type { InterventionTournee } from "@/lib/db/queries/interventions";
import { formatHeure } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";

/// Bloc « À VENIR » de la maquette **T1**, colonne droite sous la carte.
///
/// ── Ce qui est porté, et ce qui ne l'est pas
///
/// La carte sombre de T1 porte l'heure, le nom du client, le forfait et la
/// ville de la prochaine intervention, plus un bouton jaune « Préparer ma
/// prochaine intervention ». **Le bouton ne se porte pas** : il mènerait au
/// détail de l'intervention, route `/interventions/[id]` qui arrive avec
/// T-V2-02. Un appel à l'action vers un 404 est le lien mort que la leçon
/// `T-T2-16` d'Argo proscrit, et c'est le même motif qui garde les lignes de la
/// liste non cliquables. Il revient avec la route.
///
/// ── « Prochaine » se déduit du STATUT, jamais de l'horloge
///
/// La liste est déjà triée chronologiquement : la prochaine est donc la
/// première `PLANNED`. Se fier à `Date.now()` ici produirait une divergence
/// d'hydratation - le serveur et le navigateur ne lisent pas la même horloge -
/// sur un composant que le polling de 30 s re-rend en permanence. C'est le
/// défaut payé sur le stepper du tunnel (PR #29 note 8).
///
/// Une intervention `IN_PROGRESS` n'est pas « à venir » : elle est en cours, et
/// la ligne cerclée de la liste la désigne déjà.
export function ProchaineIntervention({
  interventions,
}: {
  interventions: readonly InterventionTournee[];
}) {
  const prochaine = interventions.find(
    (intervention) => intervention.status === "PLANNED",
  );

  // Journée finie, ou entièrement annulée : rien à annoncer. Un bloc « aucune
  // prochaine intervention » redirait ce que la liste montre déjà.
  if (!prochaine) return null;

  return (
    <Card className="border-0 bg-primary text-primary-foreground">
      <CardContent className="flex flex-col gap-1">
        <p className="flex items-center gap-1.5 text-xs font-bold tracking-[0.06em] text-primary-fixed uppercase">
          <Clock aria-hidden="true" className="size-4" />À venir ·{" "}
          <time dateTime={prochaine.appointmentAt}>
            {formatHeure(new Date(prochaine.appointmentAt))}
          </time>
        </p>

        {/* `h3` : la page porte un `h1`, la section de la tournée son `h2`. */}
        <h3 className="font-heading text-xl font-extrabold tracking-tighter">
          {prochaine.client.nom}
        </h3>

        <p className="text-sm text-primary-foreground/80">
          {prochaine.forfait} · {prochaine.adresse.city}
        </p>
      </CardContent>
    </Card>
  );
}
