// @vitest-environment node
//
// Les bornes de saisie du domaine `cycles`. Elles sont **applicatives et
// seules** : le dictionnaire ne pose aucun CHECK sur `year` ni sur `brand`, donc
// ce fichier est la seule preuve qu'elles existent.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ajouterCycleSchema,
  champsCycleSchema,
  modifierCycleSchema,
  rattacherCycleSchema,
} from "./cycles";

const VALIDE = {
  brand: "Decathlon",
  model: "Elops 900",
  type: "CLASSIC" as const,
  year: 2023,
};

/// Premier message de refus pour un champ donné.
function refus(resultat: ReturnType<typeof champsCycleSchema.safeParse>) {
  if (resultat.success) return null;
  return resultat.error.issues.map((issue) => issue.message);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("champsCycleSchema - marque", () => {
  it("accepte la saisie nominale", () => {
    const resultat = champsCycleSchema.safeParse(VALIDE);

    expect(resultat.success).toBe(true);
  });

  it("refuse une marque vide", () => {
    const resultat = champsCycleSchema.safeParse({ ...VALIDE, brand: "" });

    expect(refus(resultat)).toContain("Marque requise");
  });

  it("refuse une marque faite d'espaces", () => {
    // `trim` AVANT `min` : sans lui, trois espaces satisfont la longueur et
    // s'écrivent en base comme une marque vide.
    const resultat = champsCycleSchema.safeParse({ ...VALIDE, brand: "   " });

    expect(refus(resultat)).toContain("Marque requise");
  });
});

describe("champsCycleSchema - modele", () => {
  it("ramène la chaîne vide à null", () => {
    // Une seule représentation de l'absence : deux obligeraient chaque lecteur
    // à tester `null` ET `""`.
    const resultat = champsCycleSchema.parse({ ...VALIDE, model: "" });

    expect(resultat.model).toBeNull();
  });

  it("accepte l'absence du champ", () => {
    const sansModele = {
      brand: VALIDE.brand,
      type: VALIDE.type,
      year: VALIDE.year,
    };

    expect(champsCycleSchema.parse(sansModele).model).toBeNull();
  });
});

describe("champsCycleSchema - type", () => {
  it("accepte les trois valeurs du CHECK SQL", () => {
    for (const type of ["CLASSIC", "ELECTRIC", "CARGO"]) {
      expect(champsCycleSchema.safeParse({ ...VALIDE, type }).success).toBe(
        true,
      );
    }
  });

  it("refuse une quatrième valeur avec le libellé de la SPEC", () => {
    // Un type accepté ici et absent du CHECK ferait échouer l'écriture en base,
    // donc la saisie que ce schéma devait valider.
    const resultat = champsCycleSchema.safeParse({ ...VALIDE, type: "BMX" });

    expect(refus(resultat)).toContain("Type invalide");
  });
});

describe("champsCycleSchema - annee", () => {
  it("accepte l'absence", () => {
    expect(champsCycleSchema.parse({ ...VALIDE, year: null }).year).toBeNull();
  });

  it("refuse une année antérieure à 1900", () => {
    const resultat = champsCycleSchema.safeParse({ ...VALIDE, year: 1899 });

    expect(refus(resultat)).toContain("Année d'achat invalide");
  });

  it("accepte 1900 exactement", () => {
    expect(champsCycleSchema.safeParse({ ...VALIDE, year: 1900 }).success).toBe(
      true,
    );
  });

  it("refuse une année future", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T10:00:00.000Z"));

    expect(
      refus(champsCycleSchema.safeParse({ ...VALIDE, year: 2027 })),
    ).toContain("Année d'achat invalide");
    expect(champsCycleSchema.safeParse({ ...VALIDE, year: 2026 }).success).toBe(
      true,
    );
  });

  it("lit l'année courante AU PARSE et non au chargement du module", () => {
    // La borne est dans le corps du `refine`. Si elle était figée à l'import,
    // ce test échouerait : le module a été chargé avant que l'horloge ne
    // bascule, et 2027 resterait refusée.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-01T00:00:00.000Z"));

    expect(champsCycleSchema.safeParse({ ...VALIDE, year: 2027 }).success).toBe(
      true,
    );
  });

  it("refuse une année décimale", () => {
    expect(
      champsCycleSchema.safeParse({ ...VALIDE, year: 2023.5 }).success,
    ).toBe(false);
  });

  it("refuse NaN, ce que produit une saisie non numérique convertie", () => {
    // L'écran envoie `Number(saisie)` : sans cette garde, `NaN` traverserait
    // jusqu'à Prisma.
    expect(
      champsCycleSchema.safeParse({ ...VALIDE, year: Number.NaN }).success,
    ).toBe(false);
  });
});

describe("modifierCycleSchema", () => {
  it("exige un identifiant de cycle entier et positif", () => {
    expect(
      modifierCycleSchema.safeParse({ ...VALIDE, cycleId: 0 }).success,
    ).toBe(false);
    expect(
      modifierCycleSchema.safeParse({ ...VALIDE, cycleId: 12 }).success,
    ).toBe(true);
  });

  it("ne transporte AUCUN propriétaire", () => {
    // Le propriétaire vient de la session. S'il pouvait entrer par la charge
    // utile, modifier le vélo d'autrui serait une question d'UUID.
    const parsed = modifierCycleSchema.parse({
      ...VALIDE,
      cycleId: 12,
      userId: "3f1e0a5c-0b2d-4c6e-9a11-2b3c4d5e6f70",
    });

    expect(parsed).not.toHaveProperty("userId");
  });
});

describe("ajouterCycleSchema", () => {
  it("ne transporte ni identifiant ni propriétaire", () => {
    const parsed = ajouterCycleSchema.parse({
      ...VALIDE,
      cycleId: 12,
      userId: "3f1e0a5c-0b2d-4c6e-9a11-2b3c4d5e6f70",
    });

    expect(parsed).not.toHaveProperty("cycleId");
    expect(parsed).not.toHaveProperty("userId");
  });
});

describe("rattacherCycleSchema", () => {
  it("accepte un vélo", () => {
    expect(
      rattacherCycleSchema.safeParse({ interventionId: 3, cycleId: 12 })
        .success,
    ).toBe(true);
  });

  it("accepte null, qui EST le détachement", () => {
    // Sans lui, une erreur de désignation serait définitive, ce qui
    // contredirait « rattachement facultatif ».
    expect(
      rattacherCycleSchema.safeParse({ interventionId: 3, cycleId: null })
        .success,
    ).toBe(true);
  });

  it("refuse l'absence du champ, qui serait un détachement implicite", () => {
    expect(rattacherCycleSchema.safeParse({ interventionId: 3 }).success).toBe(
      false,
    );
  });
});
