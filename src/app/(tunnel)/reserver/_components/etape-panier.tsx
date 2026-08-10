"use client";

import { Minus, Package, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LignePanier, ProduitVendable } from "@/lib/db/queries/produits";
import { formatPrixEuros } from "@/lib/format";
import { cn } from "@/lib/utils";

/// Bloc « Produits additionnels » de l'écran **C5** (`c5:170-244`).
///
/// Constitution §2.6 : service et vente forment un acte commercial unique. Le
/// panier vit donc **dans** le tunnel, sur l'écran de validation, et pas dans
/// une boutique séparée.
///
/// ── Géométrie portée
///
///   · dalle `rounded-xl p-6`, titre `headline-sm` avec la mention
///     « (facultatif) » en 14 px atone (`c5:172`) ;
///   · cartes `border rounded-xl p-4`, prix en `headline-sm`, sélecteur de
///     quantité en pilule `rounded-full` avec deux boutons ronds de 24 px
///     (`c5:196-206`) ;
///   · carte choisie soulignée `border-primary` sur `primary-fixed/10`, badge
///     « Ajouté » en haut à droite (`c5:183-185`).
///
/// ── Ce qui ne se porte pas
///
///  1. **Les vignettes produit** (`c5:188-190`). Elles pointent
///     `lh3.googleusercontent.com`, que le bloc *Global* de [[maquettage]]
///     §Notes portage interdit, et `products` n'a **aucune colonne d'image** au
///     dictionnaire. Inventer un champ pour trois pastilles serait un
///     changement de modèle ; l'icône générique dit la même chose.
///  2. **Les filtres par catégorie** (`c5:174-179` : « Tous · Pneus · Chambres
///     à air · Éclairage »). `product_categories` est vide et le seed pose
///     `category_id` NULL - aucune US v1 ne les peuple. Des onglets qui ne
///     filtrent rien sont une promesse.
///  3. **Les libellés de marque** de la maquette. Le catalogue réel est celui
///     du seed de T-V3-01, générique par construction : le dépôt bascule
///     public.
///  4. **Material Symbols** → Lucide, règle transverse.
///
/// ── Ce que le panier n'est pas
///
/// Composer un panier ne **retient** rien : le stock affiché est celui du
/// moment, et il peut partir avant la validation. Le refus arrive alors à la
/// validation, nommé, et le panier n'est pas corrigé dans le dos du client.
export function EtapePanier({
  produits,
  panier,
  onChangement,
}: {
  produits: readonly ProduitVendable[];
  panier: readonly LignePanier[];
  onChangement: (panier: LignePanier[]) => void;
}) {
  function regler(productId: number, quantite: number) {
    if (quantite <= 0) {
      onChangement(panier.filter((ligne) => ligne.productId !== productId));
      return;
    }

    const connue = panier.some((ligne) => ligne.productId === productId);
    onChangement(
      connue
        ? panier.map((ligne) =>
            ligne.productId === productId
              ? { ...ligne, quantity: quantite }
              : ligne,
          )
        : [...panier, { productId, quantity: quantite }],
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-xl font-bold tracking-[-0.01em]">
          Produits additionnels{" "}
          <span className="text-sm font-normal text-muted-foreground">
            (facultatif)
          </span>
        </h2>
        <p className="text-sm leading-[1.5] text-muted-foreground">
          Le technicien les apporte et les pose pendant l&apos;intervention.
          Vous les réglez avec le forfait, sur place.
        </p>
      </div>

      {produits.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Aucun produit n&apos;est proposé pour le moment.
        </p>
      ) : (
        /* La maquette pose deux colonnes là où trois tiennent dans la colonne
           de saisie ([[maquettage]] §Notes portage, « grid produits 2 cols au
           lieu de 3 »). Trois à partir de `xl`, deux ensuite, une sur
           téléphone : les maquettes sont en 1920 seulement, le responsive
           s'ajoute au portage. */
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {produits.map((produit) => (
            <CarteProduit
              key={produit.id}
              produit={produit}
              quantite={
                panier.find((ligne) => ligne.productId === produit.id)
                  ?.quantity ?? 0
              }
              onRegler={(quantite) => {
                regler(produit.id, quantite);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function CarteProduit({
  produit,
  quantite,
  onRegler,
}: {
  produit: ProduitVendable;
  quantite: number;
  onRegler: (quantite: number) => void;
}) {
  const rupture = produit.stock === 0;
  const choisi = quantite > 0;
  // `US-INTERVENTION-PRODUIT-AJOUTER` : « plafond = stock disponible ».
  const plafond = quantite >= produit.stock;

  return (
    <li
      className={cn(
        "relative flex flex-col gap-3 rounded-xl border p-4 transition-colors",
        choisi
          ? "border-primary bg-primary-fixed/10"
          : "border-border bg-card hover:border-input",
        rupture && "opacity-60",
      )}
    >
      {/* Un seul badge. Les deux se superposaient au même point d'ancrage dès
          qu'une ligne déjà choisie tombait en rupture, et c'est la rupture qui
          prime : c'est elle qui demande un geste. */}
      {rupture ? (
        <Badge variant="secondary" className="absolute top-2 right-2">
          Rupture
        </Badge>
      ) : choisi ? (
        <Badge className="absolute top-2 right-2">Ajouté</Badge>
      ) : null}

      <div className="flex items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-secondary">
          <Package
            aria-hidden="true"
            className="size-7 text-muted-foreground"
          />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{produit.label}</h3>
          {produit.description ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {produit.description}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
        <span
          className={cn(
            "font-heading text-xl font-bold tracking-[-0.01em]",
            choisi ? "text-primary" : "text-foreground",
          )}
        >
          {formatPrixEuros(produit.price)}
        </span>

        {/* ⚠️ **`choisi` est testé AVANT `rupture`, et l'ordre est le
            correctif.** L'inverse masquait le sélecteur de quantité derrière
            « Indisponible » dès qu'une ligne déjà au panier tombait à zéro : la
            ligne restait, comptait dans le total, faisait refuser la validation,
            et l'écran n'offrait plus aucun moyen de l'enlever. Le tunnel était
            en impasse sur son dernier écran, dans le cas que la DoD décrit
            elle-même - le panier survit à l'aller-retour d'activation, et le
            catalogue est relu au retour.
            Le « + » reste désarmé par le plafond de stock, le « - » redevient
            atteignable. Relevé par l'agent testeur. */}
        {choisi ? (
          <div className="flex items-center gap-1 rounded-full bg-secondary p-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              onClick={() => {
                onRegler(quantite - 1);
              }}
            >
              <Minus aria-hidden="true" className="size-4" />
              <span className="sr-only">
                Retirer une unité de {produit.label}
              </span>
            </Button>
            {/* Le nombre est lisible par le lecteur d'écran via les noms des
                deux boutons, qui portent déjà le produit. Une région live de
                plus par carte rendrait la dalle bavarde. */}
            <span className="min-w-6 text-center text-sm font-semibold">
              {quantite}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              disabled={plafond}
              onClick={() => {
                onRegler(quantite + 1);
              }}
            >
              <Plus aria-hidden="true" className="size-4" />
              <span className="sr-only">
                Ajouter une unité de {produit.label}
              </span>
            </Button>
          </div>
        ) : rupture ? (
          <span className="text-sm text-muted-foreground">Indisponible</span>
        ) : (
          <Button
            type="button"
            variant="secondary"
            className="h-auto rounded-full px-4 py-1.5 text-sm"
            onClick={() => {
              onRegler(1);
            }}
          >
            <Plus aria-hidden="true" className="size-4" />
            Ajouter
            <span className="sr-only">{produit.label}</span>
          </Button>
        )}
      </div>

      {/* Dire pourquoi la validation refusera, plutôt que de laisser le client
          buter dessus. Le panier n'est pas corrigé dans son dos, mais l'impasse
          ne se déguise pas non plus en silence. */}
      {rupture && choisi ? (
        <p className="text-sm leading-[1.5] text-destructive">
          Ce produit n&apos;est plus disponible. Retirez-le pour valider votre
          réservation.
        </p>
      ) : null}
    </li>
  );
}
