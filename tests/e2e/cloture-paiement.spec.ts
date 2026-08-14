import { PrismaClient } from "@prisma/client";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { instantUtc, jourLocal } from "../../src/lib/creneaux/horaires";
import {
  creerCompte,
  creerTechnicien,
  seConnecterCompte,
  seConnecterTechnicien,
  supprimerCompteSeme,
  type TechnicienSeme,
} from "../support/compte-technicien";

/// Cloture et paiement terrain - `US-INTERVENTION-MARQUER-FAITE` couplee a
/// `US-PAIEMENT-ENREGISTRER`, ecran **T4**. C'est la tache qui ferme le
/// critere n°2.
///
/// Ce fichier ne rejoue pas ce que les tests co-localises couvrent deja (les
/// bornes du montant, le verrou modelise, la garde de la Server Action, les
/// deux panneaux de la modale). Il eprouve ce qu'un mock ne peut PAS eprouver :
///
///   · **le couple ecrit contre PostgreSQL** - la ligne `payments` et le statut
///     de l'intervention relus en base apres coup, sur les DEUX branches ;
///   · **l'unicite d'`intervention_id`**, second filet de l'irreversibilite,
///     qui n'existe que dans la migration 009 ;
///   · **la propagation jusqu'a l'ecran du CLIENT** - « Montant paye » et le
///     motif de refus, deux espaces cloisonnes que seul un test de bout en bout
///     fait se rencontrer ;
///   · **le rendu par un Server Component asynchrone**, que Vitest et RTL ne
///     savent pas derouler (CLAUDE.md §Testing).
///
/// ⚠️ **Techniciens et clients dedies, semes par ce fichier**, aucun affecte a
/// une zone : la derivation des creneaux ne lit que les techniciens affectes,
/// donc `gp-02` ne peut pas deposer de reservation dans ces tournees. Meme
/// mecanique que `detail-intervention.spec.ts` (cadrage D7).

let db: PrismaClient;
let technicien: TechnicienSeme;
let client: TechnicienSeme;
let serviceId: number;
let addressId: number;
let prixForfait: string;

const interventionsCreees: number[] = [];
const adressesCreees: number[] = [];
const utilisateursCreees: string[] = [];

/// Instant UTC correspondant a une heure murale de PARIS, aujourd'hui.
function quandLocal(heure: number) {
  return instantUtc(jourLocal(new Date()), heure * 60);
}

async function semerIntervention(options: {
  techId?: string;
  clientId?: string;
  heure: number;
  status?: string;
}): Promise<number> {
  const intervention = await db.intervention.create({
    data: {
      status: options.status ?? "IN_PROGRESS",
      appointmentAt: quandLocal(options.heure),
      startedAt: new Date(),
      priceSnapshot: prixForfait,
      durationSnapshot: 60,
      clientId: options.clientId ?? client.id,
      techId: options.techId ?? technicien.id,
      addressId,
      serviceId,
    },
    select: { id: true },
  });

  interventionsCreees.push(intervention.id);
  return intervention.id;
}

/// Le meme geste que le technicien, du clic au toast.
async function cloturerParLEcran(
  page: import("@playwright/test").Page,
  id: number,
  options: { montant?: string; mode?: string } = {},
) {
  await page.goto(`/interventions/${String(id)}`);
  await page.getByRole("button", { name: "Marquer comme faite" }).click();

  const modale = page.getByRole("dialog");
  await expect(modale).toBeVisible();

  if (options.montant !== undefined) {
    await modale.getByLabel(/Montant à encaisser/).fill(options.montant);
  }
  if (options.mode) {
    await modale.getByRole("radio", { name: options.mode }).click();
  }

  await modale.getByRole("button", { name: "Confirmer la clôture" }).click();

  // ⚠️ **Attendre la fermeture de la modale, et pas seulement cliquer.** Le clic
  // rend la main avant que la Server Action ait repondu : les deux scenarios qui
  // relisent la base tout de suite echouaient sur un `payments` encore vide, et
  // l'echec ressemblait a un defaut du produit alors que c'etait une course
  // dans l'oracle. La modale ne se ferme qu'une fois la reponse recue.
  await expect(modale).toBeHidden();
}

test.beforeAll(async () => {
  db = new PrismaClient();

  const service = await db.service.findFirstOrThrow({
    where: { isActive: true },
  });
  serviceId = service.id;
  prixForfait = service.price.toFixed(2);

  client = await creerCompte(db, "cloture-client", ["ROLE_CLIENT"]);
  technicien = await creerTechnicien(db, "cloture-tech");
  utilisateursCreees.push(client.id, technicien.id);

  const ville = await db.city.findFirstOrThrow();
  const adresse = await db.$queryRaw<{ id: number }[]>`
    INSERT INTO addresses (street, city_id, location, user_id, is_active)
    VALUES ('9 rue de la Cloture', ${ville.id},
            ST_SetSRID(ST_MakePoint(4.8357, 45.7640), 4326)::geography,
            ${client.id}::uuid, true)
    RETURNING id
  `;
  addressId = adresse[0]!.id;
  adressesCreees.push(addressId);
});

