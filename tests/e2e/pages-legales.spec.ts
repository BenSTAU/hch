import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

/// Les trois pages d'`US-RGPD` - T-V3-12, écran **C13**.
///
/// Elles sont des Server Components **asynchrones** : elles lisent l'identité de
/// la société en base, et RTL ne les déroule pas (ADR-014 : async Server
/// Components → E2E uniquement). Ce fichier est donc leur SEULE couverture de
/// rendu, et le seul endroit où axe-core les voit dans un vrai navigateur - où
/// il calcule les contrastes, ce que `jest-axe` en jsdom ne fait jamais.
///
/// Trois propriétés qu'aucun test unitaire ne peut porter :
///
///   · les trois routes répondent **sans session**, `US-RGPD` §Critères. Elles
///     ont répondu 404 depuis T-V3-13, qui posait les liens du pied de page ;
///   · le contenu vient d'`app_settings`, pas de constantes : les mentions
///     légales doivent être exactes, et c'est l'administrateur qui les tient ;
///   · le pied de page mène réellement aux trois, sur toutes les pages.

let db: PrismaClient;

const PAGES = [
  { chemin: "/mentions-legales", titre: "Mentions légales" },
  {
    chemin: "/politique-confidentialite",
    titre: "Politique de confidentialité",
  },
  { chemin: "/accessibilite", titre: "Déclaration d'accessibilité" },
] as const;

test.beforeAll(async () => {
  db = new PrismaClient();
});

test.afterAll(async () => {
  await db.$disconnect();
});

