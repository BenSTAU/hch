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
]);

export default eslintConfig;
