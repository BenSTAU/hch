"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Clock } from "lucide-react";

import {
  listerTournee,
  type Tournee,
} from "@/lib/actions/interventions/lister-tournee";
import { formatDureeCumulee, formatJourLong } from "@/lib/format";
import { BoutonDemarrer } from "@/components/features/interventions/bouton-demarrer";
import { LigneTournee } from "@/components/features/interventions/ligne-tournee";
import { Badge } from "@/components/ui/badge";

import { CarteTournee } from "./carte-tournee";
import { ProchaineIntervention } from "./prochaine-intervention";

/// Tournée du jour - `US-INTERVENTIONS-LISTER-TECH-DU-JOUR`, écran **T1**.
///
/// Portés : le titre « Aujourd'hui - <jour> », les chips de synthèse, la colonne
/// de lignes horodatées à gauche, la carte à droite, l'étiquette de statut.
///
/// **Quatre éléments ne se portent pas**, et aucun n'est un oubli :
///
///  1. **Le CTA « Nouvelle Intervention »** de la barre latérale -
///     `US-INTERVENTION-CREER` est **v2 admin**, pas technicien.
///  2. **Le chip « 12 km au total (tournée optimisée) »** - il n'existe aucun
///     calcul d'itinéraire en v1 et aucune US n'en demande. Même famille que le
///     « Rejoint par plus de 500 cyclistes lyonnais » retiré de C1 : un chiffre
///     inventé qui décore.
///  3. **La cloche de notification et son badge « 2 »** - aucune table de
///     notifications n'existe, motif pour lequel la PR #39 a déjà retiré
///     « notif in-app » d'une US.
///  4. **« contactez la régulation au 04 11 22 33 44 »** - numéro inventé. Le
///     vrai contact de la société vit dans `app_settings` et le bloc
///     d'annulation de l'espace client le lit déjà ; il n'a pas sa place ici,
///     où la maquette l'accompagnait d'une notion de « régulation » qui ne
///     correspond à aucun rôle du produit.
///
/// ⚠️ **La barre latérale de T1 n'est plus « tombée », elle est portée** -
/// par `_components/barre-laterale.tsx`, depuis T-V2-05. Ce commentaire disait
/// jusque-là que « Cette semaine » et « Historique » étaient des US v2
/// explicites : les deux ont été **promues en v1 le 2026-08-12**, sur constat
/// de Benjamin en recettant cet écran. Trois de ses six entrées sont donc
/// posées ; les trois autres restent absentes, faute d'US.
///
/// Chaque ligne ouvre `/interventions/[id]` quel que soit son statut, et les
/// lignes `PLANNED` portent en plus le bouton « Démarrer ». Le motif complet
/// vit avec la ligne, dans
/// `components/features/interventions/ligne-tournee.tsx`.
///
/// ⚠️ C'est la **seule** des trois vues à passer une action : « Cette semaine »
/// ne montre que des rendez-vous à partir de demain, et « Historique » que des
/// statuts terminaux. Un bouton « Démarrer » sur l'intervention de jeudi
/// prochain n'aurait aucun sens terrain.
///
/// Rendu au serveur, passé en `initialData`, repollé toutes les 30 secondes :
/// l'administrateur peut modifier ou annuler une intervention pendant la
/// tournée (PLAN S1 §6.1, l'une des trois vues où TanStack Query est autorisé).

/// 30 secondes, pas 5 : le besoin métier ne réclame pas mieux et l'intervalle
/// long est un choix d'éco-conception (PLAN S1 §6.1).
const INTERVALLE_MS = 30_000;

