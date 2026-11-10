// @vitest-environment node
//
// Aide à l'audit. Ce qu'elle garantit tient en une phrase : `audit_logs.details`
// ne décrit **que** ce qui a changé. Un diff trop large ferait mentir le journal
// sur des champs que personne n'a touchés, ce qui le rend inutilisable comme
// pièce (Constitution §4.2).
import { describe, expect, it } from "vitest";

import { champsModifies, detailsAudit, diffChamps } from "./diff";

const AVANT = {
  label: "Révision complète",
  description: "Entretien complet",
  duration: 60,
  price: "85.00",
  isActive: true,
};

describe("diffChamps", () => {
  it("rend un diff vide quand rien ne change", () => {
    expect(diffChamps(AVANT, { ...AVANT })).toEqual({});
    expect(champsModifies(diffChamps(AVANT, { ...AVANT }))).toEqual([]);
  });

  it("ne retient que les champs modifiés, avec leurs deux valeurs", () => {
    const diff = diffChamps(AVANT, { ...AVANT, price: "90.00" });

    expect(diff).toEqual({ price: { before: "85.00", after: "90.00" } });
  });

  it("retient plusieurs champs d'un coup", () => {
    const diff = diffChamps(AVANT, {
      ...AVANT,
      price: "90.00",
      isActive: false,
    });

    expect(champsModifies(diff).toSorted()).toEqual(["isActive", "price"]);
  });

  it("voit le passage d'une valeur à `null`", () => {
    const diff = diffChamps(AVANT, { ...AVANT, description: null });

    expect(diff).toEqual({
      description: { before: "Entretien complet", after: null },
    });
  });

  it("ignore un champ non soumis plutôt que de le croire vidé", () => {
    // Un formulaire partiel ne doit pas effacer les colonnes qu'il n'affiche
    // pas.
    expect(diffChamps(AVANT, { price: "85.00" })).toEqual({});
  });

  it("ne confond pas `0` avec l'absence de valeur", () => {
    // Le piège du `??` : `0` est falsy, et un diff qui le traiterait comme
    // absent laisserait passer une durée remise à zéro.
    const diff = diffChamps({ duration: 0 }, { duration: 60 });

    expect(diff).toEqual({ duration: { before: 0, after: 60 } });
  });

  it("traite un champ absent d'`avant` comme `null`", () => {
    expect(diffChamps({}, { label: "Nouveau" })).toEqual({
      label: { before: null, after: "Nouveau" },
    });
  });
});

describe("detailsAudit", () => {
  it("rend le diff tel quel, prêt pour la colonne JSONB", () => {
    const diff = diffChamps(AVANT, { ...AVANT, price: "90.00" });

    expect(detailsAudit(diff)).toEqual({
      price: { before: "85.00", after: "90.00" },
    });
  });
});