test.afterAll(async () => {
  // `payments.intervention_id` est NOT NULL et sa FK est en `ON DELETE
  // RESTRICT` : elle refuse la suppression du parent. Meme lecon que
  // `photos.intervention_id` sur le fichier voisin.
  await db.payment.deleteMany({
    where: { interventionId: { in: interventionsCreees } },
  });
  await db.interventionProduct.deleteMany({
    where: { interventionId: { in: interventionsCreees } },
  });
  await db.intervention.deleteMany({
    where: { id: { in: interventionsCreees } },
  });
  await db.address.deleteMany({ where: { id: { in: adressesCreees } } });
  for (const id of utilisateursCreees) {
    await supprimerCompteSeme(db, id);
  }
  await db.$disconnect();
});

test("la branche nominale ecrit le paiement ET la cloture, en une fois", async ({
  page,
}) => {
  // 🔴 **La phrase du critere n°2**, et la propriete que la revue humaine de la
  // tache demande de regarder : SPEC §Amendements A4 pose le couple comme
  // indissociable.
  const id = await semerIntervention({ heure: 9 });

  await seConnecterTechnicien(page, technicien.email);
  await cloturerParLEcran(page, id, { mode: "Espèces" });

  await expect(page.getByText("Intervention terminée.")).toBeVisible();

  // Les deux moities, relues en BASE : c'est ce que le rendu ne prouve pas.
  const ligne = await db.intervention.findUniqueOrThrow({ where: { id } });
  expect(ligne.status).toBe("DONE");
  expect(ligne.completedAt).not.toBeNull();

  const paiement = await db.payment.findUniqueOrThrow({
    where: { interventionId: id },
  });
  expect(paiement.status).toBe("PAID");
  expect(paiement.method).toBe("CASH");
  expect(paiement.paidAt).not.toBeNull();
  expect(paiement.recordedBy).toBe(technicien.id);
  // Preregle sur le total, et non retouche : sans produit attache, il vaut le
  // forfait.
  expect(paiement.amountSnapshot.toFixed(2)).toBe(prixForfait);

  // La trace, dans la meme transaction que les deux ecritures.
  const audit = await db.auditLog.findFirst({
    where: { entityType: "interventions", entityId: String(id) },
    orderBy: { createdAt: "desc" },
  });
  expect(audit?.details).toMatchObject({
    statutAvant: "IN_PROGRESS",
    statutApres: "DONE",
    paiement: "PAID",
  });
});

test("le montant preregle porte les produits, pas le forfait seul", async ({
  page,
}) => {
  // 🔴 Cadrage du plancher V2, D9. La SPEC preregle sur `price_snapshot` :
  // toute intervention avec produits serait sous-facturee PAR DEFAUT, et le
  // montant faux remonterait jusqu'a l'ecran des passees du client.
  const id = await semerIntervention({ heure: 10 });
  const produit = await db.product.findFirstOrThrow({
    where: { stock: { gt: 0 } },
  });
  await db.interventionProduct.create({
    data: {
      interventionId: id,
      productId: produit.id,
      quantity: 2,
      unitPriceSnapshot: "12.90",
    },
  });

  const attendu = (Number(prixForfait) + 25.8).toFixed(2);

  await seConnecterTechnicien(page, technicien.email);
  await page.goto(`/interventions/${String(id)}`);
  await page.getByRole("button", { name: "Marquer comme faite" }).click();

  const modale = page.getByRole("dialog");
  await expect(modale.getByLabel(/Montant à encaisser/)).toHaveValue(attendu);

  await modale.getByRole("button", { name: "Confirmer la clôture" }).click();
  await expect(modale).toBeHidden();

  const paiement = await db.payment.findUniqueOrThrow({
    where: { interventionId: id },
  });
  expect(paiement.amountSnapshot.toFixed(2)).toBe(attendu);
});

test("un montant ajuste est celui qui est encaisse", async ({ page }) => {
  // Constitution §2.3 : le montant est declaratif et modifiable.
  // ⚠️ §3.1 n'est pas contredite - elle interdit au technicien de toucher les
  // PRIX, `price_snapshot`, que ce test relit inchange.
  const id = await semerIntervention({ heure: 11 });

  await seConnecterTechnicien(page, technicien.email);
  await cloturerParLEcran(page, id, { montant: "42,50" });

  const paiement = await db.payment.findUniqueOrThrow({
    where: { interventionId: id },
  });
  // La virgule saisie est normalisee en point avant d'atteindre la base.
  expect(paiement.amountSnapshot.toFixed(2)).toBe("42.50");

  const ligne = await db.intervention.findUniqueOrThrow({ where: { id } });
  expect(ligne.priceSnapshot.toFixed(2)).toBe(prixForfait);
});

