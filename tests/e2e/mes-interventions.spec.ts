import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";

import { creerClientActive, seConnecterClient } from "../support/compte-client";

/// Espace client - `US-INTERVENTIONS-LISTER-CLIENT-A-VENIR`,
/// `US-INTERVENTIONS-LISTER-CLIENT-PASSEES`, `US-INTERVENTION-PHOTOS-AJOUTER`
/// (T+n), ecrans **C8** et **C10**.
///
/// Ce fichier ne rejoue pas ce que les tests co-localises couvrent deja (les
/// filtres, la projection, les gardes de propriete). Il eprouve ce qu'un mock ne
/// peut PAS eprouver :
///
///   · **le cloisonnement sur une vraie base** - deux clients, deux
///     interventions, et l'un ne voit jamais celle de l'autre, ni dans sa liste
///     ni par un identifiant force dans l'URL ;
///   · **le depot T+n de bout en bout** - fichier monte, EXIF depouille, ligne
///     ecrite, vignette servie par la route controlee ;
///   · **la destination post-connexion**, qui traverse la Server Action, le
///     cookie et le rendu.
///
/// Les interventions sont semees EN BASE plutot que reservees par le tunnel :
/// `gp-02` couvre deja le tunnel, et le rejouer ici ferait dependre chaque
/// scenario de la disponibilite d'un creneau.

let db: PrismaClient;
let serviceId: number;
let techId: string;
let addressId: number;

/// Tout ce que ce fichier ecrit, pour le retirer ensuite. La base de
/// developpement est partagee entre les deux postes : des interventions
/// laissees derriere fausseraient la demonstration suivante.
const interventionsCreees: number[] = [];
const adressesCreees: number[] = [];

test.beforeAll(async () => {
  db = new PrismaClient();

  const service = await db.service.findFirstOrThrow({
    where: { isActive: true },
  });
  serviceId = service.id;

  const tech = await db.user.findFirstOrThrow({
    where: { roles: { has: "ROLE_TECH" } },
  });
  techId = tech.id;

  // Une adresse rattachee a personne : `addresses.user_id` est NULLable, et la
  // partager entre les deux clients evite d'en creer une par scenario.
  const ville = await db.city.findFirstOrThrow();
  const adresse = await db.$queryRaw<{ id: number }[]>`
    INSERT INTO addresses (street, city_id, location, is_active)
    VALUES ('12 rue de la Republique', ${ville.id},
            ST_SetSRID(ST_MakePoint(4.8357, 45.7640), 4326)::geography, true)
    RETURNING id
  `;
  addressId = adresse[0]!.id;
  adressesCreees.push(addressId);
});

test.afterAll(async () => {
  await db.photo.deleteMany({
    where: { interventionId: { in: interventionsCreees } },
  });
  await db.interventionProduct.deleteMany({
    where: { interventionId: { in: interventionsCreees } },
  });
  await db.intervention.deleteMany({
    where: { id: { in: interventionsCreees } },
  });
  await db.address.deleteMany({ where: { id: { in: adressesCreees } } });
  await db.$disconnect();
});

/// Une intervention posee directement en base.
///
/// `appointment_at` est place loin dans le futur et decale par appel : la
/// contrainte `no_double_booking` porte sur le couple technicien/creneau, et
/// deux scenarios qui viseraient la meme heure se refuseraient l'un l'autre.
let decalage = 0;
async function semerIntervention(options: {
  clientId: string;
  status?: string;
  quandJours?: number;
}): Promise<number> {
  decalage += 1;
  const quand = new Date();
  quand.setUTCDate(quand.getUTCDate() + (options.quandJours ?? 30));
  quand.setUTCHours(8 + (decalage % 8), 0, 0, 0);

  const service = await db.service.findUniqueOrThrow({
    where: { id: serviceId },
  });

  const intervention = await db.intervention.create({
    data: {
      status: options.status ?? "PLANNED",
      appointmentAt: quand,
      priceSnapshot: service.price,
      durationSnapshot: service.duration,
      clientId: options.clientId,
      techId,
      addressId,
      serviceId,
    },
    select: { id: true },
  });

  interventionsCreees.push(intervention.id);
  return intervention.id;
}

/// Le panneau de detail, nomme par son titre.
function panneau(page: Page) {
  return page.getByRole("region", { name: /\d{4}/ });
}

