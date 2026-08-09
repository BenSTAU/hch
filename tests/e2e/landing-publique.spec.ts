import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/// Landing publique — `US-FORFAIT-CONSULTER`, T-V3-13.
///
/// Ce fichier couvre ce que `jest-axe` et RTL ne peuvent pas voir : la page est
/// un **RSC asynchrone**, qui lit le catalogue en base. Les tests unitaires
/// éprouvent `LandingView` avec des forfaits fabriqués ; ici la chaîne complète
/// est traversée — Prisma, le filtre `is_active`, le tri, le formatage.
///
/// Les trois forfaits attendus sont ceux du seed de T-V3-01
/// (`prisma/seed.ts:133-158`). Le prix de « Changement pneus » y vaut **39 €**
/// et non les 120 € de la maquette : arbitrage de Benjamin du 2026-08-08, la
/// maquette faisait du forfait le plus court le plus cher.

const FORFAITS_SEEDES = [
  { label: "Diagnostic express", prix: /25,00\s€/u, duree: /20\smin/u },
  { label: "Changement pneus", prix: /39,00\s€/u, duree: /30\smin/u },
  { label: "Révision complète", prix: /85,00\s€/u, duree: /60\smin/u },
];

test.describe("landing publique — accessible sans session", () => {
  test("répond 200 à un visiteur anonyme, sans aucune redirection", async ({
    page,
  }) => {
    // Constitution §5.1 : le catalogue est accessible sans authentification.
    // DoD T-V3-13 : « aucune redirection vers /connexion, vérifié par test ».
    const reponse = await page.goto("/");

    expect(reponse?.status()).toBe(200);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("affiche le catalogue seedé avec prix et durée", async ({ page }) => {
    await page.goto("/");

    const catalogue = page.locator("#forfaits");

    for (const forfait of FORFAITS_SEEDES) {
      const carte = catalogue.getByRole("listitem").filter({
        has: page.getByRole("heading", { name: forfait.label, exact: true }),
      });

      await expect(carte).toHaveCount(1);
      await expect(carte.getByText(forfait.prix)).toBeVisible();
      await expect(carte.getByText(forfait.duree)).toBeVisible();
    }
  });

  test("classe les forfaits du moins cher au plus cher", async ({ page }) => {
    await page.goto("/");

    const titres = await page
      .locator("#forfaits")
      .getByRole("heading", { level: 3 })
      .allTextContents();

    expect(titres).toEqual(FORFAITS_SEEDES.map((forfait) => forfait.label));
  });

  test("mène chaque forfait à l'entrée du tunnel", async ({ page }) => {
    // `/reserver`, sans forfait pré-sélectionné : la DoD l'impose tant que
    // T-V3-08 n'a pas livré l'état pré-rempli. La route répond 404 jusque-là —
    // c'est le `href` qui est l'oracle, pas la page d'arrivée.
    await page.goto("/");

    const versLeTunnel = page
      .locator("#forfaits")
      .getByRole("link", { name: /Réserver/ });

    await expect(versLeTunnel).toHaveCount(FORFAITS_SEEDES.length);
    for (const lien of await versLeTunnel.all()) {
      await expect(lien).toHaveAttribute("href", "/reserver");
    }
  });
});

test.describe("landing publique — coquille transverse", () => {
  test("propose la connexion sans l'imposer", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("banner").getByRole("link", { name: "Connexion" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Se déconnecter" }),
    ).toHaveCount(0);
  });

  test("porte les trois liens légaux d'US-RGPD au pied de page", async ({
    page,
  }) => {
    // ⚠️ Les trois routes n'existent qu'à partir de T-V3-12 : l'oracle porte sur
    // la PRÉSENCE et la CIBLE des liens, jamais sur ce qu'elles renvoient. Un
    // test qui suivrait les liens serait rouge pour une raison qui n'appartient
    // pas à cette tâche.
    await page.goto("/");

    const pied = page.getByRole("contentinfo");

    await expect(
      pied.getByRole("link", { name: "Mentions légales" }),
    ).toHaveAttribute("href", "/mentions-legales");
    await expect(
      pied.getByRole("link", { name: "Politique de confidentialité" }),
    ).toHaveAttribute("href", "/politique-confidentialite");
    await expect(
      pied.getByRole("link", { name: "Accessibilité" }),
    ).toHaveAttribute("href", "/accessibilite");
  });

  test("ne propose ni « Mes factures » ni « Recrutement »", async ({
    page,
  }) => {
    // Le premier contredit Constitution §2.3, le second est hors périmètre v1.
    // Tous deux sont dans la maquette : sans oracle, ils reviennent au premier
    // portage d'écran suivant.
    await page.goto("/");

    await expect(page.getByText(/factures?/i)).toHaveCount(0);
    await expect(page.getByText(/recrutement/i)).toHaveCount(0);
  });

  test("ancre chaque entrée de la navigation sur une section réelle", async ({
    page,
  }) => {
    // Un lien d'ancre dont la cible n'existe pas ne produit aucune erreur : il
    // ne fait rien. C'est exactement le genre de défaut qu'une démonstration
    // révèle et qu'aucun test de rendu ne voit.
    await page.goto("/");

    for (const ancre of ["forfaits", "fonctionnement", "zone"]) {
      await expect(page.locator(`#${ancre}`)).toHaveCount(1);
    }
  });
});

test.describe("landing publique — accessibilité outillée", () => {
  /// RGAA **niveau A** (SPEC §6.3.1) — l'AA reste réservée aux points d'entrée
  /// d'authentification (§6.3.2). Les tags AA sont néanmoins passés : le
  /// contraste de texte (WCAG 1.4.3) est le seul critère que le navigateur
  /// ajoute à `jest-axe`, qui ne calcule aucune couleur en jsdom, et c'est
  /// précisément celui qu'une palette portée à la main peut casser.
  const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

  test("la landing ne présente aucune violation", async ({ page }) => {
    await page.goto("/");

    const resultats = await new AxeBuilder({ page }).withTags(TAGS).analyze();

    expect(resultats.violations).toEqual([]);
  });

  test("la landing reste sans violation en affichage mobile", async ({
    page,
  }) => {
    // Règle 2 du portage : les maquettes sont en 1920×1080 seulement, et le
    // parcours client est mobile-first (`US-RGPD` §Critères).
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    const resultats = await new AxeBuilder({ page }).withTags(TAGS).analyze();

    expect(resultats.violations).toEqual([]);
  });

  test("le menu mobile ouvert ne présente aucune violation", async ({
    page,
  }) => {
    // Le panneau est un dialogue Radix : piège de focus, `aria-modal`, nom
    // accessible. Rien de tout cela n'est visible tant qu'il est fermé, et c'est
    // la seule surface interactive de la coquille publique.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    await page.getByRole("button", { name: "Ouvrir le menu" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    const resultats = await new AxeBuilder({ page }).withTags(TAGS).analyze();

    expect(resultats.violations).toEqual([]);
  });
});

test.describe("landing publique — navigation mobile", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("garde la navigation atteignable sous 768 px", async ({ page }) => {
    // C1 masque purement sa nav sous `md` (`code.html:211`), ce qui laisserait
    // un mobile sans aucune navigation. Mesuré au navigateur avant le burger :
    // la replier en seconde ligne donnait 185 px d'en-tête sur trois lignes.
    await page.goto("/");

    await expect(
      page.getByRole("navigation", { name: "Navigation principale" }),
    ).toBeHidden();

    await page.getByRole("button", { name: "Ouvrir le menu" }).click();

    const panneau = page.getByRole("dialog");

    await expect(
      panneau.getByRole("link", { name: "Nos forfaits" }),
    ).toBeVisible();
    await expect(
      panneau.getByRole("link", { name: "Comment ça marche" }),
    ).toBeVisible();
    await expect(
      panneau.getByRole("link", { name: "Zone desservie" }),
    ).toBeVisible();
    await expect(
      panneau.getByRole("link", { name: "Connexion" }),
    ).toBeVisible();
  });

  test("se referme au choix d'une entrée", async ({ page }) => {
    // Les entrées sont des ancres de la même page : aucune navigation ne
    // démonte le panneau, et le laisser ouvert masquerait la section vers
    // laquelle on vient de sauter.
    await page.goto("/");

    await page.getByRole("button", { name: "Ouvrir le menu" }).click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: "Nos forfaits" })
      .click();

    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("nomme son bouton de fermeture en français", async ({ page }) => {
    // Le registry shadcn livre « Close ». C'est un nom accessible, donc ce
    // qu'annonce un lecteur d'écran sur une application entièrement en français.
    await page.goto("/");

    await page.getByRole("button", { name: "Ouvrir le menu" }).click();

    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Fermer" }),
    ).toBeVisible();
  });
});
