import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { forbidden } from "next/navigation";
import {
  ArrowLeft,
  Bike,
  ClipboardList,
  Mail,
  MapPin,
  Navigation,
  Package,
  Phone,
  User,
  Wrench,
} from "lucide-react";

import { requireTech } from "@/lib/auth/permissions";
import { chargerInterventionDuTech } from "@/lib/db/queries/interventions";
import {
  formatDateLongue,
  formatDuree,
  formatHeure,
  formatPrixEuros,
} from "@/lib/format";
import { CHEMIN_TOURNEE_DU_JOUR } from "@/lib/routes";
import { EtiquetteStatut } from "@/components/features/interventions/ligne-tournee";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import { HubStatut } from "./_components/hub-statut";

/// Détail d'une intervention - `US-INTERVENTION-AFFICHER` et
/// `US-INTERVENTION-DEMARRER`, écran **T2**.
///
/// ── La garde vit ICI, dans la page
///
/// `requireTech()` et non un contrôle dans le layout de l'espace : le Partial
/// Rendering ne rejoue pas un layout en navigation client, un contrôle posé
/// là-haut deviendrait obsolète sans que rien ne le signale (CLAUDE.md
/// §Authentication). Le layout de `(app)/interventions/` le dit déjà de son
/// côté.
///
/// Le rôle ne suffit pas : la **propriété** se joue dans la clause `where` de
/// `chargerInterventionDuTech`, qui reçoit l'identifiant de session.
///
/// ── 403 sur l'intervention d'un collègue, et 403 aussi sur l'inexistante
///
/// `US-INTERVENTION-AFFICHER` §Cas d'erreur écrit 403 deux fois, et c'est ce que
/// la page rend. Elle le rend **aussi** pour un identifiant qui n'existe pas,
/// et cette symétrie est le point : `interventions.id` est un `SERIAL`, donc
/// énumérable, et deux réponses distinctes apprendraient à qui incrémente
/// quelles interventions existent.
///
/// ⚠️ **Ce n'est pas la doctrine des surfaces client**, qui rendent
/// « introuvable » (annulation, mutations produits, route de lecture des
/// photos), et la divergence est voulue. Là-bas l'espace d'identifiants est
/// partagé entre tous les clients et les surfaces sont joignables par
/// n'importe quel compte. Ici la route est derrière `requireTech()` et
/// l'acteur est un interne : ce qu'il apprendrait en énumérant, c'est que
/// l'intervention 43 existe et n'est pas la sienne. Chaque surface suit sa
/// propre US. Ne pas « harmoniser » les deux.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;

  return {
    // Pas de donnée client dans le titre : il part dans l'historique du
    // navigateur et dans les listes d'onglets.
    title: `Intervention #${id} - HomeCycl'Home`,
  };
}

