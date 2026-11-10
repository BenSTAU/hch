// @vitest-environment node
//
// Jeton de version des fiches d'administration. Ce qui se vérifie ici est la
// propriété dont dépend tout le refus de concurrence : **deux états différents
// donnent deux empreintes différentes**. Une collision ne ferait pas échouer un
// test ailleurs, elle laisserait silencieusement écraser une modification.
import { describe, expect, it } from "vitest";

import { empreinteFiche } from "./empreinte";

const FICHE = ["Révision complète", "Entretien complet", 60, "85.00", true];

describe("empreinteFiche", () => {
  it("rend la même empreinte pour le même état", () => {
    expect(empreinteFiche(FICHE)).toBe(empreinteFiche([...FICHE]));
  });

  it("change dès qu'un champ change, quel qu'il soit", () => {
    const reference = empreinteFiche(FICHE);

    const variantes = [
      ["Révision", "Entretien complet", 60, "85.00", true],
      ["Révision complète", "Autre texte", 60, "85.00", true],
      ["Révision complète", "Entretien complet", 90, "85.00", true],
      ["Révision complète", "Entretien complet", 60, "90.00", true],
      ["Révision complète", "Entretien complet", 60, "85.00", false],
    ];

    for (const variante of variantes) {
      expect(empreinteFiche(variante)).not.toBe(reference);
    }
  });

  it("distingue une colonne vidée d'une colonne contenant la chaîne vide", () => {
    // `services.description` est NULLable : confondre les deux laisserait
    // passer la modification qui vide un champ.
    expect(empreinteFiche(["a", null])).not.toBe(empreinteFiche(["a", ""]));
  });

  it("ne confond pas deux découpages du même texte concaténé", () => {
    // Le piège qu'un `join()` naïf ne voit pas : sans longueur en préfixe, ces
    // deux fiches auraient la même empreinte, et l'une passerait pour l'autre.
    expect(empreinteFiche(["ab", "c"])).not.toBe(empreinteFiche(["a", "bc"]));
  });

  it("distingue un nombre de sa représentation textuelle voisine", () => {
    expect(empreinteFiche([60])).not.toBe(empreinteFiche(["60 "]));
  });

  // ───────────────────────────────────────────────────────────────────────
  // Ajouté par l'agent testeur (verify-only) sur T-B1-01.
  // ───────────────────────────────────────────────────────────────────────

  it("NE distingue PAS un nombre de la même valeur en chaîne", () => {
    // Limite réelle de l'encodage : `encoder` fait `String(valeur)` et ne
    // marque pas le type, donc `60` et `"60"` produisent la même empreinte.
    //
    // ⚠️ Le test voisin s'appelle « distingue un nombre de sa représentation
    // textuelle voisine » et compare `[60]` à `["60 "]` : c'est l'ESPACE
    // final qui les sépare, pas le type. Son nom promet plus qu'il ne
    // vérifie.
    //
    // Sans conséquence AUJOURD'HUI parce que la fabrique du jeton
    // (`versAdmin`, `src/lib/db/queries/forfaits.ts`) place toujours le même
    // type à la même position : libellé chaîne, durée nombre, prix chaîne,
    // statut booléen. C'est donc une **condition d'emploi du patron**, et
    // c'est ce que ce test fige : le prochain écran qui réutilise
    // `empreinteFiche` ne peut pas faire voyager une colonne tantôt en
    // nombre tantôt en chaîne sans rendre deux états indistinguables.
    expect(empreinteFiche([60])).toBe(empreinteFiche(["60"]));
    expect(empreinteFiche([true])).toBe(empreinteFiche(["true"]));
  });

  it("rend un jeton court et sûr dans une URL ou un attribut HTML", () => {
    const jeton = empreinteFiche(FICHE);

    expect(jeton).toHaveLength(22);
    expect(jeton).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
