import { randomBytes } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

import {
  creerClientActive,
  inscrire,
  MOT_DE_PASSE_CLIENT,
  seConnecterClient,
} from "../support/compte-client";

/// **Droit à l'oubli** - `US-COMPTE-SUPPRIMER`, T-V3-12.
///
/// C'est la seule mutation **irréversible** du parcours client, et la seule que
/// la politique de confidentialité décrit à un tiers. Ce qu'aucun test unitaire
/// ne peut prouver, et qui se joue donc ici, sur une vraie base :
///
///   · les champs identifiants sont réellement remplacés, y compris la
///     **géométrie** de l'adresse, que Prisma ne sait ni lire ni écrire ;
///   · **l'historique d'intervention subsiste**, et reste lisible par une
///     lecture d'exploitation - c'est l'obligation comptable de dix ans que la
///     politique déclare ;
///   · le compte pseudonymisé **ne permet plus de se connecter**, sur toutes
///     les sessions et pas seulement celle du navigateur courant.
///
/// Les interventions sont semées EN BASE, même motif que `gp-03` : `gp-02`
/// couvre le tunnel, le rejouer ici ferait dépendre le scénario de la
/// disponibilité d'un créneau.

let db: PrismaClient;
let serviceId: number;
let techId: string;
let villeId: number;

const comptesCrees: string[] = [];
const interventionsCreees: number[] = [];
const adressesCreees: number[] = [];

