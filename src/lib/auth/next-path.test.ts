// @vitest-environment node
//
// Validation de la destination post-connexion.
//
// `src/proxy.ts:35` produit un `?next=<chemin>` depuis le 2026-08-05 et
// personne ne le lisait — T-J0-05 ferme la boucle. Le jour où on la ferme,
// la valeur devient une **entrée contrôlée par l'attaquant qui atterrit dans
// un `redirect()`** : c'est la définition de l'open redirect. Un lien
// `…/connexion?next=https://phishing.example` sur un domaine légitime, suivi
// d'une vraie connexion réussie, dépose l'utilisateur chez l'attaquant en
// ayant traversé une page authentique.
//
// La règle est celle de la DoD : chemin relatif du même site, jamais une URL
// absolue ni un `//hôte`.
import { describe, expect, it } from "vitest";

import { safeNextPath } from "./next-path";

describe("safeNextPath — destinations acceptées", () => {
  it("accepte un chemin absolu du même site", () => {
    expect(safeNextPath("/admin/parametres")).toBe("/admin/parametres");
  });

  it("conserve la query string et le fragment", () => {
    expect(safeNextPath("/admin/parametres?onglet=societe")).toBe(
      "/admin/parametres?onglet=societe",
    );
  });

  it("accepte la racine", () => {
    expect(safeNextPath("/")).toBe("/");
  });
});

describe("safeNextPath — destinations refusées", () => {
  it("refuse une URL absolue", () => {
    expect(safeNextPath("https://phishing.example/connexion")).toBeNull();
  });

  it("refuse une URL absolue sans schéma — le `//hôte` nommé par la DoD", () => {
    // `//phishing.example` est une URL protocol-relative : le navigateur la
    // résout en `https://phishing.example`. Elle commence par `/`, donc un
    // contrôle naïf « ça commence par un slash » la laisse passer. C'est le
    // contournement classique de ce filtre.
    expect(safeNextPath("//phishing.example")).toBeNull();
  });

  it("refuse un antislash après le slash initial", () => {
    // `/\phishing.example` : plusieurs navigateurs traitent l'antislash comme
    // un slash dans une autorité, ce qui rend cette forme équivalente à
    // `//phishing.example` chez eux sans l'être pour un `startsWith("//")`.
    expect(safeNextPath("/\\phishing.example")).toBeNull();
    expect(safeNextPath("\\\\phishing.example")).toBeNull();
  });

  it("refuse un schéma exotique", () => {
    expect(safeNextPath("javascript:alert(1)")).toBeNull();
    expect(safeNextPath("data:text/html,<script>")).toBeNull();
  });

  it("refuse un chemin relatif sans slash initial", () => {
    // `admin/parametres` se résout relativement à la page courante — la
    // destination n'est pas celle qu'on lit.
    expect(safeNextPath("admin/parametres")).toBeNull();
  });

  it("refuse une valeur absente, vide ou non textuelle", () => {
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath("")).toBeNull();
  });

  it("refuse les caractères de contrôle, y compris encodés", () => {
    // Un saut de ligne dans une destination est un vecteur d'injection
    // d'en-tête. Le `%0d%0a` couvre le cas où la valeur arrive encore encodée.
    expect(safeNextPath("/admin\nSet-Cookie: a=b")).toBeNull();
    expect(safeNextPath("/admin%0d%0aSet-Cookie:%20a=b")).toBeNull();
  });

  it("refuse un `//hôte` dissimulé par un encodage", () => {
    // `/%2Fphishing.example` se décode en `//phishing.example`. Valider avant
    // de décoder laisserait passer exactement ce que le test précédent refuse.
    expect(safeNextPath("/%2Fphishing.example")).toBeNull();
  });

  it("refuse des espaces en tête, qui masquent le schéma", () => {
    expect(safeNextPath("  https://phishing.example")).toBeNull();
    expect(safeNextPath("\thttps://phishing.example")).toBeNull();
  });
});
