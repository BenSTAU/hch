import { PrismaClient } from "@prisma/client";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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
  MOT_DE_PASSE_TECHNICIEN,
  type TechnicienSeme,
} from "../support/compte-technicien";

/// Detail d'intervention et demarrage - `US-INTERVENTION-AFFICHER` et
/// `US-INTERVENTION-DEMARRER`, ecran **T2**.
///
/// Ce fichier ne rejoue pas ce que les tests co-localises couvrent deja (la
/// projection, le verrou, la garde de la Server Action, le hub statut par
/// statut). Il eprouve ce qu'un mock ne peut PAS eprouver :
///
///   · **le 403 sur l'intervention d'un collegue**, sur une vraie base, rendu
///     par `forbidden()` et `src/app/forbidden.tsx` ;
///   · **la transition contre PostgreSQL**, avec la ligne relue apres coup ;
///   · **l'oracle de couplage de la case 11** - une intervention passee en
///     `IN_PROGRESS` verrouille le panier du client, et c'est le SEUL endroit
///     ou les deux moities de la propriete se rencontrent ;
///   · **le detail rendu par un Server Component asynchrone**, que Vitest et
///     RTL ne savent pas derouler (CLAUDE.md §Testing).
///
/// ⚠️ **Deux techniciens et un client dedies, semes par ce fichier**, aucun
/// affecte a une zone : la derivation des creneaux ne lit que les techniciens
/// affectes, donc `gp-02` ne peut pas deposer de reservation dans ces tournees.
/// Meme mecanique que `tournee-du-jour.spec.ts` (cadrage D7).

let db: PrismaClient;
let techProprietaire: TechnicienSeme;
let techVoisin: TechnicienSeme;
let client: TechnicienSeme;
let serviceId: number;
let addressId: number;
let productId: number;
let productLabel: string;

const interventionsCreees: number[] = [];
const adressesCreees: number[] = [];
const utilisateursCreees: string[] = [];

/// Instant UTC correspondant a une heure murale de PARIS, le jour demande.
function quandLocal(heure: number, decalageJours = 0) {
  const jour = ajouterJours(jourLocal(new Date()), decalageJours);
  return instantUtc(jour, heure * 60);
}

async function semerIntervention(options: {
  techId: string;
  heure: number;
  status?: string;
  /// Le client titulaire. Par defaut celui du fichier ; les deux scenarios qui
  /// LISENT une liste entiere passent le leur, cf. le commentaire ci-dessous.
  clientId?: string;
}): Promise<number> {
  const service = await db.service.findUniqueOrThrow({
    where: { id: serviceId },
  });

  const intervention = await db.intervention.create({
    data: {
      status: options.status ?? "PLANNED",
      appointmentAt: quandLocal(options.heure),
      priceSnapshot: service.price,
      durationSnapshot: service.duration,
      clientId: options.clientId ?? client.id,
      techId: options.techId,
      addressId,
      serviceId,
    },
    select: { id: true },
  });

  interventionsCreees.push(intervention.id);
  return intervention.id;
}

/// ⚠️ **Deux scenarios de ce fichier sement leurs PROPRES comptes**, et ce
/// n'est pas de la prudence : ce sont les deux qui lisent une **liste entiere**
/// plutot qu'une ligne connue par son identifiant.
///
/// Les autres tests naviguent vers `/interventions/<id>`, donc l'accumulation
/// leur est indifferente. Ces deux-la comptent des boutons dans une tournee et
/// cliquent « la premiere carte » d'un espace client : chaque intervention
/// semee par un test voisin s'y ajoute, et l'oracle devient dependant de
/// l'ordre d'execution. Constate au premier passage - le compte de boutons
/// valait 3 pour 1 attendu, et la carte cliquee n'etait pas celle qui venait
/// d'etre demarree, donc l'ajout de produit REUSSISSAIT et le test passait a
/// cote de la propriete qu'il devait prouver.
///
/// C'est la meme lecon que le cadrage D7, un cran plus fin : il isolait un
/// fichier de `gp-02`, il faut aussi isoler ces deux tests de leurs voisins.
async function semerActeursIsoles(prefixe: string) {
  const technicien = await creerTechnicien(db, prefixe);
  const titulaire = await creerCompte(db, `${prefixe}-client`, ["ROLE_CLIENT"]);
  utilisateursCreees.push(technicien.id, titulaire.id);

  return { technicien, titulaire };
}

