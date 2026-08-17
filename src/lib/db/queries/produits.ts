import "server-only";

import { Prisma } from "@prisma/client";
import { cache } from "react";

import { db } from "@/lib/db/client";

/// Produits additionnels - helpers métier, pas Server Actions.
///
/// Aucun `revalidatePath`, aucun `redirect` : ils jettent hors contexte Next et
/// rendraient ces fonctions intestables en isolation.
///
/// Constitution §2.6 : service et vente forment un acte commercial unique. Il
/// n'y a donc pas de « commande produits » séparée - les lignes vivent sur
/// l'intervention, dans le même panier et sur la même facture.

/// Statut qui autorise la composition du panier après réservation.
///
/// Tranché en B7 Session 4 (Q2a) : ajout et retrait client sont bloqués **dès**
/// `IN_PROGRESS`. Le technicien qui vend sur place pendant l'exécution relève
/// d'une US v2 dédiée, pas d'un élargissement de celle-ci.
const STATUT_MODIFIABLE = "PLANNED";

/// Vue publique du catalogue.
export type ProduitVendable = {
  id: number;
  label: string;
  description: string | null;
  /// Chaîne à deux décimales, jamais un `number` : un DECIMAL(10,2) qui passe
  /// par un flottant binaire perd ses centimes. C'est cette chaîne qui sera
  /// figée en `unit_price_snapshot` à la vente (Constitution §4.1).
  price: string;
  /// Rendu au client pour que l'écran grise les ruptures et plafonne les
  /// quantités. Ce n'est **pas** une réservation : composer un panier ne retient
  /// rien, et le stock peut partir avant la validation.
  stock: number;
};

/// `cache()` de React : le tunnel et la vue de détail d'intervention lisent ce
/// catalogue dans le même rendu. Sans lui, deux requêtes identiques par visite,
/// sur une base jointe par tunnel SSH.
export const listProduitsVendables = cache(
  async (): Promise<ProduitVendable[]> => {
    const produits = await db.product.findMany({
      // La vue publique MASQUE l'inactif, là où la vue admin le grise
      // (`US-PRODUIT-LISTER`). Même partage que le catalogue des forfaits : le
      // filtre appartient à la requête, pas à la vue.
      where: { isActive: true },
      select: {
        id: true,
        label: true,
        description: true,
        price: true,
        stock: true,
      },
      // Alphabétique, et non par prix comme les forfaits : on ne compare pas
      // trois produits d'un catalogue qui grandira, on y cherche un article.
      // `id` départage deux libellés identiques et rend l'ordre stable d'un
      // seed rejoué à l'autre.
      orderBy: [{ label: "asc" }, { id: "asc" }],
    });

    return produits.map((produit) => ({
      ...produit,
      price: produit.price.toFixed(2),
    }));
  },
);

/// Une ligne de panier telle qu'elle voyage depuis l'écran : un produit, une
/// quantité. **Jamais un prix** - il est lu en base au moment de la vente.
export type LignePanier = {
  productId: number;
  quantity: number;
};

/// Échecs de vente, tous rattrapables par le client sans support.
export type EchecStock =
  | { reason: "produit_indisponible"; label: string }
  | { reason: "stock_insuffisant"; label: string; disponible: number };

type ProduitVerrouille = {
  id: number;
  label: string;
  price: Prisma.Decimal;
  stock: number;
  isActive: boolean;
};

/// Verrou pessimiste sur les produits d'un panier (PLAN S2 §5.4).
///
/// `SELECT … FOR UPDATE` sérialise les ventes concurrentes sur ces `product_id`
/// jusqu'au commit. Le `ORDER BY "id"` n'est pas cosmétique : deux paniers qui
/// se croisent sur les mêmes produits verrouillent dans le **même ordre**, et
/// ne peuvent donc pas s'interbloquer en se tenant chacun la ligne que l'autre
/// attend.
///
/// Le second filet est en base - `products_stock_non_negative`, migration 013.
/// Le verrou rend l'erreur intelligible, la contrainte rend l'état impossible.
async function verrouillerProduits(
  tx: Prisma.TransactionClient,
  identifiants: readonly number[],
): Promise<Map<number, ProduitVerrouille>> {
  const verrouilles = await tx.$queryRaw<ProduitVerrouille[]>`
    SELECT "id", "label", "price", "stock", "is_active" AS "isActive"
    FROM "products"
    WHERE "id" IN (${Prisma.join([...identifiants])})
    ORDER BY "id"
    FOR UPDATE
  `;

  return new Map(verrouilles.map((produit) => [produit.id, produit]));
}

