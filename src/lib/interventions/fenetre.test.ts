// @vitest-environment node
//
// Lecture des paramètres d'URL des vues technicien - T-V2-05.
//
// Ce que ce module traite vient de l'URL, donc de n'importe qui. La DoD écrit
// « toute date reçue est validée et bornée » : ces tests sont l'oracle de cette
// case, et ils portent surtout sur les entrées hostiles - c'est là que le
// module a une valeur, le cas nominal étant trivial.
import { describe, expect, it } from "vitest";

import {
  FENETRE_PAR_DEFAUT,
  FENETRES_JOURS,
  lireFenetre,
  lireJourCivil,
  lirePage,
} from "./fenetre";

describe("lireFenetre", () => {
  it("reconnaît les deux valeurs que l'US écrit", () => {
    // « 7 j / 30 j », `US-INTERVENTIONS-LISTER-TECH-A-VENIR` §Récit.
    expect(lireFenetre("7")).toBe(7);
    expect(lireFenetre("30")).toBe(30);
    expect(FENETRES_JOURS).toEqual([7, 30]);
  });

  it("retombe sur 7 devant n'importe quoi d'autre", () => {
    // ⚠️ C'est tout l'intérêt d'une énumération plutôt que d'une date libre :
    // il n'y a **rien à borner**. Une valeur absurde ne produit pas une fenêtre
    // absurde, elle produit la fenêtre par défaut.
    for (const hostile of [
      undefined,
      "",
      "0",
      "-7",
      "8",
      "365",
      "1e9",
      "7.5",
      "sept",
      "7; DROP TABLE interventions",
      "Infinity",
      "NaN",
    ]) {
      expect(lireFenetre(hostile)).toBe(FENETRE_PAR_DEFAUT);
    }
  });

  it("refuse une valeur qui vaut 7 après coercition mais ne l'est pas", () => {
    // `Number(" 7 ")` vaut 7, et une comparaison laxiste laisserait passer des
    // formes que l'application ne produit jamais. La fonction compare le nombre
    // aux deux valeurs autorisées, pas la chaîne.
    expect(lireFenetre(" 7 ")).toBe(7);
    expect(lireFenetre("07")).toBe(7);
    // En revanche rien n'ouvre une troisième fenêtre.
    expect(lireFenetre("14")).toBe(FENETRE_PAR_DEFAUT);
  });
});

describe("lireJourCivil", () => {
  it('lit ce que rend un `<input type="date">`', () => {
    expect(lireJourCivil("2026-08-13")).toEqual({
      annee: 2026,
      mois: 8,
      jour: 13,
    });
  });

  it("rend une date CIVILE, jamais un instant", () => {
    // 🐛 Le parseur qu'il remplace construisait `new Date(valeur + "T00:00:00Z")`,
    // donc minuit UTC : c'est le bug du filtre de C10 versé dans
    // [[points-ouverts-hch]]. L'ancrage dans `Europe/Paris` appartient à la
    // couche d'accès, qui le fait par `instantUtc`. Rien ici ne porte d'heure.
    const jour = lireJourCivil("2026-08-13");

    expect(jour).not.toBeInstanceOf(Date);
    expect(Object.keys(jour ?? {}).sort()).toEqual(["annee", "jour", "mois"]);
  });

  it("refuse un jour qui n'existe pas", () => {
    // ⚠️ `2026-02-31` passe la regex de format, et `Date.UTC` le roulerait
    // silencieusement au 3 mars : le filtre porterait sur une date que personne
    // n'a saisie. La vérification est un aller-retour, pas une expression
    // régulière plus longue.
    expect(lireJourCivil("2026-02-31")).toBeUndefined();
    expect(lireJourCivil("2026-13-01")).toBeUndefined();
    expect(lireJourCivil("2026-00-10")).toBeUndefined();
    expect(lireJourCivil("2026-04-31")).toBeUndefined();
  });

  it("accepte le 29 février d'une année bissextile", () => {
    expect(lireJourCivil("2028-02-29")).toEqual({
      annee: 2028,
      mois: 2,
      jour: 29,
    });
    expect(lireJourCivil("2026-02-29")).toBeUndefined();
  });

  it("refuse une année que `Date.UTC` remapperait en silence", () => {
    // ⚠️ **Ajout de l'agent testeur.** `Date.UTC(26, 7, 13)` ne rend pas l'an 26
    // mais **1926** : la spécification remappe les années 0 à 99 sur 1900+n.
    // Le contrôle du module est un aller-retour, donc il attrape le cas - mais
    // rien ne le figeait, et un contrôle réécrit en « regex plus longue »
    // (exactement la tentation que le commentaire du module écarte pour le
    // 31 février) laisserait passer ces quatre formes en filtrant sur une année
    // que personne n'a saisie.
    for (const remappee of [
      "0026-08-13",
      "0099-12-31",
      "0000-01-01",
      "0001-01-01",
    ]) {
      expect(lireJourCivil(remappee)).toBeUndefined();
    }

    // Le contrôle positif : quatre chiffres significatifs passent.
    expect(lireJourCivil("0100-01-01")).toEqual({
      annee: 100,
      mois: 1,
      jour: 1,
    });
  });

  it("ignore tout ce qui n'a pas la forme attendue", () => {
    for (const hostile of [
      undefined,
      "",
      "13/08/2026",
      "2026-8-13",
      "2026-08-13T10:00:00Z",
      "aujourd'hui",
      "2026-08-13' OR 1=1--",
      "0000-00-00",
    ]) {
      expect(lireJourCivil(hostile)).toBeUndefined();
    }
  });
});

