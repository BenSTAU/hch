import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { creerClientActive, seConnecterClient } from "../support/compte-client";

/// **GP-03 `annuler-creneau`** - `US-INTERVENTION-ANNULER-CLIENT`, T-V3-11.
///
/// Troisieme des cinq golden paths d'ADR-014 §5, et il etait **orphelin**
/// jusqu'a l'audit V3 du 2026-08-08 : la phase n'en revendiquait que trois sur
/// cinq alors que cette tache EST GP-03, et sa DoD n'avait aucun E2E.
///
/// Ce que ce fichier eprouve, et qu'aucun test unitaire ne peut prouver :
///
///   · **la transition d'etat sur une vraie base** - `PLANNED → CANCELLED`,
///     motif ecrit, et l'entree `audit_logs` avec elle (Constitution §4.2) ;
///   · **le creneau redevient libre** - aucune ligne a supprimer, la contrainte
///     `no_double_booking` filtre sur le statut. C'est une propriete de la BASE,
///     un mock ne la dit pas ;
///   · **la fenetre H-24 refuse cote serveur**, pas seulement a l'ecran. Une
///     Server Action exportee est un endpoint POST public (ADR-006 v2) : un
///     bouton absent ne protege rien.
///
/// Les interventions sont semees EN BASE plutot que reservees par le tunnel,
/// meme motif qu'en `mes-interventions.spec.ts` : `gp-02` couvre deja le
/// tunnel, et le rejouer ici ferait dependre chaque scenario de la
/// disponibilite d'un creneau.

let db: PrismaClient;
let serviceId: number;
let techId: string;
let addressId: number;

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

  const ville = await db.city.findFirstOrThrow();
  const adresse = await db.$queryRaw<{ id: number }[]>`
    INSERT INTO addresses (street, city_id, location, is_active)
    VALUES ('8 rue de l''Annulation', ${ville.id},
            ST_SetSRID(ST_MakePoint(4.8357, 45.7640), 4326)::geography, true)
    RETURNING id
  `;
  addressId = adresse[0]!.id;
  adressesCreees.push(addressId);
});

test.afterAll(async () => {
  // L'audit est nettoye avec les interventions : la base de developpement est
  // partagee entre les deux postes, et des traces laissees derriere fausseraient
  // la lecture du journal.
  await db.auditLog.deleteMany({
    where: {
      entityType: "interventions",
      entityId: { in: interventionsCreees.map(String) },
    },
  });
  await db.intervention.deleteMany({
    where: { id: { in: interventionsCreees } },
  });
  await db.address.deleteMany({ where: { id: { in: adressesCreees } } });
  await db.$disconnect();
});

