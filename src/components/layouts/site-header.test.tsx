// En-tête **unique** du site depuis T-V3-10, qui a fusionné `AppHeader` dedans.
// Trois comportements que rien d'autre ne porte, et qui sont chacun une
// contrainte de source :
//
//   · il s'affiche pour un visiteur ANONYME, Constitution §5.1 faisant de
//     l'accueil une page ouverte à tous ;
//   · il retire l'appel à la réservation quand le catalogue est vide
//     (`US-FORFAIT-CONSULTER` §Cas limites) ;
//   · sa nav ne porte ni « Avis » ni « Contact », les deux items des maquettes
//     qui ne correspondent à aucune fonctionnalité v1 — le second contredit
//     même Constitution §1.2.
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

vi.mock("@/lib/actions/auth/logout", () => ({ logout: vi.fn() }));

const { SiteHeader } = await import("./site-header");

const CAMILLE = {
  firstname: "Camille",
  lastname: "Durand",
  roles: ["ROLE_CLIENT"],
};
/// Le même compte, avec les rôles que T-V2-05 rend décisifs.
const MARC = { firstname: "Marc", lastname: "Leroy", roles: ["ROLE_TECH"] };
const ADMIN = { firstname: "Alex", lastname: "Roy", roles: ["ROLE_ADMIN"] };

