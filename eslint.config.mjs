import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Sorties Playwright (T-J0-09). ESLint 9 en flat config **ne lit pas
    // `.gitignore`** : sans ces lignes il parcourt les bundles minifiés du
    // rapport de trace et sort en erreur sur du code qui n'est pas le nôtre.
    // `pnpm lint` devenait rouge sur tout poste ayant lancé les E2E une fois.
    // Relevé par l'agent testeur.
    "test-results/**",
    "playwright-report/**",
    "blob-report/**",
    "playwright/.cache/**",
  ]),
  {
    // 🐛 **Neuf fichiers portaient un BOM UTF-8**, en deux lots : le droit à
    // l'oubli (T-V3-12) et les trois pages légales. Audit de conformité du
    // 2026-08-12.
    //
    // La cause est l'outillage d'écriture, pas la rédaction : sur ce poste
    // PowerShell écrit en UTF-8 **avec** BOM par défaut (`Out-File`, `>`), et
    // Prettier **préserve** un BOM existant au lieu de le retirer. Rien dans la
    // chaîne ne les empêchait ni ne les enlevait, donc ils se propageaient d'un
    // lot au suivant sans que rien ne le signale.
    //
    // `unicode-bom` est une règle du coeur d'ESLint, donc elle tourne déjà en
    // CI : c'est la garde la moins chère, et elle vaut mieux qu'un nettoyage
    // qu'il faudrait refaire au prochain lot.
    rules: { "unicode-bom": ["error", "never"] },
  },
]);

export default eslintConfig;
