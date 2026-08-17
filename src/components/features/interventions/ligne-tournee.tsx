import { MapPin, Package, Phone, User } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type { InterventionTournee } from "@/lib/db/queries/interventions";
import { formatDateCourte, formatDuree, formatHeure } from "@/lib/format";
import { cheminIntervention } from "@/lib/routes";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/// Une ligne de la tournée, vue par le technicien - maquette **T1**.
///
/// **Aucun `"use client"`** : le composant n'a ni état ni effet. C'est ce qui
/// lui permet d'être rendu par les deux nouvelles vues, qui sont de purs Server
/// Components, tout en restant importable depuis `TourneeVue` qui est cliente.
///
/// ⚠️ **Aucun des six éléments n'est garanti présent** : `users.phone` est
/// NULLable, et un client pseudonymisé perd aussi son nom et sa rue. Mentions
/// neutres, jamais de vide ni de plantage - l'intervention survit à
/// l'effacement de son client (Constitution §4.1, pas de FK cassée).
///
/// Chaque ligne ouvre le détail **quel que soit son statut**, une intervention
/// terminée ou annulée s'ouvrant en lecture seule. Le seul bouton réel est
/// celui de `PLANNED`, passé par le slot `action` plutôt que décidé ici : les
/// vues « Cette semaine » et « Historique » rendent la même ligne sans jamais
/// démarrer quoi que ce soit, et ce fichier reste utilisable depuis un Server
/// Component.
///
/// ⚠️ La carte contient déjà un lien `tel:` et parfois un bouton. Les imbriquer
/// dans un lien produirait du HTML invalide et un piège au clavier. Le motif
/// retenu est celui de la carte cliquable : **un** lien porté par le titre,
/// étiré à toute la carte par un pseudo-élément (`after:absolute after:inset-0`),
/// et les éléments interactifs internes remontés au-dessus (`relative z-10`).
/// Un seul élément tabulable pour la navigation, et les autres restent
/// atteignables.

/// Fin théorique du rendez-vous - début plus la durée FIGÉE à la réservation.
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

/// Libellés, teinte de l'étiquette et teinte du point, pour les quatre statuts.
///
/// Les quatre sont présents, y compris les terminaux : la SPEC §Cas nominal
/// exige que `DONE` et `CANCELLED` restent affichés en fin de journée, pour la
/// traçabilité de la tournée. C'est la règle inverse de l'espace client, dont
/// les deux onglets se partagent les statuts.
///
/// ⚠️ **La couleur marque CE QUI EST EN COURS, le reste est neutre.** Donner
/// une teinte propre aux quatre statuts rend une liste de six lignes bariolée
/// où rien ne ressort : le technicien ouvre son écran pour savoir où il en est.
/// `CANCELLED` garde la sienne parce que c'est une anomalie à repérer.
const STATUTS: Record<
  string,
  { label: string; classe: string; point: string }
> = {
  PLANNED: {
    label: "Planifiée",
    classe: "bg-secondary text-muted-foreground",
    point: "border-2 border-muted-foreground/40 bg-transparent",
  },
  IN_PROGRESS: {
    label: "En cours",
    classe: "bg-primary text-primary-foreground",
    point: "bg-primary-fixed",
  },
  DONE: {
    label: "Terminée",
    classe: "bg-secondary text-muted-foreground",
    point: "bg-muted-foreground/40",
  },
  CANCELLED: {
    label: "Annulée",
    classe: "bg-destructive/10 text-destructive",
    point: "bg-destructive/40",
  },
};

export function EtiquetteStatut({ statut }: { statut: string }) {
  const connu = STATUTS[statut];
  // Un statut inconnu s'affiche tel quel plutôt que de disparaître : c'est le
  // symptôme d'une divergence entre le CHECK SQL et cette table, et le masquer
  // la rendrait invisible jusqu'au support. Même choix que l'espace client.
  return (
    <Badge
      variant="secondary"
      className={cn(
        "text-[0.6875rem] font-bold tracking-[0.06em] uppercase",
        connu?.classe,
      )}
    >
      {connu?.label ?? statut}
    </Badge>
  );
}

