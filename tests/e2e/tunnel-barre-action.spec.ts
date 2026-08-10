import { expect, test, type Page } from "@playwright/test";

import { ADRESSE_DEMO, entiteBan } from "../../src/mocks/handlers";

/// Barre d'actions basse du tunnel, au format téléphone - DoD T-V3-09.
///
/// ⚠️ Ajouté par l'agent testeur, 2026-08-10. La DoD était vérifiée à la main
/// au navigateur, ce qui prouve l'état du jour et rien du lendemain : la barre
/// est PARTAGÉE par trois écrans, ses libellés se raccourcissent par classes
/// utilitaires (`LibelleBarre`), et la compensation du contenu (`pb-24`) est un
/// nombre écrit ailleurs que la barre elle-même. Trois pièces qui bougent
/// séparément et dont l'accord ne se relit pas.
///
/// L'invariant tenu ici est celui que `tunnel-barre-action.tsx:26-33` énonce en
/// commentaire : **la barre reste d'une ligne, à toute largeur**. Dès qu'un
/// libellé se replie, elle grandit sans que le `pb-24` du contenu le sache, et
/// elle recouvre le bas de l'écran - la card « Récapitulatif du créneau », dont
/// le total se fait manger.
///
/// jsdom ne peut pas le voir : il n'applique aucune feuille de style et ne
/// calcule aucune géométrie. C'est un test de navigateur ou rien.

/// `pb-24` du contenu (`tunnel-reservation.tsx:382`), en pixels. C'est LE
/// nombre que la hauteur de barre ne doit pas dépasser.
const COMPENSATION_PB24 = 96;

const TELEPHONE = { width: 375, height: 812 };

const URL_BAN = "https://data.geopf.fr/geocodage/search/**";

async function mockerBan(page: Page) {
  await page.route(URL_BAN, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        type: "FeatureCollection",
        features: [entiteBan({ ...ADRESSE_DEMO, type: "housenumber" })],
      }),
    });
  });
}

/// La barre n'a pas de rôle propre - c'est un conteneur de deux boutons. On la
/// désigne par le bouton principal, dont elle est le parent positionné.
function barre(page: Page) {
  return page.locator("div.fixed.inset-x-0.bottom-0");
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(TELEPHONE);
  await mockerBan(page);
});

test("la barre tient sur une ligne au premier pas, à 375 px", async ({
  page,
}) => {
  await page.goto("/reserver");
  await expect(barre(page)).toBeVisible();

  const cadre = await barre(page).boundingBox();
  expect(cadre?.height ?? 0).toBeLessThanOrEqual(COMPENSATION_PB24);
  expect(cadre?.width ?? 0).toBeLessThanOrEqual(TELEPHONE.width);
});

test("aucun bouton de la barre ne sort du cadre, à 375 px", async ({
  page,
}) => {
  // Le défaut constaté par Benjamin le 2026-08-10 : « Continuer vers le
  // récapitulatif » tronqué et le bouton sorti du cadre à droite. Le libellé
  // court de `LibelleBarre` est la réponse ; ce test tient l'effet, pas le
  // moyen.
  await page.goto("/reserver");
  await page.locator("label", { hasText: /Diagnostic express/ }).click();
  await page.getByRole("button", { name: /^continuer$/i }).click();

  await expect(
    page.getByRole("heading", { name: /où intervenons-nous/i }),
  ).toBeVisible();

  await page
    .getByRole("combobox", { name: /adresse/i })
    .fill("12 rue de la bicyclette");
  await page.getByRole("option").first().click();
  await expect(page.getByText(/adresse dans notre zone/i)).toBeVisible();

  // Au format téléphone le libellé visible est le COURT (`sm:hidden`), et le
  // nom accessible suit le texte réellement affiché - c'est tout l'objet du
  // doublon dans le DOM plutôt que d'un `aria-label` divergent (WCAG 2.5.3).
  const suivant = page.getByRole("button", { name: /créneaux/i });
  const cadreSuivant = await suivant.boundingBox();
  expect(cadreSuivant).not.toBeNull();
  expect(
    (cadreSuivant?.x ?? 0) + (cadreSuivant?.width ?? 0),
  ).toBeLessThanOrEqual(TELEPHONE.width);

  await suivant.click();
  await expect(
    page.getByRole("heading", { name: /choisissez votre créneau/i }),
  ).toBeVisible();

  const versRecapitulatif = page.getByRole("button", {
    name: /récapitulatif/i,
  });
  const cadreRecap = await versRecapitulatif.boundingBox();
  expect(cadreRecap).not.toBeNull();
  expect((cadreRecap?.x ?? 0) + (cadreRecap?.width ?? 0)).toBeLessThanOrEqual(
    TELEPHONE.width,
  );

  // Et la barre elle-même n'a pas grandi sous le libellé le plus long des
  // trois écrans : c'est là que la hauteur dérapait.
  const cadreBarre = await barre(page).boundingBox();
  expect(cadreBarre?.height ?? 0).toBeLessThanOrEqual(COMPENSATION_PB24);
});

test("la barre ne recouvre pas la card de récapitulatif du créneau", async ({
  page,
}) => {
  // La divergence était nommée pour C3 dans [[maquettage]] §Notes portage
  // (« nav bottom sticky coupe la card résultat ») et traitée écran par écran,
  // alors que la barre est partagée. L'oracle porte donc sur la géométrie, pas
  // sur une classe.
  await page.goto("/reserver");
  await page.locator("label", { hasText: /Diagnostic express/ }).click();
  await page.getByRole("button", { name: /^continuer$/i }).click();
  await page
    .getByRole("combobox", { name: /adresse/i })
    .fill("12 rue de la bicyclette");
  await page.getByRole("option").first().click();
  await expect(page.getByText(/adresse dans notre zone/i)).toBeVisible();
  await page.getByRole("button", { name: /créneaux/i }).click();

  const card = page
    .locator("div")
    .filter({ hasText: /^Récapitulatif du créneau/ })
    .first();
  await expect(card).toBeVisible();

  // ⚠️ **Attente ajoutée le 2026-08-10, règle du test rouge cas 3 : oracle
  // dépendant d'un détail de timing.** La grille de créneaux arrive par
  // TanStack Query, donc APRÈS un aller-retour réseau. Scroller pendant le
  // squelette amenait bien en bas d'une page qui grandissait ensuite : la
  // mesure lisait un état intermédiaire, jamais celui que voit l'utilisateur au
  // repos. Le test échouait à 853 px pour un bas de card qui vaut 716 une fois
  // la grille posée, vérifié trois fois au navigateur.
  //
  // La propriété visée ne change pas d'un iota - la barre ne recouvre pas la
  // card, page déroulée au maximum. C'est le moment de la mesure qui devient
  // déterministe.
  await expect(
    page.getByRole("button", { name: /^\d{2}:\d{2}$/ }).first(),
  ).toBeVisible();

  // Bas de page : c'est là que le recouvrement se produit, la barre étant
  // `fixed` et la card en fin de flux.
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(200);

  const cadreCard = await card.boundingBox();
  const cadreBarre = await barre(page).boundingBox();
  expect(cadreCard).not.toBeNull();
  expect(cadreBarre).not.toBeNull();

  expect(
    (cadreCard?.y ?? 0) + (cadreCard?.height ?? 0),
    "le bas de la card passe sous le haut de la barre d'action",
  ).toBeLessThanOrEqual(cadreBarre?.y ?? 0);
});
