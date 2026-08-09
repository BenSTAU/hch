// Landing publique — écran C1, `US-FORFAIT-CONSULTER`.
//
// Deux familles d'oracles cohabitent ici, et la seconde compte autant que la
// première :
//
//   · le catalogue s'affiche, se vide proprement, et ne propose rien à réserver
//     quand il n'a rien à vendre ;
//   · **six formulations de la maquette ne doivent PAS revenir**. Aucune n'était
//     listée en [[maquettage]] §Notes portage, et une divergence non testée
//     revient au premier copier-coller depuis `code.html`. Le paiement en ligne
//     de l'étape 3 contredit un axiome de la Constitution — c'est le genre
//     d'erreur qui se défend mal en soutenance.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";

import { LandingView } from "./landing-view";

/// La section des forfaits porte des `h3`, mais ce n'est pas la seule : les
/// étapes et les engagements en portent sept autres. Les oracles de catalogue
/// doivent donc regarder DANS `#forfaits`, sinon ils décrivent la page entière
/// et cassent au premier bloc éditorial ajouté.
function dansLesForfaits(container: HTMLElement) {
  const section = container.querySelector("#forfaits");
  if (!section) throw new Error("section #forfaits absente");
  return within(section as HTMLElement);
}

const FORFAITS = [
  {
    id: 2,
    label: "Diagnostic express",
    description: "Contrôle rapide de l'état général du vélo.",
    duration: 20,
    price: "25.00",
  },
  {
    id: 3,
    label: "Changement pneus",
    description: "Dépose et pose des pneus et chambres à air.",
    duration: 30,
    price: "39.00",
  },
  {
    id: 1,
    label: "Révision complète",
    description: "Réglage des patins et disques.",
    duration: 60,
    price: "85.00",
  },
];

describe("LandingView — catalogue", () => {
  it("affiche chaque forfait avec son nom, sa durée et son prix", () => {
    render(<LandingView forfaits={FORFAITS} />);

    for (const forfait of FORFAITS) {
      expect(
        screen.getByRole("heading", { name: forfait.label }),
      ).toBeInTheDocument();
    }

    expect(screen.getByText(/25,00\s€/u)).toBeInTheDocument();
    expect(screen.getByText(/39,00\s€/u)).toBeInTheDocument();
    expect(screen.getByText(/85,00\s€/u)).toBeInTheDocument();

    expect(screen.getByText(/20\smin/u)).toBeInTheDocument();
    expect(screen.getByText(/30\smin/u)).toBeInTheDocument();
    expect(screen.getByText(/60\smin/u)).toBeInTheDocument();
  });

  it("respecte l'ordre reçu de la couche d'accès", () => {
    // Le tri est une décision de requête (prix croissant), pas de vue : la vue
    // qui retrierait ferait diverger l'affichage du contrat testé côté requête.
    const { container } = render(<LandingView forfaits={FORFAITS} />);

    const titres = dansLesForfaits(container)
      .getAllByRole("heading", { level: 3 })
      .map((titre) => titre.textContent);

    expect(titres).toEqual([
      "Diagnostic express",
      "Changement pneus",
      "Révision complète",
    ]);
  });

  it("mène au tunnel depuis chaque forfait et depuis le hero", () => {
    render(<LandingView forfaits={FORFAITS} />);

    const liens = screen
      .getAllByRole("link")
      .filter((lien) => lien.getAttribute("href") === "/reserver");

    // Trois cartes, l'appel principal du hero, et la vérification d'adresse de
    // la section Zone.
    expect(liens).toHaveLength(5);
  });
});

describe("LandingView — catalogue vide", () => {
  it("remplace la grille par un message explicite", () => {
    // `US-FORFAIT-CONSULTER` §Cas limites : « un message explicite remplace la
    // liste (pas une grille vide) ».
    const { container } = render(<LandingView forfaits={[]} />);

    expect(
      screen.getByText(/Aucun forfait n'est proposé à la réservation/i),
    ).toBeInTheDocument();
    expect(
      dansLesForfaits(container).queryByRole("heading", { level: 3 }),
    ).not.toBeInTheDocument();
    expect(
      dansLesForfaits(container).queryByRole("list"),
    ).not.toBeInTheDocument();
  });

  it("ne propose plus aucun appel à la réservation", () => {
    // « et aucun appel à l'action de réservation n'est proposé ». Lecture
    // stricte : le hero perd le sien aussi, pas seulement les cartes.
    render(<LandingView forfaits={[]} />);

    const versLeTunnel = screen
      .queryAllByRole("link")
      .filter((lien) => lien.getAttribute("href") === "/reserver");

    expect(versLeTunnel).toHaveLength(0);
  });

  it("garde la page lisible malgré tout", () => {
    // La transparence tarifaire n'est pas la seule raison d'être de l'écran :
    // le visiteur doit toujours comprendre ce qu'est le service.
    render(<LandingView forfaits={[]} />);

    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Trois étapes/i }),
    ).toBeInTheDocument();
  });
});