test.beforeAll(async () => {
  db = new PrismaClient();

  const service = await db.service.findFirstOrThrow({
    where: { isActive: true },
  });
  serviceId = service.id;

  // Un produit EN STOCK : le catalogue de l'espace client ne propose que ceux
  // dont le stock est strictement positif, un produit epuise ne s'y afficherait
  // pas et l'oracle de couplage n'aurait rien a cliquer.
  const produit = await db.product.findFirstOrThrow({
    where: { stock: { gt: 0 } },
  });
  productId = produit.id;
  productLabel = produit.label;

  // Client porteur d'un nom, d'un telephone et d'un email CONNUS : ce sont les
  // trois que le detail doit afficher en entier (`US-INTERVENTION-AFFICHER`
  // §Cas nominal, « nom + telephone + email complet »).
  client = await creerCompte(db, "detail-client", ["ROLE_CLIENT"]);
  utilisateursCreees.push(client.id);

  const ville = await db.city.findFirstOrThrow();
  const adresse = await db.$queryRaw<{ id: number }[]>`
    INSERT INTO addresses (street, city_id, location, user_id, is_active)
    VALUES ('4 quai Tres Identifiable', ${ville.id},
            ST_SetSRID(ST_MakePoint(4.8357, 45.7640), 4326)::geography,
            ${client.id}::uuid, true)
    RETURNING id
  `;
  addressId = adresse[0]!.id;
  adressesCreees.push(addressId);

  techProprietaire = await creerTechnicien(db, "detail-proprio");
  techVoisin = await creerTechnicien(db, "detail-voisin");
  utilisateursCreees.push(techProprietaire.id, techVoisin.id);
});

test.afterAll(async () => {
  // ⚠️ `photos.intervention_id` est NOT NULL et sa FK refuse la suppression du
  // parent. Sans ce nettoyage, l'`afterAll` echoue et laisse tout derriere lui.
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
  for (const id of utilisateursCreees) {
    await supprimerCompteSeme(db, id);
  }
  await db.$disconnect();
});

test("le detail affiche les elements que la SPEC enumere", async ({ page }) => {
  const id = await semerIntervention({ techId: techProprietaire.id, heure: 9 });
  await db.interventionProduct.create({
    data: {
      interventionId: id,
      productId,
      quantity: 2,
      unitPriceSnapshot: "12.90",
    },
  });

  await seConnecterTechnicien(page, techProprietaire.email);
  await page.goto(`/interventions/${String(id)}`);

  // Le client en entier : c'est l'exposition que l'US assume nommement, au
  // titre de la « justification metier terrain ».
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Tourneur Dessai",
  );
  await expect(page.getByText("+33600000000")).toBeVisible();
  await expect(page.getByText(client.email)).toBeVisible();
  await expect(page.getByText("4 quai Tres Identifiable")).toBeVisible();

  // Le velo : `cycle_id` est vide sur toute intervention venue du tunnel, et
  // les deux etats s'affichent (cadrage D11).
  await expect(page.getByText("Aucun vélo indiqué")).toBeVisible();

  // Le total est forfait PLUS produits, jamais le forfait seul.
  const service = await db.service.findUniqueOrThrow({
    where: { id: serviceId },
  });
  const total = Number(service.price) + 12.9 * 2;
  await expect(
    page.getByText(total.toFixed(2).replace(".", ",")),
  ).toBeVisible();
});

test("un technicien n'ouvre pas l'intervention d'un collegue", async ({
  page,
}) => {
  // 🔴 Constitution §3.1, cloisonnement. La garde vit dans la clause `where` de
  // la requete, pas dans un `if` de la page.
  const id = await semerIntervention({
    techId: techProprietaire.id,
    heure: 11,
  });

  await seConnecterTechnicien(page, techVoisin.email);
  const reponse = await page.goto(`/interventions/${String(id)}`);

  await expect(page.getByText("Accès refusé")).toBeVisible();
  // ⚠️ L'UI de refus
  // seule ne prouve que la moitie : la [PR #46](https://github.com/BenSTAU/hch/pull/46)
  // vient de montrer qu'un `loading.tsx` de segment fait partir les en-tetes en
  // **200**, apres quoi le `forbidden()` de la page ne peut plus poser son
  // status - la garde tient, l'ecran de refus s'affiche, et la reponse dit
  // « tout va bien ». C'est le status qui l'attrape, et lui seul.
  expect(reponse?.status()).toBe(403);
  // Rien de la ligne ne doit avoir fuite avec le refus.
  expect(await page.content()).not.toContain("4 quai Tres Identifiable");
});