test("la connexion d'un client atterrit sur son espace", async ({ page }) => {
  // DoD finale de la destination post-connexion, provisoire depuis T-V3-03.
  // [[module-1-utilisateurs]] §287 : « client → `/mes-interventions/a-venir` ».
  const { email } = await creerClientActive(page, db, "espace-destination");

  await seConnecterClient(page, email);

  await expect(page).toHaveURL(/\/mes-interventions\/a-venir$/);
});

test("on rejoint l'espace depuis la navbar, sans ouvrir de menu", async ({
  page,
}) => {
  // L'entree de navbar double celle du menu utilisateur : le menu doit etre
  // ouvert pour livrer son contenu, alors que l'espace client est la
  // destination la plus frequente d'un client connecte.
  const { email } = await creerClientActive(page, db, "espace-navbar");
  await seConnecterClient(page, email);

  // Depuis une page PUBLIQUE, pour prouver que l'entree suit la session et pas
  // la route : la coquille publique et l'espace connecte partagent le meme
  // en-tete depuis la fusion de T-V3-10.
  await page.goto("/");
  await page.getByRole("link", { name: "Mes interventions" }).click();

  await expect(page).toHaveURL(/\/mes-interventions\/a-venir$/);
});

test("la navbar ne propose pas l'espace a un visiteur anonyme", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("link", { name: "Mes interventions" }),
  ).toHaveCount(0);
});

test("un visiteur anonyme est renvoye vers la connexion avec son `next`", async ({
  page,
}) => {
  // Les deux US l'ecrivent mot pour mot dans leurs criteres d'erreur. C'est
  // `src/proxy.ts` qui le fabrique, et son matcher ne couvrait pas ce chemin
  // avant T-V3-10.
  await page.goto("/mes-interventions/passees");

  await expect(page).toHaveURL(
    /\/connexion\?next=%2Fmes-interventions%2Fpassees$/,
  );
});