test.describe("Pages légales - accessibles à tous", () => {
  for (const page_ of PAGES) {
    test(`${page_.chemin} répond sans session`, async ({ page }) => {
      const reponse = await page.goto(page_.chemin);

      expect(reponse?.status()).toBe(200);
      // L'URL n'a pas bougé : aucune redirection vers `/connexion`. C'est ce que
      // `src/proxy.ts` garantit en ne matchant pas ces chemins, et c'est
      // vérifié plutôt que supposé.
      await expect(page).toHaveURL(new RegExp(`${page_.chemin}$`));
      await expect(
        page.getByRole("heading", { level: 1, name: page_.titre }),
      ).toBeVisible();
      // L'en-tête propose de se connecter : la session est bien absente.
      await expect(
        page.getByRole("banner").getByRole("link", { name: /Connexion/i }),
      ).toBeVisible();
    });
  }

  test("le pied de page mène aux trois pages", async ({ page }) => {
    await page.goto("/");

    const pied = page.getByRole("contentinfo");
    for (const page_ of PAGES) {
      await expect(
        pied.getByRole("link", { name: LIBELLE_PIED[page_.chemin] }),
      ).toHaveAttribute("href", page_.chemin);
    }
  });

  test("la barre des pages légales marque la page courante", async ({
    page,
  }) => {
    await page.goto("/accessibilite");

    const barre = page.getByRole("navigation", { name: "Pages légales" });
    await expect(
      barre.getByRole("link", { name: "Accessibilité" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      barre.getByRole("link", { name: "Mentions légales" }),
    ).not.toHaveAttribute("aria-current", "page");
  });

  test("aucune page de conditions générales de vente n'est proposée", async ({
    page,
  }) => {
    // La maquette C13 nomme son troisième onglet « Conditions Générales de
    // Vente ». Le triplet de PLAN S4 §4.2 fait foi : la troisième page est la
    // déclaration RGAA, et la case « J'accepte les CGV » de C5 et C6 n'a pas
    // été portée non plus.
    await page.goto("/mentions-legales");

    await expect(page.getByText(/conditions générales/i)).toHaveCount(0);
  });
});

test.describe("Mentions légales - le contenu vient de la base", () => {
  test("affiche la raison sociale et le SIRET tenus par l'administrateur", async ({
    page,
  }) => {
    const reglages = await db.appSetting.findMany({
      where: { key: { in: ["company.name", "company.siret"] } },
      select: { key: true, value: true },
    });
    const parCle = new Map(reglages.map((r) => [r.key, r.value]));

    await page.goto("/mentions-legales");

    // Oracle lu EN BASE, pas recopié : une valeur en dur ici rendrait le test
    // vert le jour où la page cesserait de lire `app_settings`.
    //
    // ⚠️ Porté sur l'**article 1** et non sur la page entière depuis le
    // 2026-08-12 : le rappel d'éditeur ajouté au pied de la coquille (écart E1
    //) affiche les mêmes valeurs, et le mode strict
    // de Playwright en résolvait deux. La propriété visée reste la même, et
    // elle est même mieux localisée qu'avant.
    const editeur = page.getByRole("region", {
      name: "Article 1 : éditeur du site",
    });
    await expect(
      editeur.getByText(parCle.get("company.name") ?? ""),
    ).toBeVisible();
    await expect(
      editeur.getByText(parCle.get("company.siret") ?? ""),
    ).toBeVisible();
  });

  test("explique l'absence de bannière cookies", async ({ page }) => {
    await page.goto("/mentions-legales");

    await expect(page.getByText("Zéro bannière cookies")).toBeVisible();
    // Aucune bannière de consentement ne doit apparaître, sur aucune page :
    // c'est la décision de PLAN S4 §4.1, et l'écran est sa seule preuve.
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("Politique de confidentialité - ce qu'elle déclare", () => {
  test("nomme les quatre destinataires réels", async ({ page }) => {
    await page.goto("/politique-confidentialite");

    const destinataires = page.getByRole("region", { name: "Destinataires" });
    await expect(destinataires).toContainText("OVH");
    // La BAN, que PLAN S4 §4.2 ne listait pas : `verifierAdresse` lui transmet
    // l'adresse saisie.
    await expect(destinataires).toContainText("Base Adresse Nationale");
    // Google au titre du TRANSPORT EMAIL (ADR-017).
    await expect(destinataires).toContainText("Google LLC");
    await expect(destinataires).toContainText("Data Privacy Framework");

    // ⚠️ **Oracle inversé par T-V2-01** (règle du test rouge, cas 3 : il disait
    // vrai jusqu'à ce que le produit change). Il exigeait l'ABSENCE de « Maps »,
    // ce qui était juste sous ADR-015 v2 — la cartographie avait quitté le
    // parcours client le 2026-08-08. Le cadrage du plancher V2 (D5) a rétabli
    // une carte Maps JS sur l'écran T1, la tournée du technicien, cas dont
    // l'ADR ne disait rien. Le transfert doit donc être déclaré, et c'est
    // exactement ce que la DoD case 14 exige : « si la carte part, la mention
    // part avec elle » — donc si la carte revient, la mention revient.
    await expect(destinataires).toContainText("Google Maps");
    // Le fond de carte, PAS le géocodage : celui-ci passe par la BAN, service
    // public français, sans clé et sans transfert hors UE.
    await expect(destinataires).not.toContainText("géocodage");
  });

  test("mène à la suppression de compte depuis la section Vos droits", async ({
    page,
  }) => {
    await page.goto("/politique-confidentialite");

    // Second point d'entrée nommé par `US-COMPTE-SUPPRIMER` §Cas nominal, et
    // celui qui rend le droit à l'oubli atteignable même si l'écran C12
    // n'est jamais livré.
    await expect(
      page.getByRole("link", { name: "Supprimer mon compte" }),
    ).toHaveAttribute("href", "/mon-compte/supprimer");
  });

  test("dit comment exercer les droits que le produit n'outille pas", async ({
    page,
  }) => {
    await page.goto("/politique-confidentialite");

    const droits = page.getByRole("region", { name: "Vos droits" });
    // Un droit déclaré sans chemin pour l'exercer est pire que le silence : la
    // portabilité est annoncée, elle n'a pas d'écran, l'adresse de contact est
    // donc obligatoire.
    await expect(droits).toContainText("portabilité");
    await expect(droits.getByRole("link", { name: /@/ })).toBeVisible();
  });

  test("ne promet pas la disparition des données", async ({ page }) => {
    await page.goto("/politique-confidentialite");

    // PLAN S4 §4.4 : « pas de "votre compte disparaît pour de bon" qui
    // exposerait à un rappel CNIL ». L'opération est une pseudonymisation, et
    // c'est ce mot-là qui doit apparaître.
    await expect(page.getByText(/pseudonymis/i).first()).toBeVisible();

    // ⚠️ **La moitié manquante de cet oracle** en
    // PR #39 : il vérifiait la PRÉSENCE de « pseudonymis », jamais l'ABSENCE
    // d'une promesse de disparition, alors que son nom promet l'inverse. Les
    // trois formules ci-dessous sont exactement celles que S4 §4.4 interdit.
    const droits = page.getByRole("region", { name: "Vos droits" });
    await expect(droits).not.toContainText(/disparaî/i);
    await expect(droits).not.toContainText(/définitivement effacé/i);
    await expect(droits).not.toContainText(/pour de bon/i);
  });

  test("déclare que les données conservées restent ré-identifiables", async ({
    page,
  }) => {
    await page.goto("/politique-confidentialite");

    // PLAN S2 §T6 : le maintien des clés étrangères vers `interventions` et
    // `payments` rend la personne identifiable par recoupement, et c'est ce qui
    // fait de l'opération une PSEUDONYMISATION et non une anonymisation. S4
    // §4.4 ne le disait pas, les deux sections du PLAN se contredisaient depuis
    // le 2026-07-29, et le produit se taisait.
    //
    // L'assertion porte sur la phrase elle-même : elle échoue si on la retire,
    // ce que ne faisait aucun oracle de la PR #39.
    const droits = page.getByRole("region", { name: "Vos droits" });
    await expect(droits).toContainText(/identifier par recoupement/i);
    // La ré-identification doit être annoncée POSSIBLE, pas hypothétique : une
    // formule qui l'adoucirait viderait la déclaration de son objet.
    await expect(droits).not.toContainText(
      /théoriquement|improbable|peu probable/i,
    );
  });

  test("déclare que la commune des adresses est conservée", async ({
    page,
  }) => {
    await page.goto("/politique-confidentialite");

    // `addresses.city_id` pointe vers une table partagée que la pseudonymisation
    // ne touche pas, volontairement. L'énumération de ce qui est effacé se lit
    // comme exhaustive tant que l'exception n'y figure pas.
    await expect(
      page.getByRole("region", { name: "Vos droits" }),
    ).toContainText(/commune/i);
  });
});

test.describe("Déclaration d'accessibilité", () => {
  test("déclare la conformité partielle et nomme la non-conformité connue", async ({
    page,
  }) => {
    await page.goto("/accessibilite");

    await expect(page.getByText(/partiellement conforme/i)).toBeVisible();
    // La bordure des champs, non conforme et assumée en faveur de la maquette.
    // Aucune barrière ne la détecte : ni axe en jsdom (aucun contraste calculé)
    // ni axe au navigateur (aucune règle pour 1.4.11). Cette page est le seul
    // endroit du produit où elle est écrite.
    // ⚠️ Attendait « 1,06:1 », chiffre hérité de la DoD et de la note (4) de la
    // PR #17, que l'agent testeur a mesuré faux au navigateur : le fond du
    // champ donne 1,11:1 sur une carte et 1,05:1 sur le fond de page. Oracle
    // corrigé avec la page, write-back dû sur la DoD.
    await expect(page.getByText(/1,11:1/)).toBeVisible();
    await expect(page.getByText(/1,05:1/)).toBeVisible();
    await expect(page.getByText(/1\.4\.11/)).toBeVisible();
    await expect(page.getByText(/2\.4\.7/)).toBeVisible();
  });

  test("porte les voies de recours", async ({ page }) => {
    await page.goto("/accessibilite");

    await expect(page.getByText(/Défenseur des droits/i).first()).toBeVisible();
  });
});

/// Une déclaration de conformité partielle est le seul endroit du produit où un
/// chiffre engage l'éditeur devant un tiers, et c'est le seul chiffre qu'aucune
/// barrière ne recalculait : ni `jest-axe` (aucun contraste en jsdom) ni
/// `@axe-core/playwright` (aucune règle axe ne couvre WCAG 1.4.11). Il était
/// donc recopié depuis un commentaire de `src/components/ui/input.tsx`, lui-même
/// recopié du vault.
///
/// Ces deux tests le mesurent DANS le navigateur, sur la surface où le champ est
/// réellement posé.
test.describe("Déclaration d'accessibilité - le chiffre publié est mesuré", () => {
  /// Couleur de fond calculée du champ, et celle de la première surface opaque
  /// derrière lui. La bordure au repos est `transparent` : la limite du champ
  /// n'est donc rien d'autre que ce couple d'aplats.
  async function aplatsDuChamp(page: import("@playwright/test").Page) {
    return page.evaluate(() => {
      const opaque = (couleur: string) =>
        couleur !== "transparent" && !couleur.startsWith("rgba(0, 0, 0, 0)");

      const champ = document.querySelector('[data-slot="input"]');
      if (!champ) throw new Error("aucun champ de saisie sur cette page");

      let surface: Element | null = champ.parentElement;
      while (surface && !opaque(getComputedStyle(surface).backgroundColor)) {
        surface = surface.parentElement;
      }

      return {
        champ: getComputedStyle(champ).backgroundColor,
        surface: surface
          ? getComputedStyle(surface).backgroundColor
          : "rgb(255, 255, 255)",
      };
    });
  }

  test("la non-conformité 1.4.11 annoncée existe encore", async ({ page }) => {
    await page.goto("/connexion");

    const { champ, surface } = await aplatsDuChamp(page);
    const mesure = ratioContraste(champ, surface);

    // La déclaration affirme que la limite du champ n'est pas identifiable au
    // contraste. Ce test rougit le jour où quelqu'un rend `border-input` au
    // repos sans retirer la non-conformité de la page - une déclaration qui
    // annonce un défaut corrigé est fausse dans l'autre sens.
    expect(
      mesure,
      `contraste mesuré ${mesure.toFixed(2)}:1 entre ${champ} et ${surface}`,
    ).toBeLessThan(3);
  });

  test("le ratio publié est celui que les tokens produisent", async ({
    page,
  }) => {
    await page.goto("/connexion");
    const aplats = await aplatsDuChamp(page);
    const mesure = ratioContraste(aplats.champ, aplats.surface);

    await page.goto("/accessibilite");
    const texte = (await page.getByText(/:1/).first().textContent()) ?? "";
    const publie = texte.match(/(\d+,\d+):1/)?.[1];
    expect(publie, "aucun ratio publié sur la déclaration").toBeDefined();

    const declare = Number(publie!.replace(",", "."));

    // Tolérance de 0,01 : c'est l'arrondi de l'affichage, pas une marge de
    // confort. Le champ de connexion est posé sur `--card` (#ffffff), pas sur
    // `--background` (#f8faf8) - deux surfaces qui ne donnent pas le même
    // chiffre, et la déclaration n'en publie qu'un.
    expect(
      Math.abs(declare - mesure),
      `déclaré ${declare}:1, mesuré ${mesure.toFixed(2)}:1 entre ${aplats.champ} et ${aplats.surface}`,
    ).toBeLessThanOrEqual(0.01);
  });
});

/// Ratio de contraste WCAG 2.1, formule des Techniques G17/G18. Écrit ici plutôt
/// qu'emprunté : axe-core l'implémente mais ne l'expose pas, et aucune de ses
/// règles ne porte sur 1.4.11.
function ratioContraste(premiere: string, seconde: string): number {
  const [claire, sombre] = [luminance(premiere), luminance(seconde)].sort(
    (a, b) => b - a,
  ) as [number, number];
  return (claire + 0.05) / (sombre + 0.05);
}

function luminance(couleur: string): number {
  const canaux = couleur
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (!canaux || canaux.length < 3) {
    throw new Error(`couleur illisible : ${couleur}`);
  }

  const [rouge, vert, bleu] = canaux.map((canal) => {
    const normalise = canal / 255;
    return normalise <= 0.03928
      ? normalise / 12.92
      : ((normalise + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * rouge + 0.7152 * vert + 0.0722 * bleu;
}

test.describe("Pages légales - accessibilité au navigateur", () => {
  for (const page_ of PAGES) {
    test(`${page_.chemin} ne présente aucune violation en 1440 px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(page_.chemin);

      const resultats = await new AxeBuilder({ page }).analyze();

      expect(resultats.violations.filter((v) => v.impact !== "minor")).toEqual(
        [],
      );
    });

    test(`${page_.chemin} ne présente aucune violation en 375 px`, async ({
      page,
    }) => {
      // Le parcours client est mobile-first (règle 2 du portage), et le
      // sommaire disparaît sous `md` : la structure de titres change, elle doit
      // être auditée dans les deux largeurs.
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(page_.chemin);

      const resultats = await new AxeBuilder({ page }).analyze();

      expect(resultats.violations.filter((v) => v.impact !== "minor")).toEqual(
        [],
      );
    });
  }
});

/// Le pied de page nomme la politique « Politique de confidentialité », comme
/// la barre ; le titre de la page d'accessibilité, lui, est plus long que son
/// lien.
const LIBELLE_PIED: Record<string, string> = {
  "/mentions-legales": "Mentions légales",
  "/politique-confidentialite": "Politique de confidentialité",
  "/accessibilite": "Accessibilité",
};
