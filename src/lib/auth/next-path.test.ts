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

// ───────────────────────────────────────────────────────────────────────────
// Sondes ajoutées par l'agent testeur (T-J0-05).
//
// Les cas ci-dessus couvrent les formes nommées par la DoD. Ceux-ci couvrent
// les formes qui contournent habituellement un filtre écrit à la main : le
// slash reconstitué par un encodage partiel, le caractère de contrôle placé
// AILLEURS qu'en tête, et les caractères que la relecture humaine confond avec
// un slash.
// ───────────────────────────────────────────────────────────────────────────

describe("safeNextPath — contournements de forme", () => {
  it("refuse un `//` reconstitué par deux séquences encodées", () => {
    // `/%2f%2fhôte` se décode en `///hôte`. Le filtre `startsWith("//")` ne
    // voit rien sur la forme brute : c'est le contrôle de la forme décodée qui
    // travaille ici, et ce test est ce qui empêche de le retirer.
    expect(safeNextPath("/%2f%2fphishing.example")).toBeNull();
    expect(safeNextPath("/%2F%2Fphishing.example")).toBeNull();
  });

  it("refuse un triple slash", () => {
    // Plusieurs parseurs d'URL absorbent les slashes surnuméraires et lisent
    // `///hôte` comme `//hôte`.
    expect(safeNextPath("///phishing.example")).toBeNull();
  });

  it("refuse des antislashs encodés", () => {
    expect(safeNextPath("/%5C%5Cphishing.example")).toBeNull();
    expect(safeNextPath("/%5cphishing.example")).toBeNull();
  });

  it("refuse un caractère de contrôle ailleurs qu'en tête de chaîne", () => {
    // Un filtre qui ne regarderait que le début de la valeur laisserait passer
    // ceci. `hasControlCharacter` parcourt toute la chaîne — ce test est ce
    // qui empêche de la remplacer un jour par un `trimStart()`.
    expect(safeNextPath("/ad\tmin/parametres")).toBeNull();
    expect(safeNextPath("/admin%09parametres")).toBeNull();
    expect(safeNextPath("/admin\rparametres")).toBeNull();
  });

  it("refuse un octet nul encodé", () => {
    // `%00` tronque la chaîne dans toute couche écrite en C : ce qui suit
    // devient invisible à un contrôle qui n'aurait regardé qu'avant.
    expect(safeNextPath("/admin%00https://phishing.example")).toBeNull();
  });

  it("refuse un chemin dont seul le slash initial est encodé", () => {
    expect(safeNextPath("%2Fphishing.example")).toBeNull();
    expect(safeNextPath("%2f%2fphishing.example")).toBeNull();
  });
});

describe("safeNextPath — constats, pas des refus", () => {
  // Ces cas PASSENT le filtre. Ils sont écrits pour que ce soit un choix
  // observable et non un oubli : chacun reste une destination du même site,
  // donc aucun n'est un open redirect. Si l'un devait un jour être refusé,
  // c'est ici qu'on le verrait devenir rouge — et ce serait la bonne réaction.

  it("accepte un double encodage — la destination reste du même site", () => {
    // `/%252Fphishing.example` se décode UNE fois en `/%2Fphishing.example`,
    // qui commence par un slash unique. Le contrôle est donc borné à une
    // profondeur de décodage. Non exploitable : le navigateur résout
    // `Location: /%252F…` relativement à l'origine courante et ne décode pas
    // deux fois. La borne est réelle et vaut d'être écrite.
    expect(safeNextPath("/%252Fphishing.example")).toBe(
      "/%252Fphishing.example",
    );
  });

  it("accepte une remontée de chemin encodée", () => {
    // `/../..` est normalisé par le navigateur et ne sort jamais de l'origine.
    expect(safeNextPath("/..%2F..%2Fadmin")).toBe("/..%2F..%2Fadmin");
  });

  it("accepte les caractères Unicode que l'œil confond avec un slash", () => {
    // U+FF0F SOLIDUS PLEINE CHASSE et U+2044 BARRE DE FRACTION ressemblent à
    // un slash sans en être un pour le parseur d'URL : WHATWG ne traite
    // spécialement que `/` et `\`. La valeur reste un chemin de ce site dont
    // le premier segment porte un caractère exotique.
    const fullwidth = `/${String.fromCodePoint(0xff0f).repeat(2)}phishing.example`;
    const fraction = `/${String.fromCodePoint(0x2044).repeat(2)}phishing.example`;

    expect(safeNextPath(fullwidth)).toBe(fullwidth);
    expect(safeNextPath(fraction)).toBe(fraction);
  });

  it("refuse désormais les caractères de contrôle C1", () => {
    // Ce test était un CONSTAT vert de l'agent testeur : `hasControlCharacter`
    // couvrait C0 (< 0x20) et DEL (0x7F), pas C1 (U+0080–U+009F) — dont U+0085
    // NEXT LINE, que certaines couches traitent comme un saut de ligne. Il
    // notait « si X est durci, ce test devient rouge, et ce sera la bonne
    // réaction ».
    //
    // Durci : la garde couvre C1. Aucun vecteur n'était connu — Next encode la
    // valeur avant de la poser en en-tête — mais une garde qui couvre une
    // famille de contrôles et pas l'autre est une garde dont personne ne peut
    // dire ce qu'elle protège.
    const nel = `/admin${String.fromCodePoint(0x85)}parametres`;
    const c1 = `/admin${String.fromCodePoint(0x9f)}parametres`;

    expect(safeNextPath(nel)).toBeNull();
    expect(safeNextPath(c1)).toBeNull();
  });

  it("refuse un chemin légitime portant un `%` isolé", () => {
    // Faux négatif assumé : `decodeURIComponent` lève sur un `%` non suivi de
    // deux chiffres hexadécimaux, et la fonction renvoie `null`. Aucune route
    // du jalon 0 n'est concernée, et le repli est la destination par défaut —
    // l'erreur va dans le sens sûr. À rouvrir le jour où une recherche libre
    // transite par `next=`.
    expect(safeNextPath("/recherche?q=100%")).toBeNull();
    expect(safeNextPath("/recherche?q=100%25")).toBe("/recherche?q=100%25");
  });
});
