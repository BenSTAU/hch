// @vitest-environment node
//
// Lecture publique du catalogue. Ce module porte **trois** règles que rien
// d'autre ne porte, et chacune est une divergence assumée avec une autre vue de
// la même table :
//
//   · `is_active = false` est MASQUÉ ici, alors que la vue admin le grise ;
//   · le prix sort en chaîne à deux décimales, jamais en `Decimal` ni en
//     `number` — l'un ne se sérialise pas, l'autre perd les centimes ;
//   · l'ordre est le prix croissant, pas l'ordre d'insertion.
//
// Les trois sont invisibles à la relecture de la vue, qui reçoit un tableau déjà
// filtré, déjà trié et déjà converti.
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db/client", () => ({ db: { service: { findMany } } }));

const { listForfaitsPublics } = await import("./forfaits");

const REVISION = {
  id: 1,
  label: "Révision complète",
  description: "Réglage des patins et disques, indexation des dérailleurs.",
  duration: 60,
  price: new Prisma.Decimal("85.00"),
};

const DIAGNOSTIC = {
  id: 2,
  label: "Diagnostic express",
  description: "Contrôle rapide de l'état général du vélo.",
  duration: 20,
  price: new Prisma.Decimal("25.00"),
};

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
});

describe("listForfaitsPublics", () => {
  it("ne demande que les forfaits actifs", async () => {
    // Constitution §5.1 côté public, `US-FORFAIT-CONSULTER` §Cas nominal :
    // « les forfaits `is_active = false` n'apparaissent pas ». Le filtre est
    // vérifié sur la REQUÊTE et non sur le résultat : un filtre posé dans la vue
    // laisserait la prochaine surface qui lit ce catalogue hériter du mauvais
    // défaut.
    await listForfaitsPublics();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it("trie par prix croissant, puis par identifiant", async () => {
    await listForfaitsPublics();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ price: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("ne sélectionne aucune colonne au-delà du DTO public", async () => {
    await listForfaitsPublics();

    const [argument] = findMany.mock.calls[0] as [{ select: object }];
    expect(Object.keys(argument.select).toSorted()).toEqual([
      "description",
      "duration",
      "id",
      "label",
      "price",
    ]);
  });

  it("rend le prix en chaîne à deux décimales", async () => {
    // Prisma normalise `85.00` en `85` sur `toString()`. Le laisser passer
    // ferait afficher « 85 € » à un catalogue dont la colonne est un
    // DECIMAL(10,2), et rendrait le formatage dépendant de la valeur.
    findMany.mockResolvedValue([REVISION]);

    const [forfait] = await listForfaitsPublics();

    expect(forfait?.price).toBe("85.00");
    expect(typeof forfait?.price).toBe("string");
  });

  it("ne laisse fuir aucun Decimal vers l'appelant", async () => {
    // Un `Decimal` de decimal.js rendu tel quel dans un composant traverse la
    // frontière serveur/client comme un objet non sérialisable.
    findMany.mockResolvedValue([REVISION, DIAGNOSTIC]);

    const forfaits = await listForfaitsPublics();

    for (const forfait of forfaits) {
      expect(forfait.price).not.toBeInstanceOf(Prisma.Decimal);
    }
  });

  it("préserve libellé, description et durée en minutes", async () => {
    findMany.mockResolvedValue([DIAGNOSTIC]);

    await expect(listForfaitsPublics()).resolves.toEqual([
      {
        id: 2,
        label: "Diagnostic express",
        description: "Contrôle rapide de l'état général du vélo.",
        duration: 20,
        price: "25.00",
      },
    ]);
  });

  it("accepte un forfait sans description", async () => {
    // `services.description` est NULLable (dictionnaire §services champ 3). La
    // vue doit pouvoir s'en passer : c'est le PRIX qui conditionne l'affichage
    // d'un forfait, pas son texte.
    findMany.mockResolvedValue([{ ...DIAGNOSTIC, description: null }]);

    const [forfait] = await listForfaitsPublics();

    expect(forfait?.description).toBeNull();
  });

  it("rend un tableau vide quand aucun forfait n'est actif", async () => {
    // Le cas limite de `US-FORFAIT-CONSULTER` : c'est la VUE qui doit alors
    // afficher un message explicite. La requête, elle, ne doit ni lever ni
    // inventer un catalogue de repli.
    await expect(listForfaitsPublics()).resolves.toEqual([]);
  });
});
