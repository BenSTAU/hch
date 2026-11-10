// @vitest-environment node
//
// Schémas du catalogue. Deux propriétés portent au-delà de la saisie :
//
//   · le prix reste une CHAÎNE normalisée à deux décimales. S'il passait par
//     un flottant, un DECIMAL(10,2) perdrait ses centimes, et l'empreinte de
//     version bougerait sans que le prix change ;
//   · les bornes hautes sont celles des TYPES Postgres. Sans elles, une saisie
//     absurde produit une 22003 rendue en 500 au lieu du message de la SPEC.
import { describe, expect, it } from "vitest";

import { PARAM_PAGE, PARAM_SENS, PARAM_TRI } from "@/lib/routes";

import {
  ajouterForfaitSchema,
  lireTriForfaits,
  modifierForfaitSchema,
} from "./forfaits";

const VALIDE = {
  label: "Révision complète",
  description: "Entretien complet",
  duration: "60",
  price: "85",
  isActive: true,
};

describe("ajouterForfaitSchema", () => {
  it("normalise le prix à deux décimales", () => {
    const resultat = ajouterForfaitSchema.parse(VALIDE);

    expect(resultat.price).toBe("85.00");
    expect(typeof resultat.price).toBe("string");
  });

  it("accepte la virgule décimale d'un clavier français", () => {
    expect(
      ajouterForfaitSchema.parse({ ...VALIDE, price: "85,50" }).price,
    ).toBe("85.50");
  });

  it("rend la durée en nombre entier de minutes", () => {
    expect(ajouterForfaitSchema.parse(VALIDE).duration).toBe(60);
  });

  it("transforme une description vide en `null`", () => {
    // Chaîne vide et NULL décrivent le même état. Les distinguer ferait bouger
    // l'empreinte de version sans changement réel.
    expect(
      ajouterForfaitSchema.parse({ ...VALIDE, description: "   " }).description,
    ).toBeNull();
  });

  it("coupe les espaces autour du nom", () => {
    expect(
      ajouterForfaitSchema.parse({ ...VALIDE, label: "  Révision  " }).label,
    ).toBe("Révision");
  });

  for (const prix of ["0", "-5", "abc", "", "   ", "85.123", "100000000"]) {
    it(`refuse le prix ${JSON.stringify(prix)}`, () => {
      const resultat = ajouterForfaitSchema.safeParse({
        ...VALIDE,
        price: prix,
      });

      expect(resultat.success).toBe(false);
    });
  }

  for (const duree of ["0", "-5", "12.5", "abc", "", "2147483648"]) {
    it(`refuse la durée ${JSON.stringify(duree)}`, () => {
      const resultat = ajouterForfaitSchema.safeParse({
        ...VALIDE,
        duration: duree,
      });

      expect(resultat.success).toBe(false);
    });
  }

  it("refuse un nom vide ou réduit à des espaces", () => {
    expect(
      ajouterForfaitSchema.safeParse({ ...VALIDE, label: "   " }).success,
    ).toBe(false);
  });

  it("refuse un nom plus long que la colonne", () => {
    expect(
      ajouterForfaitSchema.safeParse({ ...VALIDE, label: "a".repeat(151) })
        .success,
    ).toBe(false);
  });

  it("porte les messages de la SPEC", () => {
    const prix = ajouterForfaitSchema.safeParse({ ...VALIDE, price: "0" });
    const duree = ajouterForfaitSchema.safeParse({ ...VALIDE, duration: "0" });

    expect(prix.error?.issues[0]?.message).toBe(
      "Le prix doit être un nombre positif",
    );
    expect(duree.error?.issues[0]?.message).toBe(
      "La durée doit être un entier positif en minutes",
    );
  });
});

describe("modifierForfaitSchema", () => {
  it("exige un identifiant et un jeton de version", () => {
    // Sans jeton, une soumission ne peut pas dire sur quelle version elle
    // porte : elle serait indistinguable d'un écrasement aveugle.
    expect(modifierForfaitSchema.safeParse(VALIDE).success).toBe(false);
    expect(
      modifierForfaitSchema.safeParse({ ...VALIDE, id: 1, version: "" })
        .success,
    ).toBe(false);
    expect(
      modifierForfaitSchema.safeParse({ ...VALIDE, id: 1, version: "abc" })
        .success,
    ).toBe(true);
  });
});

