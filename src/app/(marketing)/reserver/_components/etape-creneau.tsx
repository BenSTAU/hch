"use client";

import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { listerCreneaux } from "@/lib/actions/interventions/lister-creneaux";
import { cn } from "@/lib/utils";

/// Étape 3 du tunnel — écran **C4**.
///
/// La grille se **dérive à la volée** : aucun créneau n'est stocké
/// (Constitution §2.1). Elle se rafraîchit toutes les 30 secondes parce qu'un
/// autre visiteur peut prendre le créneau qu'on regarde — c'est l'une des trois
/// vues où TanStack Query est autorisé (PLAN S1 §6.1).
///
/// Divergence de maquette assumée : C4 affichait un calendrier condensé dont
/// les créneaux n'étaient pas rattachés visuellement à leur jour. Porté en
/// grille par jour, comme le prescrit §Notes portage.

/// 30 secondes, pas 5 : le besoin métier ne réclame pas mieux et l'intervalle
/// long est un choix d'éco-conception (PLAN S1 §6.1).
const INTERVALLE_MS = 30_000;

type EtapeCreneauProps = {
  serviceId: number;
  zoneId: number;
  creneauChoisi: string | null;
  onChoisir: (debutIso: string) => void;
};

function grouperParJour(creneaux: string[]): Map<string, string[]> {
  const parJour = new Map<string, string[]>();

  for (const iso of creneaux) {
    // Clé de regroupement dans le fuseau du NAVIGATEUR, conformément à
    // PLAN S2 T5 : la base est en UTC, l'affichage suit le lecteur.
    const jour = new Intl.DateTimeFormat("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date(iso));

    const existants = parJour.get(jour);
    if (existants) existants.push(iso);
    else parJour.set(jour, [iso]);
  }

  return parJour;
}

const heure = new Intl.DateTimeFormat("fr-FR", { timeStyle: "short" });

export function EtapeCreneau({
  serviceId,
  zoneId,
  creneauChoisi,
  onChoisir,
}: EtapeCreneauProps) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["creneaux", serviceId, zoneId],
    queryFn: async () => {
      // La `queryFn` appelle une **Server Action**, pas un Route Handler :
      // CLAUDE.md §Data fetching interdit qu'un Client Component lise par
      // Route Handler.
      const resultat = await listerCreneaux({ serviceId, zoneId });

      if (resultat?.serverError) throw new Error(resultat.serverError);

      const donnees = resultat?.data;
      if (!donnees) throw new Error("Réponse inattendue du serveur.");
      if (!donnees.ok) throw new Error(donnees.message);

      return donnees.creneaux;
    },
    refetchInterval: INTERVALLE_MS,
    // Onglet en arrière-plan : on cesse d'interroger. Charge serveur, batterie
    // et bande passante — l'anti-patron nommé par la convention axe 03 §12.
    refetchIntervalInBackground: false,
  });

  if (isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Recherche des créneaux disponibles…
      </p>
    );
  }

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error instanceof Error
          ? error.message
          : "Impossible de charger les créneaux — réessayez."}
      </p>
    );
  }

  if (data.length === 0) {
    // Message explicite et non une grille vide : `US-INTERVENTION-RESERVER`
    // le nomme pour l'horizon de 30 jours.
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Aucun créneau disponible dans les 30 prochains jours.
      </p>
    );
  }

  const parJour = grouperParJour(data);

  return (
    <div className="flex flex-col gap-6">
      {[...parJour.entries()].map(([jour, creneaux]) => (
        <section key={jour} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold capitalize">{jour}</h3>
          <ul className="flex flex-wrap gap-2">
            {creneaux.map((iso) => {
              const choisi = iso === creneauChoisi;
              return (
                <li key={iso}>
                  <Button
                    type="button"
                    variant={choisi ? "default" : "outline"}
                    // `aria-pressed` et non une simple classe : sans lui, un
                    // lecteur d'écran ne distingue pas le créneau retenu des
                    // autres (RGAA 7.1).
                    aria-pressed={choisi}
                    className={cn("rounded-xl", choisi && "ring-2")}
                    onClick={() => {
                      onChoisir(iso);
                    }}
                  >
                    {heure.format(new Date(iso))}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
