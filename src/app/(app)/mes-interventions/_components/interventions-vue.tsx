"use client";

import { CalendarClock, MapPin, User, Wrench } from "lucide-react";
import Link from "next/link";
import { parseAsInteger, useQueryState } from "nuqs";

import type { CycleClient } from "@/lib/db/queries/cycles";
import type { InterventionClient } from "@/lib/db/queries/interventions";
import type { ProduitVendable } from "@/lib/db/queries/produits";
import {
  formatDateCourte,
  formatDateLongue,
  formatDelaiRelatif,
  formatDuree,
  formatPrixEuros,
} from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { BlocAnnulation, type ContactSociete } from "./bloc-annulation";
import { BlocCycle } from "./bloc-cycle";
import { BlocPhotos } from "./bloc-photos";
import { BlocProduits } from "./bloc-produits";

/// Liste et panneau de détail - cœur de **C8**, réutilisé par **C10**.
///
/// ── Un seul composant pour les deux onglets
///
/// L'US des passées demande que « chaque ligne soit cliquable et ouvre un récap
/// sommaire » ; celle des à-venir, qu'elle « ouvre le détail avec les actions
/// autorisées ». C'est le même panneau : ce qui change est la présence des
/// blocs de mutation, gouvernée par le statut et non par l'onglet. Un second
/// composant aurait dupliqué le récapitulatif, donc laissé deux vérités sur le
/// calcul du total.
///
/// ── La sélection vit dans l'URL
///
/// `?intervention=<id>` via `nuqs`, comme CLAUDE.md §State l'impose pour tout ce
/// qui doit être partageable. Un état local rendrait le panneau impossible à
/// envoyer par lien et perdrait la sélection au retour arrière.
///
/// ⚠️ Un identifiant inconnu **ne produit aucune erreur** : la vue retombe sur
/// la première intervention. `interventions.id` est un `SERIAL`, donc
/// énumérable, et un message « intervention introuvable » distinct du cas
/// nominal confirmerait l'existence du rendez-vous d'un tiers à qui incrémente.
/// Même régime que les deux mutations produits et que la route de lecture des
/// photos.
export function InterventionsVue({
  interventions,
  produits,
  cycles,
  contact,
  maintenant,
  vide,
}: {
  interventions: readonly InterventionClient[];
  /// Catalogue vendable, pour le bloc T+n du panneau. Vide sur l'onglet des
  /// passées, où aucune ligne n'est modifiable.
  produits: readonly ProduitVendable[];
  /// Les vélos du client, pour le sélecteur de rattachement du panneau. Vide
  /// sur l'onglet des passées, pour la même raison que le catalogue.
  cycles: readonly CycleClient[];
  /// Coordonnées de l'atelier, affichées par le bloc d'annulation quand la
  /// fenêtre H-24 est dépassée (`US-INTERVENTION-ANNULER-CLIENT` §Cas d'erreur).
  contact: ContactSociete;
  /// Horloge du **rendu serveur**, descendue en prop plutôt que lue ici.
  ///
  /// Deux surfaces en dépendent, le chip « Dans X jours » et la fenêtre
  /// d'annulation, et toutes deux sont rendues au serveur puis hydratées. Un
  /// `new Date()` au rendu produirait deux valeurs, donc potentiellement deux
  /// résultats : c'est la divergence d'hydratation payée sur le stepper du
  /// tunnel (PR #29 note 8).
  maintenant: Date;
  vide: { message: string; href: string; libelle: string };
}) {
  const [selection, setSelection] = useQueryState(
    "intervention",
    parseAsInteger,
  );

  // Une seule garde pour deux cas qui n'en font qu'un : pas de sélection
  // possible **parce que** la liste est vide. Tester `length === 0` puis
  // `interventions[0]` séparément produirait une seconde branche que rien ne
  // peut atteindre (`noUncheckedIndexedAccess` la réclame pourtant), donc du
  // code mort à relire.
  const courante =
    interventions.find((intervention) => intervention.id === selection) ??
    interventions.at(0);

  if (!courante) {
    return (
      <section className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground">{vide.message}</p>
        <Button asChild>
          <Link href={vide.href}>{vide.libelle}</Link>
        </Button>
      </section>
    );
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      {/* `<ul>` de boutons et non de liens : la sélection ne change pas de
          page, elle change un paramètre. Un lien annoncerait une navigation qui
          n'a pas lieu. */}
      <ul className="flex flex-col gap-3">
        {interventions.map((intervention) => (
          <li key={intervention.id}>
            <CarteIntervention
              intervention={intervention}
              courante={intervention.id === courante.id}
              maintenant={maintenant}
              onChoisir={() => {
                void setSelection(intervention.id);
              }}
            />
          </li>
        ))}
      </ul>

      <PanneauDetail
        intervention={courante}
        produits={produits}
        cycles={cycles}
        contact={contact}
        maintenant={maintenant}
      />
    </div>
  );
}

