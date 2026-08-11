// Bandeau et onglets de l'espace client - C8 et C10.
//
// Le point qui vaut un test : **« A venir » et « Passees » sont deux ROUTES**,
// pas deux panneaux d'un widget. Un `Tabs` Radix basculerait le contenu sans
// produire d'URL - donc pas de page partageable, pas de retour arriere, et le
// `next=` de la redirection de connexion n'aurait plus de cible, alors que les
// deux US l'ecrivent mot pour mot dans leurs criteres d'erreur.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";

import { EnTeteEspace } from "./en-tete-espace";

const COMPTEURS = { aVenir: 2, passees: 5 };

describe("EnTeteEspace", () => {
  it("rend les deux onglets en LIENS, avec leurs compteurs", () => {
    render(
      <EnTeteEspace
        sousTitre="Sous-titre"
        actif="a-venir"
        compteurs={COMPTEURS}
      />,
    );

    expect(screen.getByRole("link", { name: "À venir (2)" })).toHaveAttribute(
      "href",
      "/mes-interventions/a-venir",
    );
    expect(screen.getByRole("link", { name: "Passées (5)" })).toHaveAttribute(
      "href",
      "/mes-interventions/passees",
    );
  });

  it("marque l'onglet courant par `aria-current`, et lui seul", () => {
    // `aria-current="page"` et non `aria-selected` : ce sont des liens de
    // navigation, pas les onglets d'un widget.
    render(
      <EnTeteEspace
        sousTitre="Sous-titre"
        actif="passees"
        compteurs={COMPTEURS}
      />,
    );

    expect(screen.getByRole("link", { name: "Passées (5)" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: "À venir (2)" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("porte un titre unique et le sous-titre de son onglet", () => {
    render(
      <EnTeteEspace
        sousTitre="Consultez l'historique de vos rendez-vous passés."
        actif="passees"
        compteurs={COMPTEURS}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Mes interventions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Consultez l'historique de vos rendez-vous passés."),
    ).toBeInTheDocument();
  });

  it("nomme son repere de navigation", () => {
    // La page porte plusieurs reperes `navigation` - celui-ci, la barre
    // laterale, et l'en-tete du site. Sans nom accessible, un lecteur d'ecran
    // les annonce a l'identique (WCAG 1.3.1, RGAA A).
    render(
      <EnTeteEspace
        sousTitre="Sous-titre"
        actif="a-venir"
        compteurs={COMPTEURS}
      />,
    );

    expect(
      screen.getByRole("navigation", { name: "Filtrer mes interventions" }),
    ).toBeInTheDocument();
  });

  it("ne porte aucun des elements inventes par les maquettes", () => {
    // C8 : cloche de notifications et roue dentee, aucune US.
    // C10 : « Exporter historique (PDF) » et les trois cartes de statistiques
    // (« Total interventions », « Total depense », « Technicien le plus
    // frequent »), qu'aucun critere d'acceptation ne demande.
    render(
      <EnTeteEspace
        sousTitre="Sous-titre"
        actif="passees"
        compteurs={COMPTEURS}
      />,
    );

    expect(screen.queryByText(/Exporter/i)).toBeNull();
    expect(screen.queryByText(/Total dépensé/i)).toBeNull();
    expect(screen.queryByText(/Technicien le plus/i)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("ne presente aucune violation d'accessibilite", async () => {
    const vue = render(
      <EnTeteEspace
        sousTitre="Sous-titre"
        actif="a-venir"
        compteurs={COMPTEURS}
      />,
    );

    await expect(axe(vue.container)).resolves.toHaveNoViolations();
  });
});
