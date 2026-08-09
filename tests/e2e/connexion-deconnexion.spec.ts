import { PrismaClient } from "@prisma/client";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  MOT_DE_PASSE_CLIENT,
  creerClientActive,
  emailUnique,
} from "../support/compte-client";

/// Connexion, cloisonnement et déconnexion du client — T-V3-03,
/// `US-COMPTE-CONNECTER` et `US-COMPTE-DECONNECTER`.
///
/// Avec `inscription-activation.spec.ts`, ce fichier forme **`GP-01
/// signup-login-client`** (ADR-014 §5) : le premier porte inscription et
/// activation, celui-ci prend la suite au premier écran de connexion. Le
/// découpage vaut mieux qu'un fichier unique de trente tests, et chacun garde
/// un oracle lisible.
///
/// Ce qui se prouve ici et nulle part ailleurs :
///   · la destination post-connexion dépend du RÔLE — un client qui atterrit
///     sur `/admin/parametres` voit un 403, c'est le parcours nominal de V3 qui
///     casse ;
///   · le plafond d'échecs existe pour une adresse INCONNUE, sans quoi « trop
///     de tentatives » redevient un oracle d'énumération ;
///   · la déconnexion ferme réellement la porte, pas seulement l'affichage.

const db = new PrismaClient();

test.afterAll(async () => {
  await db.$disconnect();
});

/// Le repère d'alerte de la PAGE, et non celui du framework : Next injecte dans
/// chaque document un annonceur de route `role="alert"` vide, hors de `<main>`.
/// Sans ce cadrage, le mode strict de Playwright en résout deux.
function alerte(page: Page) {
  return page.getByRole("main").getByRole("alert");
}

