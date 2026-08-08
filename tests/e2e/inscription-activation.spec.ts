import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

/// Inscription et activation de bout en bout — T-V3-02, `US-COMPTE-CREER` et
/// `US-COMPTE-ACTIVER`.
///
/// Le fichier ne dépend d'AUCUN transport email, et c'est la propriété qui
/// compte (ADR-017 §Contraintes). Deux conséquences de conception :
///
///   · pour la partie inscription, l'oracle est la BASE — une ligne `users`
///     inactive, une ligne `auth_providers` locale, un jeton non consommé à
///     24 h ;
///   · pour la partie activation, le test **pose son propre jeton** avec un
///     clair qu'il connaît. Il ne peut pas faire autrement : la base ne stocke
///     que le SHA-256 (dictionnaire §verification_tokens), et le clair ne vit
///     que dans l'URL de l'email. Poser le jeton est plus fort que lire un log
///     de conteneur, et ça reste le vrai chemin de consommation côté serveur.
///
/// Le hash est recalculé ici plutôt qu'importé de `src/lib/auth/` : c'est
/// l'ORACLE. Un test qui emprunterait la fonction de production resterait vert
/// le jour où l'algorithme changerait, alors que tous les liens en circulation
/// tomberaient.

const db = new PrismaClient();

test.afterAll(async () => {
  await db.$disconnect();
});

const MOT_DE_PASSE = "un-mot-de-passe-long-v3";

