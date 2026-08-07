import { expect, type Page } from "@playwright/test";

/// Connecte l'administrateur seedé et attend l'écran d'administration.
///
/// Partagé par la barrière (`tests/e2e/`) et le smoke (`tests/smoke/`) : c'est
/// la seule séquence que les deux exécutent à l'identique, et la dupliquer
/// ferait diverger deux oracles qui doivent rester le même.
///
/// **Pourquoi une reprise, et pourquoi elle ne devrait pas être nécessaire.**
/// `src/app/(auth)/connexion/_components/login-form.tsx` est un `<form>` sans
/// attribut `action`, dont la soumission passe uniquement par `onSubmit`.
/// Cliquer avant que React n'ait hydraté déclenche donc la soumission NATIVE
/// du navigateur : une requête **GET** vers l'URL courante, tous les champs en
/// query string — mot de passe compris. Observé sur ce test, avec le mot de
/// passe en clair dans l'URL reçue.
///
/// La fenêtre est ouverte par la compilation à la demande de `pnpm dev` ; elle
/// est bien plus étroite contre l'image de production, déjà construite. La
/// reprise ci-dessous absorbe la course **sans la masquer** : si le formulaire
/// ne fonctionne jamais, toutes les tentatives échouent et le test rougit.
///
/// Le correctif applicatif est un `<form action={…}>` (progressive enhancement
/// Next), qui soumet en POST même sans JavaScript. Il est hors périmètre de
/// T-J0-09 et remonté comme tel.
export async function seConnecter(
  page: Page,
  email: string,
  motDePasse: string,
): Promise<void> {
  await expect(async () => {
    await page.goto("/connexion");
    await page.getByLabel("Adresse email").fill(email);
    await page.getByLabel("Mot de passe").fill(motDePasse);
    await page.getByRole("button", { name: "Se connecter" }).click();

    // Atteindre cette URL prouve trois choses d'un coup : le hash bcrypt a été
    // comparé, la session a été signée, et `requireAdmin()` a laissé passer.
    await expect(page).toHaveURL(/\/admin\/parametres$/, { timeout: 5_000 });
  }).toPass({ timeout: 45_000 });
}
