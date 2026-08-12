import { PrismaClient } from "@prisma/client";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  ajouterJours,
  instantUtc,
  jourLocal,
} from "../../src/lib/creneaux/horaires";
import {
  creerCompte,
  creerTechnicien,
  seConnecterCompte,
  seConnecterTechnicien,
  supprimerCompteSeme,
  type TechnicienSeme,
} from "../support/compte-technicien";

/// Tournee du jour - `US-INTERVENTIONS-LISTER-TECH-DU-JOUR`, ecran **T1**.
///
/// Ce fichier ne rejoue pas ce que les tests co-localises couvrent deja (les
/// bornes de la journee, la projection, la garde de la Server Action). Il
/// eprouve ce qu'un mock ne peut PAS eprouver :
///
///   · **la destination post-connexion du technicien**, qui traverse la Server
///     Action de login, le cookie et le rendu ;
///   · **le cloisonnement sur une vraie base** - deux techniciens, et l'un ne
///     voit jamais la tournee de l'autre ;
///   · **la borne de journee contre PostgreSQL**, avec un `timestamptz` reel :
///     un rendez-vous d'hier ne remonte pas ;
///   · **le 403 d'un client**, rendu par `forbidden()` et le fichier
///     `src/app/forbidden.tsx`.
///
/// ⚠️ **Deux techniciens dedies, semes par ce fichier**, et AUCUN n'est affecte
/// a une zone. La derivation des creneaux ne lit que les techniciens affectes a
/// la zone du client : ces comptes sont donc structurellement injoignables par
/// le tunnel, et `gp-02` ne peut pas deposer une reservation dans leur tournee.
/// Sans ca le scenario dependrait de l'ordre d'execution des fichiers et de ce
/// que `gp-02` a laisse derriere lui (cadrage du plancher V2, D7).

let db: PrismaClient;
let techPlein: TechnicienSeme;
let techVide: TechnicienSeme;
let clientId: string;
let serviceId: number;
let addressId: number;
let productLabel: string;

const interventionsCreees: number[] = [];
const adressesCreees: number[] = [];
const utilisateursCreees: string[] = [];

/// Instant UTC correspondant a une heure murale de PARIS, le jour demande.
///
/// Les memes helpers que le code de production, et c'est le point : un
/// `setUTCHours` en dur poserait le rendez-vous a une heure UTC, donc deux
/// heures a cote en ete - le test passerait ou echouerait selon la saison.
function quandLocal(heure: number, decalageJours = 0) {
  const jour = ajouterJours(jourLocal(new Date()), decalageJours);
  return instantUtc(jour, heure * 60);
}

async function semerIntervention(options: {
  techId: string;
  heure: number;
  status?: string;
  decalageJours?: number;
}): Promise<number> {
  const service = await db.service.findUniqueOrThrow({
    where: { id: serviceId },
  });

  const intervention = await db.intervention.create({
    data: {
      status: options.status ?? "PLANNED",
      appointmentAt: quandLocal(options.heure, options.decalageJours ?? 0),
      priceSnapshot: service.price,
      durationSnapshot: service.duration,
      clientId,
      techId: options.techId,
      addressId,
      serviceId,
    },
    select: { id: true },
  });

  interventionsCreees.push(intervention.id);
  return intervention.id;
}