/// Libellés et teinte des quatre statuts.
///
/// `PLANNED` seul en v1 côté « à venir », `DONE` et `CANCELLED` côté historique.
/// `IN_PROGRESS` y figure parce que le statut existe en base et qu'un rendez-vous
/// démarré reste visible : l'omettre afficherait une carte sans étiquette.
/// `CONFIRMED` n'existe pas en v1 (basculé v2 le 2026-07-06).
const STATUTS: Record<string, { label: string; classe: string }> = {
  PLANNED: { label: "Planifiée", classe: "bg-primary-fixed text-primary" },
  IN_PROGRESS: {
    label: "En cours",
    classe: "bg-tertiary-fixed text-foreground",
  },
  DONE: { label: "Terminée", classe: "bg-primary-fixed text-primary" },
  CANCELLED: { label: "Annulée", classe: "bg-destructive/10 text-destructive" },
};

/// Une intervention annulée ne porte aucun montant, nulle part.
///
/// La règle vaut pour la carte de liste **et** pour le panneau : c'est le même
/// arbitrage, et la scinder en deux tests de statut laisserait la moitié
/// dériver. Le motif d'annulation prend la place du chiffre, comme l'US
/// l'indexe.
function estAnnulee(intervention: InterventionClient): boolean {
  return intervention.status === "CANCELLED";
}

function EtiquetteStatut({ statut }: { statut: string }) {
  const connu = STATUTS[statut];
  // Un statut inconnu s'affiche tel quel plutôt que de disparaître : c'est le
  // symptôme d'une divergence entre le CHECK SQL et cette table, et le masquer
  // la rendrait invisible jusqu'au support.
  return (
    <Badge variant="secondary" className={connu?.classe}>
      {connu?.label ?? statut}
    </Badge>
  );
}