describe("SiteHeader — visiteur anonyme", () => {
  it("expose un repère d'en-tête", () => {
    // WCAG 1.3.1 (A) : `<header>` hors de tout `<main>` porte le rôle `banner`.
    render(<SiteHeader user={null} reservationDisponible />);

    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("propose la connexion sans l'imposer", () => {
    render(<SiteHeader user={null} reservationDisponible />);

    expect(screen.getByRole("link", { name: "Connexion" })).toHaveAttribute(
      "href",
      "/connexion",
    );
    expect(
      screen.queryByRole("button", { name: "Se déconnecter" }),
    ).not.toBeInTheDocument();
  });

  it("ne propose pas « Mes interventions » à un visiteur anonyme", () => {
    // L'espace est protégé : l'entrée l'enverrait sur le formulaire de
    // connexion, ce qui est une promesse tenue de travers.
    render(<SiteHeader user={null} reservationDisponible />);

    expect(
      screen.queryByRole("link", { name: "Mes interventions" }),
    ).not.toBeInTheDocument();
  });

  it("mène au tunnel de réservation", () => {
    // `/reserver` et NON `/client/reserver` : le matcher de `src/proxy.ts`
    // couvre `/client/:path*` et renverrait un visiteur anonyme vers la
    // connexion, contre Constitution §3.2 — la réservation précède
    // l'inscription.
    render(<SiteHeader user={null} reservationDisponible />);

    expect(screen.getByRole("link", { name: "Réserver" })).toHaveAttribute(
      "href",
      "/reserver",
    );
  });
});

describe("SiteHeader — session ouverte", () => {
  // ⚠️ **Oracle déplacé par T-V3-10, règle du test rouge cas 3.** Ce test
  // cherchait « Se déconnecter » directement dans l'en-tête : c'était vrai du
  // couple « nom + bouton » de T-V3-03, et `US-COMPTE-DECONNECTER` §Contexte
  // place l'action « dans le menu utilisateur (avatar / initiales dans le
  // header) ». Le bouton n'a pas disparu, il a changé de profondeur. La
  // propriété vérifiée est la même : une session ouverte se voit, et elle se
  // ferme depuis l'en-tête.
  it("nomme la personne connectée et porte sa déconnexion", async () => {
    const utilisateur = userEvent.setup();
    render(<SiteHeader user={CAMILLE} reservationDisponible />);

    expect(screen.getByText(/Camille Durand/)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Connexion" }),
    ).not.toBeInTheDocument();

    await utilisateur.click(
      screen.getByRole("button", { name: "Ouvrir le menu de Camille Durand" }),
    );

    expect(
      screen.getByRole("menuitem", { name: "Se déconnecter" }),
    ).toBeInTheDocument();
  });

  it("mène à l'espace client depuis le menu", async () => {
    const utilisateur = userEvent.setup();
    render(<SiteHeader user={CAMILLE} reservationDisponible />);

    await utilisateur.click(
      screen.getByRole("button", { name: "Ouvrir le menu de Camille Durand" }),
    );

    expect(
      screen.getByRole("menuitem", { name: "Mes interventions" }),
    ).toHaveAttribute("href", "/mes-interventions/a-venir");
  });

  it("porte « Mes interventions » dans la nav, sans ouvrir de menu", () => {
    // L'entrée double celle du menu utilisateur, et c'est voulu : le menu doit
    // être ouvert pour livrer son contenu, alors que l'espace client est la
    // destination la plus fréquente d'un client connecté.
    render(<SiteHeader user={CAMILLE} reservationDisponible />);

    expect(
      screen.getByRole("link", { name: "Mes interventions" }),
    ).toHaveAttribute("href", "/mes-interventions/a-venir");
  });

  it("porte les initiales de la personne, pas sa photo", () => {
    // `users` n'a aucune colonne d'avatar, et [[maquettage]] §Notes portage
    // tranche « initiales SD » contre la photo dessinée en C7 et C8. Aucune
    // balise `img` ne doit donc apparaître dans le déclencheur.
    render(<SiteHeader user={CAMILLE} reservationDisponible />);

    expect(screen.getByText("CD")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("n'affiche ni email ni rôle", () => {
    // Le DTO du DAL les porte ; l'en-tête n'en a pas besoin, et sur un poste
    // partagé une adresse affichée en permanence est une donnée personnelle
    // exposée sans motif.
    render(<SiteHeader user={CAMILLE} reservationDisponible />);

    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ROLE_/)).not.toBeInTheDocument();
  });
});

describe("SiteHeader - la navigation suit le rôle (T-V2-05)", () => {
  // 🔴 Le cœur du volet 1. `navigationPrincipale` prenait un booléen, donc
  // rendait l'entrée de l'espace CLIENT à toute session ouverte. Depuis que cet
  // espace répond 403 à un technicien (Constitution §3.1, clarification du
  // 2026-08-12), c'était un lien vers un refus.

  it("mène le technicien à sa tournée, jamais à l'espace client", () => {
    render(<SiteHeader user={MARC} reservationDisponible />);

    expect(screen.getByRole("link", { name: "Ma tournée" })).toHaveAttribute(
      "href",
      "/interventions/du-jour",
    );
    expect(
      screen.queryByRole("link", { name: "Mes interventions" }),
    ).not.toBeInTheDocument();
  });

  it("mène l'administrateur au back-office", () => {
    render(<SiteHeader user={ADMIN} reservationDisponible />);

    expect(
      screen.getByRole("link", { name: "Administration" }),
    ).toHaveAttribute("href", "/admin/parametres");
    expect(
      screen.queryByRole("link", { name: "Mes interventions" }),
    ).not.toBeInTheDocument();
  });

  it("retire « Réserver » au technicien et à l'administrateur", () => {
    // ⚠️ La ROUTE reste ouverte - Constitution §3.2 veut le tunnel explorable
    // sans compte, et un E2E le fige. Ce qui disparaît est l'appel à l'action
    // dans une navigation d'employé, pas l'accès.
    const tech = render(<SiteHeader user={MARC} reservationDisponible />);
    expect(
      screen.queryByRole("link", { name: "Réserver" }),
    ).not.toBeInTheDocument();
    tech.unmount();

    render(<SiteHeader user={ADMIN} reservationDisponible />);
    expect(
      screen.queryByRole("link", { name: "Réserver" }),
    ).not.toBeInTheDocument();
  });

  it("la laisse au client et au visiteur", () => {
    const client = render(<SiteHeader user={CAMILLE} reservationDisponible />);
    expect(screen.getByRole("link", { name: "Réserver" })).toBeInTheDocument();
    client.unmount();

    render(<SiteHeader user={null} reservationDisponible />);
    expect(screen.getByRole("link", { name: "Réserver" })).toBeInTheDocument();
  });

  it("fait suivre le menu utilisateur au même rôle", async () => {
    // `user-menu.tsx` pointait `CHEMIN_ESPACE_CLIENT` en dur pour tout le
    // monde. La barre et le menu sont côte à côte : deux liens voisins menant
    // à deux espaces différents est un défaut qu'on ne voit qu'en production.
    const utilisateur = userEvent.setup();
    render(<SiteHeader user={MARC} reservationDisponible />);

    await utilisateur.click(
      screen.getByRole("button", { name: "Ouvrir le menu de Marc Leroy" }),
    );

    expect(
      screen.getByRole("menuitem", { name: "Ma tournée" }),
    ).toHaveAttribute("href", "/interventions/du-jour");
    expect(
      screen.queryByRole("menuitem", { name: "Mes interventions" }),
    ).not.toBeInTheDocument();
  });

  it("porte la même entrée dans le panneau mobile", () => {
    // Les deux surfaces passent par la même fonction. Ce test est ce qui
    // rattrapera l'oubli le jour où l'une des deux cessera de le faire.
    render(<SiteHeader user={MARC} reservationDisponible />);

    expect(
      screen.getByRole("button", { name: "Ouvrir le menu" }),
    ).toBeInTheDocument();
  });

  it("n'affiche toujours ni email ni rôle", () => {
    // Le menu reçoit une destination déjà résolue, pas les rôles : ils ne
    // doivent pas se retrouver dans le document parce que la barre les connaît
    // maintenant.
    render(<SiteHeader user={MARC} reservationDisponible />);

    expect(screen.queryByText(/ROLE_/)).not.toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });
});

describe("SiteHeader — navigation", () => {
  it("porte les trois entrées retenues", () => {
    render(<SiteHeader user={null} reservationDisponible />);

    const nav = screen.getByRole("navigation", {
      name: "Navigation principale",
    });

    expect(screen.getByRole("link", { name: "Nos forfaits" })).toHaveAttribute(
      "href",
      "/#forfaits",
    );
    expect(
      screen.getByRole("link", { name: "Comment ça marche" }),
    ).toHaveAttribute("href", "/#fonctionnement");
    expect(
      screen.getByRole("link", { name: "Zone desservie" }),
    ).toHaveAttribute("href", "/#zone");
    expect(nav).toBeInTheDocument();
  });

  it("ne porte ni « Avis » ni « Contact »", () => {
    // C1 (`code.html:215`) et C13 (`code.html:136-137`) les portent tous les
    // deux. « Avis » ne correspond à aucune US v1 ; « Contact » ouvrirait le
    // rappel humain intermédiaire que Constitution §1.2 écarte.
    render(<SiteHeader user={null} reservationDisponible />);

    expect(screen.queryByText(/Avis/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Contact/i)).not.toBeInTheDocument();
  });

  it("nomme son repère de navigation", () => {
    // La page porte trois repères `navigation` — l'en-tête et les deux colonnes
    // du pied de page. Sans nom accessible, un lecteur d'écran les annonce à
    // l'identique (WCAG 1.3.1, RGAA A).
    render(<SiteHeader user={null} reservationDisponible />);

    expect(
      screen.getByRole("navigation", { name: "Navigation principale" }),
    ).toBeInTheDocument();
  });
});

describe("SiteHeader — catalogue vide", () => {
  it("retire l'appel à la réservation", () => {
    // `US-FORFAIT-CONSULTER` §Cas limites : « aucun appel à l'action de
    // réservation n'est proposé ». La règle vaut pour l'en-tête autant que pour
    // la grille — proposer de réserver ce qui n'existe pas est une impasse, où
    // qu'on clique.
    render(<SiteHeader user={null} reservationDisponible={false} />);

    expect(
      screen.queryByRole("link", { name: "Réserver" }),
    ).not.toBeInTheDocument();
  });

  it("laisse la connexion et la navigation en place", () => {
    render(<SiteHeader user={null} reservationDisponible={false} />);

    expect(screen.getByRole("link", { name: "Connexion" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Nos forfaits" }),
    ).toBeInTheDocument();
  });
});

describe("SiteHeader — menu mobile", () => {
  // Le panneau n'existe dans le DOM qu'une fois ouvert : c'est ce qui permet à
  // la nav de la barre et à celle du panneau de partager le même nom accessible
  // sans jamais coexister. Les oracles ci-dessous en dépendent — un `Sheet`
  // monté d'avance les rendrait ambigus, et ce serait le bon signal.

  it("porte un déclencheur nommé", () => {
    // C1 masque purement sa nav sous `md` (`code.html:211`) : un mobile sans
    // navigation. Le déclencheur est ce qui la rend atteignable.
    render(<SiteHeader user={null} reservationDisponible />);

    expect(
      screen.getByRole("button", { name: "Ouvrir le menu" }),
    ).toBeInTheDocument();
  });

  it("n'expose rien tant qu'il est fermé", () => {
    render(<SiteHeader user={null} reservationDisponible />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("navigation", { name: "Navigation principale" }),
    ).toHaveLength(1);
  });

  it("ouvre un dialogue nommé qui porte les mêmes entrées", async () => {
    // Radix Dialog exige un nom accessible : sans `SheetTitle`, le panneau est
    // annoncé comme un dialogue anonyme.
    const utilisateur = userEvent.setup();
    render(<SiteHeader user={null} reservationDisponible />);

    await utilisateur.click(
      screen.getByRole("button", { name: "Ouvrir le menu" }),
    );

    const panneau = within(screen.getByRole("dialog"));

    expect(screen.getByRole("dialog")).toHaveAccessibleName(/HomeCycl/);
    expect(panneau.getByRole("link", { name: "Nos forfaits" })).toHaveAttribute(
      "href",
      "/#forfaits",
    );
    expect(
      panneau.getByRole("link", { name: "Comment ça marche" }),
    ).toBeInTheDocument();
    expect(
      panneau.getByRole("link", { name: "Zone desservie" }),
    ).toBeInTheDocument();
  });

  it("nomme son bouton de fermeture en français", () => {
    // Le registry shadcn livre « Close ». C'est un nom accessible, donc ce
    // qu'annonce un lecteur d'écran sur une application entièrement en français
    // (RGAA A). Traduit dans `src/components/ui/sheet.tsx` — et ce test est ce
    // qui le rattrapera si le fichier est un jour régénéré.
    render(<SiteHeader user={null} reservationDisponible />);

    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
  });

  it("descend les actions de session dans le panneau", async () => {
    // Pattern donut : le bloc est rendu côté serveur et passé en `children`.
    // S'il était passé en props, le DTO utilisateur partirait dans la charge
    // sérialisée envoyée au navigateur.
    const utilisateur = userEvent.setup();
    render(<SiteHeader user={CAMILLE} reservationDisponible />);

    await utilisateur.click(
      screen.getByRole("button", { name: "Ouvrir le menu" }),
    );

    const panneau = within(screen.getByRole("dialog"));

    expect(panneau.getByText(/Camille Durand/)).toBeInTheDocument();
    // Le panneau mobile porte le même `UserMenu` que la barre desktop, donc son
    // déclencheur et non le bouton final : la déconnexion est à un cran de plus
    // depuis T-V3-10.
    expect(
      panneau.getByRole("button", { name: "Ouvrir le menu de Camille Durand" }),
    ).toBeInTheDocument();
  });
});

describe("SiteHeader — accessibilité", () => {
  it("ne présente aucune violation, session ouverte ou non", async () => {
    const anonyme = render(<SiteHeader user={null} reservationDisponible />);
    await expect(axe(anonyme.container)).resolves.toHaveNoViolations();
    anonyme.unmount();

    const connecte = render(
      <SiteHeader user={CAMILLE} reservationDisponible />,
    );
    await expect(axe(connecte.container)).resolves.toHaveNoViolations();
    connecte.unmount();

    // La barre d'un technicien porte une entrée de plus et un bouton de moins
    // depuis T-V2-05 : c'est une configuration distincte, pas une variante de
    // la précédente.
    const technicien = render(<SiteHeader user={MARC} reservationDisponible />);
    await expect(axe(technicien.container)).resolves.toHaveNoViolations();
  });
});