export function LigneTournee({
  intervention,
  dateVisible = false,
  action,
}: {
  intervention: InterventionTournee;
  /// Vrai sur « Historique », où les lignes couvrent des jours quelconques et
  /// où l'heure seule ne situe rien. Faux sur la tournée du jour, dont le titre
  /// porte déjà la date, et sur « Cette semaine », qui groupe par journée.
  dateVisible?: boolean;
  /// Action contextuelle de la ligne - aujourd'hui `<BoutonDemarrer>` sur les
  /// lignes `PLANNED` de la tournée du jour, rien ailleurs.
  ///
  /// Un **slot** et non un booléen : composition en première intention
  /// (CLAUDE.md §Patterns composants), et surtout la frontière serveur/client
  /// reste lisible. Ce fichier n'a pas de `"use client"` ; c'est l'appelant qui
  /// apporte son composant interactif, donc les deux vues RSC continuent de
  /// rendre cette ligne au serveur sans embarquer le bouton ni son `AlertDialog`
  /// dans leur paquet.
  action?: ReactNode;
}) {
  const debut = new Date(intervention.appointmentAt);
  const enCours = intervention.status === "IN_PROGRESS";
  // `DONE` autant que `CANCELLED` : T1 grise la ligne terminée comme l'annulée.
  // Les deux restent là pour la traçabilité de la journée, pas pour être
  // exécutées, et c'est ce que la teinte doit dire.
  const close =
    intervention.status === "DONE" || intervention.status === "CANCELLED";

  return (
    // `Card` de shadcn plutôt qu'un `div` habillé à la main : c'est la primitive
    // que le reste du produit utilise pour un bloc de contenu, et elle porte
    // déjà l'angle, la bordure et le fond de la palette. Le `<li>` reste, parce
    // que la sémantique de liste appartient à la tournée, pas à la carte.
    <li>
      <Card
        className={cn(
          // `relative` : c'est le repère du lien étiré porté par le titre.
          // `focus-within` reporte sur la carte le focus reçu par ce lien, sans
          // quoi la cible clavier serait le seul texte du titre alors que la
          // zone cliquable est la carte entière (RGAA A, focus visible).
          "relative gap-0 py-4 transition-colors focus-within:ring-2 focus-within:ring-ring hover:border-primary/40 hover:bg-secondary/30",
          // La ligne en cours est cerclée dans T1, et c'est la seule. C'est le
          // repère que le technicien cherche en ouvrant l'écran.
          enCours && "border-primary ring-1 ring-primary/30",
          close && "opacity-60",
        )}
      >
        <CardContent className="flex gap-3 px-4 sm:gap-4">
          {/* Colonne horaire. `<time>` porte la valeur machine, que l'heure
          affichée ne donne pas - un lecteur d'écran et un moteur d'indexation
          lisent la même chose que l'œil. */}
          <div
            className={cn(
              "flex shrink-0 flex-col items-end pt-1 text-right",
              dateVisible ? "w-24" : "w-14 sm:w-16",
            )}
          >
            <time
              dateTime={intervention.appointmentAt}
              className="font-heading text-lg font-bold tracking-tighter"
            >
              {formatHeure(debut)}
            </time>
            <span className="text-sm text-muted-foreground">
              {dateVisible ? formatDateCourte(debut) : heureFin(intervention)}
            </span>
          </div>

          {/* Pastille de statut de T1. Purement redondante avec l'étiquette, donc
          `aria-hidden` : elle donne le rythme vertical de la tournée à l'œil,
          elle n'ajoute rien à un lecteur d'écran. */}
          <span
            aria-hidden="true"
            className={cn(
              "mt-2 size-2.5 shrink-0 rounded-full",
              STATUTS[intervention.status]?.point ?? "bg-muted-foreground/40",
            )}
          />

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <EtiquetteStatut statut={intervention.status} />
              <span className="text-sm text-muted-foreground">
                {formatDuree(intervention.durationSnapshot)}
              </span>
            </div>

            {/* Le forfait est le titre de la ligne. `h3` : la page porte un `h1`,
            la section son `h2`.

            C'est lui qui porte le lien, et le lien qui porte la carte entière
            via `after:inset-0`. Le nom accessible dit le forfait ET l'heure :
            « Révision complète » répété six fois dans une liste ne distingue
            aucune ligne pour qui navigue de lien en lien (RGAA A, intitulé
            explicite hors contexte).

            ⚠️ `aria-label` plutôt qu'un `<span class="sr-only">` ajouté au
            contenu, et ce n'est pas une préférence : le calcul du nom
            accessible **trim chaque nœud de texte avant de les joindre**, donc
            un espace de bord disparaît et deux nœuds voisins s'annoncent
            collés (« Révision complèteà 10:00 »). Mesuré, pas supposé. Le
            libellé commence par le texte visible, ce qu'exige WCAG 2.5.3
            « label in name » pour qui pilote à la voix. */}
            <h3 className="font-heading text-base font-bold text-foreground">
              <Link
                href={cheminIntervention(intervention.id)}
                aria-label={`${intervention.forfait} à ${formatHeure(debut)}`}
                className="after:absolute after:inset-0 after:rounded-2xl hover:text-primary focus-visible:outline-none"
              >
                {intervention.forfait}
              </Link>
            </h3>

            {/* Ligne méta, sur le modèle du « Sophie Dumas • Lyon 2e » de T1 - mais
            avec l'adresse COMPLÈTE, que la maquette abrège en arrondissement.
            La SPEC §Cas nominal exige « adresse complète » : le technicien s'y
            rend, une ville ne suffit pas. */}
            <p className="flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
              <span className="inline-flex items-center gap-1.5">
                <User aria-hidden="true" className="size-4 shrink-0" />
                {/* Nom COMPLET : le technicien sonne chez cette personne
                (Constitution §1.1). `abregerNom` joue dans l'autre sens. */}
                <span className="font-medium text-foreground">
                  {intervention.client.nom}
                </span>
              </span>

              <span className="inline-flex items-start gap-1.5">
                <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>
                  {intervention.adresse.street}, {intervention.adresse.zipCode}{" "}
                  {intervention.adresse.city}
                </span>
              </span>
            </p>

            {/* Encart de T1 : le téléphone et les produits attachés y sont groupés
            dans un aplat, détachés de la description. Ce sont les deux données
            dont le technicien se sert **sur place**, pas pour choisir sa
            ligne. */}
            <div className="flex flex-col gap-2 rounded-xl bg-secondary/50 px-3 py-2 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
              <span className="inline-flex items-center gap-1.5">
                <Phone
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
                {intervention.client.telephone ? (
                  // `tel:` - le technicien est sur le terrain, souvent au téléphone.
                  //
                  // `relative z-10` : il passe AU-DESSUS du lien étiré du titre,
                  // sinon le pseudo-élément le recouvrirait et un appui sur le
                  // numéro ouvrirait le détail au lieu de composer.
                  <a
                    href={`tel:${intervention.client.telephone}`}
                    className="relative z-10 font-medium underline underline-offset-2 hover:text-primary"
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

              {intervention.produits.length > 0 && (
                <span className="inline-flex items-start gap-1.5 text-muted-foreground">
                  <Package
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span>
                    {intervention.produits
                      .map(
                        (produit) =>
                          `${produit.label}${produit.quantity > 1 ? ` × ${String(produit.quantity)}` : ""}`,
                      )
                      .join(" · ")}
                  </span>
                </span>
              )}
            </div>

            {/* Action contextuelle. `relative z-10` pour la même raison que le
            numéro de téléphone : elle doit rester cliquable par-dessus le lien
            étiré. Rien n'est rendu quand l'appelant ne passe pas de slot, et
            aucun bouton désactivé ne prend sa place - la DoD interdit
            nommément les boutons inertes. */}
            {action ? (
              <div className="relative z-10 flex flex-wrap gap-2 pt-1">
                {action}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </li>
  );
}