test("le refus de paiement annule l'intervention et trace un UNPAID", async ({
  page,
}) => {
  // 🔴 Critere v1 de `US-PAIEMENT-ENREGISTRER` §Fallback (finding audit F-12
  // B2), et le plus gros trou de la seconde passe du cadrage : aucune DoD ne le
  // portait avant le 2026-08-12.
  const id = await semerIntervention({ heure: 12 });

  await seConnecterTechnicien(page, technicien.email);
  await page.goto(`/interventions/${String(id)}`);
  await page.getByRole("button", { name: "Marquer comme faite" }).click();

  const modale = page.getByRole("dialog");
  await modale
    .getByRole("button", { name: "Le client refuse le paiement" })
    .click();
  await modale.getByLabel("Motif du refus").fill("Client absent au règlement");
  await modale
    .getByRole("button", { name: "Clôturer sans encaissement" })
    .click();
  await expect(modale).toBeHidden();

  await expect(page.getByText("Intervention annulée.")).toBeVisible();

  const ligne = await db.intervention.findUniqueOrThrow({ where: { id } });
  // `CANCELLED`, PAS `DONE` : le travail a eu lieu, mais le dossier ne peut pas
  // se clore sur un encaissement qui n'existe pas.
  expect(ligne.status).toBe("CANCELLED");
  expect(ligne.cancellationReason).toBe("Client absent au règlement");
  // Une intervention annulee n'est pas une intervention completee.
  expect(ligne.completedAt).toBeNull();

  const paiement = await db.payment.findUniqueOrThrow({
    where: { interventionId: id },
  });
  expect(paiement.status).toBe("UNPAID");
  expect(paiement.method).toBeNull();
  expect(paiement.paidAt).toBeNull();
  expect(paiement.amountSnapshot.toFixed(2)).toBe("0.00");
});

