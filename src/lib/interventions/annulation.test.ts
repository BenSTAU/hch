// @vitest-environment node
//
// La fenetre H-24, isolee de la base et de l'ecran.
//
// Elle est testee ici ET dans `queries/interventions.test.ts` : ce n'est pas un
// doublon. Ce fichier eprouve la REGLE, l'autre eprouve que la transaction
// l'applique. Les deux surfaces qui l'appellent - le helper metier et le bloc
// d'annulation - doivent repondre la meme chose, et c'est le seul moyen de le
// dire sans monter un composant.
import { describe, expect, it } from "vitest";

import { annulationOuverte, FENETRE_ANNULATION_MS } from "./annulation";

const RDV = new Date("2026-08-20T08:00:00.000Z");

/// `maintenant` place a `heures` avant le rendez-vous.
function aMoins(heures: number): Date {
  return new Date(RDV.getTime() - heures * 3_600_000);
}

describe("annulationOuverte", () => {
  it("accepte a H-25", () => {
    expect(annulationOuverte(RDV, aMoins(25))).toBe(true);
  });

  it("refuse a H-23", () => {
    expect(annulationOuverte(RDV, aMoins(23))).toBe(false);
  });

  it("refuse a exactement H-24", () => {
    // L'US ecrit le nominal en `> 24 h` et le cas d'erreur en `<= 24 h` :
    // l'egalite appartient au refus. C'est la seule valeur ou les deux
    // formulations pourraient diverger, et aucune source ne laisse le choix.
    expect(annulationOuverte(RDV, aMoins(24))).toBe(false);
  });

  it("accepte une milliseconde avant la borne, et refuse une milliseconde apres", () => {
    // Le voisinage immediat de H-24, des deux cotes. Le titre disait « refuse »
    // pour une assertion qui vaut `true`, dans le fichier dont c'est tout le
    // sujet - releve par l'agent testeur.
    const justeAvant = new Date(RDV.getTime() - FENETRE_ANNULATION_MS - 1);
    const justeApres = new Date(RDV.getTime() - FENETRE_ANNULATION_MS + 1);

    expect(annulationOuverte(RDV, justeAvant)).toBe(true);
    expect(annulationOuverte(RDV, justeApres)).toBe(false);
  });

  it("refuse un rendez-vous deja passe", () => {
    // L'onglet « A venir » retient `PLANNED` sans borne de date : un rendez-vous
    // que le technicien n'a pas cloture y reste, et il ne s'annule plus en
    // ligne. Sans ce cas, l'ecart negatif passerait la comparaison a l'envers.
    expect(annulationOuverte(RDV, new Date("2026-08-25T08:00:00.000Z"))).toBe(
      false,
    );
  });
});
