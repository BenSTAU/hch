import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { seConnecter } from "../support/connexion";

/// Barrière pré-déploiement du jalon 0 — le scénario que nomme le critère de
/// fin : un administrateur seedé se connecte et modifie un paramètre société.
///
/// Ce n'est aucun des 5 golden paths d'ADR-014 §5, qui portent tous sur des
/// parcours métier pas encore écrits. Il leur préexiste et il est spécifique
/// au jalon (PLAN S3 §8).
///
/// Il tourne contre l'IMAGE `benstau/hch:<sha>` en CI, contre `pnpm dev` en
/// local. Le smoke post-déploiement (`tests/smoke/`) exerce la même connexion
/// contre les environnements déployés — deux surfaces, pas un doublon.

/// Le premier des deux administrateurs de `prisma/seed.ts`. Adresse de
/// fiction, présente dans un dépôt public — ce n'est pas un secret, seul le
/// mot de passe en est un.
const ADMIN_EMAIL = "admin@homecyclhome.fr";

/// Clé exercée : `string`, donc sans contrainte de format
/// (`validateSettingValue`), et déjà seedée — `updateAppSettings` refuse toute
/// clé absente de la table.
const CLE = "company.phone";
const LIBELLE = "Téléphone affiché aux clients";

function motDePasseAdmin(): string {
  const password = process.env["SEED_ADMIN_PASSWORD"];
  if (!password) {
    throw new Error(
      "SEED_ADMIN_PASSWORD absente. Le seed pose le hash à partir de cette " +
        "valeur et la rafraîchit à chaque déploiement : sans elle, aucun mot " +
        "de passe ne peut être deviné. La renseigner dans .env.local (poste) " +
        "ou par le secret d'Environment (CI).",
    );
  }
  return password;
}

/// Valeur neuve à chaque exécution — sinon `updateAppSettings` ignore la ligne
/// (« (row.value ?? '') === entry.value »), aucune écriture n'a lieu et le test
/// vérifierait la persistance de ce qui était déjà là.
///
/// La valeur courante est passée en argument, et le tirage l'évite : les
/// quatre derniers chiffres de l'horloge donnent une chance sur 10 000 de
/// retomber dessus. Le formulaire répondrait alors « Aucune modification à
/// enregistrer », la barrière rougirait, et aucun code ne serait en cause.
/// Mesuré par l'agent testeur sur T-J0-09 ; en local `retries` vaut 0, donc le
/// dé n'était relancé par personne.
///
/// Plage de fiction réservée par l'ARCEP, comme le seed : aucune donnée
/// personnelle réelle, ni en base de test ni en base déployée.
function numeroDeFiction(differentDe: string | null): string {
  const numero = (n: number) =>
    `+3363998${String(n % 10_000).padStart(4, "0")}`;
  const base = Number(String(Date.now()).slice(-4));
  const candidat = numero(base);
  return candidat === differentDe ? numero(base + 1) : candidat;
}

