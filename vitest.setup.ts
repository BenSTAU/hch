import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { toHaveNoViolations } from "jest-axe";
import { afterAll, afterEach, beforeAll, expect } from "vitest";

import { server } from "@/mocks/node";

// Les globals Vitest ne sont pas activés : chaque test importe `describe`,
// `it` et `expect` explicitement. React Testing Library branche son cleanup
// automatique en détectant un `afterEach` global — absent ici, on le pose.
afterEach(() => {
  cleanup();
});

// `jest-axe` expose ses matchers au format Jest ; l'API `expect` de Vitest est
// compatible, `expect.extend` suffit. Le typage vient de `@types/jest-axe`.
expect.extend(toHaveNoViolations);

// `onUnhandledRequest: "error"` (ADR-014 §Stack) : tout appel sortant non
// déclaré fait échouer le test au lieu de partir sur le réseau. Aujourd'hui
// aucun handler n'est enregistré — c'est donc une interdiction complète, et
// c'est voulu : le premier appel réseau du projet devra être décidé, pas subi.
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

// Les handlers ajoutés par un test ne fuient pas vers le suivant.
afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
