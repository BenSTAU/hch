// @vitest-environment node
//
// Normalisation de `users.email` — dette reportée de T-J0-04 vers T-V3-03.
//
// Le `.toLowerCase()` posé dans les schémas Zod referme le symptôme à la
// LECTURE : « Admin@HomeCyclHome.fr » retrouve le compte que Postgres, qui
// compare octet par octet sur une VARCHAR sous index unique ordinaire, ne
// trouvait pas. Il ne protège de rien à l'ÉCRITURE : une inscription qui
// écrirait « Camille@Example.test » créerait une seconde ligne pour un compte
// déjà pris, et l'index unique ne la verrait pas passer.
//
// Ce module est le premier des deux filets. Le second est le CHECK SQL
// `email = lower(email)` de la migration, qui tient même face à un script de
// maintenance ou à une écriture future oubliée ici.
import { describe, expect, it } from "vitest";

const { normalizeEmail } = await import("./email");

describe("normalizeEmail", () => {
  it("abaisse la casse", () => {
    expect(normalizeEmail("Camille@Example.TEST")).toBe(
      "camille@example.test",
    );
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