/// Remplit et soumet le formulaire de connexion.
///
/// `exact: true` sur « Mot de passe » : l'écran C6 porte une bascule
/// d'affichage dont le nom accessible contient le libellé du champ, et
/// `getByLabel` compare en sous-chaîne insensible à la casse. Même piège que
/// « Nom » face à « Prénom », qui a coûté 9 tests en CI sur la PR #17.
async function soumettre(
  page: Page,
  email: string,
  motDePasse: string,
): Promise<void> {
  await page.goto("/connexion");
  await page.getByLabel("Adresse email").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

test.describe("connexion du client", () => {
  test("dépose le client sur l'accueil, pas sur un 403", async ({ page }) => {
    // DoD T-V3-03, reportée de T-V3-02 : `AFTER_LOGIN` valait
    // `/admin/parametres` pour tout le monde. Un client fraîchement activé se
    // connectait avec succès et voyait un refus.
    const { email } = await creerClientActive(page, db, "connexion");

    await soumettre(page, email, MOT_DE_PASSE_CLIENT);

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("pose un cookie de session HttpOnly", async ({ page }) => {
    const { email } = await creerClientActive(page, db, "cookie");

    await soumettre(page, email, MOT_DE_PASSE_CLIENT);
    await expect(page).toHaveURL(/\/$/);

    const session = (await page.context().cookies()).find(
      (c) => c.name === "hch_session",
    );
    expect(session).toBeDefined();
    // ADR-005 v2 : inaccessible à `document.cookie`, jamais en clair sur le
    // réseau, et `lax` pour couper le CSRF en POST cross-site.
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Lax");
  });

  test("respecte le `next` posé par le proxy", async ({ page }) => {
    // `src/proxy.ts` redirige un visiteur sans cookie vers
    // `/connexion?next=<chemin demandé>`. La destination initiale doit être
    // rendue après authentification — sinon la personne se reconnecte et
    // recommence sa navigation.
    const { email } = await creerClientActive(page, db, "next");

    await page.goto("/admin/parametres");
    await expect(page).toHaveURL(/\/connexion\?next=/);

    await page.getByLabel("Adresse email").fill(email);
    await page
      .getByLabel("Mot de passe", { exact: true })
      .fill(MOT_DE_PASSE_CLIENT);
    await page.getByRole("button", { name: "Se connecter" }).click();

    // Le client est bien mené à la destination demandée — et c'est le 403 qui
    // l'y attend, pas la page. Le `next` n'est pas une autorisation.
    await expect(page).toHaveURL(/\/admin\/parametres$/);
    await expect(page.getByText(/403|interdit|refus/i).first()).toBeVisible();
  });

  test("refuse un mot de passe faux avec le message générique", async ({
    page,
  }) => {
    const { email } = await creerClientActive(page, db, "faux");

    await soumettre(page, email, "ce-nest-pas-le-bon-mot-de-passe");

    await expect(alerte(page)).toContainText(
      /Identifiants invalides ou compte non activé/i,
    );
    await expect(page).toHaveURL(/\/connexion/);
  });

  /// Ajout de l'agent testeur. DoD T-V3-03 : « Bouton “Renvoyer un email
  /// d'activation” sous le formulaire de connexion ».
  ///
  /// Ce qui était couvert : le `href` du lien
  /// (`connexion-view.test.tsx:84`). Ce qui ne l'était pas : que la destination
  /// serve à quelque chose. Une page qui ignorerait `renvoi=1` afficherait
  /// « Lien invalide » et aucun formulaire — le test du `href` resterait vert et
  /// la DoD serait fausse. Or c'est tout l'objet de cette entrée : avant elle,
  /// le formulaire de renvoi n'était atteignable qu'en cliquant un lien EXPIRÉ,
  /// donc en l'ayant encore sous la main, ce qu'on ne peut pas supposer de qui
  /// n'a jamais reçu son email.
  test("mène de la connexion au renvoi d'activation", async ({ page }) => {
    await page.goto("/connexion");

    await page
      .getByRole("link", { name: /Renvoyer un email d'activation/i })
      .click();

    await expect(page).toHaveURL(/\/activation\?renvoi=1$/);
    await expect(page.getByLabel("Adresse email")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Renvoyer un email d'activation/i }),
    ).toBeVisible();
    // Et surtout : pas de « Lien invalide », qui est ce que rend cette page
    // quand elle est atteinte sans jeton ET sans le paramètre.
    await expect(page.getByText(/Lien invalide/i)).toHaveCount(0);
  });
});

test.describe("cloisonnement des rôles", () => {
  test("un client connecté n'atteint pas l'écran d'administration", async ({
    page,
  }) => {
    // PLAN S1 §7.1, deux niveaux : `src/proxy.ts` ne fait qu'un redirect
    // OPTIMISTE sur présence du cookie — il laisse donc passer ce client. Le
    // rempart réel est `requireAdmin()` dans la page, et c'est lui qu'on
    // éprouve ici. Un test qui n'apporterait pas de cookie ne prouverait que
    // le proxy.
    const { email } = await creerClientActive(page, db, "cloisonnement");
    await soumettre(page, email, MOT_DE_PASSE_CLIENT);
    await expect(page).toHaveURL(/\/$/);

    const reponse = await page.goto("/admin/parametres");

    expect(reponse?.status()).toBe(403);
    // Un refus, pas une page vide et pas une redirection (DoD T-J0-05).
    await expect(page.getByText(/403|interdit|refus/i).first()).toBeVisible();
    // Et surtout : rien du contenu protégé ne fuit dans la réponse refusée.
    await expect(
      page.getByRole("button", { name: /Enregistrer/i }),
    ).toHaveCount(0);
  });
});

test.describe("déconnexion", () => {
  test("efface la session et ramène à l'accueil", async ({ page }) => {
    const { email } = await creerClientActive(page, db, "deconnexion");
    await soumettre(page, email, MOT_DE_PASSE_CLIENT);
    await expect(page).toHaveURL(/\/$/);

    await page.getByRole("button", { name: "Se déconnecter" }).click();

    await expect(page).toHaveURL(/\/\?deconnecte=1$/);
    await expect(page.getByRole("status")).toContainText(/déconnecté/i);
    expect(
      (await page.context().cookies()).find((c) => c.name === "hch_session"),
    ).toBeUndefined();
  });

  test("ferme réellement l'accès, pas seulement l'affichage", async ({
    page,
  }) => {
    // `US-COMPTE-DECONNECTER` : « toute nouvelle requête vers un endpoint
    // authentifié renvoie 401 (session absente) ». Ici la route protégée
    // renvoie au formulaire de connexion — c'est le comportement du proxy, et
    // c'est ce qui compte : sans cookie, on ne franchit plus la porte.
    const { email } = await creerClientActive(page, db, "revocation");
    await soumettre(page, email, MOT_DE_PASSE_CLIENT);
    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await expect(page).toHaveURL(/deconnecte=1/);

    await page.goto("/admin/parametres");

    await expect(page).toHaveURL(/\/connexion\?next=/);
  });

  test("reste sans erreur sur une session déjà close", async ({ page }) => {
    // §Cas d'erreur : comportement idempotent. On rejoue la déconnexion depuis
    // l'en-tête d'une page encore affichée alors que le cookie a déjà disparu.
    const { email } = await creerClientActive(page, db, "idempotent");
    await soumettre(page, email, MOT_DE_PASSE_CLIENT);
    await expect(page).toHaveURL(/\/$/);

    await page.context().clearCookies();
    await page.getByRole("button", { name: "Se déconnecter" }).click();

    await expect(page).toHaveURL(/\/\?deconnecte=1$/);
  });
});

test.describe("plafond d'échecs", () => {
  /// 5 échecs / 15 min par email (SPEC §285-287, PLAN S4 §11.1). Chaque
  /// soumission coûte un bcrypt : le scénario est volontairement le plus court
  /// qui prouve la borne.
  async function echouer(page: Page, email: string, fois: number) {
    for (let i = 0; i < fois; i += 1) {
      await soumettre(page, email, `mauvais-mot-de-passe-${i}`);
      await expect(alerte(page)).not.toBeEmpty();
    }
  }

  test("bloque la 6ᵉ tentative et désactive le formulaire", async ({
    page,
  }) => {
    const { email } = await creerClientActive(page, db, "plafond");

    await echouer(page, email, 5);
    await soumettre(page, email, "mauvais-mot-de-passe-6");

    await expect(alerte(page)).toContainText(/Trop de tentatives/i);
    // « bloqué front ET serveur » : le serveur a refusé, et le bouton ne
    // permet plus de marteler.
    await expect(
      page.getByRole("button", { name: "Se connecter" }),
    ).toBeDisabled();
  });

  test("compte aussi pour une adresse qui n'a aucun compte", async ({
    page,
  }) => {
    // DoD T-V3-03, et c'est le cœur du choix d'une table sans clé étrangère
    // (PLAN S4 §11.2). Si le compteur n'existait que pour les comptes réels,
    // « trop de tentatives » dirait qu'une adresse est inscrite — la fuite
    // exactement refermée par le durcissement à temps constant de T-J0-04.
    const inconnu = emailUnique("fantome");

    await echouer(page, inconnu, 5);
    await soumettre(page, inconnu, "mauvais-mot-de-passe-6");

    await expect(alerte(page)).toContainText(/Trop de tentatives/i);
    expect(await db.user.count({ where: { email: inconnu } })).toBe(0);
  });

  test("laisse passer la connexion valide d'une autre adresse", async ({
    page,
  }) => {
    // La fenêtre est portée par la CLÉ, pas par le navigateur ni par l'IP : un
    // plafond global transformerait cinq erreurs de frappe en déni de service
    // pour tout le monde.
    const bloque = emailUnique("voisin");
    await echouer(page, bloque, 5);

    const { email } = await creerClientActive(page, db, "epargne");
    await soumettre(page, email, MOT_DE_PASSE_CLIENT);

    await expect(page).toHaveURL(/\/$/);
  });

  /// Ajout de l'agent testeur. Les trois tests ci-dessus prouvent que le
  /// plafond REFUSE ; aucun ne prouve qu'il refuse **le bon mot de passe**.
  ///
  /// C'est pourtant la seule formulation qui distingue un vrai contrôle d'accès
  /// d'un affichage : un plafond implémenté après la vérification du mot de
  /// passe, ou seulement dans le formulaire, laisserait passer celui-ci. Le
  /// blocage « front ET serveur » (SPEC §287) se mesure ici, en soumettant des
  /// identifiants qui marcheraient une minute plus tôt.
  ///
  /// Et il rend visible le coût, qui est réel et assumé : cinq échecs sur une
  /// adresse ferment la connexion à son titulaire pour le quart d'heure. Un
  /// plafond par email l'implique ; la SPEC le demande ainsi.
  test("refuse le bon mot de passe une fois le plafond atteint", async ({
    page,
  }) => {
    const { email } = await creerClientActive(page, db, "verrou");

    await echouer(page, email, 5);
    await soumettre(page, email, MOT_DE_PASSE_CLIENT);

    await expect(alerte(page)).toContainText(/Trop de tentatives/i);
    await expect(page).toHaveURL(/\/connexion/);
    // Aucune session posée : le refus est serveur, pas décoratif.
    expect(
      (await page.context().cookies()).find((c) => c.name === "hch_session"),
    ).toBeUndefined();
  });
});

test.describe("accueil et session — surface publique", () => {
  /// Ajouts de l'agent testeur. L'accueil est devenu **dynamique** en T-V3-03 :
  /// il lit la session par `getOptionalUser` et monte `AppHeader`
  /// (`src/app/(marketing)/page.tsx:34-41`). C'est une page que la Constitution
  /// §5.1 veut ouverte à tous, et elle exécute désormais du code
  /// d'authentification à chaque visite anonyme. Rien ne le couvrait.

  test("reste servi à un visiteur anonyme, sans en-tête connecté", async ({
    page,
  }) => {
    const reponse = await page.goto("/");

    expect(reponse?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("banner")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Se déconnecter" }),
    ).toHaveCount(0);
  });

  test("ne casse pas sur un cookie de session forgé", async ({
    page,
    context,
    baseURL,
  }) => {
    // Le pendant, côté page PUBLIQUE, du test de cookie forgé de
    // `admin-parametres.spec.ts`. Là-bas l'attendu est une redirection ; ici il
    // n'y a rien à protéger, donc l'attendu est un 200 anonyme. Une 500 fermerait
    // la vitrine à quiconque traîne un cookie périmé — et le catalogue des
    // forfaits doit rester joignable sans authentification (Constitution §5.1).
    await context.addCookies([
      {
        name: "hch_session",
        value: "pas.un.jeton",
        url: baseURL ?? "http://localhost:3000",
      },
    ]);

    const reponse = await page.goto("/");

    expect(reponse?.status()).toBe(200);
    await expect(page.getByRole("banner")).toHaveCount(0);
  });

  test("retire l'en-tête dès que le compte est désactivé en base", async ({
    page,
  }) => {
    // Révocation effective (`findUserById` filtre `isActive`,
    // src/lib/db/queries/auth.ts:255). Le JWT reste valide 7 jours : sans cette
    // relecture, un compte fermé par un administrateur garderait son en-tête
    // nominatif — et son bouton de déconnexion — sur une page publique.
    const { email, userId } = await creerClientActive(page, db, "revoque");
    await soumettre(page, email, MOT_DE_PASSE_CLIENT);
    await expect(page.getByRole("banner")).toBeVisible();

    await db.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    const reponse = await page.goto("/");

    expect(reponse?.status()).toBe(200);
    await expect(page.getByRole("banner")).toHaveCount(0);
  });
});

/// Ajout de l'agent testeur. `logout-button.tsx:8-13` affirme que le
/// `<form action={…}>` « part en POST que React ait hydraté ou non », et en fait
/// le motif de ne pas écrire un `onClick`. L'affirmation n'était vérifiée nulle
/// part — or c'est exactement le défaut payé en T-J0-04 sur le formulaire de
/// connexion, et l'enjeu est plus lourd ici : une déconnexion décorative sur un
/// poste partagé laisse la session ouverte à la personne suivante, qui croit
/// que le bouton a fait son office.
///
/// Le compte est créé dans le contexte ORDINAIRE, puis la connexion et la
/// déconnexion sont rejouées dans un second contexte sans JavaScript. Un
/// `test.use({ javaScriptEnabled: false })` sur tout le scénario ferait passer
/// l'inscription par la même contrainte, et un échec là-bas se lirait ici comme
/// un défaut de la déconnexion.
test("la déconnexion ferme la session sans hydratation", async ({
  page,
  browser,
  baseURL,
}) => {
  const { email } = await creerClientActive(page, db, "sansjs");

  // `browser.newContext()` n'hérite RIEN du bloc `use` de la configuration :
  // sans ce `baseURL` explicite, les navigations relatives échouent.
  const contexte = await browser.newContext({
    javaScriptEnabled: false,
    ...(baseURL ? { baseURL } : {}),
  });
  const sansJs = await contexte.newPage();

  await sansJs.goto("/connexion");
  await sansJs.getByLabel("Adresse email").fill(email);
  await sansJs
    .getByLabel("Mot de passe", { exact: true })
    .fill(MOT_DE_PASSE_CLIENT);
  await sansJs.getByRole("button", { name: "Se connecter" }).click();
  await expect(sansJs).toHaveURL(/\/$/);

  await sansJs.getByRole("button", { name: "Se déconnecter" }).click();

  await expect(sansJs).toHaveURL(/\/\?deconnecte=1$/);
  expect(
    (await contexte.cookies()).find((c) => c.name === "hch_session"),
  ).toBeUndefined();

  await contexte.close();
});

test.describe("accessibilité outillée", () => {
  /// `@axe-core/playwright` sur `GP-01` — DoD T-V3-03, reportée de T-V3-02.
  ///
  /// Deux critères **AA** ne se prouvent pas en jsdom, où `jest-axe` tourne :
  /// le **contraste** (axe-core ne calcule rien sans moteur de rendu, la règle
  /// sort en `incomplete` et ne compte pas comme violation) et le **focus
  /// visible**. Ils ne se mesurent qu'ici, au navigateur.
  ///
  /// `wcag21a` / `wcag21aa` inclus : le RGAA 4.1 transpose WCAG **2.1**, et les
  /// seuls tags `wcag2*` laisseraient hors du champ `autocomplete-valid`, qui
  /// porte précisément sur un formulaire d'identification.
  const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

  test("la page de connexion ne présente aucune violation", async ({
    page,
  }) => {
    await page.goto("/connexion");

    const resultats = await new AxeBuilder({ page }).withTags(TAGS).analyze();

    expect(resultats.violations).toEqual([]);
  });

  test("la page d'inscription ne présente aucune violation", async ({
    page,
  }) => {
    // Jamais auditée au navigateur jusqu'ici : T-V3-02 n'avait que `jest-axe`,
    // aveugle au contraste. C'est l'autre moitié du point d'entrée AA.
    await page.goto("/inscription");

    const resultats = await new AxeBuilder({ page }).withTags(TAGS).analyze();

    expect(resultats.violations).toEqual([]);
  });

  test("le formulaire en erreur ne présente aucune violation", async ({
    page,
  }) => {
    // L'état d'erreur porte ses propres exigences AA — région live annoncée,
    // focus déplacé, message associé — et c'est l'état que personne n'audite.
    await soumettre(page, emailUnique("axe-erreur"), "mauvais-mot-de-passe");
    await expect(alerte(page)).not.toBeEmpty();

    const resultats = await new AxeBuilder({ page }).withTags(TAGS).analyze();

    expect(resultats.violations).toEqual([]);
  });

  /// Ajouts de l'agent testeur. Le parcours de T-V3-03 ne s'arrête pas au
  /// formulaire : il **atterrit** quelque part, et cet écran d'arrivée est une
  /// surface neuve — l'accueil porteur d'`AppHeader`, avec son repère `banner`,
  /// son lien de marque et son bouton de déconnexion. Aucun des deux états
  /// n'était audité, alors que la sortie de session est le dernier écran du
  /// golden path.

  test("l'accueil connecté ne présente aucune violation", async ({ page }) => {
    const { email } = await creerClientActive(page, db, "axe-accueil");
    await soumettre(page, email, MOT_DE_PASSE_CLIENT);
    await expect(page.getByRole("banner")).toBeVisible();

    const resultats = await new AxeBuilder({ page }).withTags(TAGS).analyze();

    expect(resultats.violations).toEqual([]);
  });

  test("la confirmation de déconnexion ne présente aucune violation", async ({
    page,
  }) => {
    // `US-COMPTE-DECONNECTER` §Cas nominal impose un message de confirmation.
    // Il est rendu dans un `role="status"` : la région doit rester annonçable
    // et ne pas entrer en concurrence avec un autre repère live de la page.
    const { email } = await creerClientActive(page, db, "axe-sortie");
    await soumettre(page, email, MOT_DE_PASSE_CLIENT);
    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await expect(page.getByRole("status")).toContainText(/déconnecté/i);

    const resultats = await new AxeBuilder({ page }).withTags(TAGS).analyze();

    expect(resultats.violations).toEqual([]);
  });
});
