// @vitest-environment node
//
// Regles d'encaissement terrain - module PUR, partage par la modale cliente et
// par le schema Zod.
//
// Le schema est teste a travers l'action (`cloturer-intervention.test.ts`), qui
// eprouve les REFUS. Ce fichier eprouve la sortie : la forme canonique que
// `Prisma.Decimal` recevra. Une normalisation qui rendrait « 97,90 » tel quel
// passerait tous les tests de refus et ecrirait un montant faux.
import { describe, expect, it } from "vitest";

import {
  LIBELLE_METHODE,
  METHODES_PAIEMENT,
  montantStrictementPositif,
  normaliserMontant,
} from "./encaissement";

describe("normaliserMontant", () => {
  it.each([
    ["97.90", "97.90"],
    ["97,90", "97.90"],
    ["85", "85"],
    ["0.05", "0.05"],
    ["  12.50  ", "12.50"],
    ["99999999.99", "99999999.99"],
  ])("ramene %s a %s", (saisie, attendu) => {
    expect(normaliserMontant(saisie)).toBe(attendu);
  });

  it.each([
    ["12.345"],
    ["abc"],
    ["12 €"],
    [""],
    ["-5"],
    ["1e3"],
    ["1.2.3"],
    ["999999999"],
    [".50"],
  ])("refuse %s", (saisie) => {
    expect(normaliserMontant(saisie)).toBeNull();
  });
});

describe("montantStrictementPositif", () => {
  it.each([["0"], ["0.00"], ["0.0"], ["00"]])(
    "refuse %s, qui serait un UNPAID sous une etiquette fausse",
    (canonique) => {
      expect(montantStrictementPositif(canonique)).toBe(false);
    },
  );

  it.each([["0.01"], ["85"], ["97.90"]])("accepte %s", (canonique) => {
    expect(montantStrictementPositif(canonique)).toBe(true);
  });
});

describe("les trois modes de Constitution §2.3", () => {
  it("sont exactement CB, CASH et CHECK", () => {
    // Les memes valeurs que le CHECK SQL de la migration 009 et que le
    // dictionnaire §payments. Une quatrieme ici passerait Zod et serait rejetee
    // par la base, en erreur serveur opaque.
    expect(METHODES_PAIEMENT).toEqual(["CB", "CASH", "CHECK"]);
  });

  it("portent tous les trois un libelle lisible", () => {
    // Un client qui lirait « CHECK » dans son email ne saurait pas s'il s'agit
    // d'un cheque ou d'une verification.
    for (const methode of METHODES_PAIEMENT) {
      expect(LIBELLE_METHODE[methode]).toBeTruthy();
      expect(LIBELLE_METHODE[methode]).not.toBe(methode);
    }
  });
});
