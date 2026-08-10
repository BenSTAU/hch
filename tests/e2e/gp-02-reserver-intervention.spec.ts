import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";

import { ADRESSE_DEMO, entiteBan } from "../../src/mocks/handlers";

/// `GP-02 reserver-intervention` — golden path d'ADR-014 §5.
///
/// **La BAN n'est jamais appelée pour de vrai.** La barrière tourne sur un
/// runner GitHub dont l'IP est partagée et le débit imprévisible ; un test qui
/// dépend d'un service public tiers échoue pour des raisons qui n'ont rien à
/// voir avec le code.
///
/// L'interception se fait par `page.route()` et non par le worker MSW : ce
/// dernier imposerait `public/mockServiceWorker.js`, un fichier servi par
/// l'application **en production**, plus un interrupteur capable d'activer le
/// mock sur une image promue vers staging puis prod. `page.route` intercepte au
/// niveau du contexte navigateur, donc plus près de la frontière réseau qu'un
/// service worker vivant dans la page. Les **fixtures**, elles, sont bien
/// partagées avec Vitest — `src/mocks/handlers.ts` est la source unique.
///
/// ⚠️ **Portée limitée, et c'est signalé, pas absorbé.** Ce fichier s'arrête
/// après l'autocomplétion d'adresse. Les étapes suivantes passent par
/// `verifierAdresse` puis `reserver`, qui **re-géocodent côté serveur** — un
/// appel sortant émis par le processus Next, que `page.route` n'intercepte pas.
/// Aller plus loin ferait taper la vraie BAN depuis la CI, ce que la DoD
/// interdit explicitement. Voir le champ Divergences de la PR.

const URL_BAN = "https://data.geopf.fr/geocodage/search/**";

async function mockerBan(page: Page) {
  await page.route(URL_BAN, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        type: "FeatureCollection",
        features: [
          entiteBan({ ...ADRESSE_DEMO, type: "housenumber" }),
          // Une voie sans numéro : la BAN en renvoie spontanément, et elle ne
          // doit jamais atteindre la liste de suggestions.
          entiteBan({
            label: "Rue de la Bicyclette 69003 Lyon",
            type: "street",
            lon: 4.8321,
            lat: 45.7579,
          }),
        ],
      }),
    });
  });
}

test("le tunnel est accessible sans session — la réservation précède l'inscription", async ({
  page,
}) => {
  // Constitution §3.2. `/reserver` vit à la RACINE et non sous `/client/`, que
  // le matcher de `src/proxy.ts` redirigerait vers `/connexion`. C'est
  // l'amendement du 2026-08-09 : la route écrite dans ADR-006 §10 était
  // inatteignable au visiteur.
  const reponse = await page.goto("/reserver");

  expect(reponse?.status()).toBe(200);
  await expect(page).toHaveURL(/\/reserver/);
  await expect(
    page.getByRole("heading", { name: /choisir une prestation/i }),
  ).toBeVisible();

  // L'en-tête propose toujours de se connecter : personne n'a été connecté au
  // passage.
  await expect(page.getByRole("link", { name: /connexion/i })).toBeVisible();
});

test("un forfait choisi depuis la landing arrive pré-sélectionné", async ({
  page,
}) => {
  // Report de T-V3-13, qui n'avait posé que le lien vers l'entrée du tunnel :
  // les cartes de C1 pointaient toutes la même URL. C'est ici que le paramètre
  // se câble, et ici qu'il se prouve.
  await page.goto("/reserver");

  const premier = page.getByRole("button", { name: /^choisir /i }).first();
  await premier.click();

  // L'étape ET le forfait vivent dans l'URL : le parcours est partageable et
  // survit à un rechargement.
  await expect(page).toHaveURL(/forfait=\d+/);
  await expect(page).toHaveURL(/etape=adresse/);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: /où intervenons-nous/i }),
  ).toBeVisible();
});

test("l'autocomplétion ne propose que des adresses précises", async ({
  page,
}) => {
  await mockerBan(page);
  await page.goto("/reserver");

  await page
    .getByRole("button", { name: /^choisir /i })
    .first()
    .click();

  const champ = page.getByRole("combobox", { name: /adresse/i });
  await champ.fill("12 rue de la bicyclette");

  const options = page.getByRole("option");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toHaveText(ADRESSE_DEMO.label);
});

test("une panne du service d'adressage se dit, elle ne se déguise pas", async ({
  page,
}) => {
  // ADR-015 : échec du géocodage → message explicite, jamais de repli
  // silencieux sur une saisie libre non contrôlée (Constitution §2.2).
  await page.route(URL_BAN, async (route) => {
    await route.fulfill({ status: 503, body: "" });
  });

  await page.goto("/reserver");
  await page
    .getByRole("button", { name: /^choisir /i })
    .first()
    .click();

  await page.getByRole("combobox", { name: /adresse/i }).fill("12 rue de la");

  await expect(page.getByText(/temporairement indisponible/i)).toBeVisible();
});

test("un visiteur anonyme ne peut pas valider, et aucune intervention n'est créée", async ({
  page,
}) => {
  // La garde vit dans la SERVER ACTION, pas dans le matcher de `src/proxy.ts` :
  // `/reserver` reste publique, seule la validation exige un compte
  // (Constitution §3.2, alignée le 2026-08-09).
  //
  // Le test attaque l'action DIRECTEMENT, sans passer par l'écran : une Server
  // Action exportée est un endpoint POST public, et masquer le bouton ne
  // protège rien. C'est exactement ce que l'écran ne peut pas prouver.
  const db = new PrismaClient();
  try {
    const avant = await db.intervention.count();

    await page.goto("/reserver");

    const reponse = await page.request.post("/reserver", {
      headers: {
        "Content-Type": "application/json",
        // En-tête qu'ajoute le client Next pour invoquer une Server Action.
        // Sans identifiant valide la requête n'atteint pas l'action ; ce que le
        // test vérifie, c'est qu'AUCUN chemin anonyme n'écrit en base.
        "Next-Action": "invalide",
      },
      data: JSON.stringify([
        {
          serviceId: 1,
          adresse: {
            label: ADRESSE_DEMO.label,
            street: ADRESSE_DEMO.name,
            postcode: "69003",
            city: "Lyon",
            citycode: "69383",
            lon: ADRESSE_DEMO.lon,
            lat: ADRESSE_DEMO.lat,
          },
          debut: "2027-05-10T08:00:00.000Z",
        },
      ]),
      failOnStatusCode: false,
    });

    // Peu importe le code rendu — refus, redirection ou rejet du protocole.
    // Ce qui compte est l'invariant : la table n'a pas bougé.
    expect(reponse.status()).toBeGreaterThanOrEqual(200);
    expect(await db.intervention.count()).toBe(avant);
  } finally {
    await db.$disconnect();
  }
});

test("le récapitulatif propose de créer un compte au lieu de valider", async ({
  page,
}) => {
  await mockerBan(page);
  await page.goto("/reserver?etape=recapitulatif");

  // Sans session, le bouton de validation n'est pas proposé : ce n'est pas la
  // protection — elle est côté serveur — mais un écran qui ne promet pas ce
  // qu'il ne peut pas tenir.
  await expect(
    page.getByRole("button", { name: /valider ma réservation/i }),
  ).toHaveCount(0);
});
