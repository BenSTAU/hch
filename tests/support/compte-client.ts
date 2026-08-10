import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { expect, type Page } from "@playwright/test";

/// Fabrique de comptes clients pour la barrière E2E.
///
/// Le seed ne pose que deux administrateurs et un technicien
/// (`prisma/seed.ts`) : aucun client, parce que la SPEC veut que le client naisse
/// du parcours public. Les scénarios qui ont besoin d'un client le CRÉENT donc,
/// et le créent par l'interface — c'est le début de `GP-01`.
///
/// Extrait de `tests/e2e/inscription-activation.spec.ts` en T-V3-03, à
/// l'identique. Deux fichiers avaient besoin de la même séquence, et la
/// dupliquer ferait diverger deux oracles qui doivent rester le même — c'est
/// déjà le motif d'existence de `seConnecter` dans ce dossier.

export const MOT_DE_PASSE_CLIENT = "un-mot-de-passe-long-v3";

/// Une adresse par exécution : la base de la barrière est jetable en CI, mais
/// elle survit d'un run à l'autre en local, et l'index unique sur `users.email`
/// ferait échouer la seconde passe.
export function emailUnique(prefixe: string): string {
  return `${prefixe}-${randomBytes(6).toString("hex")}@example.test`;
}

/// Remplit et soumet le formulaire d'inscription.
export async function inscrire(page: Page, email: string): Promise<void> {
  await page.goto("/inscription");
  await page.getByLabel("Prénom").fill("Camille");
  // `exact` obligatoire : `getByLabel` compare en SOUS-CHAÎNE insensible à la
  // casse, et « nom » est contenu dans « Prénom ». Sans lui, deux champs
  // matchent et le mode strict de Playwright échoue — 9 tests sur 19 en CI sur
  // la barrière de la PR #17. Le champ « Mot de passe » portait déjà la même
  // précaution, pour la même raison face à « Confirmer le mot de passe ».
  //
  // Le piège est silencieux tant que le formulaire n'a qu'un seul libellé
  // englobant : tout champ ajouté ici doit être vérifié contre ses voisins.
  await page.getByLabel("Nom", { exact: true }).fill("Durand");
  await page.getByLabel("Adresse email").fill(email);
  await page
    .getByLabel("Mot de passe", { exact: true })
    .fill(MOT_DE_PASSE_CLIENT);
  await page.getByLabel("Confirmer le mot de passe").fill(MOT_DE_PASSE_CLIENT);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
}

/// Inscrit un client puis l'active **en base**.
///
/// L'activation par l'écran est déjà éprouvée de bout en bout par
/// `inscription-activation.spec.ts`, jeton posé et bouton cliqué. La rejouer ici
/// n'ajouterait aucune couverture et allongerait chaque scénario de connexion
/// d'un aller-retour ; ce qui est testé ici commence après.
export async function creerClientActive(
  page: Page,
  db: PrismaClient,
  prefixe: string,
): Promise<{ email: string; userId: string }> {
  const email = emailUnique(prefixe);

  await inscrire(page, email);
  await expect(page.getByText(/Vérifiez votre email/i).first()).toBeVisible();

  const compte = await db.user.update({
    where: { email },
    // Les deux colonnes, pas une seule : `is_active` rouvre la connexion,
    // `email_verified_at` distingue « jamais activé » de « fermé par un
    // administrateur » (T-V3-02, constat B1 de l'agent testeur).
    data: { isActive: true, emailVerifiedAt: new Date() },
    select: { id: true },
  });

  return { email, userId: compte.id };
}

/// Connecte un client déjà activé.
///
/// Distinct de `seConnecter` du dossier voisin, qui attend `/admin/parametres` :
/// un client n'a pas ce rôle et atterrit sur l'accueil
/// (`AFTER_LOGIN_DEFAULT`, T-V3-03). Attendre la mauvaise URL ferait échouer le
/// helper sur une connexion pourtant réussie.
export async function seConnecterClient(
  page: Page,
  email: string,
): Promise<void> {
  await page.goto("/connexion");
  await page.getByLabel("Adresse email").fill(email);
  // `exact` : l'écran C6 porte une bascule « Afficher le mot de passe », dont
  // le nom accessible contient le libellé du champ.
  await page
    .getByLabel("Mot de passe", { exact: true })
    .fill(MOT_DE_PASSE_CLIENT);
  await page.getByRole("button", { name: "Se connecter" }).click();

  // L'en-tête propose de SE DÉCONNECTER : preuve de session la plus robuste,
  // elle ne dépend d'aucune destination. Libellé exact de `LogoutButton`.
  await expect(
    page.getByRole("button", { name: /se déconnecter/i }),
  ).toBeVisible();
}
