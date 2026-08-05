// Contrastes de la palette — ajoutés par l'agent testeur.
//
// SPEC §6.3.2 place le parcours de connexion au niveau **AA**, et §6.3.1
// critère 1 exige un contraste texte/fond ≥ 4.5:1. La preuve est censée être
// outillée (`jest-axe` en Vitest, `@axe-core/playwright` en E2E), mais :
//   · `jest-axe` n'est pas installé — il arrive avec T-J0-09, et je ne peux
//     pas l'ajouter (`package.json` est hors de mon périmètre) ;
//   · même installé, axe-core ne mesure PAS le contraste sous jsdom : il lui
//     faut un moteur de rendu qui résolve les couleurs calculées. Sous jsdom
//     la règle `color-contrast` est marquée `incomplete`, jamais `pass`.
//
// Ce fichier prend le problème par l'autre bout : la palette est en hexadécimal
// fixe dans `globals.css` (ADR-012 §D4), donc calculable. On vérifie les six
// paires effectivement présentes à l'écran de connexion. Ce n'est pas un audit
// axe-core — ça ne dit rien de la composition réelle des couches, ni des
// opacités `/50` des anneaux de focus. C'est la borne inférieure, prouvée.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Chemin depuis la racine du projet, et non `import.meta.url` : sous
// l'environnement jsdom de ce dépôt, `import.meta.url` est une URL `http:` et
// `fileURLToPath` la refuse. Vitest s'exécute toujours depuis la racine.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/// Lit un token du bloc `:root`. Volontairement strict : si un token passe en
/// `oklch()` ou en `color-mix()`, la lecture échoue au lieu de renvoyer une
/// valeur fausse et de rendre le test vert par accident.
function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(css);
  if (!match?.[1]) {
    throw new Error(
      `Token --${name} introuvable ou non hexadécimal dans globals.css. ` +
        `Le calcul de contraste ci-dessous ne sait lire que du #rrggbb.`,
    );
  }
  return match[1];
}

/// Luminance relative WCAG 2.x, §Relative luminance.
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  }) as [number, number, number];

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

describe("palette — contrastes du texte de l'écran de connexion", () => {
  // WCAG 1.4.3 (A) / RGAA 3.3. Les trois paires ci-dessous sont celles que le
  // DOM de `/connexion` produit réellement : le corps hérite de `bg-background
  // text-foreground` (globals.css:92-94), le sous-titre porte
  // `text-muted-foreground` et le message de refus `text-destructive`
  // (src/app/(auth)/connexion/_components/login-form.tsx:43).
  it.each([
    ["texte courant", "foreground", "background"],
    ["sous-titre atténué", "muted-foreground", "background"],
    ["message de refus", "destructive", "background"],
  ])("%s : ≥ 4.5:1", (_libelle, avant, arriere) => {
    expect(contrast(token(avant), token(arriere))).toBeGreaterThanOrEqual(4.5);
  });

  it("libellé du bouton « Se connecter » sur son fond : ≥ 4.5:1", () => {
    // Variante `default` du bouton — `bg-primary text-primary-foreground`
    // (src/components/ui/button.tsx, variants.variant.default).
    expect(
      contrast(token("primary-foreground"), token("primary")),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("palette — contrastes des éléments non textuels", () => {
  // WCAG 1.4.11 (AA) / RGAA 3.3 : 3:1 suffit pour une bordure ou un anneau,
  // ce ne sont pas des glyphes.
  it("bordure des champs de saisie : ≥ 3:1", () => {
    expect(
      contrast(token("input"), token("background")),
    ).toBeGreaterThanOrEqual(3);
  });

  it("anneau de focus : ≥ 3:1", () => {
    // WCAG 2.4.7 (A) exige un focus VISIBLE ; 1.4.11 en fixe le seuil. La
    // largeur (`focus-visible:ring-3`, soit 3px, ≥ 2px demandés par SPEC
    // §6.3.1 critère 2) est portée par les composants, pas par la palette —
    // elle n'est pas vérifiable ici.
    expect(contrast(token("ring"), token("background"))).toBeGreaterThanOrEqual(
      3,
    );
  });
});

describe("palette — ce que le test ne couvre pas", () => {
  it("échoue explicitement si un token quitte l'hexadécimal", () => {
    // Garde-fou méta : si demain la palette passe en `oklch()`, ce fichier
    // doit tomber en panne bruyamment plutôt que de continuer à afficher six
    // tests verts sur des valeurs qu'il ne sait plus lire.
    expect(() => token("token-qui-n-existe-pas")).toThrow(/introuvable/);
  });
});