export function TourneeVue({
  initialData,
  mapsApiKey,
}: {
  initialData: Tournee;
  /// `null` quand `HCH_MAPS_API_KEY` n'est pas renseignée. La carte ne se monte
  /// alors pas, et la liste ci-contre sert de repli - c'est le même chemin de
  /// code que lorsque le script Maps ne charge pas.
  mapsApiKey: string | null;
}) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["tournee-du-jour"],
    queryFn: async () => {
      // Server Action et non Route Handler : CLAUDE.md §Data fetching interdit
      // qu'un Client Component lise par Route Handler. Elle porte sa propre
      // garde de rôle - la garde de la page ne couvre pas cet appel.
      const resultat = await listerTournee();

      if (resultat?.serverError) throw new Error(resultat.serverError);

      const donnees = resultat?.data;
      if (!donnees) throw new Error("Réponse inattendue du serveur.");

      return donnees;
    },
    initialData,
    refetchInterval: INTERVALLE_MS,
    // Onglet en arrière-plan : on cesse d'interroger. Charge serveur, batterie
    // et bande passante - l'anti-patron de la convention axe 03 §12.
    refetchIntervalInBackground: false,
  });

  const { interventions } = data;

  // ⚠️ **Hors `CANCELLED`.** Sommer la durée d'une intervention annulée dans du
  // « travail estimé » serait faux, et c'est un total qu'on recalcule à la main
  // sur trois lignes.
  const minutes = interventions
    .filter((intervention) => intervention.status !== "CANCELLED")
    .reduce((somme, intervention) => somme + intervention.durationSnapshot, 0);

  const compte = interventions.length;

  return (
    <>
      <header className="flex flex-col gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-tighter text-primary md:text-4xl">
          {/* `first-letter:uppercase` plutôt qu'une capitale posée dans la
              chaîne : `Intl` rend « jeudi » en minuscule, et découper la chaîne
              casserait sur toute locale qui ne commence pas par le jour. */}
          Aujourd&apos;hui -{" "}
          <span className="first-letter:uppercase">
            {formatJourLong(new Date(data.debutJournee))}
          </span>
        </h1>

        <p className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="gap-1.5 py-1.5">
            <CalendarCheck aria-hidden="true" className="size-4" />
            {compte === 0
              ? "Aucune intervention"
              : `${String(compte)} intervention${compte > 1 ? "s" : ""}`}
          </Badge>

          {minutes > 0 && (
            <Badge variant="outline" className="gap-1.5 py-1.5">
              <Clock aria-hidden="true" className="size-4" />
              {formatDureeCumulee(minutes)} de travail estimé
            </Badge>
          )}
        </p>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row">
        <section
          aria-labelledby="titre-tournee"
          className="flex min-w-0 flex-1 flex-col gap-3"
        >
          <h2 id="titre-tournee" className="sr-only">
            Mes interventions du jour
          </h2>

          {interventions.length === 0 ? (
            // Message explicite, pas une liste vide : le libellé est celui de
            // l'US §Cas nominal.
            <p className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-muted-foreground">
              Aucune intervention prévue aujourd&apos;hui.
            </p>
          ) : (
            // `<ol>` et non `<ul>` : l'ordre chronologique EST l'information,
            // c'est la tournée dans l'ordre où elle se fait.
            <ol className="flex flex-col gap-3">
              {interventions.map((intervention) => (
                <LigneTournee
                  key={intervention.id}
                  intervention={intervention}
                  action={
                    // « Démarrer » si `PLANNED`, rien sinon (SPEC §Cas nominal).
                    // « Ouvrir détail » d'`IN_PROGRESS` est le lien de la carte,
                    // et les deux statuts terminaux sont en lecture seule.
                    intervention.status === "PLANNED" ? (
                      <BoutonDemarrer
                        interventionId={intervention.id}
                        taille="sm"
                        // La revalidation serveur de l'action ne touche pas le
                        // cache TanStack de cette vue : sans cette invalidation,
                        // la ligne resterait « Planifiée » jusqu'au prochain
                        // cycle de 30 secondes.
                        onDemarree={() => {
                          void queryClient.invalidateQueries({
                            queryKey: ["tournee-du-jour"],
                          });
                        }}
                      />
                    ) : null
                  }
                />
              ))}
            </ol>
          )}
        </section>

        {/* Colonne droite de T1 : la carte, puis la prochaine intervention.
            `sticky` parce qu'elle ne s'étire plus sur la liste - sur une
            tournée de dix rendez-vous, une colonne courte disparaîtrait au
            premier défilement. */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-24 lg:w-[26rem] lg:shrink-0 lg:self-start">
          <CarteTournee interventions={interventions} mapsApiKey={mapsApiKey} />
          <ProchaineIntervention interventions={interventions} />
        </div>
      </div>
    </>
  );
}