test.beforeAll(async () => {
  db = new PrismaClient();

  const service = await db.service.findFirstOrThrow({
    where: { isActive: true },
  });
  serviceId = service.id;

  const produit = await db.product.findFirstOrThrow();
  productLabel = produit.label;

  // Client porteur d'un nom et d'un telephone CONNUS : ce sont eux que la
  // tournee doit afficher en entier, et un compte cree par l'interface ne
  // porterait pas de telephone.
  const client = await db.user.create({
    data: {
      email: `client-tournee-${Date.now().toString(36)}@example.test`,
      firstname: "Sophie",
      lastname: "Dumas",
      phone: "+33612345678",
      roles: ["ROLE_CLIENT"],
      isActive: true,
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });
  clientId = client.id;
  utilisateursCreees.push(client.id);

  const ville = await db.city.findFirstOrThrow();
  const adresse = await db.$queryRaw<{ id: number }[]>`
    INSERT INTO addresses (street, city_id, location, is_active)
    VALUES ('8 rue Tres Reconnaissable', ${ville.id},
            ST_SetSRID(ST_MakePoint(4.8357, 45.7640), 4326)::geography, true)
    RETURNING id
  `;
  addressId = adresse[0]!.id;
  adressesCreees.push(addressId);

  techPlein = await creerTechnicien(db, "plein");
  techVide = await creerTechnicien(db, "vide");
  utilisateursCreees.push(techPlein.id, techVide.id);

  // Trois interventions aujourd'hui, a des heures distinctes : la contrainte
  // `no_double_booking` porte sur le couple technicien/creneau.
  const matin = await semerIntervention({ techId: techPlein.id, heure: 9 });
  await semerIntervention({
    techId: techPlein.id,
    heure: 14,
    status: "DONE",
  });
  await semerIntervention({
    techId: techPlein.id,
    heure: 16,
    status: "CANCELLED",
  });

  // HIER, pour eprouver la borne basse de la journee sur une vraie colonne
  // `timestamptz`. Elle ne doit jamais apparaitre.
  await semerIntervention({
    techId: techPlein.id,
    heure: 10,
    decalageJours: -1,
  });

  // Celle d'un AUTRE technicien, le meme jour et a une heure qui figure deja
  // dans la tournee du premier : le cloisonnement ne doit tenir qu'au `tech_id`.
  await semerIntervention({ techId: techVide.id, heure: 11 });

  await db.interventionProduct.create({
    data: {
      interventionId: matin,
      productId: produit.id,
      quantity: 2,
      unitPriceSnapshot: produit.price,
    },
  });
});

test.afterAll(async () => {
  await db.interventionProduct.deleteMany({
    where: { interventionId: { in: interventionsCreees } },
  });
  await db.intervention.deleteMany({
    where: { id: { in: interventionsCreees } },
  });
  await db.address.deleteMany({ where: { id: { in: adressesCreees } } });
  // Apres les interventions : `interventions.tech_id` et `client_id` sont NOT
  // NULL, la contrainte refuserait l'ordre inverse.
  for (const id of utilisateursCreees) {
    await supprimerCompteSeme(db, id);
  }
  await db.$disconnect();
});

/// Les lignes de la tournee, et **elles seules**.
///
/// ⚠️ Un `page.getByRole("listitem")` nu en ramassait **treize** pour trois
/// interventions : l'en-tete du site, le pied de page et l'encart de la page de
/// connexion portent tous des listes. L'oracle mesurait donc la coquille du site
/// autant que la tournee, et aurait bouge au premier lien ajoute au pied de
/// page. On passe par la region que la section expose via son `aria-labelledby`.
function lignesTournee(page: Page) {
  return page
    .getByRole("region", { name: "Mes interventions du jour" })
    .getByRole("listitem");
}

test("la connexion d'un technicien atterrit sur sa tournee", async ({
  page,
}) => {
  // DoD finale de la destination post-connexion, provisoire depuis T-V3-03 qui
  // avait refuse de poser une coquille vide. [[module-1-utilisateurs]] §250.
  await seConnecterTechnicien(page, techPlein.email);

  await expect(
    page.getByRole("heading", { level: 1, name: /Aujourd'hui/i }),
  ).toBeVisible();
});

test("la tournee affiche les six elements de chaque ligne", async ({
  page,
}) => {
  await seConnecterTechnicien(page, techPlein.email);

  const lignes = lignesTournee(page);
  await expect(lignes).toHaveCount(3);

  const premiere = lignes.first();
  // Nom COMPLET et telephone : le technicien sonne chez cette personne
  // (Constitution §1.1, cadrage D6). `abregerNom` joue dans l'autre sens.
  await expect(premiere).toContainText("Sophie Dumas");
  await expect(premiere).toContainText("+33612345678");
  // Adresse complete, pas la seule ville.
  await expect(premiere).toContainText("8 rue Tres Reconnaissable");
  await expect(premiere).toContainText("Planifiée");
  // Produits attaches, avec leur quantite au-dela de un.
  await expect(premiere).toContainText(productLabel);
  await expect(premiere).toContainText("× 2");
});

test("les statuts terminaux restent affiches en fin de journee", async ({
  page,
}) => {
  // ⚠️ La tournee est bornee par le JOUR, pas par le statut - regle inverse de
  // l'onglet « A venir » du client. La SPEC l'exige pour la tracabilite de la
  // tournee.
  await seConnecterTechnicien(page, techPlein.email);

  await expect(page.getByText("Terminée")).toBeVisible();
  await expect(page.getByText("Annulée")).toBeVisible();
});

test("un rendez-vous de la veille ne remonte pas", async ({ page }) => {
  // La borne basse, contre une vraie colonne `timestamptz`. Les trois lignes
  // attendues sont celles d'aujourd'hui : la quatrieme, semee hier, est exclue.
  await seConnecterTechnicien(page, techPlein.email);

  await expect(lignesTournee(page)).toHaveCount(3);
  await expect(page.getByText("3 interventions")).toBeVisible();
});

test("un technicien ne voit jamais la tournee d'un autre", async ({ page }) => {
  // Constitution §3.1. `techVide` a exactement une intervention aujourd'hui, a
  // 11 h : elle ne doit apparaitre chez personne d'autre.
  await seConnecterTechnicien(page, techVide.email);

  await expect(lignesTournee(page)).toHaveCount(1);
  await expect(page.getByText("1 intervention")).toBeVisible();
});

test("une journee sans intervention affiche un message explicite", async ({
  page,
}) => {
  // `techVide` porte une intervention aujourd'hui ; on la retire le temps du
  // scenario plutot que de semer un troisieme compte. Le message est celui de
  // l'US §Cas nominal, et l'oracle porte sur l'ABSENCE de liste autant que sur
  // sa presence : une liste vide n'est pas un message.
  const sienne = await db.intervention.findFirstOrThrow({
    where: { techId: techVide.id },
    select: { id: true },
  });
  await db.intervention.update({
    where: { id: sienne.id },
    data: { techId: techPlein.id, appointmentAt: quandLocal(20) },
  });

  try {
    await seConnecterTechnicien(page, techVide.email);

    await expect(
      page.getByText("Aucune intervention prévue aujourd'hui."),
    ).toBeVisible();
    await expect(lignesTournee(page)).toHaveCount(0);
  } finally {
    await db.intervention.update({
      where: { id: sienne.id },
      data: { techId: techVide.id, appointmentAt: quandLocal(11) },
    });
  }
});

test("un client authentifie recoit un 403", async ({ page }) => {
  // `US-INTERVENTIONS-LISTER-TECH-DU-JOUR` §Cas d'erreur. Un refus, pas une
  // page vide et pas une redirection : se reconnecter n'y changerait rien.
  const client = await creerCompte(db, "403", ["ROLE_CLIENT"]);
  utilisateursCreees.push(client.id);
  await seConnecterCompte(page, client.email);

  const reponse = await page.goto("/interventions/du-jour");

  expect(reponse?.status()).toBe(403);
  await expect(
    page.getByRole("heading", { level: 1, name: /Aujourd'hui/i }),
  ).toHaveCount(0);
  // Et surtout : aucune donnee de client tiers n'a fuite dans la reponse.
  await expect(page.locator("body")).not.toContainText("+33612345678");
});

test("un visiteur anonyme est renvoye vers la connexion avec son `next`", async ({
  page,
}) => {
  // Le trou que la DoD case 1 referme : `/interventions/du-jour` n'etait dans
  // aucune entree du matcher de `src/proxy.ts`.
  await page.context().clearCookies();

  await page.goto("/interventions/du-jour");

  await expect(page).toHaveURL(/\/connexion\?next=%2Finterventions%2Fdu-jour$/);
});

test("la tournee ne presente aucune violation RGAA de niveau A", async ({
  page,
}) => {
  await seConnecterTechnicien(page, techPlein.email);

  const resultats = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag21a"])
    .analyze();

  expect(resultats.violations).toEqual([]);
});
