import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { BAN_SEARCH_URL } from "@/lib/geo/ban";
import { ADRESSE_DEMO, entiteBan, reponseBan } from "@/mocks/handlers";
import { server } from "@/mocks/node";

import { AddressAutocomplete } from "./address-autocomplete";

/// Le composant attend 300 ms avant d'interroger la BAN. Les attentes passent
/// donc par `findBy*`, dont le délai par défaut (1 s) couvre le debounce sans
/// qu'on ait à piloter des minuteries factices — `user-event` et les faux
/// timers de Vitest cohabitent mal, et le test deviendrait plus fragile que ce
/// qu'il vérifie.

function poser(onSelectionner = vi.fn()) {
  const utilisateur = userEvent.setup();
  const { container } = render(
    <AddressAutocomplete onSelectionner={onSelectionner} />,
  );
  const champ = screen.getByRole("combobox", {
    name: /adresse d'intervention/i,
  });
  return { utilisateur, champ, container, onSelectionner };
}

describe("AddressAutocomplete", () => {
  it("n'interroge pas la BAN sous trois caractères", async () => {
    let appels = 0;
    server.use(
      http.get(BAN_SEARCH_URL, () => {
        appels += 1;
        return reponseBan([]);
      }),
    );

    const { utilisateur, champ } = poser();
    await utilisateur.type(champ, "12");

    // Laisser le debounce s'écouler : sans cette attente, le test passerait au
    // vert même si la requête partait juste après.
    await new Promise((resoudre) => setTimeout(resoudre, 500));
    expect(appels).toBe(0);
  });

  it("propose les adresses précises et écarte les voies", async () => {
    const { utilisateur, champ } = poser();
    await utilisateur.type(champ, "12 rue de la bicyclette");

    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent(ADRESSE_DEMO.label);
  });

  it("remonte la suggestion choisie à la souris", async () => {
    const { utilisateur, champ, onSelectionner } = poser();
    await utilisateur.type(champ, "12 rue de la bicyclette");

    const option = await screen.findByRole("option");
    await utilisateur.click(option);

    expect(onSelectionner).toHaveBeenCalledTimes(1);
    expect(onSelectionner).toHaveBeenCalledWith(
      expect.objectContaining({
        label: ADRESSE_DEMO.label,
        lon: ADRESSE_DEMO.lon,
        lat: ADRESSE_DEMO.lat,
      }),
    );
    expect(champ).toHaveValue(ADRESSE_DEMO.label);
  });

  it("se pilote entièrement au clavier", async () => {
    // RGAA : la liste doit être utilisable sans souris. `aria-activedescendant`
    // est ce qui permet au lecteur d'écran d'annoncer l'option courante sans
    // que le focus quitte le champ.
    const { utilisateur, champ, onSelectionner } = poser();
    await utilisateur.type(champ, "12 rue de la bicyclette");
    await screen.findByRole("option");

    await utilisateur.keyboard("{ArrowDown}");
    expect(champ).toHaveAttribute("aria-activedescendant");
    expect(screen.getByRole("option")).toHaveAttribute("aria-selected", "true");

    await utilisateur.keyboard("{Enter}");
    expect(onSelectionner).toHaveBeenCalledTimes(1);
  });

  it("ferme la liste sur Échap sans rien choisir", async () => {
    const { utilisateur, champ, onSelectionner } = poser();
    await utilisateur.type(champ, "12 rue de la bicyclette");
    await screen.findByRole("option");

    await utilisateur.keyboard("{Escape}");

    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(onSelectionner).not.toHaveBeenCalled();
  });

  it("annonce une indisponibilité plutôt qu'une absence de résultat", async () => {
    server.use(
      http.get(BAN_SEARCH_URL, () => new HttpResponse(null, { status: 503 })),
    );

    const { utilisateur, champ } = poser();
    await utilisateur.type(champ, "12 rue de la bicyclette");

    // Pas de repli silencieux sur une saisie libre (ADR-015) : l'utilisateur
    // doit savoir que c'est le service qui manque, pas son adresse.
    //
    // L'attente porte sur le TEXTE et non sur la région `status`, qui existe en
    // permanence dans le DOM — `findByRole("status")` résoudrait aussitôt, sur
    // un élément encore vide.
    const message = await screen.findByText(/temporairement indisponible/i);
    expect(message).toHaveAttribute("role", "status");
  });

  it("distingue l'absence de résultat de la panne", async () => {
    server.use(http.get(BAN_SEARCH_URL, () => reponseBan([])));

    const { utilisateur, champ } = poser();
    await utilisateur.type(champ, "adresse qui n'existe pas");

    expect(await screen.findByText(/aucune adresse trouvée/i)).toBeVisible();
  });

  it("invalide le choix précédent dès que la saisie reprend", async () => {
    const { utilisateur, champ, onSelectionner } = poser();
    await utilisateur.type(champ, "12 rue de la bicyclette");
    await utilisateur.click(await screen.findByRole("option"));
    expect(onSelectionner).toHaveBeenCalledTimes(1);

    // Modifier le libellé à la main après coup ne doit pas laisser l'adresse
    // choisie associée au point d'avant — c'est la faille qui rendrait la
    // saisie libre à nouveau possible.
    await utilisateur.type(champ, " bis");
    const options = await screen.findAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    expect(onSelectionner).toHaveBeenCalledTimes(1);
  });

  it("ne présente aucune violation axe, liste ouverte", async () => {
    // L'audit porte sur le container du composant qu'on vient d'ouvrir. Un
    // second `render()` produirait un composant neuf, liste fermée, sans
    // aucune option dans l'arbre — l'audit serait vert sans rien auditer de ce
    // que ce test promet : les options, `aria-activedescendant`,
    // `aria-selected`.
    const { utilisateur, champ, container } = poser();
    await utilisateur.type(champ, "12 rue de la bicyclette");
    await screen.findByRole("option");

    // Garde anti-régression : elle atteste que l'arbre soumis à axe contient
    // bien les options. Sans elle, le test redeviendrait vert en n'auditant
    // rien le jour où le container cesse de les porter — le défaut d'origine
    // ne se voyait pas autrement.
    expect(
      container.querySelectorAll('[role="option"]').length,
    ).toBeGreaterThan(0);

    expect(await axe(container)).toHaveNoViolations();
  });

  it("n'expose que des adresses précises même si la BAN en renvoie d'autres", async () => {
    server.use(
      http.get(BAN_SEARCH_URL, () =>
        reponseBan([
          entiteBan({
            label: "Rue de la Bicyclette 69003 Lyon",
            type: "street",
            lon: 4.832,
            lat: 45.7578,
          }),
          entiteBan({
            label: "Lyon",
            type: "municipality",
            lon: 4.84,
            lat: 45.75,
          }),
        ]),
      ),
    );

    const { utilisateur, champ } = poser();
    await utilisateur.type(champ, "rue de la bicyclette");

    expect(await screen.findByText(/aucune adresse trouvée/i)).toBeVisible();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });
});