test("la liste vide propose de reserver", async ({ page }) => {
  const { email } = await creerClientActive(page, db, "espace-vide");
  await seConnecterClient(page, email);

  await expect(
    page.getByText(/Vous n'avez pas de rendez-vous prévu/),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Réserver un créneau" }),
  ).toBeVisible();
});

test("un client ne voit que ses propres interventions", async ({ page }) => {
  // Constitution §3.2. La garde est dans la clause `where` de la requete, donc
  // elle ne peut pas etre contournee par un `if` oublie - mais c'est ici, sur
  // une vraie base et deux vrais comptes, qu'on le constate.
  const mien = await creerClientActive(page, db, "espace-mien");
  const autre = await creerClientActive(page, db, "espace-autre");

  await semerIntervention({ clientId: mien.userId });
  const interventionDuTiers = await semerIntervention({
    clientId: autre.userId,
  });

  await seConnecterClient(page, mien.email);

  // Une seule carte : la mienne.
  await expect(page.getByRole("button", { name: /Lyon/ })).toHaveCount(1);

  // Et l'identifiant de l'autre, force dans l'URL, ne l'ouvre pas. La vue
  // retombe sur la premiere SANS message distinct : un « introuvable » qui se
  // distinguerait du cas nominal confirmerait l'existence du rendez-vous
  // d'autrui, sur une table dont la cle est un SERIAL.
  await page.goto(
    `/mes-interventions/a-venir?intervention=${String(interventionDuTiers)}`,
  );

  await expect(panneau(page)).toBeVisible();
  await expect(page.getByText(/introuvable/i)).toHaveCount(0);
});

test("le panneau de detail porte le rendez-vous, son technicien et son montant", async ({
  page,
}) => {
  const client = await creerClientActive(page, db, "espace-detail");
  await semerIntervention({ clientId: client.userId });

  await seConnecterClient(page, client.email);

  const detail = panneau(page);

  await expect(detail.getByText(/12 rue de la Republique/)).toBeVisible();
  // Prenom + initiale, jamais le patronyme entier (protection RGPD, les deux
  // US l'ecrivent).
  const tech = await db.user.findUniqueOrThrow({ where: { id: techId } });
  await expect(
    detail.getByText(`${tech.firstname} ${tech.lastname}`),
  ).toHaveCount(0);
  await expect(
    detail.getByText(`${tech.firstname} ${tech.lastname.charAt(0)}.`),
  ).toBeVisible();

  // ⚠️ « Montant » et non « Montant payé » : `payments` n'existe pas, la table
  // arrive avec T-V2-03.
  await expect(detail.getByText("Montant", { exact: true })).toBeVisible();
  await expect(page.getByText(/Montant pay/i)).toHaveCount(0);
});

test("l'historique liste les interventions terminales et leur motif", async ({
  page,
}) => {
  const client = await creerClientActive(page, db, "espace-historique");
  const annulee = await semerIntervention({
    clientId: client.userId,
    status: "CANCELLED",
    quandJours: -20,
  });
  await db.intervention.update({
    where: { id: annulee },
    data: { cancellationReason: "Client absent" },
  });
  await semerIntervention({
    clientId: client.userId,
    status: "DONE",
    quandJours: -10,
  });

  await seConnecterClient(page, client.email);
  await page.getByRole("link", { name: /Passées/ }).click();

  await expect(page).toHaveURL(/\/mes-interventions\/passees$/);
  await expect(page.getByRole("button", { name: /Lyon/ })).toHaveCount(2);

  // Tri `appointment_at DESC` : la plus recente d'abord, donc la terminee.
  await expect(panneau(page).getByText("Terminée")).toBeVisible();
});

test("l'onglet des passées n'offre aucune modification", async ({ page }) => {
  // Le statut gouverne, pas la route : une intervention cloturee n'accepte ni
  // produit ni photo, et l'ecran ne doit pas proposer un geste que l'action
  // refuse.
  const client = await creerClientActive(page, db, "espace-verrou");
  await semerIntervention({
    clientId: client.userId,
    status: "DONE",
    quandJours: -5,
  });

  await seConnecterClient(page, client.email);
  await page.getByRole("link", { name: /Passées/ }).click();

  await expect(
    page.getByRole("button", { name: /Ajouter un produit/ }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/Ajouter une photo pour le technicien/),
  ).toHaveCount(0);
});

test("le client ajoute puis retire un produit sur son intervention", async ({
  page,
}) => {
  // Montage du bloc T+n, DoD reçue de T-V3-09. La logique et le verrou de stock
  // viennent de PR #32 ; ce qui est verifie ici est que l'ecran les atteint, et
  // que `revalidatePath` rafraichit le panneau.
  const client = await creerClientActive(page, db, "espace-produits");
  const interventionId = await semerIntervention({ clientId: client.userId });

  const produit = await db.product.findFirstOrThrow({
    where: { isActive: true, stock: { gt: 0 } },
  });
  const stockAvant = produit.stock;

  await seConnecterClient(page, client.email);

  await page.getByRole("button", { name: /Ajouter un produit/ }).click();
  await page.getByRole("button", { name: `Ajouter ${produit.label}` }).click();

  await expect(panneau(page).getByText(`${produit.label} x 1`)).toBeVisible();

  // Le stock a bouge en base, pas seulement a l'ecran.
  await expect(async () => {
    const apres = await db.product.findUniqueOrThrow({
      where: { id: produit.id },
      select: { stock: true },
    });
    expect(apres.stock).toBe(stockAvant - 1);
  }).toPass();

  await page.getByRole("button", { name: `Retirer ${produit.label}` }).click();

  await expect(panneau(page).getByText(`${produit.label} x 1`)).toHaveCount(0);

  // Le retrait RESTITUE le stock : c'est la moitie qui manquait a toute DoD
  // jusqu'au 2026-08-08, et sans elle un catalogue se vide au fil des paniers
  // remanies.
  await expect(async () => {
    const apres = await db.product.findUniqueOrThrow({
      where: { id: produit.id },
      select: { stock: true },
    });
    expect(apres.stock).toBe(stockAvant);
  }).toPass();

  const lignes = await db.interventionProduct.count({
    where: { interventionId },
  });
  expect(lignes).toBe(0);
});

test("le client joint une photo, et elle n'est servie qu'a lui", async ({
  page,
  browser,
  baseURL,
}) => {
  // Depot T+n de bout en bout : l'endpoint depouille l'EXIF et ecrit le
  // fichier, la Server Action ecrit la ligne, la route controlee sert l'image.
  const client = await creerClientActive(page, db, "espace-photo");
  const interventionId = await semerIntervention({ clientId: client.userId });

  await seConnecterClient(page, client.email);

  // Un vrai PNG minimal : `sharp` doit pouvoir le decoder, un tampon arbitraire
  // serait refuse en « illisible » et le test passerait pour la mauvaise raison.
  await page.getByLabel(/Ajouter une photo pour le technicien/).setInputFiles({
    name: "velo.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  });

  const vignette = panneau(page).getByRole("img", {
    name: /Photo 1 de l'intervention/,
  });
  await expect(vignette).toBeVisible();

  const photo = await db.photo.findFirstOrThrow({
    where: { interventionId },
  });
  // Ré-encodee en WebP, renommee en UUID : le nom d'origine n'atteint jamais le
  // disque, et l'EXIF disparait par construction.
  expect(photo.url).toMatch(/^uploads\/[0-9a-f-]{36}\.webp$/);
  expect(photo.type).toBe("BEFORE");
  expect(photo.uploadedByUserId).toBe(client.userId);

  const chemin = `/api/intervention-photos/${String(photo.id)}`;

  // ⚠️ **Tout passe par le NAVIGATEUR, jamais par `page.request`**, et ce n'est
  // pas un detail de confort.
  //
  // Le cookie de session est `secure: true` (ADR-005 v2). L'`APIRequestContext`
  // de Playwright ne l'envoie pas en clair vers `127.0.0.1`, alors qu'il
  // l'accepte pour `localhost` - et la barriere CI tape justement
  // `http://127.0.0.1:3000` quand le poste local tape `http://localhost:3000`.
  // Chromium, lui, envoie le cookie sur les deux : c'est ce que prouvent les
  // 100 autres tests de la barriere, dont la connexion elle-meme.
  //
  // Consequence, mesuree sur le MEME build en changeant le seul hote : la
  // premiere version de ce test rendait 200 en local et 404 en CI, sans qu'une
  // ligne de produit ne differe. L'oracle mesurait a travers un client dont la
  // politique de cookies n'est pas celle du navigateur, donc il ne mesurait pas
  // ce que voit un client reel.
  //
  // Ce qui suit teste plus fort que le statut : la vignette **se charge**.
  await expect(vignette).toHaveJSProperty("complete", true);
  expect(
    await vignette.evaluate((image: HTMLImageElement) => image.naturalWidth),
  ).toBeGreaterThan(0);

  // ⚠️ **Et 404 pour tout le monde d'autre.** C'est l'arbitrage du 2026-08-11 :
  // `uploads/` n'est pas servi statiquement, parce qu'une photo prise au
  // domicile de quelqu'un ne doit pas dependre du seul caractere non devinable
  // de son URL - une URL voyage dans les journaux nginx, les referents et
  // l'historique de navigation.
  //
  // Les deux refus passent par une NAVIGATION, pour la meme raison : un
  // `request.get` sans cookie rendrait 404 pour le tiers aussi, mais parce
  // qu'il serait anonyme, pas parce qu'il serait un tiers. Le test ne
  // prouverait alors rien du cloisonnement.
  const anonyme = await browser.newContext(baseURL ? { baseURL } : {});
  const pageAnonyme = await anonyme.newPage();
  expect((await pageAnonyme.goto(chemin))?.status()).toBe(404);
  await anonyme.close();

  const tiers = await browser.newContext(baseURL ? { baseURL } : {});
  const pageTiers = await tiers.newPage();
  const voisin = await creerClientActive(pageTiers, db, "espace-photo-tiers");
  await seConnecterClient(pageTiers, voisin.email);
  // La session du voisin EST ouverte - `seConnecterClient` vient de l'attester
  // sur son en-tete. Le 404 ne peut donc venir que de la garde de propriete.
  expect((await pageTiers.goto(chemin))?.status()).toBe(404);
  await tiers.close();
});

test("la connexion et la deconnexion sont tracees dans `audit_logs`", async ({
  page,
}) => {
  // Migration 014, report de T-V3-03 : le CHECK de la migration 003 bornait la
  // colonne a quatre valeurs, et ni ADR-005 ni ADR-014 §5 ne pouvaient etre
  // satisfaits. `entity_type = 'session'` et non `users` : une connexion est un
  // evenement de securite, pas un acte de gestion (dictionnaire v2.3).
  const client = await creerClientActive(page, db, "espace-audit");

  await seConnecterClient(page, client.email);

  await expect(async () => {
    const connexions = await db.auditLog.count({
      where: { actorId: client.userId, action: "LOGIN", entityType: "session" },
    });
    expect(connexions).toBe(1);
  }).toPass();

  await page.getByRole("button", { name: /Ouvrir le menu de/ }).click();
  await page.getByRole("menuitem", { name: "Se déconnecter" }).click();

  await expect(page).toHaveURL(/\/\?deconnecte=1$/);

  await expect(async () => {
    const sorties = await db.auditLog.count({
      where: {
        actorId: client.userId,
        action: "LOGOUT",
        entityType: "session",
      },
    });
    expect(sorties).toBe(1);
  }).toPass();
});