test.beforeAll(async () => {
  db = new PrismaClient();

  const service = await db.service.findFirstOrThrow({
    where: { isActive: true },
  });
  serviceId = service.id;

  const ville = await db.city.findFirstOrThrow();
  villeId = ville.id;

  // Un technicien dédié, comme en `gp-03` : `no_double_booking` porte sur le
  // couple technicien/plage, le seed n'en pose qu'un, et la base de
  // développement est partagée entre les deux postes. Il n'est affecté à aucune
  // zone, donc il n'apparaît dans aucune grille de créneaux.
  const tech = await db.user.create({
    data: {
      email: `tech-oubli-${randomBytes(6).toString("hex")}@example.test`,
      firstname: "Tech",
      lastname: "Oubli",
      roles: ["ROLE_TECH"],
      isActive: true,
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });
  techId = tech.id;
});

test.afterAll(async () => {
  // L'ordre suit les clés étrangères, et l'audit passe en premier :
  // `audit_logs.actor_id` est une FK NOT NULL vers les comptes qu'on efface
  // juste après.
  await db.auditLog.deleteMany({
    where: { actorId: { in: [...comptesCrees, techId] } },
  });
  await db.intervention.deleteMany({
    where: { id: { in: interventionsCreees } },
  });
  await db.address.deleteMany({ where: { id: { in: adressesCreees } } });
  await db.authProvider.deleteMany({ where: { userId: { in: comptesCrees } } });
  await db.verificationToken.deleteMany({
    where: { userId: { in: comptesCrees } },
  });
  await db.user.deleteMany({
    where: { id: { in: [...comptesCrees, techId] } },
  });
  await db.$disconnect();
});

let decalage = 0;

/// Un client activé, une adresse à lui, et une intervention passée qui la
/// référence. C'est l'état minimal dans lequel la pseudonymisation a quelque
/// chose à préserver.
async function semerClientAvecHistorique(
  page: import("@playwright/test").Page,
  prefixe: string,
) {
  const { email, userId } = await creerClientActive(page, db, prefixe);
  comptesCrees.push(userId);

  const adresse = await db.$queryRaw<{ id: number }[]>`
    INSERT INTO addresses (street, city_id, location, user_id, label, is_active)
    VALUES ('14 rue de l''Oubli', ${villeId},
            ST_SetSRID(ST_MakePoint(4.8357, 45.7640), 4326)::geography,
            ${userId}::uuid, 'Domicile', true)
    RETURNING id
  `;
  const addressId = adresse[0]!.id;
  adressesCreees.push(addressId);

  decalage += 1;
  const service = await db.service.findUniqueOrThrow({
    where: { id: serviceId },
  });
  const intervention = await db.intervention.create({
    data: {
      status: "DONE",
      // Dans le passé : c'est l'historique que l'obligation comptable protège.
      appointmentAt: new Date(Date.now() - (48 + decalage) * 3_600_000),
      completedAt: new Date(Date.now() - 47 * 3_600_000),
      priceSnapshot: service.price,
      durationSnapshot: service.duration,
      clientId: userId,
      techId,
      addressId,
      serviceId,
    },
    select: { id: true },
  });
  interventionsCreees.push(intervention.id);

  return { email, userId, addressId, interventionId: intervention.id };
}

/// Le point GPS, lu en SQL brut : la colonne est `Unsupported`, le client
/// Prisma la masque, et un `findUnique` ne dirait jamais si elle est nulle.
async function pointEstEfface(addressId: number): Promise<boolean> {
  const lignes = await db.$queryRaw<{ vide: boolean }[]>`
    SELECT location IS NULL AS vide FROM addresses WHERE id = ${addressId}
  `;
  return lignes[0]!.vide;
}

test.describe("Droit à l'oubli - ce que l'écran déclare avant l'acte", () => {
  test("annonce que les données conservées restent ré-identifiables", async ({
    page,
  }) => {
    const { email } = await semerClientAvecHistorique(page, "oubli-mention");
    await seConnecterClient(page, email);
    await page.goto("/mon-compte/supprimer");

    // C'est l'écran où quelqu'un décide d'un acte irréversible, et la seule
    // information qui distingue une pseudonymisation d'une anonymisation.
    // PLAN S2 §T6 l'impose ; S4 §4.4, dont cet écran porte le verbatim, ne le
    // disait pas - les deux sections se contredisaient depuis le 2026-07-29.
    const avertissement = page.getByRole("region", {
      name: "Action irréversible",
    });
    await expect(avertissement).toContainText(/identifier par recoupement/i);
    // Annoncée POSSIBLE, jamais adoucie : une ré-identification présentée comme
    // théorique ne prévient de rien.
    await expect(avertissement).not.toContainText(
      /théoriquement|improbable|peu probable/i,
    );
    // Et la mention reste attachée à sa cause, les dix ans de conservation.
    await expect(avertissement).toContainText(/10 ans/);
  });

  test("annonce que la commune des adresses est conservée", async ({
    page,
  }) => {
    const { email } = await semerClientAvecHistorique(page, "oubli-commune");
    await seConnecterClient(page, email);
    await page.goto("/mon-compte/supprimer");

    // L'écran énumère ce qui part et ce qui reste, en deux colonnes : la commune
    // survit à la pseudonymisation (`addresses.city_id` pointe une table
    // partagée), et sans cette ligne les deux colonnes se contrediraient.
    await expect(
      page.getByRole("region", { name: "Action irréversible" }),
    ).toContainText(/commune/i);
    await expect(
      page.getByRole("region", { name: "Conservé sous identifiant anonyme" }),
    ).toContainText(/commune/i);
  });
});

test.describe("Droit à l'oubli - ce qui protège", () => {
  test("un visiteur anonyme est renvoyé vers la connexion", async ({
    page,
  }) => {
    await page.goto("/mon-compte/supprimer");

    // `src/proxy.ts` pose le redirect optimiste et le `next=` ; la garde réelle
    // est `getCurrentUser` dans la page.
    await expect(page).toHaveURL(/\/connexion\?next=%2Fmon-compte%2Fsupprimer/);
  });

  test("un mot de passe faux ne supprime rien", async ({ page }) => {
    const { email, userId } = await semerClientAvecHistorique(
      page,
      "oubli-faux",
    );
    await seConnecterClient(page, email);

    await page.goto("/mon-compte/supprimer");
    await page.getByRole("button", { name: "Supprimer mon compte" }).click();
    await page
      .getByLabel(/saisissez votre mot de passe/i)
      .fill("ce-n-est-pas-le-bon");
    await page
      .getByRole("button", { name: /Supprimer définitivement/ })
      .click();

    // `getByRole("alert")` est ici sans ambiguïté, et c'est une propriété de
    // Radix plutôt qu'une chance : le panneau modal ouvert pose `aria-hidden`
    // sur tout le reste du document, y compris l'annonceur de route de Next qui
    // porte ce même rôle sur chaque page.
    await expect(page.getByRole("alert")).toHaveText("Mot de passe incorrect");

    // L'oracle qui compte est en BASE, pas à l'écran : le message pourrait être
    // juste et l'effacement avoir eu lieu quand même.
    const compte = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(compte.email).toBe(email);
    expect(compte.deletedAt).toBeNull();
    expect(compte.isActive).toBe(true);
  });
});

test.describe("Droit à l'oubli - la pseudonymisation", () => {
  test("efface l'identité, conserve l'intervention, et déconnecte", async ({
    page,
  }) => {
    const { email, userId, addressId, interventionId } =
      await semerClientAvecHistorique(page, "oubli-nominal");
    await seConnecterClient(page, email);

    // Le chemin que `US-COMPTE-SUPPRIMER` §Cas nominal nomme en second, et le
    // seul qui existe tant que l'écran C12 (T-V3-07) n'est pas livré.
    await page.goto("/politique-confidentialite");
    await page.getByRole("link", { name: "Supprimer mon compte" }).click();
    await expect(page).toHaveURL(/\/mon-compte\/supprimer$/);

    await page.getByRole("button", { name: "Supprimer mon compte" }).click();
    await page
      .getByLabel(/saisissez votre mot de passe/i)
      .fill(MOT_DE_PASSE_CLIENT);
    await page
      .getByRole("button", { name: /Supprimer définitivement/ })
      .click();

    // Retour à l'accueil public avec le message final de l'US.
    await expect(page).toHaveURL(/\/\?compte=supprime$/);
    await expect(page.getByRole("status")).toHaveText(
      "Votre compte a été supprimé.",
    );
    // La session est tombée : l'en-tête reproposerait le menu utilisateur
    // sinon.
    await expect(
      page.getByRole("banner").getByRole("link", { name: /Connexion/i }),
    ).toBeVisible();

    const compte = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(compte.firstname).toBe("Utilisateur");
    expect(compte.lastname).toBe("Anonymisé");
    expect(compte.email).toBe(`deleted-${userId}@anon.local`);
    expect(compte.phone).toBeNull();
    expect(compte.isActive).toBe(false);
    expect(compte.deletedAt).not.toBeNull();

    // Les identifiants d'authentification partent avec l'identité.
    expect(await db.authProvider.count({ where: { userId } })).toBe(0);

    // L'adresse : rue anonymisée ET point GPS effacé. Le second est la moitié
    // que `US-COMPTE-SUPPRIMER` laissait « à trancher PLAN + juriste » et que
    // le PLAN n'avait jamais tranchée - arbitré le 2026-08-11, migration 015.
    const adresse = await db.address.findUniqueOrThrow({
      where: { id: addressId },
    });
    expect(adresse.street).toBe("Anonymisée");
    expect(adresse.label).toBeNull();
    expect(await pointEstEfface(addressId)).toBe(true);

    // L'historique subsiste, et sa clé étrangère est intacte : c'est
    // l'obligation comptable de dix ans que la politique déclare.
    const intervention = await db.intervention.findUniqueOrThrow({
      where: { id: interventionId },
    });
    expect(intervention.clientId).toBe(userId);
    expect(intervention.addressId).toBe(addressId);
    expect(intervention.status).toBe("DONE");

    // Constitution §4.2 : la trace, avec l'action que le dictionnaire nomme.
    const trace = await db.auditLog.findFirstOrThrow({
      where: { entityType: "users", entityId: userId, action: "ANONYMIZE" },
    });
    expect(trace.actorId).toBe(userId);
    expect(trace.details).toEqual({
      deletion_reason: "client_right_to_be_forgotten",
    });
  });

  test("le compte pseudonymisé ne permet plus de se connecter", async ({
    page,
  }) => {
    const { email } = await semerClientAvecHistorique(
      page,
      "oubli-reconnexion",
    );
    await seConnecterClient(page, email);

    await page.goto("/mon-compte/supprimer");
    await page.getByRole("button", { name: "Supprimer mon compte" }).click();
    await page
      .getByLabel(/saisissez votre mot de passe/i)
      .fill(MOT_DE_PASSE_CLIENT);
    await page
      .getByRole("button", { name: /Supprimer définitivement/ })
      .click();
    await expect(page).toHaveURL(/\?compte=supprime$/);

    await page.goto("/connexion");
    await page.getByLabel("Adresse email").fill(email);
    await page
      .getByLabel("Mot de passe", { exact: true })
      .fill(MOT_DE_PASSE_CLIENT);
    await page.getByRole("button", { name: "Se connecter" }).click();

    // Refus **indifférencié** : le même message que pour un email inconnu.
    // Distinguer « compte supprimé » rouvrirait l'énumération que
    // Constitution §4.2 ferme.
    //
    // ⚠️ Pas `getByRole("alert")` : Next monte son propre annonceur de route
    // (`__next-route-announcer__`) avec ce rôle sur toute page, et le mode
    // strict de Playwright en résout alors deux. Constaté ici, à corriger
    // partout où un E2E interroge une alerte par son rôle.
    await expect(page.getByText(/Identifiants invalides/i)).toBeVisible();
    await expect(page).toHaveURL(/\/connexion/);
  });

  test("l'adresse email redevient disponible pour un nouveau compte", async ({
    page,
  }) => {
    // ⚠️ Ajout de l'agent testeur, 2026-08-12.
    //
    // Le droit à l'oubli **efface**, il ne bannit pas : quelqu'un qui se
    // ravise doit pouvoir revenir. C'est `emailPseudonyme` qui libère l'index
    // unique de `users.email` en déplaçant l'ancienne adresse sur
    // `deleted-<uuid>@anon.local`, et rien ne l'éprouvait de bout en bout - un
    // helper qui se contenterait de vider `firstname`/`lastname` passerait tous
    // les autres tests de ce fichier et fermerait l'adresse pour toujours,
    // avec un « email déjà utilisé » que personne ne saurait expliquer.
    const { email } = await semerClientAvecHistorique(page, "oubli-retour");
    await seConnecterClient(page, email);

    await page.goto("/mon-compte/supprimer");
    await page.getByRole("button", { name: "Supprimer mon compte" }).click();
    await page
      .getByLabel(/saisissez votre mot de passe/i)
      .fill(MOT_DE_PASSE_CLIENT);
    await page
      .getByRole("button", { name: /Supprimer définitivement/ })
      .click();
    await expect(page).toHaveURL(/\?compte=supprime$/);

    await inscrire(page, email);

    await expect(page.getByText(/Vérifiez votre email/i).first()).toBeVisible();

    // L'oracle est en base : l'écran d'inscription répond la MÊME chose sur une
    // adresse déjà prise (anti-énumération, `US-COMPTE-CREER`), donc le message
    // ci-dessus ne prouve rien à lui seul.
    const nouveau = await db.user.findUniqueOrThrow({
      where: { email },
      select: { id: true, deletedAt: true },
    });
    comptesCrees.push(nouveau.id);
    expect(nouveau.deletedAt).toBeNull();
  });

  test("une intervention rattachée à une adresse pseudonymisée reste lisible en exploitation", async ({
    page,
  }) => {
    const { userId, email, interventionId } = await semerClientAvecHistorique(
      page,
      "oubli-exploitation",
    );
    await seConnecterClient(page, email);

    await page.goto("/mon-compte/supprimer");
    await page.getByRole("button", { name: "Supprimer mon compte" }).click();
    await page
      .getByLabel(/saisissez votre mot de passe/i)
      .fill(MOT_DE_PASSE_CLIENT);
    await page
      .getByRole("button", { name: /Supprimer définitivement/ })
      .click();
    await expect(page).toHaveURL(/\?compte=supprime$/);

    // ⚠️ **Oracle sur la DONNÉE, pas sur un écran, et c'est déclaré.** Aucune
    // vue technicien ni administrateur des interventions n'existe au HEAD
    // courant : `src/app/(app)/tech` et `/admin` ne portent que les paramètres
    // société. Ce qui est éprouvé ici est la lecture que ces écrans feront -
    // la jointure complète d'une fiche d'intervention, sur une adresse dont la
    // géométrie est nulle et dont le titulaire est pseudonymisé.
    //
    // La régression que cette assertion attrape est réelle : une jointure ou
    // un `NOT NULL` mal placé rendrait l'historique **illisible** après une
    // suppression, et personne ne s'en apercevrait avant la vague V2.
    const fiche = await db.intervention.findUniqueOrThrow({
      where: { id: interventionId },
      include: {
        client: { select: { firstname: true, lastname: true, email: true } },
        tech: { select: { firstname: true } },
        address: {
          select: {
            street: true,
            city: { select: { zipCode: true, city: true } },
          },
        },
        service: { select: { label: true } },
      },
    });

    expect(fiche.client.firstname).toBe("Utilisateur");
    expect(fiche.client.email).toBe(`deleted-${userId}@anon.local`);
    expect(fiche.address.street).toBe("Anonymisée");
    // La commune reste : elle n'identifie personne et l'exploitation en a
    // besoin pour lire son historique.
    expect(fiche.address.city.city).not.toBe("");
    expect(fiche.service.label).not.toBe("");
    expect(fiche.tech.firstname).toBe("Tech");
  });
});

test.describe("Droit à l'oubli - l'anti-rejeu au niveau de la base", () => {
  test("un second effacement ne peut pas s'appliquer à une ligne déjà pseudonymisée", async ({
    page,
  }) => {
    // ⚠️ Ajout de l'agent testeur, 2026-08-12.
    //
    // `pseudonymiserCompte` ne prend AUCUN verrou de ligne, contrairement à
    // `annulerInterventionDuClient` et `ajouterPhoto` : son anti-rejeu est
    // entièrement porté par le `deletedAt: null` du `where` de l'update
    // (`src/lib/db/queries/users.ts:104-105`), et par la sémantique que Prisma
    // lui donne. Cette sémantique est une affirmation sur une BIBLIOTHÈQUE, et
    // rien ne la vérifiait : un `update` étendu qui se contenterait de toucher
    // zéro ligne sans lever laisserait le second appel poursuivre et écrire une
    // SECONDE trace `ANONYMIZE` pour un seul effacement.
    //
    // Le test rejoue la primitive elle-même, en séquentiel : c'est
    // déterministe, là où deux transactions concurrentes ne le seraient pas.
    // Ce qu'il ne prouve pas, et qui reste ouvert : que deux appels VRAIMENT
    // simultanés se sérialisent, et que la garde du dernier administrateur y
    // survive - elle, elle ne lit qu'un `count` sans verrou.
    const { userId } = await semerClientAvecHistorique(page, "oubli-rejeu");

    await db.user.update({
      where: { id: userId, deletedAt: null },
      data: { deletedAt: new Date(), isActive: false },
    });

    await expect(
      db.user.update({
        where: { id: userId, deletedAt: null },
        data: { firstname: "Rejeu" },
      }),
    ).rejects.toThrow();

    const compte = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(compte.firstname).not.toBe("Rejeu");
  });
});

test.describe("Droit à l'oubli - accessibilité", () => {
  test("l'écran ne présente aucune violation, dialogue ouvert compris", async ({
    page,
  }) => {
    const { email } = await semerClientAvecHistorique(page, "oubli-a11y");
    await seConnecterClient(page, email);
    await page.goto("/mon-compte/supprimer");

    const avant = await new AxeBuilder({ page }).analyze();
    expect(avant.violations.filter((v) => v.impact !== "minor")).toEqual([]);

    await page.getByRole("button", { name: "Supprimer mon compte" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Le panneau modal est le moment où l'arbre accessible change le plus :
    // focus piégé, reste du document masqué. C'est là qu'un audit compte.
    const pendant = await new AxeBuilder({ page }).analyze();
    expect(pendant.violations.filter((v) => v.impact !== "minor")).toEqual([]);
  });

  test("l'écran tient en 375 px", async ({ page }) => {
    const { email } = await semerClientAvecHistorique(page, "oubli-mobile");
    await seConnecterClient(page, email);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/mon-compte/supprimer");

    // Aucun débordement horizontal : la leçon du 2026-08-10 sur la barre
    // d'actions du tunnel, démentie sur un téléphone réel après avoir été
    // déclarée vérifiée au navigateur de bureau.
    const largeurDocument = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(largeurDocument).toBeLessThanOrEqual(375);

    const resultats = await new AxeBuilder({ page }).analyze();
    expect(resultats.violations.filter((v) => v.impact !== "minor")).toEqual(
      [],
    );
  });
});
