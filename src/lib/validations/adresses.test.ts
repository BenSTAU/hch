import { describe, expect, it } from "vitest";

import {
  adresseSelectionneeSchema,
  ajouterAdresseSchema,
  supprimerAdresseSchema,
} from "./adresses";

const ADRESSE_VALIDE = {
  label: "12 Rue de la Bicyclette 69003 Lyon",
  street: "12 Rue de la Bicyclette",
  postcode: "69003",
  city: "Lyon",
  citycode: "69383",
  lon: 4.832,
  lat: 45.7578,
};

describe("adresseSelectionneeSchema", () => {
  it("accepte une adresse BAN complète", () => {
    expect(adresseSelectionneeSchema.safeParse(ADRESSE_VALIDE).success).toBe(
      true,
    );
  });

  it("accepte les codes communes corses, qui ne sont pas numériques", () => {
    // `2A004` et `2B033` existent. Une regex `\d{5}` sur le code INSEE
    // rejetterait deux départements entiers — c'est le genre de règle qu'on
    // n'écrit juste qu'une fois qu'on a vu le cas.
    for (const citycode of ["2A004", "2B033"]) {
      const resultat = adresseSelectionneeSchema.safeParse({
        ...ADRESSE_VALIDE,
        citycode,
      });
      expect(resultat.success, citycode).toBe(true);
    }
  });

  it("refuse un code postal qui n'a pas cinq chiffres", () => {
    for (const postcode of ["6900", "690033", "69O03", ""]) {
      const resultat = adresseSelectionneeSchema.safeParse({
        ...ADRESSE_VALIDE,
        postcode,
      });
      expect(resultat.success, postcode).toBe(false);
    }
  });

  it("refuse des coordonnées hors des bornes WGS84", () => {
    expect(
      adresseSelectionneeSchema.safeParse({ ...ADRESSE_VALIDE, lon: 181 })
        .success,
    ).toBe(false);
    expect(
      adresseSelectionneeSchema.safeParse({ ...ADRESSE_VALIDE, lat: -91 })
        .success,
    ).toBe(false);
  });

  it("accepte des coordonnées valides mais fausses — ce n'est pas son rôle de trancher", () => {
    // Un point au milieu de l'Atlantique passe la validation de forme. C'est
    // volontaire : la véracité se décide au re-géocodage serveur, pas ici.
    const resultat = adresseSelectionneeSchema.safeParse({
      ...ADRESSE_VALIDE,
      lon: -30,
      lat: 0,
    });
    expect(resultat.success).toBe(true);
  });
});

describe("ajouterAdresseSchema", () => {
  it("rend un mémo vide indistinct d'un mémo absent", () => {
    // Sans cette normalisation, un champ laissé vide écrirait la chaîne vide en
    // base, et la liste afficherait un libellé invisible au lieu de retomber
    // sur la rue.
    const resultat = ajouterAdresseSchema.safeParse({
      ...ADRESSE_VALIDE,
      memo: "   ",
    });

    expect(resultat.success).toBe(true);
    if (!resultat.success) return;
    expect(resultat.data.memo).toBeUndefined();
  });
});

describe("supprimerAdresseSchema", () => {
  it("refuse un identifiant qui n'est pas un entier positif", () => {
    for (const adresseId of [0, -1, 1.5]) {
      expect(
        supprimerAdresseSchema.safeParse({ adresseId }).success,
        String(adresseId),
      ).toBe(false);
    }
  });
});
