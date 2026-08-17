// Coquille des trois pages légales - `US-RGPD`, écran **C13**.
//
// Les trois pages elles-mêmes sont des Server Components **asynchrones** : elles
// lisent l'identité de la société en base, et RTL ne les déroule pas (ADR-014 :
// async Server Components → E2E uniquement). Leur rendu complet et leur audit
// axe au navigateur vivent donc dans `tests/e2e/pages-legales.spec.ts`.
//
// Ce qui se teste ici est la coquille, qui est synchrone et qui porte à elle
// seule trois propriétés d'accessibilité et une décision de portage :
//
//   · les onglets JavaScript de la maquette sont devenus des liens, seule forme
//     compatible avec « aucun JS client propre à ces pages » (PLAN S4 §3.2) ;
//   · la page active est annoncée, sans quoi la barre est une rangée de liens
//     identiques pour un lecteur d'écran ;
//   · les repères de navigation sont nommés - la page en porte trois.
import { render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";

import {
  CHEMIN_ACCESSIBILITE,
  CHEMIN_MENTIONS_LEGALES,
  CHEMIN_POLITIQUE_CONFIDENTIALITE,
} from "@/components/layouts/site-navigation";

import { PageLegale, SectionLegale } from "./page-legale";

const SOMMAIRE = [
  { id: "editeur", label: "Art. 1 : éditeur" },
  { id: "cookies", label: "Art. 5 : cookies" },
] as const;

const SOCIETE = {
  nom: "LeCycleLyonnais",
  siret: "99999999900001",
  adresse: "12 rue de la Bicyclette, 69003 Lyon",
  telephone: "+33639980000",
  email: "contact@exemple.test",
};

function monter(chemin: string = CHEMIN_MENTIONS_LEGALES) {
  return render(
    <PageLegale
      titre="Mentions légales"
      chemin={chemin}
      miseAJour="11 août 2026"
      sommaire={SOMMAIRE}
      societe={SOCIETE}
    >
      <SectionLegale id="editeur" titre="Article 1 : éditeur du site">
        <p>Raison sociale, SIRET, adresse.</p>
      </SectionLegale>
      <SectionLegale id="cookies" titre="Article 5 : cookies">
        <p>Un seul cookie de session.</p>
      </SectionLegale>
    </PageLegale>,
  );
}

describe("PageLegale - navigation entre les trois pages", () => {
  it("rend les trois pages comme des liens, pas comme des onglets", () => {
    monter();

    const barre = screen.getByRole("navigation", { name: "Pages légales" });
    // La maquette C13 pilote ses onglets en `onclick` : un onglet ne se partage
    // ni ne s'indexe, et le pied de page pointe trois URL distinctes.
    expect(within(barre).getAllByRole("link")).toHaveLength(3);
    expect(within(barre).queryAllByRole("button")).toHaveLength(0);
  });

  it("pointe le triplet de PLAN S4, sans page de conditions de vente", () => {
    monter();

    const barre = screen.getByRole("navigation", { name: "Pages légales" });
    expect(
      within(barre).getByRole("link", { name: "Mentions légales" }),
    ).toHaveAttribute("href", CHEMIN_MENTIONS_LEGALES);
    expect(
      within(barre).getByRole("link", { name: "Politique de confidentialité" }),
    ).toHaveAttribute("href", CHEMIN_POLITIQUE_CONFIDENTIALITE);
    expect(
      within(barre).getByRole("link", { name: "Accessibilité" }),
    ).toHaveAttribute("href", CHEMIN_ACCESSIBILITE);

    // C13 nomme son troisième onglet « Conditions Générales de Vente ». La page
    // n'existe pas au périmètre v1, et le triplet de S4 §4.2 fait foi.
    expect(within(barre).queryByText(/Conditions/i)).not.toBeInTheDocument();
  });

  it("annonce la page courante, et elle seule", () => {
    monter(CHEMIN_ACCESSIBILITE);

    const barre = screen.getByRole("navigation", { name: "Pages légales" });
    const courants = within(barre)
      .getAllByRole("link")
      .filter((lien) => lien.getAttribute("aria-current") === "page");

    expect(courants).toHaveLength(1);
    expect(courants[0]).toHaveTextContent("Accessibilité");
  });
});

describe("PageLegale - structure", () => {
  it("porte un titre de niveau 1 unique", () => {
    monter();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Mentions légales" }),
    ).toBeInTheDocument();
  });

  it("nomme ses deux repères de navigation", () => {
    monter();

    // Trois `nav` cohabitent sur la page rendue (en-tête du layout, barre des
    // pages, sommaire) : anonymes, ils s'annoncent à l'identique (RGAA A).
    expect(
      screen.getByRole("navigation", { name: "Pages légales" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Sommaire" }),
    ).toBeInTheDocument();
  });

  it("ancre chaque entrée de sommaire sur la section du même identifiant", () => {
    monter();

    const sommaire = screen.getByRole("navigation", { name: "Sommaire" });
    for (const entree of SOMMAIRE) {
      expect(
        within(sommaire).getByRole("link", { name: entree.label }),
      ).toHaveAttribute("href", `#${entree.id}`);
      // La cible existe : un sommaire qui pointe dans le vide est pire qu'un
      // sommaire absent, il fait croire que le contenu a été survolé.
      expect(document.getElementById(entree.id)).not.toBeNull();
    }
  });

  it("affiche la date de mise à jour", () => {
    monter();

    expect(
      screen.getByText(/Dernière mise à jour : 11 août 2026/),
    ).toBeInTheDocument();
  });

  it("rappelle l'éditeur et l'hébergeur sur toutes les pages, pas seulement les mentions", () => {
    // `US-RGPD` §Critères : « **chaque page** rappelle nom entreprise, SIRET,
    // coordonnées, hébergeur ». Seules les mentions légales le portaient - écart
    // Le rappel vit dans la coquille pour que
    // les trois pages ne puissent pas diverger.
    monter(CHEMIN_ACCESSIBILITE);

    expect(screen.getByText(/LeCycleLyonnais/)).toBeInTheDocument();
    expect(screen.getByText(/SIRET 99999999900001/)).toBeInTheDocument();
    expect(screen.getByText(/Hébergeur : OVH SAS/)).toBeInTheDocument();
    // Depuis une autre page que les mentions légales, le rappel y renvoie.
    expect(
      screen.getByRole("link", { name: "Mentions légales complètes" }),
    ).toHaveAttribute("href", CHEMIN_MENTIONS_LEGALES);
  });

  it("ne se renvoie pas à lui-même depuis les mentions légales", () => {
    monter(CHEMIN_MENTIONS_LEGALES);

    expect(
      screen.queryByRole("link", { name: "Mentions légales complètes" }),
    ).not.toBeInTheDocument();
  });
});

describe("PageLegale - accessibilité", () => {
  it("ne présente aucune violation", async () => {
    const { container } = monter();

    expect(await axe(container)).toHaveNoViolations();
  });
});