test("une intervention inexistante repond comme celle d'un collegue", async ({
  page,
}) => {
  // 🔴 La symetrie EST la propriete : `interventions.id` est un SERIAL, donc
  // enumerable. Deux reponses distinctes apprendraient a qui incremente quelles
  // interventions existent.
  await seConnecterTechnicien(page, techVoisin.email);
  const reponse = await page.goto("/interventions/999999999");

  await expect(page.getByText("Accès refusé")).toBeVisible();
  // La symetrie porte AUSSI sur le status : deux codes distincts se lisent dans
  // n'importe quel outil reseau, sans meme regarder la page.
  expect(reponse?.status()).toBe(403);
});

test("un identifiant qui n'est pas un entier repond comme une inexistante", async ({
  page,
}) => {
  // ⚠️ `interventions.id`
  // est un SERIAL et le segment dynamique accepte n'importe quelle chaine : la
  // page ecarte tout ce qui n'est pas un entier positif AVANT d'atteindre la
  // base, comme la route de lecture des photos. Aucun oracle ne le suivait, et
  // c'est la seule barriere entre l'URL et Prisma.
  await seConnecterTechnicien(page, techVoisin.email);

  for (const hostile of ["abc", "1.5", "-1", "0"]) {
    const reponse = await page.goto(`/interventions/${hostile}`);

    await expect(page.getByText("Accès refusé")).toBeVisible();
    expect(reponse?.status()).toBe(403);
  }
});

test("le proprietaire, lui, obtient bien un 200 sur cette meme route", async ({
  page,
}) => {
  // ⚠️ Sans lui,
  // les deux tests ci-dessus passeraient a l'identique si la route repondait
  // 403 a TOUT LE MONDE - une garde cassee dans le sens fermant est aussi un
  // defaut, et c'est exactement la lecon de la PR #42 : un refus qu'aucun succes
  // ne borne ne prouve pas le cloisonnement, il prouve une porte murée.
  const id = await semerIntervention({
    techId: techProprietaire.id,
    heure: 16,
  });

  await seConnecterTechnicien(page, techProprietaire.email);
  const reponse = await page.goto(`/interventions/${String(id)}`);

  expect(reponse?.status()).toBe(200);
  await expect(page.getByText("4 quai Tres Identifiable")).toBeVisible();
});

test("un client authentifie recoit 403 sur le detail", async ({ page }) => {
  // ⚠️ `US-INTERVENTION-AFFICHER` §Cas d'erreur porte DEUX refus, et le second -
  // « Given je ne suis pas technicien … Then je recois 403 » - n'avait aucun
  // oracle sur cette route. `src/proxy.ts` ne fait qu'un redirect optimiste sur
  // la presence du cookie : un client authentifie le franchit et atteint la
  // page, ou seul `requireTech()` l'arrete.
  const id = await semerIntervention({
    techId: techProprietaire.id,
    heure: 18,
  });

  await seConnecterCompte(page, client.email);
  const reponse = await page.goto(`/interventions/${String(id)}`);

  expect(reponse?.status()).toBe(403);
  await expect(page.getByText("Accès refusé")).toBeVisible();
  // Le detail client est sensible - nom, telephone, email, adresse : rien n'en
  // sort avec le refus.
  expect(await page.content()).not.toContain("4 quai Tres Identifiable");
});

