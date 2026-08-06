// @vitest-environment node
//
// Validation de la configuration société.
//
// `app_settings` est une table clé-valeur : `value` est stockée en TEXT et
// c'est `value_type` qui dit à l'application comment la relire
// (mcd-dictionnaire §app_settings, migration 002). Le schéma Zod ne peut donc
// pas être une forme fermée — il valide la STRUCTURE soumise, et le typage de
// chaque valeur se fait contre le `value_type` lu en base.
//
// Séparer les deux n'est pas une commodité : le formulaire est générique,
// piloté par les lignes existantes, et une clé ajoutée par un simple INSERT
// doit fonctionner sans qu'aucun schéma soit retouché.
import { describe, expect, it } from "vitest";

import { updateSettingsSchema, validateSettingValue } from "./parametres";

describe("updateSettingsSchema — structure", () => {
  it("accepte une liste de couples clé/valeur", () => {
    const parsed = updateSettingsSchema.safeParse({
      settings: [{ key: "company.name", value: "LeCycleLyonnais" }],
    });

    expect(parsed.success).toBe(true);
  });

  it("accepte une valeur vide — une clé non renseignée reste une clé", () => {
    // `company.siret` et `company.address` sont seedées à chaîne vide
    // (prisma/seed.ts). Refuser le vide interdirait d'effacer un champ.
    const parsed = updateSettingsSchema.safeParse({
      settings: [{ key: "company.siret", value: "" }],
    });

    expect(parsed.success).toBe(true);
  });

  it("refuse une soumission sans aucune entrée", () => {
    expect(updateSettingsSchema.safeParse({ settings: [] }).success).toBe(
      false,
    );
  });

  it("refuse une clé vide", () => {
    expect(
      updateSettingsSchema.safeParse({ settings: [{ key: "", value: "x" }] })
        .success,
    ).toBe(false);
  });

  it("refuse une clé plus longue que la colonne", () => {
    // `key` est VARCHAR(100). Laisser passer plus long échangerait un refus
    // Zod lisible contre une erreur Postgres 22001 en 500.
    expect(
      updateSettingsSchema.safeParse({
        settings: [{ key: "c".repeat(101), value: "x" }],
      }).success,
    ).toBe(false);
  });

  it("refuse une valeur non textuelle", () => {
    // L'action est un endpoint POST public : rien ne garantit qu'un objet ou
    // un tableau n'arrive pas à la place d'une chaîne.
    expect(
      updateSettingsSchema.safeParse({
        settings: [{ key: "company.name", value: { toString: "évasion" } }],
      }).success,
    ).toBe(false);
  });

  it("refuse deux fois la même clé dans une soumission", () => {
    // Deux valeurs contradictoires pour une seule ligne : l'ordre d'écriture
    // déciderait silencieusement du gagnant, et l'entrée d'audit décrirait un
    // diff qui n'a jamais existé.
    expect(
      updateSettingsSchema.safeParse({
        settings: [
          { key: "company.name", value: "A" },
          { key: "company.name", value: "B" },
        ],
      }).success,
    ).toBe(false);
  });

  it("écarte les champs surnuméraires plutôt que de les transporter", () => {
    // `updated_by` se décide côté serveur depuis la session, jamais depuis la
    // charge utile — sans quoi n'importe qui signe une modification du nom
    // d'un administrateur.
    const parsed = updateSettingsSchema.safeParse({
      settings: [
        { key: "company.name", value: "X", updatedBy: "un-autre-admin" },
      ],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.settings[0]).toEqual({
      key: "company.name",
      value: "X",
    });
  });
});

describe("validateSettingValue — typage par `value_type`", () => {
  it("accepte n'importe quel texte pour `string`", () => {
    expect(validateSettingValue("string", "LeCycleLyonnais").ok).toBe(true);
  });

  it("accepte le vide quel que soit le type — le vide est « non renseigné »", () => {
    // `value` est NULLable en base, et une chaîne vide exprime la même chose.
    // Sans cette exception, un SIRET typé `number` ne pourrait jamais être
    // effacé une fois posé.
    for (const type of [
      "string",
      "number",
      "boolean",
      "json",
      "url",
    ] as const) {
      expect(validateSettingValue(type, "").ok).toBe(true);
    }
  });

  it("exige un nombre fini pour `number`", () => {
    expect(validateSettingValue("number", "42").ok).toBe(true);
    expect(validateSettingValue("number", "3.5").ok).toBe(true);
    expect(validateSettingValue("number", "quarante-deux").ok).toBe(false);
    expect(validateSettingValue("number", "Infinity").ok).toBe(false);
    expect(validateSettingValue("number", "NaN").ok).toBe(false);
    // `Number("")` vaut 0 et `Number(" ")` aussi : la conversion implicite de
    // JavaScript accepte des chaînes qui ne sont pas des nombres écrits.
    expect(validateSettingValue("number", "  ").ok).toBe(false);
  });

  it("n'accepte que `true` ou `false` pour `boolean`", () => {
    expect(validateSettingValue("boolean", "true").ok).toBe(true);
    expect(validateSettingValue("boolean", "false").ok).toBe(true);
    expect(validateSettingValue("boolean", "1").ok).toBe(false);
    expect(validateSettingValue("boolean", "oui").ok).toBe(false);
    expect(validateSettingValue("boolean", "TRUE").ok).toBe(false);
  });

  it("exige un JSON relisable pour `json`", () => {
    expect(validateSettingValue("json", '{"lundi":"9h-18h"}').ok).toBe(true);
    expect(validateSettingValue("json", "{lundi: 9}").ok).toBe(false);
  });

  it("n'accepte que http et https pour `url`", () => {
    expect(validateSettingValue("url", "https://homecyclhome.fr").ok).toBe(
      true,
    );
    expect(validateSettingValue("url", "http://homecyclhome.fr").ok).toBe(true);
    expect(validateSettingValue("url", "javascript:alert(1)").ok).toBe(false);
    expect(validateSettingValue("url", "pas-une-url").ok).toBe(false);
  });

  it("porte un motif exploitable dans sa branche d'échec", () => {
    // Union discriminée (CLAUDE.md §TypeScript) : le refus doit dire POURQUOI,
    // sinon le formulaire ne peut afficher qu'un « erreur » opaque sur un
    // écran qui compte cinq champs.
    const result = validateSettingValue("number", "quarante-deux");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason.length).toBeGreaterThan(0);
  });
});