describe("lireTriForfaits", () => {
  it("retombe sur le tri alphabétique croissant par défaut", () => {
    expect(lireTriForfaits({})).toEqual({ tri: "label", sens: "asc", page: 1 });
  });

  it("accepte les trois colonnes triables", () => {
    for (const tri of ["label", "price", "duration"]) {
      expect(lireTriForfaits({ tri }).tri).toBe(tri);
    }
  });

  it("ignore une clé de tri inconnue plutôt que de la passer à Prisma", () => {
    // L'URL s'édite à la main : un tri non validé serait une injection de clé.
    expect(lireTriForfaits({ tri: "price; DROP TABLE services" }).tri).toBe(
      "label",
    );
  });

  it("ignore une page illisible, négative ou décimale", () => {
    for (const page of ["0", "-3", "abc", "1.5", ""]) {
      expect(lireTriForfaits({ page }).page).toBe(1);
    }
  });

  it("lit une page et un sens valides", () => {
    expect(lireTriForfaits({ page: "3", sens: "desc" })).toEqual({
      tri: "label",
      sens: "desc",
      page: 3,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Test ajouté par l'agent testeur (verify-only) sur la PR de fond de
// T-B1-01, constat F4.
// ─────────────────────────────────────────────────────────────────────────

describe("ajouterForfaitSchema, la disponibilité n'entre pas", () => {
  it("écarte un `isActive` soumis par un appelant direct", () => {
    // ⚠️ **Le chemin résiduel du constat F5, et il n'était pas couvert.**
    //
    // Retirer la case de l'écran ne retire pas le champ de l'endpoint : une
    // Server Action exportée est un POST public (ADR-006 v2), et le schéma est
    // la seule barrière sur ce chemin. `z.object()` dépouille les clés
    // inconnues, donc `isActive: false` ne traverse pas - mais un `.passthrough()`
    // ou un retour du champ dans `champsSaisis` le ferait, et aucun test
    // existant ne le dirait : la constante `VALIDE` de ce fichier porte
    // `isActive: true` depuis T-B1-01 et tous les `parse` passent malgré tout.
    const resultat = ajouterForfaitSchema.parse({
      ...VALIDE,
      isActive: false,
    });

    expect(resultat).not.toHaveProperty("isActive");
  });

  it("garde `isActive` obligatoire à la MODIFICATION", () => {
    // L'autre face : `US-FORFAIT-MODIFIER` §Désactivation et réactivation en
    // fait un champ de la fiche. Le sortir des deux schémas d'un coup
    // supprimerait la désactivation sans que rien ne le signale.
    const sansDisponibilite = {
      label: VALIDE.label,
      description: VALIDE.description,
      duration: VALIDE.duration,
      price: VALIDE.price,
      id: 1,
      version: "jeton",
    };

    expect(modifierForfaitSchema.safeParse(sansDisponibilite).success).toBe(
      false,
    );
    expect(
      modifierForfaitSchema.safeParse({ ...sansDisponibilite, isActive: false })
        .success,
    ).toBe(true);
  });
});

describe("lireTriForfaits, le contrat avec les constantes d'URL", () => {
  it("lit les trois paramètres que `routes.ts` nomme", () => {
    // ⚠️ Le constat F4 déplace les noms de paramètres dans `PARAM_PAGE`,
    // `PARAM_TRI` et `PARAM_SENS` pour la CONSTRUCTION des liens, et laisse la
    // LECTURE les nommer en propriétés d'objet - deux sources pour un même
    // nom, que `src/lib/routes.ts` assume en commentaire.
    //
    // Renommer une constante produirait des liens que ce lecteur ignore en
    // silence, en retombant sur ses défauts : aucun écran ne planterait, le
    // tri cesserait simplement de répondre. Ce test ferme la boucle du côté
    // `lib`, et c'est aussi le typage qui mord - des clés calculées qui ne
    // correspondent plus à la signature font échouer `pnpm typecheck`.
    const depuisLUrl = {
      [PARAM_TRI]: "price",
      [PARAM_SENS]: "desc",
      [PARAM_PAGE]: "2",
    };

    expect(lireTriForfaits(depuisLUrl)).toEqual({
      tri: "price",
      sens: "desc",
      page: 2,
    });
  });
});