test("le demarrage passe la ligne en IN_PROGRESS et date son debut", async ({
  page,
}) => {
  const id = await semerIntervention({
    techId: techProprietaire.id,
    heure: 13,
  });

  await seConnecterTechnicien(page, techProprietaire.email);
  await page.goto(`/interventions/${String(id)}`);

  await page.getByRole("button", { name: "Démarrer l'intervention" }).click();

  // La confirmation n'est pas contournable : la transition est irreversible et
  // ferme le panier du client.
  await expect(
    page.getByRole("alertdialog", { name: "Démarrer cette intervention ?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Démarrer", exact: true }).click();

  await expect(page.getByText(/Intervention démarrée à/)).toBeVisible();

  // L'etat est relu en BASE, pas seulement a l'ecran : c'est la moitie que le
  // rendu ne prouve pas.
  const ligne = await db.intervention.findUniqueOrThrow({ where: { id } });
  expect(ligne.status).toBe("IN_PROGRESS");
  expect(ligne.startedAt).not.toBeNull();

  // Et la trace, dans la meme transaction que la mutation.
  const audit = await db.auditLog.findFirst({
    where: { entityType: "interventions", entityId: String(id) },
  });
  expect(audit?.action).toBe("UPDATE");
  expect(audit?.details).toMatchObject({
    statutAvant: "PLANNED",
    statutApres: "IN_PROGRESS",
  });
});

test("le bouton de demarrage cede la place a celui de cloture", async ({
  page,
}) => {
  // 🔄 **Ce test s'appelait « le bouton disparait une fois l'intervention
  // demarree » et son commentaire disait que le hub ne propose PLUS RIEN en
  // `IN_PROGRESS`.** C'etait vrai le 13/08, ca ne l'est plus : T-V2-03 pose la
  // cloture. La proposition d'origine - le jeu d'actions suit le statut, et
  // aucun bouton n'est inerte - est conservee entiere, elle a juste une seconde
  // moitie desormais. « Deposer des photos » reste absent : T-V2-04 n'est pas
  // livree, et un bouton grise serait le bouton inerte que la DoD interdit.
  const id = await semerIntervention({
    techId: techProprietaire.id,
    heure: 15,
    status: "IN_PROGRESS",
  });

  await seConnecterTechnicien(page, techProprietaire.email);
  await page.goto(`/interventions/${String(id)}`);

  // ⚠️ Un
  // `toHaveCount(0)` passe aussi bien sur une page qui n'a RIEN rendu - 403,
  // 404, 500 - que sur un hub correctement replie. Ancrer l'oracle a un contenu
  // que seule la page rendue porte est ce qui le rend discriminant.
  await expect(
    page.getByText(/Intervention démarrée à|en cours/),
  ).toBeVisible();

  await expect(
    page.getByRole("button", { name: "Démarrer l'intervention" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Marquer comme faite" }),
  ).toBeVisible();
});

test("la tournee mene au detail, et son action ne suit que les lignes PLANNED", async ({
  page,
}) => {
  // Technicien dedie : ce test COMPTE les boutons d'une tournee entiere.
  const { technicien } = await semerActeursIsoles("detail-tournee");

  const planifiee = await semerIntervention({
    techId: technicien.id,
    heure: 8,
  });
  await semerIntervention({
    techId: technicien.id,
    heure: 17,
    status: "DONE",
  });

  await seConnecterTechnicien(page, technicien.email);

  const lignes = page
    .getByRole("region", { name: "Mes interventions du jour" })
    .getByRole("listitem");

  // Une seule des deux lignes porte le bouton, les deux portent leur lien.
  await expect(
    lignes.getByRole("button", { name: "Démarrer l'intervention" }),
  ).toHaveCount(1);

  await lignes
    .first()
    .getByRole("link", { name: /à 08:00/ })
    .click();

  await expect(page).toHaveURL(`/interventions/${String(planifiee)}`);
});

test("une intervention demarree verrouille le panier du client", async ({
  browser,
}) => {
  // 🔴 **L'oracle de couplage de la case 11.** Le verrou existe deja
  // (`STATUT_MODIFIABLE = "PLANNED"` dans `queries/produits.ts`, arbitrage B7
  // Q2a) : il n'y a rien a aligner, seulement a le prouver. C'est le seul
  // endroit ou les deux moities se rencontrent, la vue client et la transition
  // technicien vivant dans deux espaces cloisonnes.
  //
  // Le scenario est une VUE PERIMEE, et c'est le cas reel : une fois
  // `IN_PROGRESS`, la ligne quitte l'onglet « A venir » du client, donc le
  // refus ne s'observe qu'en postant depuis un ecran ouvert avant la
  // transition. Deux contextes, parce que les deux sessions coexistent.
  // Technicien ET client dedies : ce test clique « la premiere carte » de
  // l'espace client, donc il lui faut un espace ou il n'y a qu'une carte.
  const { technicien, titulaire } = await semerActeursIsoles("detail-couplage");

  const id = await semerIntervention({
    techId: technicien.id,
    heure: 10,
    clientId: titulaire.id,
  });

  const contexteClient = await browser.newContext();
  const contexteTech = await browser.newContext();

  try {
    const pageClient = await contexteClient.newPage();
    await pageClient.goto("/connexion");
    await pageClient.getByLabel("Adresse email").fill(titulaire.email);
    // Le compte vient de `creerCompte`, qui hache ce mot de passe quel que soit
    // le role demande.
    await pageClient
      .getByLabel("Mot de passe", { exact: true })
      .fill(MOT_DE_PASSE_TECHNICIEN);
    await pageClient.getByRole("button", { name: "Se connecter" }).click();
    await expect(pageClient).toHaveURL("/mes-interventions/a-venir", {
      timeout: 30_000,
    });

    // Le panneau de detail ne s'ouvre qu'a la selection d'une carte : c'est lui
    // qui porte le bloc produits. La carte est un BOUTON et non un lien (la
    // selection change un parametre d'URL, pas de page), et son nom accessible
    // porte l'etiquette de statut.
    await pageClient
      .getByRole("button", { name: /Planifiée/ })
      .first()
      .click();

    // Le technicien demarre pendant que l'ecran du client est ouvert.
    const pageTech = await contexteTech.newPage();
    await seConnecterTechnicien(pageTech, technicien.email);
    await pageTech.goto(`/interventions/${String(id)}`);
    await pageTech
      .getByRole("button", { name: "Démarrer l'intervention" })
      .click();
    await pageTech
      .getByRole("button", { name: "Démarrer", exact: true })
      .click();
    await expect(pageTech.getByText(/Intervention démarrée à/)).toBeVisible();

    // Le client poste son ajout depuis sa vue perimee, par le VRAI chemin
    // d'interface : c'est le client Next qui serialise l'appel, donc l'oracle
    // eprouve la Server Action reelle et non une sonde qui devinerait son
    // identifiant.
    // ⚠️ Le bouton du catalogue se cible par son libelle EXACT. « Ajouter un
    // produit » (qui deplie le catalogue) et « Ajouter une photo… » matchent
    // tous deux un `/^Ajouter /` : un `.first()` re-cliquait le deplieur et
    // refermait le catalogue, l'ajout n'avait jamais lieu et le test echouait
    // sur l'absence d'un message qui n'avait aucune raison d'apparaitre.
    await pageClient
      .getByRole("button", { name: "Ajouter un produit" })
      .click();
    await pageClient
      .getByRole("button", { name: `Ajouter ${productLabel}` })
      .click();

    // 🔴 Le refus vient du SERVEUR, pas de l'ecran : l'ecran, lui, croyait
    // encore l'intervention modifiable, et c'est tout l'interet du scenario.
    // Libelle de `US-INTERVENTION-PRODUIT-AJOUTER` §Cas d'erreur.
    await expect(
      pageClient.getByText(
        "Ajout impossible sur une intervention déjà démarrée ou clôturée.",
      ),
    ).toBeVisible();

    // Et rien n'a ete vendu : le refus n'est pas qu'un message.
    const lignes = await db.interventionProduct.count({
      where: { interventionId: id },
    });
    expect(lignes).toBe(0);
  } finally {
    await contexteClient.close();
    await contexteTech.close();
  }
});

test("le technicien affecte voit les photos du client, un autre non", async ({
  page,
  browser,
  baseURL,
}) => {
  // 🔴 **L'elargissement de la garde photos, de bout en bout - ajout de l'agent
  // testeur, 2026-08-13.** `chargerPhotoAutorisee` gagne une branche `techId`
  // et cette branche n'avait pour tout
  // oracle que trois assertions sur la forme d'une clause `where` doublee. Rien
  // ne prouvait sur une vraie base ni que le technicien affecte obtient l'image,
  // ni - surtout - qu'un technicien NON affecte reste dehors. La moitie cliente
  // de la meme route, elle, est prouvee depuis T-V3-10
  // (`mes-interventions.spec.ts`), et c'est exactement le pendant qui manquait.
  //
  // Le fichier passe par le VRAI depot : en CI l'application tourne dans un
  // conteneur, un fichier ecrit sur le disque de l'hote ne lui serait pas
  // visible, et le test serait vert en local et faux en barriere.
  const { technicien, titulaire } = await semerActeursIsoles("detail-photo");
  const id = await semerIntervention({
    techId: technicien.id,
    heure: 7,
    clientId: titulaire.id,
  });

  // Le panneau de l'espace client s'ouvre sur la PREMIERE intervention a venir :
  // le titulaire dedie n'en a qu'une, donc la zone de depot est la sienne.
  // ⚠️ **Aucun `page.goto` apres la connexion, et ce n'est pas un raccourci.**
  // Premiere version du test : un `goto` vers `/mes-interventions/a-venir`
  // pose juste apres la redirection de connexion vers cette MEME url. Le depot
  // ne partait alors jamais - aucune requete vers
  // `/api/upload-intervention-photo` dans le journal reseau - parce que le
  // `change` de l'input tombait dans une page rechargee mais pas encore
  // hydratee, ou React n'ecoute pas encore. Rien ne s'affichait, pas meme une
  // erreur : `bloc-photos.tsx` ne lit que `resultat.data.message`. On laisse la
  // connexion mener elle-meme a destination.
  await seConnecterCompte(page, titulaire.email);
  await expect(page).toHaveURL(/\/mes-interventions\/a-venir$/, {
    timeout: 30_000,
  });
  await page.getByLabel(/Ajouter une photo pour le technicien/).setInputFiles({
    name: "velo.png",
    mimeType: "image/png",
    // Un vrai PNG minimal : `sharp` doit pouvoir le decoder, un tampon
    // arbitraire serait refuse en « illisible » et le test passerait pour la
    // mauvaise raison.
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  // ⚠️ Delai large, et mesure : le depot traverse `POST
  // /api/upload-intervention-photo` (decodage `sharp`, strip EXIF, re-encodage
  // WebP) puis une Server Action, et en local le serveur de developpement
  // COMPILE la route au premier appel - ce fichier est le premier a la toucher
  // de sa run. Meme motif que `DELAI_CONNEXION_MS` du support.
  await expect(
    page.getByRole("img", { name: /Photo 1 de l'intervention/ }),
  ).toBeVisible({ timeout: 30_000 });

  const photo = await db.photo.findFirstOrThrow({
    where: { interventionId: id },
  });

  // Le technicien affecte : la vignette du detail se CHARGE. Plus fort qu'un
  // status - c'est le navigateur qui va chercher l'octet, avec le cookie de
  // session, par la route controlee.
  const contexteTech = await browser.newContext(baseURL ? { baseURL } : {});
  try {
    const pageTech = await contexteTech.newPage();
    await seConnecterTechnicien(pageTech, technicien.email);
    await pageTech.goto(`/interventions/${String(id)}`);

    const vignette = pageTech.getByRole("img", {
      name: /jointe par le client/,
    });
    await expect(vignette).toBeVisible();
    await expect(vignette).toHaveJSProperty("complete", true);
    expect(
      await vignette.evaluate((image: HTMLImageElement) => image.naturalWidth),
    ).toBeGreaterThan(0);
  } finally {
    await contexteTech.close();
  }

  // 🔴 Et la borne : un technicien qui n'est pas affecte a CE rendez-vous reste
  // dehors. Sa session EST ouverte - `seConnecterTechnicien` vient de l'attester
  // sur sa propre tournee - donc le 404 ne peut venir que de la garde de
  // propriete, et non de l'anonymat.
  const contexteVoisin = await browser.newContext(baseURL ? { baseURL } : {});
  try {
    const pageVoisin = await contexteVoisin.newPage();
    await seConnecterTechnicien(pageVoisin, techVoisin.email);

    const reponse = await pageVoisin.goto(
      `/api/intervention-photos/${String(photo.id)}`,
    );
    expect(reponse?.status()).toBe(404);
  } finally {
    await contexteVoisin.close();
  }
});

test("le detail ne presente aucune violation RGAA de niveau A", async ({
  page,
}) => {
  const id = await semerIntervention({
    techId: techProprietaire.id,
    heure: 12,
  });

  await seConnecterTechnicien(page, techProprietaire.email);
  await page.goto(`/interventions/${String(id)}`);

  const resultats = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag21a"])
    .analyze();

  expect(resultats.violations).toEqual([]);
});