function CarteIntervention({
  intervention,
  courante,
  maintenant,
  onChoisir,
}: {
  intervention: InterventionClient;
  courante: boolean;
  maintenant: Date;
  onChoisir: () => void;
}) {
  // Chip « Dans X jours » de C8, absent de la maquette portée par T-V3-10
  // (§Notes portage). `null` sur une date passée : l'onglet « À venir » retient
  // `PLANNED` sans borne de date, et « Dans -2 jours » ne veut rien dire.
  const delai = formatDelaiRelatif(intervention.appointmentAt, maintenant);

  return (
    <button
      type="button"
      onClick={onChoisir}
      // `aria-current` porte la sélection : deux cartes ne peuvent pas être
      // courantes, et un lecteur d'écran annonce laquelle l'est.
      aria-current={courante ? "true" : undefined}
      className={cn(
        "flex w-full flex-col gap-2 rounded-2xl border p-4 text-left transition-colors",
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        courante
          ? "border-primary bg-primary-fixed/20"
          : "border-border bg-card hover:border-input",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <EtiquetteStatut statut={intervention.status} />
        {/* Même règle que le récapitulatif du panneau : rien de chiffré sur une
            annulée. La carte est la surface la plus lue des deux.

            Et **le même montant** que lui : la carte n'a pas la place d'un
            libellé, donc rien n'y distingue un total d'un encaissement. Si les
            deux surfaces affichaient des chiffres différents pour la même
            ligne, celle qui ne s'explique pas serait crue. Le technicien peut
            ajuster ce qu'il encaisse (Constitution §2.3), l'écart est donc
            réel et pas théorique. */}
        {estAnnulee(intervention) ? null : (
          <span className="font-heading text-lg font-bold tracking-tighter">
            {formatPrixEuros(intervention.montantPaye ?? intervention.total)}
          </span>
        )}
      </div>

      <span className="flex flex-wrap items-center gap-2">
        <span className="font-heading text-base font-bold">
          {formatDateCourte(intervention.appointmentAt)}
        </span>
        {/* Le chip ne se montre que sur une intervention encore à venir : sur
            une annulée ou une terminée de l'onglet « Passées », un délai
            relatif décrirait un rendez-vous qui n'aura pas lieu. */}
        {delai && intervention.status === "PLANNED" ? (
          <Badge variant="outline">{delai}</Badge>
        ) : null}
      </span>

      <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <User aria-hidden="true" className="size-4" />
          {intervention.technicien}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MapPin aria-hidden="true" className="size-4" />
          {intervention.adresse.city}
        </span>
      </span>
    </button>
  );
}

/// Panneau de détail - la surface où T-V3-09 et T-V3-11 viennent se poser.
///
/// ── Ce qui n'est pas porté de C8
///
///   · **« Réf: INT-2026-0847 »** : `interventions.id` est un `SERIAL`, ce
///     format de référence n'existe nulle part au modèle et l'inventer
///     obligerait à le rendre stable ;
///   · **la note « ☆ 4.9/5 »** du technicien : aucune notation au dictionnaire,
///     et aucune US v1 n'en crée ;
///   · **« Voir le récapitulatif complet »** : la note SPEC de
///     `US-INTERVENTIONS-LISTER-CLIENT-PASSEES` renvoie le détail complet en v2.
///
/// Le **bloc d'annulation** y figurait comme non porté jusqu'à T-V3-11, qui le
/// monte ci-dessous.
function PanneauDetail({
  intervention,
  produits,
  cycles,
  contact,
  maintenant,
}: {
  intervention: InterventionClient;
  produits: readonly ProduitVendable[];
  cycles: readonly CycleClient[];
  contact: ContactSociete;
  maintenant: Date;
}) {
  // Le statut décide, pas l'onglet : c'est la même règle que celle des trois
  // mutations côté serveur (`STATUT_MODIFIABLE`), et la faire dépendre de la
  // route donnerait un écran qui propose ce que l'action refusera.
  const modifiable = intervention.status === "PLANNED";
  const chiffre = !estAnnulee(intervention);
  const produitsTotal = intervention.produits.reduce(
    (somme, ligne) => somme + Number(ligne.unitPriceSnapshot) * ligne.quantity,
    0,
  );

  return (
    <section
      // La région est nommée par son titre : le panneau change de contenu sans
      // changer de page, et un repère anonyme obligerait à le parcourir pour
      // savoir ce qu'il porte.
      aria-labelledby="detail-intervention"
      className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-5 md:p-8"
    >
      <div className="flex flex-col gap-3">
        <EtiquetteStatut statut={intervention.status} />
        <h2
          id="detail-intervention"
          className="font-heading text-2xl font-extrabold tracking-tighter"
        >
          {formatDateLongue(intervention.appointmentAt)}
        </h2>
      </div>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Ligne Icone={MapPin} intitule="Lieu d'intervention">
          {intervention.adresse.label ? `${intervention.adresse.label}, ` : ""}
          {intervention.adresse.street}
          <br />
          {intervention.adresse.zipCode} {intervention.adresse.city}
        </Ligne>

        <Ligne Icone={User} intitule="Technicien assigné">
          {intervention.technicien}
        </Ligne>

        <Ligne Icone={Wrench} intitule="Forfait">
          {intervention.forfait}
        </Ligne>

        <Ligne Icone={CalendarClock} intitule="Durée prévue">
          {formatDuree(intervention.durationSnapshot)}
        </Ligne>
      </dl>

      {/* `cancellation_reason` : exigé par l'US des passées sur toute ligne
          `CANCELLED`. Il n'est jamais renseigné sur une autre. */}
      {intervention.cancellationReason ? (
        <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Motif de l&apos;annulation : {intervention.cancellationReason}
        </p>
      ) : null}

      {/* Placé AVANT les produits et les photos : il désigne l'objet de
          l'intervention, quand les deux autres décrivent ce qui s'y ajoute. */}
      <BlocCycle
        interventionId={intervention.id}
        cycle={intervention.cycle}
        cycles={cycles}
        modifiable={modifiable}
      />

      <BlocProduits
        interventionId={intervention.id}
        lignes={intervention.produits}
        catalogue={produits}
        modifiable={modifiable}
      />

      <BlocPhotos
        interventionId={intervention.id}
        photos={intervention.photos}
        modifiable={modifiable}
      />

      {/* Récapitulatif tarifaire de C8. « Déplacement / Inclus » est bien dans
          le produit : Constitution §1.1, le technicien se déplace et le
          déplacement n'est pas facturé à part.

          🐛 **Rien de chiffré sur une intervention annulée**, relevé par l'agent
          testeur. Le bloc était rendu sans condition de statut : sous « Motif de
          l'annulation », un « Montant 85,00 € » s'affichait en gras, et se
          lisait comme une somme due pour une intervention qui n'a pas eu lieu.
          `US-INTERVENTIONS-LISTER-CLIENT-PASSEES` §Cas nominal indexe le champ
          sur le statut - « montant payé **si `DONE`** OU motif d'annulation
          **si `CANCELLED`** » - et l'arbitrage du 2026-08-11 le redit. */}
      {chiffre ? (
        <dl className="flex flex-col gap-2 rounded-xl bg-secondary/60 p-4">
          <LigneTarif intitule={`Forfait ${intervention.forfait}`}>
            {formatPrixEuros(intervention.priceSnapshot)}
          </LigneTarif>

          {intervention.produits.length > 0 ? (
            <LigneTarif intitule="Produits additionnels">
              {formatPrixEuros(produitsTotal.toFixed(2))}
            </LigneTarif>
          ) : null}

          <LigneTarif intitule="Déplacement">Inclus</LigneTarif>

          <div className="mt-1 flex items-baseline justify-between border-t border-border pt-3">
            {/* « Montant payé » dès qu'une ligne `payments` en `PAID` existe,
                « Montant » sinon - report reçu de T-V3-10 (PR #33), qui
                affichait le total calculé faute de table `payments`.

                ⚠️ **Les deux libellés restent, et ce n'est pas une hésitation** :
                le premier affirme un encaissement constaté, le second le montant
                de l'intervention. Une `PLANNED` ou une `IN_PROGRESS` n'a pas
                encore de paiement, et les nommer « payé » affirmerait un fait
                qu'aucune donnée ne porte. Le montant lui-même change avec le
                libellé : `payments.amount_snapshot` est ce que le technicien a
                réellement encaissé, que Constitution §2.3 l'autorise à ajuster,
                donc il peut différer du total. */}
            {/* `!== null` et non une vérité booléenne : la valeur est une
                CHAÎNE, et « une chaîne non vide » n'est pas la question posée.
                Relevé par l'agent testeur - sans effet aujourd'hui, mais une
                garde doit dire ce qu'elle protège. */}
            <dt className="font-heading text-base font-bold">
              {intervention.montantPaye !== null ? "Montant payé" : "Montant"}
            </dt>
            <dd className="font-heading text-2xl font-extrabold tracking-tighter text-primary">
              {formatPrixEuros(intervention.montantPaye ?? intervention.total)}
            </dd>
          </div>
        </dl>
      ) : null}

      {/* Le bloc n'existe que sur une intervention annulable, et `modifiable`
          porte déjà exactement cette condition (`status === "PLANNED"`) : c'est
          la même que celle des trois mutations côté serveur. Sur une terminée
          ou une annulée, il n'y a ni bouton grisé ni bandeau - il n'y a rien,
          parce qu'il n'y a plus rien à annuler. */}
      {modifiable ? (
        <BlocAnnulation
          interventionId={intervention.id}
          appointmentAt={intervention.appointmentAt}
          maintenant={maintenant}
          contact={contact}
        />
      ) : null}
    </section>
  );
}

/// L'icône vit **dans le `<dt>`**, pas à côté : un `<div>` enfant de `<dl>` ne
/// peut contenir que des `<dt>` et des `<dd>`, et `axe` le rapporte en
/// `definition-list`.
function Ligne({
  Icone,
  intitule,
  children,
}: {
  Icone: typeof MapPin;
  intitule: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icone aria-hidden="true" className="size-4" />
        {intitule}
      </dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

function LigneTarif({
  intitule,
  children,
}: {
  intitule: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{intitule}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