/// Vend un panier : contrôle, décrément et écriture des lignes figées.
///
/// Appelée **dans** la transaction de l'appelant, jamais à côté. À T=0 c'est
/// celle de la réservation : si la contrainte anti-double-réservation rejette
/// l'intervention, le stock revient tout seul. Une vente qui commiterait
/// séparément laisserait du stock décrémenté pour un rendez-vous inexistant.
export async function vendreProduits(
  tx: Prisma.TransactionClient,
  params: { interventionId: number; panier: readonly LignePanier[] },
): Promise<{ ok: true; total: Prisma.Decimal } | ({ ok: false } & EchecStock)> {
  if (params.panier.length === 0) {
    return { ok: true, total: new Prisma.Decimal(0) };
  }

  const produits = await verrouillerProduits(
    tx,
    params.panier.map((ligne) => ligne.productId),
  );

  let total = new Prisma.Decimal(0);

  for (const ligne of params.panier) {
    const produit = produits.get(ligne.productId);

    // Produit disparu du catalogue ou dépublié pendant la composition du
    // panier. Les deux se disent pareil au client : il n'a rien à en faire de
    // différent, et la nuance ne lui apprendrait que l'état du catalogue.
    if (!produit || !produit.isActive) {
      return {
        ok: false,
        reason: "produit_indisponible",
        label: produit?.label ?? "Ce produit",
      };
    }

    if (produit.stock < ligne.quantity) {
      return {
        ok: false,
        reason: "stock_insuffisant",
        label: produit.label,
        disponible: produit.stock,
      };
    }

    await tx.product.update({
      where: { id: produit.id },
      data: { stock: { decrement: ligne.quantity } },
    });

    // `unit_price_snapshot` est lu EN BASE, jamais reçu de l'écran : un prix
    // qui vient du client est un prix que le client choisit.
    await tx.interventionProduct.create({
      data: {
        interventionId: params.interventionId,
        productId: produit.id,
        quantity: ligne.quantity,
        unitPriceSnapshot: produit.price,
      },
    });

    total = total.plus(produit.price.times(ligne.quantity));
  }

  return { ok: true, total };
}

/// Résultat des deux mutations T+n.
export type ResultatLigne =
  | { ok: true; total: string }
  /// Intervention inconnue **ou** appartenant à quelqu'un d'autre : la réponse
  /// est la même. `US-INTERVENTION-PRODUIT-AJOUTER` §Cas d'erreur écrit 403
  /// pour le non-propriétaire, mais un 403 distinct d'un 404 confirme
  /// l'existence de l'intervention d'un tiers à qui s'amuse à incrémenter. Le
  /// dépôt a déjà payé ce défaut une fois, sur les adresses (PR #26 note 4).
  | { ok: false; reason: "introuvable" }
  | { ok: false; reason: "verrouillee" }
  | { ok: false; reason: "ligne_absente" }
  | ({ ok: false } & EchecStock);

/// L'intervention **du client**, si elle accepte encore une modification de
/// panier. Lue dans la transaction, comme tout ce qui décide d'une écriture.
async function chargerInterventionModifiable(
  tx: Prisma.TransactionClient,
  params: { interventionId: number; clientId: string },
): Promise<
  | { ok: true; priceSnapshot: Prisma.Decimal }
  | { ok: false; reason: "introuvable" | "verrouillee" }
> {
  const intervention = await tx.intervention.findFirst({
    where: { id: params.interventionId, clientId: params.clientId },
    select: { status: true, priceSnapshot: true },
  });

  if (!intervention) return { ok: false, reason: "introuvable" };
  if (intervention.status !== STATUT_MODIFIABLE) {
    return { ok: false, reason: "verrouillee" };
  }

  return { ok: true, priceSnapshot: intervention.priceSnapshot };
}

/// Total affiché d'une intervention.
///
/// `price_snapshot` porte le **forfait seul**, et le total se recalcule à
/// l'affichage : les deux US produits écrivent la formule mot pour mot,
/// « `price_snapshot` forfait + Σ (`unit_price_snapshot` × quantity) ». Le
/// dictionnaire §interventions champ 7 dit « prix TOTAL figé » et se trompe -
/// un total stocké obligerait chaque ajout T+n à réécrire un instantané, et
/// romprait le miroir que `duration_snapshot` forme avec lui.
async function calculerTotal(
  tx: Prisma.TransactionClient,
  params: { interventionId: number; priceSnapshot: Prisma.Decimal },
): Promise<string> {
  const lignes = await tx.interventionProduct.findMany({
    where: { interventionId: params.interventionId },
    select: { quantity: true, unitPriceSnapshot: true },
  });

  return lignes
    .reduce(
      (total, ligne) =>
        total.plus(ligne.unitPriceSnapshot.times(ligne.quantity)),
      params.priceSnapshot,
    )
    .toFixed(2);
}

