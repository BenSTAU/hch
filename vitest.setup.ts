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

// jsdom n'implémente pas `ResizeObserver`, que Radix appelle dès qu'un groupe
// de boutons radio vit **dans un `<form>`** : il y rend alors un input natif
// masqué pour que le formulaire porte la valeur, et mesure le contrôle réel.
// Le premier cas du dépôt est le formulaire de C11 (T-V3-16) ; les dalles de
// forfait du tunnel n'étaient pas dans un formulaire, d'où le silence jusqu'ici.
//
// Un bouchon inerte suffit : rien de ce qui est testé ne dépend d'une mesure, et
// tous les navigateurs visés implémentent l'API. Le poser globalement plutôt que
// par fichier - c'est un trou de l'environnement, pas une affaire de test.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

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