test("une intervention DONE ne se cloture pas deux fois", async ({ page }) => {
  // 🔴 DoD, deux fois : « le paiement est irreversible en v1 » et « une
  // intervention deja DONE ne se cloture pas deux fois ». Le hub ne propose
  // plus rien, et il n'existe aucune route ni action de modification.
  const id = await semerIntervention({ heure: 13, status: "DONE" });

  await seConnecterTechnicien(page, technicien.email);
  await page.goto(`/interventions/${String(id)}`);

  // Controle positif : ancrer l'oracle a un contenu que seule la page rendue
  // porte, sinon un `toHaveCount(0)` passerait aussi sur un 403 ou un 500.
  await expect(page.getByText("Intervention terminée.")).toBeVisible();

  await expect(
    page.getByRole("button", { name: "Marquer comme faite" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Démarrer l'intervention" }),
  ).toHaveCount(0);
});

test("la base refuse une SECONDE ligne de paiement, meme si la garde tombait", async () => {
  // 🔴 Le second filet de l'irreversibilite, et il n'existe que dans la
  // migration 009 : `intervention_id` est UNIQUE. Aucun mock ne peut l'eprouver.
  //
  // Le scenario contourne deliberement la Server Action - il n'y a pas de
  // chemin applicatif pour arriver la, et c'est bien le propos : on verifie que
  // meme sans garde applicative, la base tient.
  const id = await semerIntervention({ heure: 14 });

  await db.payment.create({
    data: {
      interventionId: id,
      amountSnapshot: prixForfait,
      method: "CB",
      status: "PAID",
      paidAt: new Date(),
      recordedBy: technicien.id,
    },
  });

  await expect(
    db.payment.create({
      data: {
        interventionId: id,
        amountSnapshot: "10.00",
        method: "CASH",
        status: "PAID",
        paidAt: new Date(),
        recordedBy: technicien.id,
      },
    }),
  ).rejects.toThrow();
});

test("la base refuse un mode de paiement hors des trois de la Constitution", async () => {
  // Le CHECK de la migration 009. Zod le refuse en amont, et c'est teste ; ceci
  // verifie que le filet du dessous existe aussi - une ecriture par un script
  // ou une console ne passe pas par Zod.
  const id = await semerIntervention({ heure: 15 });

  await expect(
    db.payment.create({
      data: {
        interventionId: id,
        amountSnapshot: "10.00",
        method: "PAYPAL",
        status: "PAID",
        paidAt: new Date(),
        recordedBy: technicien.id,
      },
    }),
  ).rejects.toThrow();
});

test("un technicien ne cloture pas l'intervention d'un collegue", async ({
  page,
}) => {
  // Constitution §3.1. La garde vit dans la clause `where`, pas dans un `if` de
  // la page - et la page repond 403 avant meme que la modale existe.
  const voisin = await creerTechnicien(db, "cloture-voisin");
  utilisateursCreees.push(voisin.id);

  const id = await semerIntervention({ heure: 16 });

  await seConnecterTechnicien(page, voisin.email);
  const reponse = await page.goto(`/interventions/${String(id)}`);

  expect(reponse?.status()).toBe(403);
  await expect(page.getByText("Accès refusé")).toBeVisible();

  // Et rien n'a ete ecrit.
  const paiement = await db.payment.findUnique({
    where: { interventionId: id },
  });
  expect(paiement).toBeNull();
});

test("le client voit « Montant paye » et le montant reellement encaisse", async ({
  browser,
}) => {
  // 🔴 **Le report recu de T-V3-10 ([PR #33](https://github.com/BenSTAU/hch/pull/33)),
  // ferme ici.** Son ecran des passees affichait le total calcule faute de table
  // `payments` ; il lit desormais `amount_snapshot`.
  //
  // Deux contextes, parce que les deux espaces sont cloisonnes : le technicien
  // ne voit pas l'espace client (T-V2-05), et c'est justement pour ca que la
  // propagation ne s'observe nulle part ailleurs.
  const titulaire = await creerCompte(db, "cloture-vue-client", [
    "ROLE_CLIENT",
  ]);
  utilisateursCreees.push(titulaire.id);

  const id = await semerIntervention({ heure: 17, clientId: titulaire.id });

  const contexteTech = await browser.newContext();
  const pageTech = await contexteTech.newPage();
  await seConnecterTechnicien(pageTech, technicien.email);
  await cloturerParLEcran(pageTech, id, { montant: "70,00" });
  await expect(pageTech.getByText("Intervention terminée.")).toBeVisible();
  await contexteTech.close();

  const contexteClient = await browser.newContext();
  const pageClient = await contexteClient.newPage();
  await seConnecterCompte(pageClient, titulaire.email);
  await pageClient.goto("/mes-interventions/passees");

  await expect(pageClient.getByText("Montant payé")).toBeVisible();
  await expect(pageClient.getByText("70,00 €").first()).toBeVisible();
  await contexteClient.close();
});

test("le client lit le motif du refus, et aucun montant", async ({
  browser,
}) => {
  // 🔴 C'est ce qui DISPENSE la branche de refus d'un email (arbitrage D10) :
  // le motif saisi par le technicien est deja affiche au client. Si cette
  // propriete tombait, l'arbitrage tomberait avec elle.
  const titulaire = await creerCompte(db, "cloture-vue-refus", ["ROLE_CLIENT"]);
  utilisateursCreees.push(titulaire.id);

  const id = await semerIntervention({ heure: 18, clientId: titulaire.id });

  const contexteTech = await browser.newContext();
  const pageTech = await contexteTech.newPage();
  await seConnecterTechnicien(pageTech, technicien.email);
  await pageTech.goto(`/interventions/${String(id)}`);
  await pageTech.getByRole("button", { name: "Marquer comme faite" }).click();
  const modale = pageTech.getByRole("dialog");
  await modale
    .getByRole("button", { name: "Le client refuse le paiement" })
    .click();
  await modale.getByLabel("Motif du refus").fill("Chèque refusé sur place");
  await modale
    .getByRole("button", { name: "Clôturer sans encaissement" })
    .click();
  await expect(pageTech.getByText("Intervention annulée.")).toBeVisible();
  await contexteTech.close();

  const contexteClient = await browser.newContext();
  const pageClient = await contexteClient.newPage();
  await seConnecterCompte(pageClient, titulaire.email);
  await pageClient.goto("/mes-interventions/passees");

  await expect(pageClient.getByText(/Chèque refusé sur place/)).toBeVisible();
  // Rien de chiffre sur une annulee, et surtout pas le zero de la ligne
  // `UNPAID` : « Montant paye 0,00 € » dirait au client qu'il a regle zero
  // euro, quand le fait est qu'il n'a pas regle.
  await expect(pageClient.getByText("Montant payé")).toHaveCount(0);
  await expect(pageClient.getByText("0,00 €")).toHaveCount(0);
  await contexteClient.close();
});

test("la modale de cloture ne presente aucune violation RGAA A", async ({
  page,
}) => {
  // Ecran T4. `jest-axe` couvre deja les deux panneaux en isolation ; ceci les
  // scanne DANS la page, avec sa navigation, son fil d'Ariane et son hub.
  const id = await semerIntervention({ heure: 19 });

  await seConnecterTechnicien(page, technicien.email);
  await page.goto(`/interventions/${String(id)}`);
  await page.getByRole("button", { name: "Marquer comme faite" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  const resultats = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag21a"])
    .analyze();

  expect(resultats.violations).toEqual([]);
});