describe("LandingView — divergences de la maquette C1", () => {
  it("annonce le paiement sur place, et écarte explicitement le paiement en ligne", () => {
    // `code.html:295-296` : « Paiement sécurisé […] réglez en ligne ou sur place
    // de manière 100 % dématérialisée ». Constitution §2.3 n'admet QUE
    // l'encaissement sur le terrain — aucune intégration de paiement en ligne
    // n'existe et il ne doit pas en exister.
    //
    // L'oracle ne peut pas être l'absence de la chaîne « en ligne » : la page
    // l'emploie justement pour la NIER, et c'est le bon endroit pour le dire —
    // un visiteur habitué aux marketplaces suppose l'inverse par défaut.
    render(<LandingView forfaits={FORFAITS} />);

    expect(
      screen.getByRole("heading", { name: /Vous réglez sur place/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/aucun règlement en ligne/i)).toBeInTheDocument();
    expect(screen.queryByText(/dématérialisé/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/paiement sécurisé/i)).not.toBeInTheDocument();
  });

  it("ne mentionne pas le SMS", () => {
    // `code.html:424` : « Rapport complet avant/après envoyé par SMS ». Hors
    // périmètre v1 — email et in-app seulement.
    render(<LandingView forfaits={FORFAITS} />);

    expect(screen.queryByText(/SMS/)).not.toBeInTheDocument();
  });

  it("n'affiche aucune preuve sociale inventée", () => {
    // `code.html:259` : « Rejoint par plus de 500 cyclistes lyonnais ce
    // mois-ci », avec trois avatars. Le produit n'a aucun client.
    render(<LandingView forfaits={FORFAITS} />);

    expect(screen.queryByText(/500/)).not.toBeInTheDocument();
    expect(screen.queryByText(/cyclistes/i)).not.toBeInTheDocument();
  });

  it("dit « technicien », jamais « mécanicien »", () => {
    // Vocabulaire SPEC — [[maquettage]] §Notes portage, bloc Global.
    render(<LandingView forfaits={FORFAITS} />);

    expect(screen.queryByText(/mécanicien/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/technicien/i).length).toBeGreaterThan(0);
  });

  it("ne nomme aucune commune hors de la zone seedée", () => {
    // `code.html:448-461` cite Villeurbanne, Bron et Vénissieux. Le seed ne
    // porte qu'UNE zone, une enveloppe qui déborde sur Caluire, Villeurbanne et
    // Sainte-Foy (`prisma/seed.ts:82`) — ni Bron ni Vénissieux. Annoncer une
    // commune qu'on ne dessert pas est la pire promesse d'une page d'accueil :
    // elle se découvre au refus, en fin de tunnel.
    render(<LandingView forfaits={FORFAITS} />);

    expect(screen.queryByText(/Bron/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Vénissieux/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Villeurbanne/)).not.toBeInTheDocument();
  });

  it("répond à la question du visiteur plutôt qu'à celle de l'architecte", () => {
    // Reprise sur retour de Benjamin : la section Zone décrivait le mécanisme de
    // sectorisation — « zone dessinée, pas déduite », « vérifiée à l'adresse
    // près ». Le visiteur ne se demande pas comment c'est implémenté, il se
    // demande si on vient chez lui, et il veut pouvoir le vérifier tout de
    // suite.
    render(<LandingView forfaits={FORFAITS} />);

    expect(
      screen.getByRole("heading", { name: /vient chez vous/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Vérifier mon adresse/i }),
    ).toHaveAttribute("href", "/reserver");
    expect(screen.queryByText(/pas déduite/i)).not.toBeInTheDocument();
  });

  it("ne propose ni formulaire de contact ni devis sur demande", () => {
    // Constitution §1.2 : un rappel humain intermédiaire n'est pas HCH. La page
    // le dit explicitement (« sans rappel intermédiaire »), donc l'oracle porte
    // sur l'absence de MOYEN d'en déclencher un, pas sur l'absence du mot.
    render(<LandingView forfaits={FORFAITS} />);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByText(/devis sur demande/i)).not.toBeInTheDocument();
    expect(screen.getByText(/sans rappel intermédiaire/i)).toBeInTheDocument();
  });
});

describe("LandingView — déconnexion", () => {
  it("confirme la déconnexion quand elle vient d'avoir lieu", () => {
    // `US-COMPTE-DECONNECTER` §Cas nominal. `role="status"` et non `alert` :
    // c'est une confirmation attendue.
    render(<LandingView forfaits={FORFAITS} deconnecte />);

    expect(screen.getByRole("status")).toHaveTextContent(
      /Vous êtes déconnecté/i,
    );
  });

  it("n'affiche rien quand ce n'est pas le cas", () => {
    render(<LandingView forfaits={FORFAITS} />);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("LandingView — structure et accessibilité", () => {
  it("expose un repère principal et un seul titre de niveau 1", () => {
    render(<LandingView forfaits={FORFAITS} />);

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("ancre les trois sections visées par la navigation", () => {
    // La nav de l'en-tête pointe `/#forfaits`, `/#fonctionnement` et `/#zone`.
    // Un lien d'ancre qui ne trouve pas sa cible est un lien mort silencieux.
    const { container } = render(<LandingView forfaits={FORFAITS} />);

    for (const ancre of ["forfaits", "fonctionnement", "zone"]) {
      expect(container.querySelector(`#${ancre}`)).not.toBeNull();
    }
  });

  it("ne présente aucune violation, catalogue plein", async () => {
    // DoD T-V3-13 : « jest-axe : zéro violation sur la landing ». RGAA niveau A
    // (SPEC §6.3.1) — l'AA reste réservée aux points d'entrée d'authentification.
    const { container } = render(<LandingView forfaits={FORFAITS} />);

    await expect(axe(container)).resolves.toHaveNoViolations();
  });

  it("ne présente aucune violation, catalogue vide", async () => {
    const { container } = render(<LandingView forfaits={[]} />);

    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
