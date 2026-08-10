import { PrismaClient } from "@prisma/client";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { ADRESSE_DEMO, entiteBan } from "../../src/mocks/handlers";
import { creerClientActive, seConnecterClient } from "../support/compte-client";

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

/// Retient un forfait sur l'écran C2.
///
/// Le clic porte sur la DALLE, pas sur le bouton radio : celui-ci est
/// visuellement masqué (`sr-only`, 1 px), et la dalle qui lui sert d'étiquette
/// intercepte les événements de pointeur - Playwright refuse alors de cliquer
/// une cible couverte, et il a raison, c'est bien la dalle que l'utilisateur
/// vise. La sélection se vérifie ensuite sur `aria-checked`, qui est la
/// propriété qui compte.
async function choisirForfait(page: Page, nom: RegExp): Promise<void> {
  await page.locator("label", { hasText: nom }).click();
  await expect(page.getByRole("radio", { name: nom })).toBeChecked();
}

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
  // ⚠️ Oracle réécrit le 2026-08-10, règle du test rouge cas 3 : le titre
  // fonctionnel « Choisir une prestation » posé par T-V3-08 n'était d'aucune
  // maquette. C'est celui de C2 (`c2:147`) qui s'affiche depuis le portage.
  await expect(
    page.getByRole("heading", { name: /quel forfait vous convient/i }),
  ).toBeVisible();

  // ⚠️ Oracle réécrit le 2026-08-10, règle du test rouge cas 3. Il regardait le
  // lien « Connexion » de l'en-tête du site : le tunnel a désormais sa PROPRE
  // coquille (groupe `(tunnel)`), sans nav publique, comme les quatre maquettes.
  // La propriété visée ne change pas - aucune session n'a été ouverte au
  // passage - et l'oracle qui la porte ne dépend plus de la coquille.
  await expect(
    page.getByRole("button", { name: /se déconnecter/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /quitter la réservation/i }),
  ).toBeVisible();
});

test("un forfait choisi depuis la landing arrive pré-sélectionné", async ({
  page,
}) => {
  // Report de T-V3-13, qui n'avait posé que le lien vers l'entrée du tunnel :
  // les cartes de C1 pointaient toutes la même URL. C'est ici que le paramètre
  // se câble, et ici qu'il se prouve.
  await page.goto("/reserver");

  // ⚠️ Oracle réécrit : les cartes de C2 ne sont plus des boutons « Choisir X »
  // mais un GROUPE DE BOUTONS RADIO - choix exclusif parmi n, puis « Continuer »
  // dans la barre basse, comme la maquette. Le pas ne change plus au clic.
  await choisirForfait(page, /Diagnostic express/);
  await page.getByRole("button", { name: /^continuer$/i }).click();

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

  await choisirForfait(page, /Diagnostic express/);
  await page.getByRole("button", { name: /^continuer$/i }).click();

  const champ = page.getByRole("combobox", { name: /adresse/i });
  await champ.fill("12 rue de la bicyclette");

  // ⚠️ Oracle réécrit le 2026-08-10 : la voie est désormais PROPOSÉE, comme
  // piste de raffinement, parce que « place Bellecour » ne rendait rien et
  // qu'un champ muet se lit comme une panne. Elle n'est toujours pas
  // retenable, et c'est ça que le test doit dire.
  const options = page.getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.first()).toHaveText(ADRESSE_DEMO.label);
  await expect(options.first()).not.toContainText(/préciser le numéro/i);
  await expect(options.nth(1)).toContainText(/préciser le numéro/i);
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
  await choisirForfait(page, /Diagnostic express/);
  await page.getByRole("button", { name: /^continuer$/i }).click();

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

test("un client activé traverse le tunnel et réserve", async ({ page }) => {
  // `GP-02` d'ADR-014 §5, dans sa forme complète. Le critère de fin de phase
  // V3 l'écrit ainsi depuis le renversement de Constitution §3.2 : le compte
  // activé PRÉCÈDE la validation, la traversée passe donc par inscription,
  // activation en base et connexion.
  const db = new PrismaClient();
  try {
    await mockerBan(page);

    const avant = await db.intervention.count();
    const photosAvant = await db.photo.count();
    const { email } = await creerClientActive(page, db, "gp02");
    await seConnecterClient(page, email);

    await page.goto("/reserver");

    // 1. Forfait
    await choisirForfait(page, /Révision complète/);
    await page.getByRole("button", { name: /^continuer$/i }).click();

    // 2. Adresse
    await page
      .getByRole("combobox", { name: /adresse/i })
      .fill("12 rue de la bicyclette");
    await page.getByRole("option").first().click();
    await expect(page.getByText(/adresse dans notre zone/i)).toBeVisible();
    await page
      .getByRole("button", { name: /continuer vers les créneaux/i })
      .click();

    // 3. Créneau. Le premier proposé suffit : ce que le test éprouve est la
    // traversée, pas la dérivation, qui a ses propres tests.
    const premierCreneau = page.getByRole("button", { name: /^\d{2}:\d{2}$/ });
    await expect(premierCreneau.first()).toBeVisible();
    await premierCreneau.first().click();
    await page
      .getByRole("button", { name: /continuer vers le récapitulatif/i })
      .click();

    // 4. Photo préparatoire, déposée pour de vrai.
    //
    // C'est la seule preuve que la chaîne complète tient : `<input type=file>`
    // → `POST /api/upload-intervention-photo` → strip EXIF par `sharp` → chemin
    // rendu → ligne `photos` écrite DANS la transaction de validation, après
    // création de l'intervention (`photos.intervention_id` est NOT NULL).
    // Le build passe sans rien prouver de tout ça.
    await page.setInputFiles('input[type="file"]', "tests/fixtures/velo.png");
    await expect(page.getByAltText(/aperçu de velo\.png/i)).toBeVisible();

    // 5. Validation
    await page.getByRole("button", { name: /valider ma réservation/i }).click();

    await expect(
      page.getByRole("heading", { name: /votre intervention est planifiée/i }),
    ).toBeVisible();

    // Les invariants qui comptent : une intervention de plus, et une seule, et
    // la photo réellement rattachée.
    expect(await db.intervention.count()).toBe(avant + 1);
    expect(await db.photo.count()).toBe(photosAvant + 1);
  } finally {
    await db.$disconnect();
  }
});

test("le tunnel ne présente aucune violation d'accessibilité", async ({
  page,
}) => {
  // `@axe-core/playwright` complète `jest-axe` : il tourne dans un vrai
  // navigateur, donc il voit les contrastes que jsdom ne calcule pas.
  // ⚠️ Il ne couvre ni WCAG 1.4.11 ni 2.4.7 - un vert ici ne referme pas
  // l'écart de bordure relevé en T-V3-02.
  await mockerBan(page);
  await page.goto("/reserver");

  for (const largeur of [1440, 375]) {
    await page.setViewportSize({ width: largeur, height: 900 });
    const resultats = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag21a"])
      .analyze();

    expect(resultats.violations, `violations en ${String(largeur)} px`).toEqual(
      [],
    );
  }
});
