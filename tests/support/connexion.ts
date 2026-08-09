import { expect, type Page } from "@playwright/test";

/// Connecte l'administrateur seedé et attend l'écran d'administration.
///
/// Partagé par la barrière (`tests/e2e/`) et le smoke (`tests/smoke/`) : c'est
/// la seule séquence que les deux exécutent à l'identique, et la dupliquer
/// ferait diverger deux oracles qui doivent rester le même.
///
/// **Sans reprise, volontairement.** T-J0-09 avait dû en poser une : le
/// formulaire de connexion n'avait pas d'attribut `action`, et un clic avant
/// hydratation le soumettait NATIVEMENT en GET. Depuis le passage à
/// `<form action={formAction}>`, la soumission part en POST vers la Server
/// Action que React n'ait hydraté ou non — la course n'existe plus, et la
/// reprise a été retirée plutôt que gardée « au cas où ». Si ce helper
/// redevient instable, c'est le formulaire qu'il faut regarder.
export async function seConnecter(
  page: Page,
  email: string,
  motDePasse: string,
): Promise<void> {
  await page.goto("/connexion");
  await page.getByLabel("Adresse email").fill(email);
  // `exact: true` depuis T-V3-03 : l'écran C6 porte une bascule d'affichage du
  // mot de passe, dont le nom accessible — « Afficher le mot de passe » —
  // contient le libellé du champ. `getByLabel` compare en sous-chaîne
  // insensible à la casse et en résoudrait deux, exactement comme « Nom » face
  // à « Prénom » sur la PR #17.
  await page.getByLabel("Mot de passe", { exact: true }).fill(motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();

  // Atteindre cette URL prouve trois choses d'un coup : le hash bcrypt a été
  // comparé, la session a été signée, et `requireAdmin()` a laissé passer.
  await expect(page).toHaveURL(/\/admin\/parametres$/);
}