test("l'administrateur seedé se connecte et modifie un paramètre société", async ({
  page,
}) => {
  const db = new PrismaClient();

  try {
    // Requêtes par label et par rôle, jamais par testid : la hiérarchie
    // d'ADR-014 §Stack, et ce sont les mêmes ancrages qu'un lecteur d'écran.
    await seConnecter(page, ADMIN_EMAIL, motDePasseAdmin());

    const champ = page.getByLabel(LIBELLE);
    await expect(champ).toBeVisible();

    // Lus AVANT la soumission : ce sont les deux oracles que l'assertion
    // d'audit ne portait pas. `after` seul ne dit rien du `before` (le diff
    // peut être faux sans que rien ne le montre) ni de l'acteur — or c'est
    // précisément la colonne qui donne sa valeur au journal (Constitution
    // §4.2 : « retracer les actions d'un compte »). Ajouté par l'agent
    // testeur sur T-J0-09.
    const valeurAvant = (
      await db.appSetting.findUniqueOrThrow({
        where: { key: CLE },
        select: { value: true },
      })
    ).value;
    const admin = await db.user.findUniqueOrThrow({
      where: { email: ADMIN_EMAIL },
      select: { id: true },
    });

    // Tirée APRÈS la lecture de `valeurAvant`, pour pouvoir l'éviter.
    const valeurAttendue = numeroDeFiction(valeurAvant);

    await champ.fill(valeurAttendue);

    // Borne basse pour la recherche de la trace d'audit, prise AVANT la
    // soumission. Sans elle, `findFirst` remonte la trace d'une exécution
    // antérieure et l'assertion passe alors même qu'aucune écriture n'a eu
    // lieu — constaté en neutralisant `writeAuditLog` : le test restait vert
    // sur `not.toBeNull()`. La base de test est jetable, mais la base de
    // développement et celle de staging accumulent les runs.
    //
    // Une seconde de marge absorbe l'écart d'horloge entre ce process et
    // Postgres, qui peuvent être sur deux machines (tunnel SSH en local,
    // conteneur en CI).
    const avantSoumission = new Date(Date.now() - 1_000);

    await page.getByRole("button", { name: "Enregistrer" }).click();

    // Le formulaire distingue « enregistré » de « rien à enregistrer » — la
    // seconde branche existe précisément pour ne pas mentir. On exige la
    // première, sinon un test qui n'écrit rien passerait au vert.
    await expect(page.getByRole("status")).toHaveText(
      /Modifications enregistrées/,
    );

    // Rechargement complet : la valeur doit venir de la base, pas de l'état
    // React laissé par la soumission.
    await page.reload();
    await expect(page.getByLabel(LIBELLE)).toHaveValue(valeurAttendue);

    // La trace RGPD est exigée par la Constitution §4.2 sur toute mutation
    // d'entité sensible, et elle est écrite DANS la transaction
    // (`src/lib/db/queries/parametres.ts`). La vérifier ici est ce que le
    // smoke ne pourra pas faire : les bases staging et production ne sont
    // joignables ni d'internet ni du runner (PLAN S3 §2).
    const trace = await db.auditLog.findFirst({
      where: {
        entityType: "app_settings",
        entityId: CLE,
        action: "UPDATE",
        createdAt: { gte: avantSoumission },
      },
      orderBy: { createdAt: "desc" },
    });
    expect(
      trace,
      "aucune entrée audit_logs écrite par cette exécution",
    ).not.toBeNull();
    expect(trace?.details).toMatchObject({
      before: valeurAvant,
      after: valeurAttendue,
    });
    // L'acteur vient de `ctx.admin` du middleware `adminActionClient`, jamais
    // de la charge utile. Sans cette assertion, une trace attribuée au mauvais
    // compte — ou à un identifiant en dur — passait inaperçue.
    expect(trace?.actorId).toBe(admin.id);

    // `updated_by` porte la même exigence côté donnée : le formulaire dit qui
    // a modifié la clé, et l'écran l'affiche.
    const ligne = await db.appSetting.findUniqueOrThrow({
      where: { key: CLE },
      select: { updatedBy: true },
    });
    expect(ligne.updatedBy).toBe(admin.id);
  } finally {
    await db.$disconnect();
  }
});

test("la page de connexion ne présente aucune violation axe", async ({
  page,
}) => {
  await page.goto("/connexion");

  // RGAA niveau A sur toute l'application, AA sur le parcours de connexion
  // (PLAN S4 §2). La conformité se prouve par un test, elle ne se déclare pas.
  //
  // `wcag21a` / `wcag21aa` ajoutés par l'agent testeur (T-J0-09) : le RGAA 4.1
  // transpose WCAG **2.1**, et les seuls tags `wcag2*` laissaient hors du
  // champ les règles propres à la 2.1 — `autocomplete-valid` notamment, qui
  // porte sur un formulaire d'identification. Zéro violation supplémentaire
  // constatée à l'ajout : c'est un élargissement de couverture, pas un
  // correctif.
  const resultats = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  expect(resultats.violations).toEqual([]);
});