/// Une intervention posee directement en base.
///
/// `heuresAvant` place le rendez-vous par rapport a MAINTENANT : c'est la
/// variable de cette suite, la fenetre H-24 se mesurant depuis l'instant du
/// serveur.
///
/// ⚠️ **Le decalage est de 90 minutes, pas de quelques minutes.** Le seul
/// technicien seede porte tous les rendez-vous de la barriere, et
/// `no_double_booking` compare des PLAGES : `reservation_range` couvre
/// `appointment_at` plus `duration_snapshot`, soit 60 minutes ici. Deux
/// scenarios espaces de sept minutes se chevauchent donc, et le second est
/// refuse par la contrainte - constate au premier jet.
let decalage = 0;
async function semerIntervention(options: {
  clientId: string;
  heuresAvant: number;
  status?: string;
}): Promise<number> {
  decalage += 1;
  const quand = new Date(
    Date.now() + options.heuresAvant * 3_600_000 + decalage * 90 * 60_000,
  );

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

test("un client annule son rendez-vous et le creneau redevient libre", async ({
  page,
}) => {
  const { email, userId } = await creerClientActive(page, db, "gp03-nominal");
  const interventionId = await semerIntervention({
    clientId: userId,
    heuresAvant: 72,
  });

  await seConnecterClient(page, email);
  await page.goto(`/mes-interventions/a-venir?intervention=${interventionId}`);

  await page
    .getByRole("button", { name: "Annuler cette intervention" })
    .click();

  const modale = page.getByRole("dialog");
  await expect(modale).toBeVisible();
  await modale
    .getByLabel(/Motif de l'annulation/)
    .fill("Empechement de derniere minute");
  await modale.getByRole("button", { name: /Confirmer l'annulation/ }).click();

  // Le message de l'US §Cas nominal : « redirige vers la liste avec message
  // Intervention annulee ». On y est deja, la redirection est un rafraichissement.
  await expect(page.getByText("Intervention annulée")).toBeVisible();

  // ── L'etat en base, pas seulement a l'ecran
  const apres = await db.intervention.findUniqueOrThrow({
    where: { id: interventionId },
    select: { status: true, cancellationReason: true },
  });
  expect(apres.status).toBe("CANCELLED");
  expect(apres.cancellationReason).toBe("Empechement de derniere minute");

  // ── L'audit RGPD (Constitution §4.2)
  const trace = await db.auditLog.findFirst({
    where: {
      entityType: "interventions",
      entityId: String(interventionId),
      action: "UPDATE",
    },
    select: { actorId: true, details: true },
  });
  expect(trace?.actorId).toBe(userId);
  expect(trace?.details).toMatchObject({
    statutAvant: "PLANNED",
    statutApres: "CANCELLED",
  });

  // ── Elle quitte « A venir » pour « Passees », avec son motif
  await page.goto("/mes-interventions/a-venir");
  await expect(page.getByText("Vous n'avez pas de rendez-vous")).toBeVisible();

  await page.goto(`/mes-interventions/passees?intervention=${interventionId}`);
  // Le panneau de detail, nomme par son titre - la date du rendez-vous. Sans
  // cette portee, « Annulée » resout aussi l'etiquette de la carte de liste.
  const panneau = page.getByRole("region", { name: /\d{4}/ });
  await expect(panneau.getByText("Annulée")).toBeVisible();
  await expect(
    panneau.getByText(/Empechement de derniere minute/),
  ).toBeVisible();

  // ── Le creneau est libere, et c'est la BASE qui le dit
  //
  // Aucune ligne n'a ete supprimee : le pool se derive a la volee
  // (Constitution §2.1) et `no_double_booking` filtre sur
  // `status IN ('PLANNED','IN_PROGRESS')`. La preuve est qu'on peut reinserer
  // un rendez-vous sur le MEME technicien au MEME instant - ce que la
  // contrainte refuserait si l'annulee occupait encore son creneau.
  //
  // ⚠️ En DERNIER, apres les assertions d'ecran : cette insertion repeuple
  // l'onglet « A venir », et la placer plus haut rendait fausse la verification
  // que le rendez-vous annule l'a quitte. Defaut du premier jet, attrape par la
  // barriere.
  const annulee = await db.intervention.findUniqueOrThrow({
    where: { id: interventionId },
    select: { appointmentAt: true },
  });
  const libere = await db.intervention.create({
    data: {
      status: "PLANNED",
      appointmentAt: annulee.appointmentAt,
      priceSnapshot: "85.00",
      durationSnapshot: 60,
      clientId: userId,
      techId,
      addressId,
      serviceId,
    },
    select: { id: true },
  });
  interventionsCreees.push(libere.id);
  expect(libere.id).toBeGreaterThan(0);
});

test("passe H-24, l'ecran renvoie vers l'atelier au lieu du bouton", async ({
  page,
}) => {
  const { email, userId } = await creerClientActive(page, db, "gp03-fenetre");
  const interventionId = await semerIntervention({
    clientId: userId,
    heuresAvant: 12,
  });

  await seConnecterClient(page, email);
  await page.goto(`/mes-interventions/a-venir?intervention=${interventionId}`);

  await expect(page.getByText("Annulation impossible en ligne")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Annuler cette intervention" }),
  ).toHaveCount(0);

  // Le contact vient d'`app_settings`, tenu par l'administrateur. Sans lui, le
  // message dirait au client de nous joindre sans dire comment.
  const telephone = await db.appSetting.findUniqueOrThrow({
    where: { key: "company.phone" },
    select: { value: true },
  });
  await expect(
    page.getByRole("link", { name: telephone.value ?? "" }),
  ).toHaveAttribute("href", `tel:${telephone.value ?? ""}`);

  // Rien n'a bouge en base : l'ecran refuse, et il ne prepare rien.
  const apres = await db.intervention.findUniqueOrThrow({
    where: { id: interventionId },
    select: { status: true },
  });
  expect(apres.status).toBe("PLANNED");
});

test("le bouton absent ne protege rien : le serveur refuse aussi", async ({
  page,
}) => {
  // ⚠️ Le scenario hostile de cette suite. Chaque Server Action exportee est un
  // endpoint POST public (ADR-006 v2) : la garde H-24 doit vivre dans la
  // transaction, pas dans le rendu. Le test ne forge pas de requete - il joue
  // le cas REEL qui produit la meme chose, un onglet ouvert avant la borne et
  // confirme apres.
  //
  // La page est rendue a H-25, puis le rendez-vous est AVANCE en base a H-23
  // pendant que l'onglet est ouvert. Le bouton est toujours la, et c'est le
  // serveur qui tranche.
  const { email, userId } = await creerClientActive(page, db, "gp03-hostile");
  const interventionId = await semerIntervention({
    clientId: userId,
    heuresAvant: 25,
  });

  await seConnecterClient(page, email);
  await page.goto(`/mes-interventions/a-venir?intervention=${interventionId}`);
  await expect(
    page.getByRole("button", { name: "Annuler cette intervention" }),
  ).toBeVisible();

  await db.intervention.update({
    where: { id: interventionId },
    data: { appointmentAt: new Date(Date.now() + 23 * 3_600_000) },
  });

  await page
    .getByRole("button", { name: "Annuler cette intervention" })
    .click();
  const modale = page.getByRole("dialog");
  await modale.getByLabel(/Motif de l'annulation/).fill("Tentative tardive");
  await modale.getByRole("button", { name: /Confirmer l'annulation/ }).click();

  // L'ecran bascule sur le renvoi vers l'atelier, et la base n'a pas bouge.
  await expect(page.getByText("Annulation impossible en ligne")).toBeVisible();
  const apres = await db.intervention.findUniqueOrThrow({
    where: { id: interventionId },
    select: { status: true, cancellationReason: true },
  });
  expect(apres.status).toBe("PLANNED");
  expect(apres.cancellationReason).toBeNull();
});

test("un client ne peut pas annuler le rendez-vous d'un autre", async ({
  page,
}) => {
  // Constitution §3.2. La garde vit dans la clause `where` de la transaction,
  // et la reponse est indifferenciee : `interventions.id` est un SERIAL, un
  // refus distinct d'un « introuvable » confirmerait l'existence du rendez-vous
  // du voisin a qui incremente.
  const voisin = await creerClientActive(page, db, "gp03-voisin");
  const interventionId = await semerIntervention({
    clientId: voisin.userId,
    heuresAvant: 72,
  });

  const intrus = await creerClientActive(page, db, "gp03-intrus");
  await seConnecterClient(page, intrus.email);

  // L'identifiant du voisin, force dans l'URL. La vue retombe sur la liste de
  // l'intrus - vide - sans rien dire de l'existence de l'autre rendez-vous.
  await page.goto(`/mes-interventions/a-venir?intervention=${interventionId}`);
  await expect(page.getByText("Vous n'avez pas de rendez-vous")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Annuler cette intervention" }),
  ).toHaveCount(0);

  const apres = await db.intervention.findUniqueOrThrow({
    where: { id: interventionId },
    select: { status: true },
  });
  expect(apres.status).toBe("PLANNED");
});

test("le serveur refuse l'intervention d'un tiers, meme modale ouverte", async ({
  page,
}) => {
  // ⚠️ Ajout de l'agent testeur, 2026-08-11.
  //
  // Le scenario voisin (« un client ne peut pas annuler le rendez-vous d'un
  // autre ») prouve que l'ECRAN ne fuit rien : la vue retombe sur la liste de
  // l'intrus, le bouton n'existe pas. Il ne dit rien de la garde SERVEUR, parce
  // qu'il n'atteint jamais l'action - et c'est precisement ce que Constitution
  // §3.2 demande de tenir. Le cloisonnement n'etait donc eprouve que par un
  // double de Prisma, sur la forme de la clause `where`.
  //
  // Comme pour la fenetre H-24, aucune requete n'est forgee : le rendez-vous
  // CHANGE de proprietaire pendant que la modale est ouverte, et l'appel part
  // par le meme chemin qu'un client normal. La reponse doit etre indifferenciee
  // - « introuvable », jamais « ce n'est pas a vous ».
  const beneficiaire = await creerClientActive(page, db, "gp03-transfert-b");
  const { email, userId } = await creerClientActive(page, db, "gp03-transfert");
  const interventionId = await semerIntervention({
    clientId: userId,
    heuresAvant: 72,
  });

  await seConnecterClient(page, email);
  await page.goto(`/mes-interventions/a-venir?intervention=${interventionId}`);

  await page
    .getByRole("button", { name: "Annuler cette intervention" })
    .click();
  const modale = page.getByRole("dialog");
  await modale.getByLabel(/Motif de l'annulation/).fill("Tentative croisee");

  await db.intervention.update({
    where: { id: interventionId },
    data: { clientId: beneficiaire.userId },
  });

  await modale.getByRole("button", { name: /Confirmer l'annulation/ }).click();

  await expect(modale.getByRole("alert")).toHaveText(
    "Intervention introuvable.",
  );

  const apres = await db.intervention.findUniqueOrThrow({
    where: { id: interventionId },
    select: { status: true, cancellationReason: true },
  });
  expect(apres.status).toBe("PLANNED");
  expect(apres.cancellationReason).toBeNull();

  // Aucune trace non plus : un refus n'est pas une mutation, et `audit_logs`
  // est la piece qu'on produit en cas de contestation.
  const traces = await db.auditLog.count({
    where: { entityType: "interventions", entityId: String(interventionId) },
  });
  expect(traces).toBe(0);
});

test("une intervention deja annulee ne propose plus rien", async ({ page }) => {
  // §2.4, cycle de vie garde : les actions terminales sont irreversibles cote
  // serveur. L'ecran ne doit pas non plus proposer de les rejouer.
  const { email, userId } = await creerClientActive(page, db, "gp03-terminale");
  const interventionId = await semerIntervention({
    clientId: userId,
    heuresAvant: 72,
    status: "CANCELLED",
  });

  await seConnecterClient(page, email);
  await page.goto(`/mes-interventions/passees?intervention=${interventionId}`);

  await expect(
    page.getByRole("button", { name: "Annuler cette intervention" }),
  ).toHaveCount(0);
  await expect(page.getByText("Annulation impossible en ligne")).toHaveCount(0);
});

test.describe("l'ecran d'annulation, mesure au navigateur", () => {
  /// ⚠️ **Ajoute apres le rapport de l'agent testeur**, qui a releve que la
  /// DoD 6 (« responsive, RGAA A ») etait **declaree et non prouvee** :
  /// `@axe-core/playwright` ne tournait sur AUCUN ecran de l'espace client, et
  /// aucune mesure a 375 px n'existait dessus.
  ///
  /// C'est exactement l'ecart que `jest-axe` ne peut pas combler : axe-core en
  /// jsdom **ne calcule aucun contraste**, et le bandeau hors fenetre est du
  /// `text-destructive` sur `bg-destructive/10`, la teinte la plus a risque de
  /// l'ecran. Les tags AA sont passes pour cette seule raison, comme sur la
  /// landing : le niveau exige reste A (SPEC §6.3.1).
  const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

  test("aucune violation, modale d'annulation ouverte", async ({ page }) => {
    const { email, userId } = await creerClientActive(page, db, "gp03-axe");
    const interventionId = await semerIntervention({
      clientId: userId,
      heuresAvant: 72,
    });

    await seConnecterClient(page, email);
    await page.goto(
      `/mes-interventions/a-venir?intervention=${interventionId}`,
    );
    await page
      .getByRole("button", { name: "Annuler cette intervention" })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();

    const resultats = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(resultats.violations).toEqual([]);
  });

  test("aucune violation sur le bandeau de renvoi vers l'atelier", async ({
    page,
  }) => {
    const { email, userId } = await creerClientActive(
      page,
      db,
      "gp03-axe-hors",
    );
    const interventionId = await semerIntervention({
      clientId: userId,
      heuresAvant: 6,
    });

    await seConnecterClient(page, email);
    await page.goto(
      `/mes-interventions/a-venir?intervention=${interventionId}`,
    );
    await expect(
      page.getByText("Annulation impossible en ligne"),
    ).toBeVisible();

    const resultats = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(resultats.violations).toEqual([]);
  });

  test("la modale et le bandeau tiennent dans le cadre a 375 px", async ({
    page,
  }) => {
    // Regle 2 du portage : les maquettes sont en 1920x1080 seulement, et le
    // parcours client est mobile-first (`US-RGPD` §Criteres). Le debordement
    // horizontal est le defaut qu'un telephone reel a revele sur le tunnel le
    // 2026-08-10, apres que la DoD « responsive verifie » ait ete cochee sur la
    // foi d'un navigateur de bureau redimensionne.
    const { email, userId } = await creerClientActive(page, db, "gp03-mobile");
    const interventionId = await semerIntervention({
      clientId: userId,
      heuresAvant: 72,
    });

    // ⚠️ La connexion se joue en LARGEUR DE BUREAU, puis on retrecit. Le
    // declencheur du menu utilisateur, oracle de `seConnecterClient`, vit dans
    // un conteneur `hidden md:flex` : sous 768 px il n'existe pas, et le helper
    // partage echoue sur une connexion pourtant reussie. C'est la dette mobile
    // ouverte par T-V3-10 (le repli `<noscript>` ne couvre que le bureau), pas
    // un defaut de cette tache - mais elle mord ici, et la contourner en
    // silence l'aurait rendue invisible une fois de plus.
    await seConnecterClient(page, email);
    await page.setViewportSize({ width: 375, height: 812 });

    await page.goto(
      `/mes-interventions/a-venir?intervention=${interventionId}`,
    );
    await page
      .getByRole("button", { name: "Annuler cette intervention" })
      .click();

    const modale = page.getByRole("dialog");
    await expect(modale).toBeVisible();

    const cadre = await modale.boundingBox();
    expect(cadre).not.toBeNull();
    expect(cadre!.x).toBeGreaterThanOrEqual(0);
    expect(cadre!.x + cadre!.width).toBeLessThanOrEqual(375);

    // Les deux boutons du pied doivent rester entiers : c'est le libelle tronque
    // et le bouton sortant du cadre qu'on a payes sur la barre du tunnel.
    for (const nom of [/Confirmer l'annulation/, /Conserver le rendez-vous/]) {
      const boite = await modale
        .getByRole("button", { name: nom })
        .boundingBox();
      expect(boite).not.toBeNull();
      expect(boite!.x).toBeGreaterThanOrEqual(0);
      expect(boite!.x + boite!.width).toBeLessThanOrEqual(375);
    }

    // Et la page elle-meme ne defile pas horizontalement.
    const debordement = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(debordement).toBeLessThanOrEqual(375);
  });
});
