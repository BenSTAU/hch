"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CalendarCheck,
  Clock,
  MapPin,
  Package,
  Phone,
  User,
} from "lucide-react";

import {
  listerTournee,
  type Tournee,
} from "@/lib/actions/interventions/lister-tournee";
import type { InterventionTournee } from "@/lib/db/queries/interventions";
import {
  formatDuree,
  formatDureeCumulee,
  formatHeure,
  formatJourLong,
} from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { CarteTournee } from "./carte-tournee";

/// Tournée du jour — `US-INTERVENTIONS-LISTER-TECH-DU-JOUR`, écran **T1**.
///
/// ── Ce qui se porte de la maquette, et ce qui saute
///
/// Portés : le titre « Aujourd'hui — <jour> », les chips de synthèse, la colonne
/// de lignes horodatées à gauche, la carte à droite, l'étiquette de statut.
///
/// **Quatre éléments ne se portent pas**, et aucun n'est un oubli :
///
///  1. **Le CTA « Nouvelle Intervention »** de la barre latérale —
///     `US-INTERVENTION-CREER` est **v2 admin**, pas technicien.
///  2. **Le chip « 12 km au total (tournée optimisée) »** — il n'existe aucun
///     calcul d'itinéraire en v1 et aucune US n'en demande. Même famille que le
///     « Rejoint par plus de 500 cyclistes lyonnais » retiré de C1 : un chiffre
///     inventé qui décore.
///  3. **La cloche de notification et son badge « 2 »** — aucune table de
///     notifications n'existe, motif pour lequel la PR #39 a déjà retiré
///     « notif in-app » d'une US.
///  4. **« contactez la régulation au 04 11 22 33 44 »** — numéro inventé. Le
///     vrai contact de la société vit dans `app_settings` et le bloc
///     d'annulation de l'espace client le lit déjà ; il n'a pas sa place ici,
///     où la maquette l'accompagnait d'une notion de « régulation » qui ne
///     correspond à aucun rôle du produit.
///
/// La barre latérale à six entrées (Aujourd'hui, Cette semaine, Historique, Ma
/// zone, Profil, Aide) tombe pour la même raison que celle de l'espace client :
/// **cinq n'ont aucune route**, et « Cette semaine » comme « Historique » sont
/// des US v2 explicites. Une seule vue existe, une barre à une entrée ne dit
/// rien — le titre de la page porte la navigation.
///
/// ── Les lignes ne sont pas cliquables, et c'est délibéré
///
/// La route de détail `/interventions/[id]` appartient à **T-V2-02**. Poser dès
/// maintenant un lien vers elle produirait une tournée dont chaque ligne mène à
/// un 404 tant que cette tâche n'a pas atterri — exactement le lien mort que la
/// leçon T-T2-16 d'Argo proscrit, et que la barre latérale de l'espace client
/// évite déjà nommément. Le cadrage du plancher V2 écrivait « T-V2-01 navigue » ;
/// Benjamin l'a corrigé le 2026-08-12, avant écriture : T-V2-02 rendra les
/// lignes cliquables **en même temps** qu'elle posera leur action contextuelle
/// (« Démarrer » si `PLANNED`, « Ouvrir détail » si `IN_PROGRESS`), une DoD
/// entière au lieu de deux moitiés.
///
/// ── Le rafraîchissement
///
/// Rendu au serveur, passé en `initialData`, repollé toutes les 30 secondes :
/// l'administrateur peut modifier ou annuler une intervention pendant la
/// tournée (PLAN S1 §6.1, l'une des trois vues où TanStack Query est autorisé).

/// 30 secondes, pas 5 : le besoin métier ne réclame pas mieux et l'intervalle
/// long est un choix d'éco-conception (PLAN S1 §6.1).
const INTERVALLE_MS = 30_000;

/// Libellés et teinte des quatre statuts.
///
/// Les quatre sont présents, y compris les terminaux : la SPEC §Cas nominal
/// exige que `DONE` et `CANCELLED` restent affichés en fin de journée, pour la
/// traçabilité de la tournée. C'est la règle inverse de l'espace client, dont
/// les deux onglets se partagent les statuts.
const STATUTS: Record<string, { label: string; classe: string }> = {
  PLANNED: { label: "Planifiée", classe: "bg-primary-fixed text-primary" },
  IN_PROGRESS: {
    label: "En cours",
    classe: "bg-tertiary-fixed text-foreground",
  },
  DONE: { label: "Terminée", classe: "bg-primary-fixed text-primary" },
  CANCELLED: { label: "Annulée", classe: "bg-destructive/10 text-destructive" },
};

function EtiquetteStatut({ statut }: { statut: string }) {
  const connu = STATUTS[statut];
  // Un statut inconnu s'affiche tel quel plutôt que de disparaître : c'est le
  // symptôme d'une divergence entre le CHECK SQL et cette table, et le masquer
  // la rendrait invisible jusqu'au support. Même choix que l'espace client.
  return (
    <Badge variant="secondary" className={connu?.classe}>
      {connu?.label ?? statut}
    </Badge>
  );
}