/// Une adresse par exécution : la base de la barrière est jetable en CI, mais
/// elle survit d'un run à l'autre en local, et l'index unique sur `users.email`
/// ferait échouer la seconde passe.
function emailUnique(prefixe: string): string {
  return `${prefixe}-${randomBytes(6).toString("hex")}@example.test`;
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function inscrire(
  page: import("@playwright/test").Page,
  email: string,
): Promise<void> {
  await page.goto("/inscription");
  await page.getByLabel("Prénom").fill("Camille");
  await page.getByLabel("Nom").fill("Durand");
  await page.getByLabel("Adresse email").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(MOT_DE_PASSE);
  await page.getByLabel("Confirmer le mot de passe").fill(MOT_DE_PASSE);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
}

test.describe("inscription", () => {
  test("crée un compte inactif et un jeton d'activation à 24 h", async ({
    page,
  }) => {
    const email = emailUnique("inscription");
    const avant = Date.now();

    await inscrire(page, email);

    // L'écran de confirmation est le SEUL retour visible, et il est le même
    // quelle que soit l'issue (anti-énumération, Constitution §4.2).
    await expect(page.getByText(/Vérifiez votre email/i).first()).toBeVisible();

    const compte = await db.user.findUnique({
      where: { email },
      select: {
        id: true,
        roles: true,
        isActive: true,
        authProviders: { select: { provider: true, passwordHash: true } },
        verificationTokens: {
          select: { purpose: true, usedAt: true, expiresAt: true },
        },
      },
    });

    expect(compte).not.toBeNull();
    expect(compte?.roles).toEqual(["ROLE_CLIENT"]);
    // US-COMPTE-CREER : `is_active = false` à la création. La colonne a
    // `DEFAULT true` — l'oublier créerait un compte utilisable sans vérifier
    // l'email.
    expect(compte?.isActive).toBe(false);

    expect(compte?.authProviders).toHaveLength(1);
    expect(compte?.authProviders[0]?.provider).toBe("local");
    // Le hash bcrypt, et rien qui ressemble au mot de passe soumis.
    expect(compte?.authProviders[0]?.passwordHash).toMatch(
      /^\$2[aby]\$1[0-9]\$/,
    );
    expect(compte?.authProviders[0]?.passwordHash).not.toContain(MOT_DE_PASSE);

    expect(compte?.verificationTokens).toHaveLength(1);
    const jeton = compte?.verificationTokens[0];
    expect(jeton?.purpose).toBe("email_verification");
    expect(jeton?.usedAt).toBeNull();
    // 24 h, la fenêtre d'US-COMPTE-ACTIVER. Bornes larges : la mesure traverse
    // un aller-retour HTTP et une insertion.
    const ttl = (jeton?.expiresAt.getTime() ?? 0) - avant;
    expect(ttl).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(ttl).toBeLessThan(25 * 60 * 60 * 1000);
  });

  test("répond la même chose sur un email déjà inscrit", async ({ page }) => {
    // US-COMPTE-CREER §Cas d'erreur : « aucune ligne `users` supplémentaire
    // n'est créée », et le retour ne dit pas que l'email était pris.
    const email = emailUnique("doublon");

    await inscrire(page, email);
    await expect(page.getByText(/Vérifiez votre email/i).first()).toBeVisible();
    const premiereUrl = page.url();

    await inscrire(page, email);
    await expect(page.getByText(/Vérifiez votre email/i).first()).toBeVisible();
    expect(page.url()).toBe(premiereUrl);

    expect(await db.user.count({ where: { email } })).toBe(1);
  });

  test("un compte non activé ne peut pas se connecter", async ({ page }) => {
    const email = emailUnique("inactif");
    await inscrire(page, email);

    await page.goto("/connexion");
    await page.getByLabel("Adresse email").fill(email);
    await page.getByLabel("Mot de passe").fill(MOT_DE_PASSE);
    await page.getByRole("button", { name: "Se connecter" }).click();

    // Le message est celui des quatre causes de refus, à l'identique : le
    // distinguer rouvrirait l'énumération que T-J0-04 a fermée.
    await expect(page.getByRole("alert")).toContainText(
      /Identifiants invalides ou compte non activé/i,
    );
  });
});

test.describe("activation", () => {
  /// Inscrit, puis substitue au jeton émis un jeton dont le test connaît le
  /// clair. L'ancien est retiré : deux liens valides pour un compte, c'est deux
  /// fenêtres au lieu d'une, et ce n'est pas ce que fait le renvoi non plus.
  async function poserJeton(
    page: import("@playwright/test").Page,
    email: string,
    options: { expiresAt?: Date } = {},
  ): Promise<{ token: string; userId: string }> {
    await inscrire(page, email);
    await expect(page.getByText(/Vérifiez votre email/i).first()).toBeVisible();

    const compte = await db.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    await db.verificationToken.deleteMany({ where: { userId: compte.id } });

    const token = randomBytes(32).toString("base64url");
    await db.verificationToken.create({
      data: {
        userId: compte.id,
        tokenHash: hash(token),
        purpose: "email_verification",
        expiresAt:
          options.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    return { token, userId: compte.id };
  }

  test("le lien seul ne consomme pas le jeton", async ({ page }) => {
    // Les webmails préchargent les liens qu'ils reçoivent. Si l'ouverture
    // consommait, un robot activerait puis brûlerait le compte, et le client
    // n'aurait plus de lien valide.
    const email = emailUnique("prefetch");
    const { token, userId } = await poserJeton(page, email);

    await page.goto(`/activation?token=${token}`);
    await expect(
      page.getByRole("button", { name: "Activer mon compte" }),
    ).toBeVisible();

    const jeton = await db.verificationToken.findFirstOrThrow({
      where: { userId },
    });
    expect(jeton.usedAt).toBeNull();
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).isActive,
    ).toBe(false);
  });

  test("inscription → activation → connexion", async ({ page }) => {
    // Le chemin nominal complet de la DoD.
    const email = emailUnique("nominal");
    const { token, userId } = await poserJeton(page, email);

    await page.goto(`/activation?token=${token}`);
    await page.getByRole("button", { name: "Activer mon compte" }).click();

    await expect(page).toHaveURL(/\/connexion\?compte=active/);
    await expect(page.getByText(/Compte activé/i).first()).toBeVisible();

    const jeton = await db.verificationToken.findFirstOrThrow({
      where: { userId },
    });
    expect(jeton.usedAt).not.toBeNull();
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).isActive,
    ).toBe(true);

    await page.getByLabel("Adresse email").fill(email);
    await page.getByLabel("Mot de passe").fill(MOT_DE_PASSE);
    await page.getByRole("button", { name: "Se connecter" }).click();

    // ⚠️ On vérifie que la connexion N'EST PLUS REFUSÉE, pas la destination.
    // `AFTER_LOGIN` vaut `/admin/parametres` depuis T-J0-05, faute d'espace
    // client — un ROLE_CLIENT y arrive donc sur un 403. Report nommé vers
    // T-V3-03, qui porte le parcours de connexion.
    await expect(page).not.toHaveURL(/\/connexion/);
    await expect(page.getByText(/Identifiants invalides/i)).toHaveCount(0);
  });

  test("un jeton déjà consommé refuse le rejeu", async ({ page }) => {
    const email = emailUnique("rejeu");
    const { token } = await poserJeton(page, email);

    await page.goto(`/activation?token=${token}`);
    await page.getByRole("button", { name: "Activer mon compte" }).click();
    await expect(page).toHaveURL(/\/connexion\?compte=active/);

    await page.goto(`/activation?token=${token}`);
    await page.getByRole("button", { name: "Activer mon compte" }).click();

    await expect(page.getByRole("alert")).toContainText(/déjà activé/i);
  });

  test("un jeton expiré propose un renvoi", async ({ page }) => {
    const email = emailUnique("expire");
    const { token } = await poserJeton(page, email, {
      expiresAt: new Date(Date.now() - 60_000),
    });

    await page.goto(`/activation?token=${token}`);
    await page.getByRole("button", { name: "Activer mon compte" }).click();

    await expect(page.getByRole("alert")).toContainText(/expiré/i);
    await expect(page.getByRole("button", { name: /Renvoyer/i })).toBeVisible();
  });

  test("un jeton inconnu reste générique", async ({ page }) => {
    await page.goto(
      `/activation?token=${randomBytes(32).toString("base64url")}`,
    );
    await page.getByRole("button", { name: "Activer mon compte" }).click();

    await expect(page.getByRole("alert")).toContainText(/invalide/i);
    // Pas de formulaire de renvoi ici : il inviterait à essayer des adresses.
    await expect(page.getByRole("button", { name: /Renvoyer/i })).toHaveCount(
      0,
    );
  });

  test("le renvoi émet un nouveau jeton et invalide le précédent", async ({
    page,
  }) => {
    // US-COMPTE-ACTIVER §Renvoi : « un nouveau token est généré (précédent
    // invalidé) ».
    const email = emailUnique("renvoi");
    const { token, userId } = await poserJeton(page, email, {
      expiresAt: new Date(Date.now() - 60_000),
    });

    await page.goto(`/activation?token=${token}`);
    await page.getByRole("button", { name: "Activer mon compte" }).click();
    await expect(page.getByRole("button", { name: /Renvoyer/i })).toBeVisible();

    await page.getByLabel("Adresse email").fill(email);
    await page.getByRole("button", { name: /Renvoyer/i }).click();

    await expect(page.getByRole("status")).toContainText(
      /Si un compte existe/i,
    );

    const jetons = await db.verificationToken.findMany({ where: { userId } });
    expect(jetons).toHaveLength(1);
    expect(jetons[0]?.tokenHash).not.toBe(hash(token));
    expect(jetons[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
