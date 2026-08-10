import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ADRESSE_DEMO, entiteBan } from "./handlers";

/// Le faux service d'adressage de la barrière E2E ne peut pas importer ces
/// fixtures : il tourne dans un conteneur `node:24-alpine` nu
/// (`docker-compose.test.yml`, service `hch-ban-mock`) et lit un fichier JSON
/// monté en volume. La donnée existe donc à deux endroits.
///
/// Ce test est ce qui les empêche de diverger en silence. Sans lui, une
/// correction sur `ADRESSE_DEMO` laisserait la barrière valider une adresse que
/// plus aucun test unitaire ne connaît, et le premier symptôme serait un
/// « hors zone » inexplicable en CI.

describe("fixture BAN de la barrière E2E", () => {
  it("décrit la même adresse que les fixtures MSW", () => {
    const fichier: unknown = JSON.parse(
      readFileSync("tests/fixtures/ban-search.json", "utf8"),
    );

    expect(fichier).toEqual({
      type: "FeatureCollection",
      features: [entiteBan({ ...ADRESSE_DEMO, type: "housenumber" })],
      limit: 1,
    });
  });
});