describe("lirePage", () => {
  it("lit un numéro de page ordinaire", () => {
    expect(lirePage("3")).toBe(3);
  });

  it("plancher à 1, et tronque", () => {
    // Les quatre formes que l'agent testeur a relevées sur C10 : le négatif, le
    // fractionnaire qui produisait un `skip` que Prisma refuse, et les deux que
    // `Math.max` propagerait telles quelles.
    expect(lirePage(undefined)).toBe(1);
    expect(lirePage("")).toBe(1);
    expect(lirePage("0")).toBe(1);
    expect(lirePage("-4")).toBe(1);
    expect(lirePage("2.3")).toBe(2);
    expect(lirePage("NaN")).toBe(1);
    expect(lirePage("Infinity")).toBe(1);
    expect(lirePage("page")).toBe(1);
  });

  it("rend toujours un entier", () => {
    for (const valeur of ["2.3", "9.99", "1e2"]) {
      expect(Number.isInteger(lirePage(valeur))).toBe(true);
    }
  });
});

describe("ce que `searchParams` rend vraiment, et que la signature ne dit pas", () => {
  // ⚠️ **Ajout de l'agent testeur.** Les deux pages typent leurs paramètres
  // `{ jours?: string }` et `{ du?: string; au?: string; page?: string }`. Next
  // rend un **`string[]`** dès qu'un paramètre est répété dans l'URL - `?jours=7
  // &jours=30` -, forme que le type déclaré exclut et que le compilateur ne
  // vérifiera jamais : elle vient du réseau, pas d'un appelant TypeScript.
  //
  // Ce n'est pas de la spéculation sur une API : c'est le contrat documenté de
  // `searchParams`, et c'est trivialement forgeable dans une barre d'adresse.
  // Le module promet « rien ici ne doit lever » - ces tests le vérifient sur la
  // seule forme d'entrée que ses tests existants n'exercent pas.
  const repete = (valeurs: string[]): string => valeurs as unknown as string;

  it("ne lève jamais sur un paramètre répété", () => {
    expect(() => lireFenetre(repete(["7", "30"]))).not.toThrow();
    expect(() =>
      lireJourCivil(repete(["2026-08-13", "2026-08-14"])),
    ).not.toThrow();
    expect(() => lirePage(repete(["2", "3"]))).not.toThrow();
  });

  it("retombe sur les défauts plutôt que d'inventer une fenêtre", () => {
    // `Number(["7", "30"])` vaut `NaN` : deux valeurs contradictoires ne
    // produisent pas la plus permissive des deux, elles produisent le défaut.
    expect(lireFenetre(repete(["7", "30"]))).toBe(FENETRE_PAR_DEFAUT);
    expect(lireFenetre(repete(["30", "30"]))).toBe(FENETRE_PAR_DEFAUT);
    expect(lireJourCivil(repete(["2026-08-13", "2026-08-14"]))).toBeUndefined();
    expect(lirePage(repete(["2", "3"]))).toBe(1);
  });

  it("ne lève ni ne s'emballe sur une chaîne démesurée", () => {
    // Le paramètre vient de l'URL : une chaîne de cent mille caractères est un
    // envoi banal. Les deux motifs du module sont ancrés aux deux bouts et sans
    // alternance, donc linéaires - mais aucun test ne l'exerçait, et un motif
    // réécrit avec un `(\d+)*` quelconque ferait de cette ligne un déni de
    // service sur un Server Component.
    const demesure = "9".repeat(100_000);

    const debut = performance.now();
    expect(lireJourCivil(demesure)).toBeUndefined();
    expect(lireFenetre(demesure)).toBe(FENETRE_PAR_DEFAUT);
    expect(lirePage(demesure)).toBeGreaterThanOrEqual(1);
    expect(performance.now() - debut).toBeLessThan(1_000);
  });
});
