// Ligne de tournée partagée par les trois vues technicien - T-V2-05.
//
// Elle vivait dans `tournee-vue.tsx`, dont les tests couvrent déjà les six
// éléments de `US-INTERVENTIONS-LISTER-TECH-DU-JOUR` §Cas nominal à travers la
// vue. Ce fichier-ci ne les rejoue pas : il éprouve ce que l'extraction a
// **ajouté** - le paramètre `dateVisible`, et le fait que le composant se rende
// hors de tout contexte client, ce dont dépendent les deux nouvelles vues qui
// sont de purs Server Components.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";

import type { InterventionTournee } from "@/lib/db/queries/interventions";

import { LigneTournee } from "./ligne-tournee";

const LIGNE: InterventionTournee = {
  id: 1,
  status: "PLANNED",
  // 08 h 00 UTC = 10 h 00 à Paris en été. Le formatage est ancré sur le fuseau
  // d'exploitation, jamais sur celui de la machine qui rend.
  appointmentAt: "2026-08-13T08:00:00.000Z",
  durationSnapshot: 60,
  forfait: "Révision complète",
  client: { nom: "Sophie Dumas", telephone: "+33612345678" },
  adresse: {
    street: "12 rue de la République",
    zipCode: "69002",
    city: "Lyon",
  },
  point: null,
  produits: [],
};

function rendre(surcharge: Partial<InterventionTournee> = {}, options = {}) {
  return render(
    <ul>
      <LigneTournee intervention={{ ...LIGNE, ...surcharge }} {...options} />
    </ul>,
  );
}

describe("LigneTournee - la colonne horaire", () => {
  it("affiche l'heure de début et la fin THÉORIQUE par défaut", () => {
    // `durationSnapshot` et non `services.duration` : un changement de
    // catalogue ne déplace pas un rendez-vous déjà pris (Constitution §4.1).
    rendre();

    expect(screen.getByText("10:00")).toBeInTheDocument();
    expect(screen.getByText("11:00")).toBeInTheDocument();
  });

  it("remplace la fin par la DATE quand les lignes couvrent plusieurs jours", () => {
    // C'est le seul écart entre les trois vues. Sur « Historique », trié DESC
    // et paginé, l'heure seule ne situe rien. Sur les deux autres, la date est
    // déjà portée - par le titre pour la tournée du jour, par le titre de
    // journée pour « Cette semaine ».
    rendre({}, { dateVisible: true });

    expect(screen.getByText("10:00")).toBeInTheDocument();
    expect(screen.getByText(/13 août/)).toBeInTheDocument();
    expect(screen.queryByText("11:00")).not.toBeInTheDocument();
  });

  it("porte la valeur machine dans `<time>`", () => {
    // Un lecteur d'écran et un moteur d'indexation lisent la même chose que
    // l'œil, ce que « 10:00 » seul ne donne pas.
    const { container } = rendre();

    expect(container.querySelector("time")).toHaveAttribute(
      "dateTime",
      "2026-08-13T08:00:00.000Z",
    );
  });
});

describe("LigneTournee - ce qui n'est jamais garanti présent", () => {
  it("remplace un téléphone absent par une mention neutre", () => {
    // `users.phone` est NULLable depuis la 004, et le droit à l'oubli le remet
    // à NULL. L'intervention survit à l'effacement de son client
    // (Constitution §4.1) : la ligne doit se rendre, pas planter.
    rendre({ client: { nom: "Compte supprimé", telephone: null } });

    expect(screen.getByText("Téléphone non renseigné")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("compose le téléphone quand il est là", () => {
    // Le technicien est sur le terrain, souvent au téléphone.
    rendre();

    expect(screen.getByRole("link", { name: "+33612345678" })).toHaveAttribute(
      "href",
      "tel:+33612345678",
    );
  });

  it("affiche un statut inconnu tel quel plutôt que de le masquer", () => {
    // Le symptôme d'une divergence entre le CHECK SQL et la table de libellés.
    // Le masquer la rendrait invisible jusqu'au support.
    rendre({ status: "SUSPENDED" });

    expect(screen.getByText("SUSPENDED")).toBeInTheDocument();
  });
});

describe("LigneTournee - accessibilité", () => {
  it("ne présente aucune violation, avec ou sans date", async () => {
    const sansDate = rendre();
    await expect(axe(sansDate.container)).resolves.toHaveNoViolations();
    sansDate.unmount();

    const avecDate = rendre(
      { produits: [{ productId: 1, label: "Pack usure", quantity: 2 }] },
      { dateVisible: true },
    );
    await expect(axe(avecDate.container)).resolves.toHaveNoViolations();
  });
});
