import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Les globals Vitest ne sont pas activés : chaque test importe `describe`,
// `it` et `expect` explicitement. React Testing Library branche son cleanup
// automatique en détectant un `afterEach` global — absent ici, on le pose.
afterEach(() => {
  cleanup();
});