export default async function DetailInterventionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [tech, { id }] = await Promise.all([requireTech(), params]);

  // `interventions.id` est un SERIAL : tout ce qui n'est pas un entier positif
  // est écarté avant d'atteindre la base. Même geste que la route de lecture
  // des photos.
  const interventionId = Number(id);
  if (!Number.isInteger(interventionId) || interventionId <= 0) {
    forbidden();
  }

  const intervention = await chargerInterventionDuTech({
    interventionId,
    techId: tech.id,
  });

  // Inconnue ou appartenant à un collègue : une seule réponse, cf. l'en-tête.
  if (!intervention) forbidden();

  const fin = new Date(
    intervention.appointmentAt.getTime() +
      intervention.durationSnapshot * 60_000,
  );

  const adresseComplete = `${intervention.adresse.street}, ${intervention.adresse.zipCode} ${intervention.adresse.city}`;

  return (
    <>
      {/* Fil de retour de T2 (« Retour à ma tournée / Intervention #… »). La
          maquette y écrit une référence inventée `#INT-2026-1042` : l'identifiant
          réel est le SERIAL, déjà dans l'URL. */}
      <nav aria-label="Fil d'Ariane">
        <Link
          href={CHEMIN_TOURNEE_DU_JOUR}
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Retour à ma tournée
        </Link>
      </nav>

      {/* En-tête T2 : le client donne son titre à l'écran, la ligne méta porte
          la date, le créneau et le forfait. */}
      <header className="flex flex-col gap-3 rounded-3xl bg-secondary/50 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="font-heading text-3xl font-bold tracking-tighter text-primary md:text-4xl">
            {intervention.client.nom}
          </h1>
          <EtiquetteStatut statut={intervention.status} />
        </div>

        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <ClipboardList aria-hidden="true" className="size-4 shrink-0" />
            <span className="first-letter:uppercase">
              {formatDateLongue(intervention.appointmentAt)}
            </span>
            <time dateTime={intervention.appointmentAt.toISOString()}>
              {formatHeure(intervention.appointmentAt)}
            </time>
            <span aria-hidden="true">-</span>
            <span className="sr-only">à</span>
            {formatHeure(fin)}
            <span>({formatDuree(intervention.durationSnapshot)})</span>
          </span>

          <span className="inline-flex items-center gap-1.5">
            <Wrench aria-hidden="true" className="size-4 shrink-0" />
            {intervention.forfait.label}
          </span>
        </p>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <BlocAdresse adresse={adresseComplete} />

          <div className="grid gap-6 md:grid-cols-2">
            <BlocClient
              client={intervention.client}
              cycle={intervention.cycle}
            />
            <BlocPrestation intervention={intervention} />
          </div>

          <BlocProduits intervention={intervention} />
          <BlocPhotos photos={intervention.photos} />

          {/* `interventions.tech_comment`. Rien ne l'écrit en v1
              (`US-INTERVENTION-COMMENTAIRE-AJOUTER` est v2), donc le bloc n'est
              rendu que s'il porte quelque chose - un encart « aucun
              commentaire » sur un champ que personne ne peut remplir serait une
              invitation à un bouton qui n'existe pas. */}
          {intervention.techComment ? (
            <Card>
              <CardContent className="flex flex-col gap-2">
                <h2 className="font-heading text-base font-bold">
                  Compte-rendu
                </h2>
                <p className="text-sm whitespace-pre-line text-muted-foreground">
                  {intervention.techComment}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* Colonne droite de T2. `sticky` comme celle de la tournée : sur un
            écran mobile elle passe simplement dessous. */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-24 lg:w-[22rem] lg:shrink-0 lg:self-start">
          <HubStatut intervention={intervention} />
        </div>
      </div>
    </>
  );
}

/// Bloc « Adresse d'intervention » de T2.
///
/// ⚠️ **Pas de carte, et ce n'est pas une divergence** : `maquettage.md`
/// §Notes portage décrit déjà la mini-carte de T2 comme « image mockup Stitch au
/// lieu de vraie Google Maps ». Porter une seconde surface Maps ici doublerait
/// le quota et la surface non vérifiée, alors que la carte de T1 n'a toujours
/// pas de referer autorisé et n'a donc jamais été peinte en conditions réelles.
///
/// ⚠️ **« Instructions d'accès » n'est pas porté** : la maquette y met un code
/// de porte et un bâtiment, or `addresses` ne porte aucune colonne de ce genre
/// (dictionnaire §addresses : `street`, `city_id`, `location`, `user_id`,
/// `label`, `is_active`). Rien à afficher, et inventer la colonne serait un
/// changement de modèle.
///
/// Le bouton « Itinéraire », lui, est conservé. Aucune US ne le porte, mais il
/// ne promet que ce qu'il tient, tout de suite, sur une adresse déjà à l'écran,
/// sans état ni service à construire - c'est la distinction de la leçon
/// `T-T2-16`, qui proscrit le lien mort et la fonction annoncée, pas le lien
/// qui marche. Divergence signalée pour write-back vers la SPEC.
function BlocAdresse({ adresse }: { adresse: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="inline-flex items-center gap-2 font-heading text-base font-bold">
            <MapPin aria-hidden="true" className="size-5 text-primary" />
            Adresse d&apos;intervention
          </h2>

          <Button asChild variant="outline" size="sm">
            {/* `target="_blank"` avec `rel="noreferrer"` : la page ouverte ne
                doit hériter ni de l'opener ni du référent, qui porterait
                l'identifiant de l'intervention dans les journaux d'un tiers. */}
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(adresse)}`}
              target="_blank"
              rel="noreferrer"
            >
              <Navigation aria-hidden="true" />
              Itinéraire
              <span className="sr-only">(nouvelle fenêtre)</span>
            </a>
          </Button>
        </div>

        <address className="text-base font-medium not-italic">
          {adresse}
        </address>
      </CardContent>
    </Card>
  );
}

/// Bloc « Client » de T2 : les coordonnées dont le technicien se sert sur place.
///
/// `US-INTERVENTION-AFFICHER` §Notes assume explicitement cette exposition :
/// « nom, téléphone, email et adresse complets accessibles au tech propriétaire
/// de l'intervention uniquement. Justification métier terrain. »
///
/// ⚠️ **« Client depuis mars 2025 » n'est pas porté** : aucune US ne le
/// demande, `users.created_at` n'a aucun usage terrain, et l'ancienneté d'un
/// compte n'aide pas à réparer un vélo.
function BlocClient({
  client,
  cycle,
}: {
  client: { nom: string; telephone: string | null; email: string };
  cycle: { brand: string; model: string | null; type: string } | null;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <h2 className="inline-flex items-center gap-2 font-heading text-base font-bold">
          <User aria-hidden="true" className="size-5 text-primary" />
          Client
        </h2>

        <p className="font-medium">{client.nom}</p>

        <Separator />

        <ul className="flex flex-col gap-2 text-sm">
          <li className="flex items-center gap-2">
            <Phone
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            {client.telephone ? (
              <a
                href={`tel:${client.telephone}`}
                className="font-medium underline underline-offset-2 hover:text-primary"
              >
                {client.telephone}
              </a>
            ) : (
              // Compte pseudonymisé : `users.phone` repasse à NULL au droit à
              // l'oubli, et l'intervention lui survit (Constitution §4.1).
              <span className="text-muted-foreground">
                Téléphone non renseigné
              </span>
            )}
          </li>

          <li className="flex items-center gap-2">
            <Mail
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <a
              href={`mailto:${client.email}`}
              className="font-medium break-all underline underline-offset-2 hover:text-primary"
            >
              {client.email}
            </a>
          </li>

          <li className="flex items-center gap-2">
            <Bike
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            {/* Les deux états s'affichent (cadrage du plancher V2, D11) :
                `interventions.cycle_id` a un écrivain, T-V3-16 côté client, mais
                le rattachement reste facultatif, donc la colonne est vide sur
                toute intervention venue du tunnel. */}
            {cycle ? (
              <span className="font-medium">
                {cycle.brand}
                {cycle.model ? ` ${cycle.model}` : ""}
              </span>
            ) : (
              <span className="text-muted-foreground">Aucun vélo indiqué</span>
            )}
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

/// Bloc « Prestation » de T2 : le forfait, sa durée, sa description, son prix.
///
/// Le prix est affiché, et Constitution §3.1 n'y fait pas obstacle : elle
/// interdit au technicien de **modifier** les prix, « interdit fonctionnel, pas
/// seulement masqué dans l'UI », jamais de les lire. Il encaissera ce montant en
/// T-V2-03.
function BlocPrestation({
  intervention,
}: {
  intervention: {
    forfait: { label: string; description: string | null };
    durationSnapshot: number;
    priceSnapshot: string;
  };
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="inline-flex items-center gap-2 font-heading text-base font-bold">
            <Wrench aria-hidden="true" className="size-5 text-primary" />
            Prestation
          </h2>
          <p className="font-heading text-lg font-bold">
            {formatPrixEuros(intervention.priceSnapshot)}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <p className="font-medium">{intervention.forfait.label}</p>
          <p className="text-sm text-muted-foreground">
            Durée estimée : {formatDuree(intervention.durationSnapshot)}
          </p>
        </div>

        {/* T2 rend la description en liste à puces cochées. Le catalogue la
            stocke en **un** paragraphe (`services.description`), pas en items :
            la découper sur la ponctuation fabriquerait des puces à partir d'un
            texte qui n'en est pas. */}
        {intervention.forfait.description ? (
          <p className="text-sm text-muted-foreground">
            {intervention.forfait.description}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/// Bloc « Produits additionnels » de T2.
///
/// ⚠️ **Le bouton « Ajouter un produit » n'est pas porté** : la vente sur place
/// par le technicien relève d'une US v2 dédiée, et le verrou du produit la
/// refuse déjà (`STATUT_MODIFIABLE = "PLANNED"` dans `queries/produits.ts`,
/// arbitrage B7 Q2a). Un bouton qui poste une action condamnée à répondre
/// « verrouillée » serait le bouton inerte que la DoD interdit.
function BlocProduits({
  intervention,
}: {
  intervention: {
    produits: {
      productId: number;
      label: string;
      quantity: number;
      unitPriceSnapshot: string;
    }[];
    priceSnapshot: string;
    total: string;
  };
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <h2 className="inline-flex items-center gap-2 font-heading text-base font-bold">
          <Package aria-hidden="true" className="size-5 text-primary" />
          Produits additionnels
        </h2>

        {intervention.produits.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun produit supplémentaire n&apos;a été ajouté à cette
            intervention.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {intervention.produits.map((produit) => (
              <li
                key={produit.productId}
                className="flex flex-wrap items-baseline justify-between gap-2"
              >
                <span>
                  {produit.label}
                  {produit.quantity > 1 ? (
                    <span className="text-muted-foreground">
                      {" "}
                      × {produit.quantity}
                    </span>
                  ) : null}
                </span>
                <span className="font-medium">
                  {formatPrixEuros(produit.unitPriceSnapshot)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <Separator />

        {/* Le total est `price_snapshot` plus la somme des
            `unit_price_snapshot × quantité`, formule que les deux US produits
            écrivent mot pour mot. C'est ce montant que T-V2-03 préréglera au
            paiement (cadrage du plancher V2, D9), et non le forfait seul. */}
        <p className="flex items-baseline justify-between gap-2">
          <span className="font-medium">Total à encaisser</span>
          <span className="font-heading text-xl font-bold text-primary">
            {formatPrixEuros(intervention.total)}
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

/// Photos existantes - `US-INTERVENTION-AFFICHER` §Cas nominal, « photos
/// existantes (client à la réservation + tech déjà déposées) ».
///
/// Le contenu passe par `GET /api/intervention-photos/[id]`, dont la garde
/// accepte depuis cette tâche le **technicien affecté** en plus du client
/// titulaire. Sans cet élargissement, ce bloc rendrait des images cassées.
///
/// ⚠️ **Aucun dépôt ici** : `US-INTERVENTION-PHOTOS-DEPOSER` est T-V2-04. Le
/// bloc lit, il n'écrit pas.
function BlocPhotos({ photos }: { photos: { id: number; type: string }[] }) {
  if (photos.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <h2 className="font-heading text-base font-bold">
          Photos ({photos.length})
        </h2>

        <ul className="flex flex-wrap gap-3">
          {photos.map((photo, index) => (
            <li key={photo.id}>
              {/* `unoptimized` : l'optimiseur d'images de Next refetch l'URL
                  depuis le serveur, sans le cookie de session, et se heurterait
                  au 404 de la route contrôlée. La photo est déjà ré-encodée en
                  WebP à l'upload. Même motif que le bloc de l'espace client. */}
              <Image
                src={`/api/intervention-photos/${String(photo.id)}`}
                alt={
                  photo.type === "AFTER"
                    ? `Photo ${String(index + 1)} prise après l'intervention`
                    : `Photo ${String(index + 1)} jointe par le client`
                }
                width={112}
                height={112}
                unoptimized
                className="size-28 rounded-xl border border-border object-cover"
              />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