/// Ajout T+n - `US-INTERVENTION-PRODUIT-AJOUTER`.
///
/// `quantity` est un **delta**, pas une quantité cible, et le plafond de stock
/// porte sur lui : un client qui a déjà trois unités quand il en reste deux au
/// catalogue doit pouvoir en ajouter une quatrième. Le plafonner sur le total
/// refuserait un ajout légitime, et le refus serait muet.
export async function ajouterProduitIntervention(params: {
  interventionId: number;
  productId: number;
  quantity: number;
  clientId: string;
}): Promise<ResultatLigne> {
  return db.$transaction(async (tx) => {
    const intervention = await chargerInterventionModifiable(tx, params);
    if (!intervention.ok) return intervention;

    const produits = await verrouillerProduits(tx, [params.productId]);
    const produit = produits.get(params.productId);

    if (!produit || !produit.isActive) {
      return {
        ok: false as const,
        reason: "produit_indisponible" as const,
        label: produit?.label ?? "Ce produit",
      };
    }

    if (produit.stock < params.quantity) {
      return {
        ok: false as const,
        reason: "stock_insuffisant" as const,
        label: produit.label,
        disponible: produit.stock,
      };
    }

    await tx.product.update({
      where: { id: produit.id },
      data: { stock: { decrement: params.quantity } },
    });

    // La clé primaire est le couple `(intervention_id, product_id)` : le modèle
    // ne peut pas porter deux lignes du même produit, donc deux prix figés
    // différents. Un ré-ajout incrémente la quantité et **conserve le snapshot
    // d'origine** - le réactualiser réécrirait le prix d'unités déjà vendues,
    // ce que Constitution §4.1 interdit.
    await tx.interventionProduct.upsert({
      where: {
        interventionId_productId: {
          interventionId: params.interventionId,
          productId: produit.id,
        },
      },
      update: { quantity: { increment: params.quantity } },
      create: {
        interventionId: params.interventionId,
        productId: produit.id,
        quantity: params.quantity,
        unitPriceSnapshot: produit.price,
      },
    });

    return {
      ok: true as const,
      total: await calculerTotal(tx, {
        interventionId: params.interventionId,
        priceSnapshot: intervention.priceSnapshot,
      }),
    };
  });
}

/// Retrait T+n - `US-INTERVENTION-PRODUIT-SUPPRIMER`.
///
/// La ligne part **entière** : l'US décrit un bouton « Retirer » sur la ligne,
/// pas un décrément unité par unité. Le stock est restitué à hauteur de la
/// quantité retirée, sous le même verrou que le décrément - c'est cette
/// symétrie qui rend le stock conservatif, et c'est elle que le test « retrait
/// puis ré-ajout laissent le stock inchangé » exerce.
export async function retirerProduitIntervention(params: {
  interventionId: number;
  productId: number;
  clientId: string;
}): Promise<ResultatLigne> {
  return db.$transaction(async (tx) => {
    const intervention = await chargerInterventionModifiable(tx, params);
    if (!intervention.ok) return intervention;

    // Verrouillé AVANT la lecture de la ligne : deux retraits concurrents de la
    // même ligne restitueraient sinon le stock deux fois.
    await verrouillerProduits(tx, [params.productId]);

    const ligne = await tx.interventionProduct.findUnique({
      where: {
        interventionId_productId: {
          interventionId: params.interventionId,
          productId: params.productId,
        },
      },
      select: { quantity: true },
    });

    // Double-clic, ou onglet resté ouvert sur un état périmé.
    if (!ligne) return { ok: false as const, reason: "ligne_absente" as const };

    await tx.interventionProduct.delete({
      where: {
        interventionId_productId: {
          interventionId: params.interventionId,
          productId: params.productId,
        },
      },
    });

    await tx.product.update({
      where: { id: params.productId },
      data: { stock: { increment: ligne.quantity } },
    });

    return {
      ok: true as const,
      total: await calculerTotal(tx, {
        interventionId: params.interventionId,
        priceSnapshot: intervention.priceSnapshot,
      }),
    };
  });
}