/// Ajouté par l'agent testeur (T-J0-09). L'écran d'administration n'était
/// audité qu'en jsdom (`settings-form.test.tsx` §« audit outillé »), où
/// axe-core ne peut PAS évaluer les contrastes : sans moteur de rendu, la
/// règle `color-contrast` sort en `incomplete` et ne compte pas comme
/// violation. `toHaveNoViolations()` y passe donc sans avoir rien mesuré sur
/// ce point. Le contraste ne se vérifie qu'au navigateur, et c'est ici.
///
/// C'est aussi le seul écran authentifié du jalon : sans login, aucun audit
/// outillé ne l'atteint en conditions réelles.
test("l'écran d'administration ne présente aucune violation axe", async ({
  page,
}) => {
  await seConnecter(page, ADMIN_EMAIL, motDePasseAdmin());

  const resultats = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  expect(resultats.violations).toEqual([]);
});

/// Cas hostile absent du lot livré : la barrière ne vérifiait que le chemin
/// nominal. Or `/admin/parametres` est un écran d'administration, et
/// `src/proxy.ts` ne fait qu'un redirect **optimiste** sur présence du cookie
/// — le rempart réel est `requireAdmin()` dans la page. Un test qui ne franchit
/// jamais la porte sans clé ne prouve pas qu'elle est fermée.
test("un visiteur non connecté n'atteint pas l'écran d'administration", async ({
  page,
}) => {
  await page.goto("/admin/parametres");

  // Redirection vers la connexion, en conservant la destination demandée.
  await expect(page).toHaveURL(/\/connexion\?next=/);

  // Et surtout : aucun champ de configuration rendu au passage. Une
  // redirection qui laisse fuiter le formulaire aurait déjà tout donné.
  await expect(page.getByLabel(LIBELLE)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enregistrer" })).toHaveCount(
    0,
  );
});

/// Le cas qui compte vraiment pour une authentification écrite à la main.
///
/// `src/proxy.ts:17` ne teste que la PRÉSENCE du cookie — il ne lit ni la
/// signature ni la base. Un cookie forgé le franchit donc intégralement, et
/// seul `getCurrentUser()` (`src/lib/auth/dal.ts:24-53`) l'arrête. Le test
/// précédent, lui, s'arrête au proxy et ne dit rien du rempart réel : c'est
/// exactement la configuration de la CVE-2025-29927 que l'ADR-005 v2 dit
/// vouloir ne jamais reproduire. Sans ce test, la propriété est écrite dans
/// les commentaires et vérifiée nulle part.
test("un cookie de session forgé franchit le proxy mais pas le DAL", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    {
      name: "hch_session",
      // Ni un JWT valide, ni même un JWT : `jwtVerify` doit refuser, et le
      // refus doit se traduire par une redirection, pas par une 500.
      value: "pas.un.jeton",
      url: baseURL ?? "http://localhost:3000",
    },
  ]);

  await page.goto("/admin/parametres");

  await expect(page).toHaveURL(/\/connexion/);
  await expect(page.getByLabel(LIBELLE)).toHaveCount(0);
});

/// Non-régression du correctif T-J0-04 fix — le cœur du sujet.
///
/// Avec `javaScriptEnabled: false`, aucun code React ne tourne : c'est
/// exactement la fenêtre qui existait avant hydratation. Le formulaire doit
/// tout de même se soumettre, en POST vers la Server Action, et aboutir.
///
/// Ce test rougirait si `<form action={…}>` redevenait un `onSubmit` : sans
/// JavaScript la soumission repartirait en GET, l'URL porterait
/// `?email=…&password=…` et la redirection n'aurait pas lieu.
test.describe("sans JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("la connexion fonctionne et ne met rien en query string", async ({
    page,
  }) => {
    await page.goto("/connexion");
    await page.getByLabel("Adresse email").fill(ADMIN_EMAIL);
    await page.getByLabel("Mot de passe", { exact: true }).fill(motDePasseAdmin());
    await page.getByRole("button", { name: "Se connecter" }).click();

    await expect(page).toHaveURL(/\/admin\/parametres$/);

    // L'assertion qui nomme le défaut : aucune valeur saisie ne doit se
    // retrouver dans l'URL, à aucun moment du parcours.
    expect(page.url()).not.toContain("password");
    expect(page.url()).not.toContain("email");
  });
});
