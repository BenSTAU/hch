// @vitest-environment node
//
// Normalisation de `users.email`, premier des deux filets ; le second est le
// CHECK SQL `email = lower(email)` de la migration. Le `.toLowerCase()` des
// schémas Zod ne referme que la LECTURE : à l'ÉCRITURE, une insertion qui lui
// échapperait créerait une seconde ligne pour un compte déjà pris, que l'index
// unique laisserait passer.
import { describe, expect, it } from "vitest";

const { normalizeEmail } = await import("./email");

describe("normalizeEmail", () => {
  it("abaisse la casse", () => {
    expect(normalizeEmail("Camille@Example.TEST")).toBe("camille@example.test");
  });

  it("retire les espaces de bordure", () => {
    // Un copier-coller depuis un client de messagerie en ramène régulièrement.
    expect(normalizeEmail("  camille@example.test\n")).toBe(
      "camille@example.test",
    );
  });

  it("est idempotent", () => {
    // Propriété nécessaire au CHECK SQL : appliquer deux fois la normalisation
    // doit donner la même valeur, sinon la contrainte rejetterait une ligne
    // que l'application croit conforme.
    const une = normalizeEmail(" Camille@Example.test ");
    expect(normalizeEmail(une)).toBe(une);
  });

  it("ne touche à rien d'autre dans la partie locale", () => {
    // Pas d'aliasing : `c.durand@gmail.com` et `cdurand@gmail.com` sont deux
    // adresses distinctes pour tout le monde sauf Gmail. Les fusionner ferait
    // rejeter une inscription légitime au motif d'un doublon inexistant.
    expect(normalizeEmail("c.durand+velo@example.test")).toBe(
      "c.durand+velo@example.test",
    );
  });

  it("laisse une chaîne vide vide", () => {
    // Le schéma Zod refuse déjà le vide en amont ; le helper ne doit pas
    // inventer de valeur pour autant.
    expect(normalizeEmail("")).toBe("");
  });
});
