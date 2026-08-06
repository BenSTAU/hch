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

// ───────────────────────────────────────────────────────────────────────────
// Sondes ajoutées par l'agent testeur (T-J0-05).
//
// `validateSettingValue` est la seule chose qui se tient entre un POST
// d'administrateur et la colonne `value` en TEXT. Ces tests décrivent ce
// qu'elle laisse passer — non pour l'approuver, mais pour que la surface soit
// écrite quelque part.
// ───────────────────────────────────────────────────────────────────────────

describe("validateSettingValue — la porte du vide", () => {
  it("refuse un `value_type` inconnu, vide ou non", () => {
    // Ce test était un CONSTAT vert de l'agent testeur : la porte du vide était
    // placée AVANT `isSettingValueType`, si bien qu'un `value_type` inconnu
    // était accepté tant que la valeur était vide et refusé dès qu'elle ne
    // l'était plus — deux verdicts contradictoires sur la même ligne, selon
    // son contenu.
    //
    // Les deux contrôles ont été réordonnés. Le CHECK SQL de la migration 002
    // rendait déjà le cas inatteignable en base ; l'ordre, lui, ne dépendait
    // pas de la base.
    expect(validateSettingValue("type-inexistant", "").ok).toBe(false);
    expect(validateSettingValue("type-inexistant", "x").ok).toBe(false);
  });

  it("ne traite pas les espaces comme du vide", () => {
    // Le vide est « non renseigné ». Une chaîne d'espaces n'est pas vide : sur
    // un type contraint elle est refusée, sur `string` elle est écrite telle
    // quelle. Deux comportements différents pour deux saisies qui se
    // ressemblent à l'écran — à garder en tête si un `trim()` est ajouté un
    // jour côté formulaire.
    expect(validateSettingValue("number", "   ").ok).toBe(false);
    expect(validateSettingValue("json", "   ").ok).toBe(false);
    expect(validateSettingValue("string", "   ").ok).toBe(true);
  });
});

describe("validateSettingValue — ce que chaque type laisse passer", () => {
  it("accepte pour `number` des écritures que `parseFloat` ne relira pas pareil", () => {
    // `Number("0x10")` vaut 16, `parseFloat("0x10")` vaut 0. La valeur est
    // stockée en TEXTE : c'est le futur lecteur qui décidera lequel des deux
    // il applique, et il n'aura aucun moyen de savoir que la validation, elle,
    // avait utilisé `Number`.
    expect(validateSettingValue("number", "0x10").ok).toBe(true);
    expect(validateSettingValue("number", "1e3").ok).toBe(true);
    expect(validateSettingValue("number", "  12  ").ok).toBe(true);
    // Contrepartie : ces formes-là sont bien refusées.
    expect(validateSettingValue("number", "12,5").ok).toBe(false);
    expect(validateSettingValue("number", "1_000").ok).toBe(false);
  });

  it("accepte pour `json` les scalaires, pas seulement les objets", () => {
    // `JSON.parse` accepte `null`, `0` et `"x"`. Une clé typée `json` peut
    // donc contenir `null` — indiscernable, à la relecture, d'une valeur
    // absente. Constat, pas défaut : le dictionnaire écrit « JSON pour
    // structures riches » sans restreindre au type objet.
    expect(validateSettingValue("json", "null").ok).toBe(true);
    expect(validateSettingValue("json", "0").ok).toBe(true);
    expect(validateSettingValue("json", '"une chaîne"').ok).toBe(true);
  });

  it("accepte pour `url` des formes que le constructeur URL normalise", () => {
    // `new URL` mange les espaces de bordure et abaisse la casse du schéma :
    // ces trois formes passent, et c'est la forme BRUTE qui est stockée, pas
    // la forme normalisée. Un lecteur qui comparerait deux valeurs
    // textuellement les verrait différentes.
    expect(validateSettingValue("url", "  https://homecyclhome.fr").ok).toBe(
      true,
    );
    expect(validateSettingValue("url", "HTTPS://homecyclhome.fr").ok).toBe(
      true,
    );
    expect(
      validateSettingValue("url", "https://compte:secret@homecyclhome.fr").ok,
    ).toBe(true);
  });

  it("n'oppose aucune borne de longueur ni de contenu à `string`", () => {
    // `app_settings.value` est en TEXT, donc Postgres ne borne rien non plus,
    // et `updateSettingsSchema` ne borne que la CLÉ. Un administrateur peut
    // écrire un mégaoctet dans `company.name`. Ce n'est atteignable qu'après
    // `requireAdmin()`, donc ce n'est pas une porte ouverte — c'est une borne
    // absente. Si elle est posée un jour, ce test devient rouge, et ce sera la
    // bonne réaction.
    expect(validateSettingValue("string", "x".repeat(100_000)).ok).toBe(true);
    expect(validateSettingValue("string", "<script>alert(1)</script>").ok).toBe(
      true,
    );
    expect(validateSettingValue("string", "ligne\nsuivante").ok).toBe(true);
  });
});