/// Fin théorique du rendez-vous — début plus la durée FIGÉE à la réservation.
///
/// `durationSnapshot` et non `services.duration` : un changement de catalogue ne
/// déplace pas la fin d'un rendez-vous déjà pris (Constitution §4.1). C'est
/// aussi la valeur qui alimente la contrainte anti-chevauchement.
function heureFin(intervention: InterventionTournee): string {
  const debut = new Date(intervention.appointmentAt);
  return formatHeure(
    new Date(debut.getTime() + intervention.durationSnapshot * 60_000),
  );
}

function LigneIntervention({
  intervention,
}: {
  intervention: InterventionTournee;
}) {
  const debut = new Date(intervention.appointmentAt);
  const annulee = intervention.status === "CANCELLED";

  return (
    <li
      className={cn(
        "flex gap-4 rounded-2xl border border-border bg-card p-4",
        // L'annulée reste lisible mais recule : elle est là pour la traçabilité
        // de la journée, pas pour être exécutée.
        annulee && "opacity-60",
      )}
    >
      {/* Colonne horaire. `<time>` porte la valeur machine, que l'heure
          affichée ne donne pas — un lecteur d'écran et un moteur d'indexation
          lisent la même chose que l'œil. */}
      <div className="flex w-16 shrink-0 flex-col items-end pt-0.5 text-right">
        <time
          dateTime={intervention.appointmentAt}
          className="font-heading text-lg font-bold tracking-tighter"
        >
          {formatHeure(debut)}
        </time>
        <span className="text-sm text-muted-foreground">
          {heureFin(intervention)}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <EtiquetteStatut statut={intervention.status} />
          <span className="text-sm text-muted-foreground">
            {formatDuree(intervention.durationSnapshot)}
          </span>
        </div>

        {/* Le forfait est le titre de la ligne. `h3` : la page porte un `h1`,
            la section « Tournée » un `h2`. */}
        <h3 className="font-heading text-base font-bold text-foreground">
          {intervention.forfait}
        </h3>

        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <User aria-hidden="true" className="size-4 text-muted-foreground" />
            {/* Nom COMPLET : le technicien sonne chez cette personne
                (Constitution §1.1). `abregerNom` joue dans l'autre sens. */}
            {intervention.client.nom}
          </span>

          <span className="inline-flex items-center gap-1.5">
            <Phone
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
            {intervention.client.telephone ? (
              // `tel:` — le technicien est sur le terrain, souvent au téléphone.
              <a
                href={`tel:${intervention.client.telephone}`}
                className="underline underline-offset-2 hover:text-primary"
              >
                {intervention.client.telephone}
              </a>
            ) : (
              // Compte pseudonymisé : `users.phone` est remis à NULL par le
              // droit à l'oubli, et l'intervention lui survit (Constitution
              // §4.1). Une mention neutre plutôt qu'un vide inexplicable.
              <span className="text-muted-foreground">
                Téléphone non renseigné
              </span>
            )}
          </span>
        </p>

        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {/* Adresse COMPLÈTE, pas la seule ville : le technicien s'y rend. */}
          <span>
            {intervention.adresse.street}, {intervention.adresse.zipCode}{" "}
            {intervention.adresse.city}
          </span>
        </p>

        {intervention.produits.length > 0 && (
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <Package aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              {intervention.produits
                .map(
                  (produit) =>
                    `${produit.label}${produit.quantity > 1 ? ` × ${String(produit.quantity)}` : ""}`,
                )
                .join(" · ")}
            </span>
          </p>
        )}
      </div>
    </li>
  );
}

export function TourneeVue({
  initialData,
  mapsApiKey,
}: {
  initialData: Tournee;
  /// `null` quand `HCH_MAPS_API_KEY` n'est pas renseignée. La carte ne se monte
  /// alors pas, et la liste ci-contre sert de repli — c'est le même chemin de
  /// code que lorsque le script Maps ne charge pas.
  mapsApiKey: string | null;
}) {
  const { data } = useQuery({
    queryKey: ["tournee-du-jour"],
    queryFn: async () => {
      // Server Action et non Route Handler : CLAUDE.md §Data fetching interdit
      // qu'un Client Component lise par Route Handler. Elle porte sa propre
      // garde de rôle — la garde de la page ne couvre pas cet appel.
      const resultat = await listerTournee();

      if (resultat?.serverError) throw new Error(resultat.serverError);

      const donnees = resultat?.data;
      if (!donnees) throw new Error("Réponse inattendue du serveur.");

      return donnees;
    },
    initialData,
    refetchInterval: INTERVALLE_MS,
    // Onglet en arrière-plan : on cesse d'interroger. Charge serveur, batterie
    // et bande passante — l'anti-patron de la convention axe 03 §12.
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
          Aujourd&apos;hui —{" "}
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
                <LigneIntervention
                  key={intervention.id}
                  intervention={intervention}
                />
              ))}
            </ol>
          )}
        </section>

        <CarteTournee interventions={interventions} mapsApiKey={mapsApiKey} />
      </div>
    </>
  );
}
