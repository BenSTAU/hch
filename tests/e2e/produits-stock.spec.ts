import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

/// Le second filet du verrou de stock - T-V3-09.
///
/// Ce fichier ne rejoue pas ce que `src/lib/db/queries/produits.test.ts`
/// couvre déjà. Il éprouve ce qu'un `tx` simulé ne peut PAS éprouver : les
/// contraintes que PostgreSQL porte lui-même, et qui restent vraies quand un
/// chemin d'écriture futur oublie le garde applicatif. C'est toute la raison
/// d'être du double filet - la vente d'administration de la vague V1 est
/// exactement ce chemin-là.
///
/// Sous Playwright et non Vitest : il faut une vraie base.

let db: PrismaClient;
let productId: number;
let stockOrigine: number;

test.beforeAll(async () => {
  db = new PrismaClient();
  const produit = await db.product.findFirstOrThrow();
  productId = produit.id;
  stockOrigine = produit.stock;
});

test.afterAll(async () => {
  // La base de développement est partagée entre les deux postes : un stock
  // laissé modifié fausserait la démonstration suivante.
  await db.product.update({
    where: { id: productId },
    data: { stock: stockOrigine },
  });
  await db.$disconnect();
});

test("la base refuse un stock négatif, garde applicatif ou pas", async () => {
  // `products_stock_non_negative`, migration 013. L'écriture ci-dessous
  // contourne délibérément la Server Action et son `SELECT … FOR UPDATE` :
  // c'est le seul moyen de vérifier que la contrainte tient toute seule.
  await expect(
    db.product.update({ where: { id: productId }, data: { stock: -1 } }),
  ).rejects.toThrow();

  const apres = await db.product.findUniqueOrThrow({
    where: { id: productId },
    select: { stock: true },
  });
  expect(apres.stock).toBe(stockOrigine);
});

test("un décrément qui dépasse le stock est refusé par la base", async () => {
  // La forme réelle du défaut : pas un `-1` écrit à la main, mais une vente de
  // plus d'unités qu'il n'en reste. Sans la contrainte, la colonne partirait en
  // négatif sans un mot.
  await db.product.update({
    where: { id: productId },
    data: { stock: 1 },
  });

  await expect(
    db.product.update({
      where: { id: productId },
      data: { stock: { decrement: 3 } },
    }),
  ).rejects.toThrow();

  const apres = await db.product.findUniqueOrThrow({
    where: { id: productId },
    select: { stock: true },
  });
  expect(apres.stock).toBe(1);
});

test("un stock nul reste permis, ce n'est pas une anomalie", async () => {
  // `US-PRODUIT-AJOUTER` : « 0 autorisé = produit publié mais rupture
  // affichée ». Une contrainte `> 0` casserait la rupture, qui est un état
  // normal du catalogue.
  await db.product.update({ where: { id: productId }, data: { stock: 0 } });

  const apres = await db.product.findUniqueOrThrow({
    where: { id: productId },
    select: { stock: true },
  });
  expect(apres.stock).toBe(0);
});
