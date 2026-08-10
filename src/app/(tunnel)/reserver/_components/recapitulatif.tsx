"use client";

import { ArrowRight, CalendarDays, Info, MapPin, Wrench } from "lucide-react";

import type { ForfaitPublic } from "@/lib/db/queries/forfaits";
import type { LignePanier, ProduitVendable } from "@/lib/db/queries/produits";
import {
  formatDuree,
  formatPrixEuros,
  multiplierEuros,
  sommeEuros,
} from "@/lib/format";
import type { SuggestionAdresse } from "@/lib/geo/ban";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import { EtapeCoordonnees } from "./etape-coordonnees";
import { EtapePanier } from "./etape-panier";
import { EtapePhotos, type PhotoDeposee } from "./etape-photos";
import { CONTENEUR } from "./etapes";

/// Étape 4 du tunnel - écran **C5** (`c5-tunnel-panier/code.html`).
///
/// ── Géométrie portée
///
///   · titre `headline-lg` 32 px, chapô `body-lg mt-2`, bloc `mb-10`
///     (`c5:162-165`) ;
///   · bento `lg:grid-cols-12`, colonne de saisie sur **8** en `gap-8`, colonne
///     de récapitulatif sur **4** (`c5:166-168`, `c5:287`) ;
///   · dalles `rounded-xl p-6`, récapitulatif **collant** à `top-24`
///     (`c5:288`) ;
///   · encart de prix `rounded-lg p-4 mb-6`, total en `headline-lg` sur
///     `tertiary-fixed`, appel à l'action pleine largeur `py-4 rounded-xl` en
///     `headline-sm` (`c5:320-352`).
///
/// ── Ce qui ne se porte pas
///
///  1. **La case « J'accepte les CGV »** (`c5:340-348`). Page hors périmètre v1,
///     la mention RGPD de PLAN S4 §4.3 la remplace - même traitement que C6.
///  2. **Les moyens de paiement énumérés** (`c5:363-364` : « Espèces, chèque,
///     CB terminal mobile »). Aucune source : il n'existe ni table `payments`
///     ni ligne de SPEC qui les fixe en v1. La dalle garde sa place et dit ce
///     qui est établi - l'encaissement se fait sur le terrain
///     (Constitution §2.3).
///  3. **« Dernière étape avant de confier votre vélo à nos experts »**
///     (`c5:164`). Le client ne confie rien : le technicien se déplace
///     (Constitution §1.1). Réécrit.
///  4. **« Vous pourrez créer un compte à l'issue de la réservation »**
///     (`c5:263`). Le renversement de Constitution §3.2 du 2026-08-09 inverse
///     la phrase : le compte activé **précède** la validation.
///  5. **Le technicien nommé dans le récapitulatif** (`c5:301-310`) :
///     l'affectation est décidée par la réservation, pas montrée avant.
///
/// Le bloc « Produits additionnels » (`c5:170-244`) arrive avec T-V3-09 et vit
/// dans `etape-panier.tsx`, qui porte ses propres divergences de portage.
export function Recapitulatif({
  forfait,
  adresse,
  creneau,
  photos,
  onChangementPhotos,
  produits,
  panier,
  onChangementPanier,
  estConnecte,
  enCours,
  onValider,
  retour,
  idTitre,
}: {
  forfait: ForfaitPublic;
  adresse: SuggestionAdresse;
  creneau: string;
  photos: PhotoDeposee[];
  onChangementPhotos: (photos: PhotoDeposee[]) => void;
  produits: readonly ProduitVendable[];
  panier: readonly LignePanier[];
  onChangementPanier: (panier: LignePanier[]) => void;
  estConnecte: boolean;
  enCours: boolean;
  onValider: () => void;
  retour: string;
  idTitre: string;
}) {
  /// Le panier ne porte que des identifiants ; les libellés et les prix se
  /// rejoignent ici, à partir du catalogue rendu par le serveur. Un panier qui
  /// transporterait ses prix laisserait l'écran décider de ce qui sera facturé.
  const lignes = panier.flatMap((ligne) => {
    const produit = produits.find((p) => p.id === ligne.productId);
    if (!produit) return [];
    return [
      {
        id: produit.id,
        label: produit.label,
        quantity: ligne.quantity,
        montant: multiplierEuros(produit.price, ligne.quantity),
      },
    ];
  });

  // Affichage seulement. Le total qui engage est recalculé côté serveur, à
  // partir des instantanés figés dans la transaction de validation.
  const total = sommeEuros([
    forfait.price,
    ...lignes.map((ligne) => ligne.montant),
  ]);

  return (
    <div className={cn(CONTENEUR, "py-12")}>
      <div className="mb-10">
        <h1
          id={idTitre}
          className="font-heading text-[2rem] leading-[1.2] font-bold tracking-[-0.03em]"
        >
          Finalisez votre réservation
        </h1>
        <p className="mt-2 text-lg leading-[1.6] text-muted-foreground">
          Dernière étape avant l&apos;intervention à votre adresse.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="flex flex-col gap-8 lg:col-span-8">
          {/* Avant les photos, comme la maquette, et **visible sans compte** :
              `US-INTERVENTION-PRODUIT-AJOUTER-TUNNEL` s'ouvre sur « authentifié
              ou non ». C'est la validation qui exige une session, pas la
              composition du panier (Constitution §3.2). */}
          <section className="rounded-xl border border-border bg-card p-6">
            <EtapePanier
              produits={produits}
              panier={panier}
              onChangement={onChangementPanier}
            />
          </section>

          {estConnecte ? (
            <section className="rounded-xl border border-border bg-card p-6">
              <EtapePhotos photos={photos} onChangement={onChangementPhotos} />
            </section>
          ) : (
            // Les photos n'apparaissent qu'une fois connecté : leur dépôt exige
            // une session, et proposer un champ qui refuserait le fichier serait
            // une promesse qu'on ne tient pas.
            <section className="rounded-xl border border-border bg-card p-6">
              <EtapeCoordonnees retour={retour} />
            </section>
          )}
        </div>

        <div className="lg:col-span-4">
          <div className="sticky top-24 flex flex-col gap-4">
            <div className="flex flex-col rounded-xl bg-primary-container p-6 text-primary-foreground shadow-lg">
              <h2 className="font-heading text-xl font-bold tracking-[-0.01em]">
                Récapitulatif
              </h2>
              <Separator className="my-4 bg-primary-foreground/20" />

              <dl className="mb-6 flex flex-col gap-4">
                <Ligne Icone={Wrench} intitule="Prestation">
                  {forfait.label}, {formatDuree(forfait.duration)}
                </Ligne>
                <Ligne Icone={CalendarDays} intitule="Date et heure">
                  <span className="first-letter:uppercase">
                    {DATE_COMPLETE.format(new Date(creneau))}
                  </span>
                </Ligne>
                <Ligne Icone={MapPin} intitule="Lieu">
                  {adresse.label}
                </Ligne>
              </dl>

              <div className="mb-6 rounded-lg border border-primary-fixed/10 bg-primary/20 p-4">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span>{forfait.label}</span>
                  <span className="font-semibold">
                    {formatPrixEuros(forfait.price)}
                  </span>
                </div>
                {/* Une ligne par produit du panier. Constitution §2.6 : même
                    panier, même paiement, même facture - la vente additionnelle
                    n'a pas de total séparé. */}
                {lignes.map((ligne) => (
                  <div
                    key={ligne.id}
                    className="mb-2 flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      {ligne.label}
                      {ligne.quantity > 1 ? ` x ${String(ligne.quantity)}` : ""}
                    </span>
                    <span className="font-semibold">
                      {formatPrixEuros(ligne.montant)}
                    </span>
                  </div>
                ))}
                <div className="mb-4 flex items-center justify-between text-sm text-primary-fixed">
                  <span>Déplacement</span>
                  <span className="font-semibold">Inclus</span>
                </div>
                <Separator className="bg-primary-foreground/20" />
                <div className="mt-4 flex items-baseline justify-between">
                  {/* « Total estimé » dans la maquette : le prix est FIGÉ à la
                      réservation (Constitution §4.1), rien n'est estimé. */}
                  <span className="text-sm font-semibold tracking-[0.05em] text-primary-fixed">
                    Total
                  </span>
                  <span className="font-heading text-[2rem] leading-[1.2] font-bold tracking-[-0.03em] text-tertiary-fixed">
                    {formatPrixEuros(total)}
                  </span>
                </div>
              </div>

              {estConnecte ? (
                <>
                  {/* Jaune `tertiary-fixed` sur texte foncé : l'appel à l'action
                      le plus engageant du parcours, seul emploi de la couleur
                      d'urgence d'ADR-012 §D4 dans le tunnel. */}
                  <Button
                    type="button"
                    disabled={enCours}
                    className="h-auto w-full rounded-xl bg-tertiary-fixed py-4 font-heading text-xl font-bold tracking-[-0.01em] text-tertiary-fixed-foreground hover:bg-tertiary-fixed/90"
                    onClick={onValider}
                  >
                    {enCours ? "Validation…" : "Valider ma réservation"}
                    {enCours ? null : (
                      <ArrowRight aria-hidden="true" className="size-5" />
                    )}
                  </Button>
                  <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-sm text-primary-fixed">
                    <Info aria-hidden="true" className="size-4 shrink-0" />
                    Aucun paiement en ligne.
                  </p>
                </>
              ) : (
                <p className="flex items-start gap-2 text-sm leading-[1.5] text-primary-fixed">
                  <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  La validation demande un compte activé : créez-le ci-contre,
                  votre sélection est conservée.
                </p>
              )}
            </div>

            <div className="flex items-center gap-4 rounded-xl bg-secondary p-4">
              <Info
                aria-hidden="true"
                className="size-6 shrink-0 text-muted-foreground"
              />
              <div>
                <p className="text-sm font-semibold tracking-[0.05em]">
                  Paiement sur place
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Vous réglez le technicien à la fin de l&apos;intervention.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const DATE_COMPLETE = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "full",
  timeStyle: "short",
});

/// L'icône vit **dans le `<dt>`**, pas à côté. Un `<div>` enfant de `<dl>` ne
/// peut contenir que des `<dt>` et des `<dd>` : y glisser une icône casse le
/// modèle de contenu, et c'est le genre d'écart qu'`axe` rapporte en
/// `definition-list`.
function Ligne({
  Icone,
  intitule,
  children,
}: {
  Icone: typeof Wrench;
  intitule: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="flex items-center gap-3 text-sm font-semibold tracking-[0.05em] text-primary-fixed">
        <Icone aria-hidden="true" className="size-5 shrink-0" />
        {intitule}
      </dt>
      <dd className="mt-1 pl-8 text-base leading-[1.6] font-medium">
        {children}
      </dd>
    </div>
  );
}
