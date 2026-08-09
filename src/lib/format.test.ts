// @vitest-environment node
//
// Deux fonctions pures, et un piège qui ne se voit qu'ici.
//
// `Intl.NumberFormat('fr-FR')` ne sépare PAS avec une espace ordinaire : U+00A0
// avant le symbole €, U+202F entre les milliers — et le couple dépend de la
// version d'ICU embarquée dans le runtime, qui n'est pas la même chose que la
// version de Node. Un attendu écrit caractère par caractère passe ici et casse
// sur une montée de version sans qu'aucun comportement n'ait changé.
//
// D'où la forme des assertions : `\s` couvre les deux, et un test dédié vérifie
// ce qui compte vraiment — que ce n'est jamais une espace sécable, sur laquelle
// une card étroite du responsive mobile couperait la ligne.
//
// La durée, elle, reste en minutes au-delà de l'heure. C'est une décision, pas
// un manque : `US-FORFAIT-CONSULTER` §Cas nominal écrit « la durée en minutes »,
// et c'est l'unité dont le moteur de créneaux dérive la grille.
import { describe, expect, it } from "vitest";

import { formatDuree, formatPrixEuros } from "./format";

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
    // client ». Un prix de 0 € EST un prix — c'est `null` qui n'en est pas un,
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
