import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

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
/// Plage de fiction réservée par l'ARCEP, comme le seed : aucune donnée
/// personnelle réelle, ni en base de test ni en base déployée.
function numeroDeFiction(): string {
  return `+3363998${String(Date.now()).slice(-4)}`;
}

test("l'administrateur seedé se connecte et modifie un paramètre société", async ({
  page,
}) => {
  const db = new PrismaClient();
  const valeurAttendue = numeroDeFiction();

  try {
    await page.goto("/connexion");

    // Requêtes par label et par rôle, jamais par testid : la hiérarchie
    // d'ADR-014 §Stack, et ce sont les mêmes ancrages qu'un lecteur d'écran.
    await page.getByLabel("Adresse email").fill(ADMIN_EMAIL);
    await page.getByLabel("Mot de passe").fill(motDePasseAdmin());
    await page.getByRole("button", { name: "Se connecter" }).click();

    // `AFTER_LOGIN` de `src/lib/actions/auth/login.ts`. Atteindre cette URL
    // prouve déjà trois choses : le hash bcrypt a été comparé, la session a
    // été signée, et `requireAdmin()` a laissé passer.
    await expect(page).toHaveURL(/\/admin\/parametres$/);

    const champ = page.getByLabel(LIBELLE);
    await expect(champ).toBeVisible();
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
    expect(trace?.details).toMatchObject({ after: valeurAttendue });
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
  const resultats = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();

  expect(resultats.violations).toEqual([]);
});
