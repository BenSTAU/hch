// @vitest-environment node
//
// Deux fonctions pures, et un piège qui ne se voit qu'ici.
//
// `Intl.NumberFormat('fr-FR')` ne sépare PAS avec une espace ordinaire : U+00A0
// avant le symbole €, U+202F entre les milliers - et le couple dépend de la
// version d'ICU embarquée dans le runtime, qui n'est pas la même chose que la
// version de Node. Un attendu écrit caractère par caractère passe ici et casse
// sur une montée de version sans qu'aucun comportement n'ait changé.
//
// D'où la forme des assertions : `\s` couvre les deux, et un test dédié vérifie
// ce qui compte vraiment - que ce n'est jamais une espace sécable, sur laquelle
// une card étroite du responsive mobile couperait la ligne.
//
// La durée, elle, reste en minutes au-delà de l'heure. C'est une décision, pas
// un manque : `US-FORFAIT-CONSULTER` §Cas nominal écrit « la durée en minutes »,
// et c'est l'unité dont le moteur de créneaux dérive la grille.
import { describe, expect, it } from "vitest";

import {
  formatDelaiRelatif,
  formatDuree,
  formatPrixEuros,
  multiplierEuros,
  sommeEuros,
} from "./format";

describe("formatPrixEuros", () => {
  it("rend un DECIMAL(10,2) en euros à la française", () => {
    expect(formatPrixEuros("85.00")).toMatch(/^85,00\s€$/u);
  });

  it("garde les centimes d'un prix qui n'en affiche pas", () => {
    // Prisma normalise le DECIMAL `39.00` en `39` : c'est le formateur qui doit
    // rendre les centimes, pas la base.
    expect(formatPrixEuros("39")).toMatch(/^39,00\s€$/u);
  });

  it("formate un prix à centimes non nuls", () => {
    expect(formatPrixEuros("12.90")).toMatch(/^12,90\s€$/u);
  });

  it("passe le millier au séparateur français", () => {
    // Aucun forfait du seed n'atteint ce montant ; un panier multi-lignes du
    // tunnel le peut, et c'est le même formateur.
    expect(formatPrixEuros("1250.50")).toMatch(/^1\s250,50\s€$/u);
  });

  it("rend zéro sans le confondre avec une absence de prix", () => {
    // Constitution §5.1 : « un forfait sans prix affiché n'existe pas côté
    // client ». Un prix de 0 € EST un prix - c'est `null` qui n'en est pas un,
    // et la colonne est NOT NULL.
    expect(formatPrixEuros("0.00")).toMatch(/^0,00\s€$/u);
  });

  it("ne sépare jamais le montant du symbole par une espace sécable", () => {
    expect(formatPrixEuros("85.00")).not.toContain(" €");
  });
});

describe("formatDuree", () => {
  it("affiche les minutes du forfait", () => {
    expect(formatDuree(20)).toMatch(/^20\smin$/u);
  });

  it("reste en minutes au-delà de l'heure", () => {
    expect(formatDuree(90)).toMatch(/^90\smin$/u);
  });

  it("ne sépare jamais le nombre de l'unité par une espace sécable", () => {
    expect(formatDuree(60)).not.toContain(" min");
  });
});

describe("multiplierEuros", () => {
  it("ne laisse pas le flottant binaire manger un centime", () => {
    // `Number("12.90") * 3` vaut 38.699999999999996. L'écart est invisible sur
    // une ligne et cesse de l'être dès qu'on additionne le panier.
    expect(multiplierEuros("12.90", 3)).toBe("38.70");
  });

  it("rend zéro pour une quantité nulle", () => {
    expect(multiplierEuros("39.90", 0)).toBe("0.00");
  });

  it("garde deux décimales sur un montant rond", () => {
    // La chaîne repart vers `formatPrixEuros`, qui attend un décimal, et vers
    // les comparaisons de tests. « 40 » et « 40.00 » ne se relisent pas pareil.
    expect(multiplierEuros("20.00", 2)).toBe("40.00");
  });
});

describe("sommeEuros", () => {
  it("additionne forfait et lignes de panier sans dérive", () => {
    expect(sommeEuros(["85.00", "38.70", "9.90"])).toBe("133.60");
  });

  it("rend zéro sur une liste vide", () => {
    // Le cas nominal du tunnel : la très grande majorité des réservations n'a
    // aucun produit.
    expect(sommeEuros([])).toBe("0.00");
  });

  it("accumule les centimes isolés sans les perdre", () => {
    expect(sommeEuros(["0.10", "0.20", "0.30"])).toBe("0.60");
  });
});

describe("formatDelaiRelatif", () => {
  // Chip « Dans X jours » des cartes de C8, divergence de portage attribuee a
  // T-V3-11. Toutes les bornes sont exprimees en heures locales Europe/Paris :
  // c'est le fuseau d'exploitation, et le jour calendaire s'y calcule.
  const MIDI = new Date("2026-08-11T10:00:00.000Z");

  it("nomme le jour meme plutot que de compter zero", () => {
    expect(formatDelaiRelatif(new Date("2026-08-11T16:00:00.000Z"), MIDI)).toBe(
      "Aujourd'hui",
    );
  });

  it("nomme le lendemain plutot que d'ecrire « Dans 1 jours »", () => {
    expect(formatDelaiRelatif(new Date("2026-08-12T06:00:00.000Z"), MIDI)).toBe(
      "Demain",
    );
  });

  it("compte en jours dans la quinzaine", () => {
    expect(formatDelaiRelatif(new Date("2026-08-18T10:00:00.000Z"), MIDI)).toBe(
      "Dans 7 jours",
    );
  });

  it("bascule en semaines au-dela de la quinzaine", () => {
    // « Dans 23 jours » se compte, « Dans 3 semaines » se lit. La maquette
    // ecrit « Dans X jours/semaines » sans dire ou passe la bascule.
    expect(formatDelaiRelatif(new Date("2026-09-01T10:00:00.000Z"), MIDI)).toBe(
      "Dans 3 semaines",
    );
  });

  it("compte en jours CALENDAIRES, pas en ecart d'heures", () => {
    // C'est la propriete qui protege de la divergence d'hydratation : un
    // rendez-vous demain a 9 h est « demain », qu'on le lise a 8 h ou a 23 h.
    // Un ecart en millisecondes dirait « aujourd'hui » le soir meme, et
    // changerait de reponse entre le rendu serveur et l'hydratation.
    const tardLeSoir = new Date("2026-08-11T21:00:00.000Z");
    const demainMatin = new Date("2026-08-12T05:00:00.000Z");

    // Huit heures les separent, moins d'une journee, et c'est pourtant demain.
    expect(formatDelaiRelatif(demainMatin, tardLeSoir)).toBe("Demain");
  });

  it("ne rend RIEN sur une date passee", () => {
    // L'onglet « A venir » retient `PLANNED` sans borne de date (arbitrage du
    // 2026-08-11) : un rendez-vous non cloture y reste, et « Dans -2 jours » ne
    // veut rien dire. Aucune source ne dit quoi afficher a la place.
    expect(
      formatDelaiRelatif(new Date("2026-08-09T10:00:00.000Z"), MIDI),
    ).toBeNull();
  });
});
