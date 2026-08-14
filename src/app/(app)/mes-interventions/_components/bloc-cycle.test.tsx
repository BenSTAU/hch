// Bloc « Vélo concerné » du panneau de détail - le rattachement, périmètre
// nouveau de T-V3-16.
//
// Ce que ce fichier vérifie, et qui n'est prouvé nulle part ailleurs :
//
//   · **ce que l'écran ENVOIE** - deux identifiants, jamais un propriétaire ;
//   · **la frontière `PLANNED` côté écran** - le sélecteur ne s'affiche pas là
//     où l'action refuserait, sans quoi l'interface proposerait un geste voué
//     au refus ;
//   · **le détachement** est une option du sélecteur, pas un geste caché ;
//   · **l'état vide** renvoie vers C11 plutôt que d'afficher une liste nue.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

const rattacherCycle = vi.fn();
vi.mock("@/lib/actions/cycles/rattacher-cycle", () => ({
  rattacherCycle: (args: unknown) => rattacherCycle(args),
}));

const { BlocCycle } = await import("./bloc-cycle");

const VELOS = [
  {
    id: 12,
    brand: "Decathlon",
    model: "Elops 900",
    type: "CLASSIC",
    year: 2023,
  },
  { id: 7, brand: "Moustache", model: null, type: "ELECTRIC", year: null },
];

const RATTACHE = {
  id: 12,
  brand: "Decathlon",
  model: "Elops 900",
  type: "CLASSIC",
};

beforeEach(() => {
  vi.clearAllMocks();
  rattacherCycle.mockResolvedValue({ data: { ok: true } });
});

describe("BlocCycle - intervention modifiable", () => {
  it("envoie l'identifiant du vélo et celui de l'intervention, rien d'autre", async () => {
    render(
      <BlocCycle
        interventionId={3}
        cycle={null}
        cycles={VELOS}
        modifiable={true}
      />,
    );

    await userEvent.click(screen.getByRole("radio", { name: /Moustache/ }));

    // Aucun `clientId` : le propriétaire vient de la session, côté serveur.
    expect(rattacherCycle).toHaveBeenCalledWith({
      interventionId: 3,
      cycleId: 7,
    });
  });

  it("propose le détachement comme une option du sélecteur", async () => {
    render(
      <BlocCycle
        interventionId={3}
        cycle={RATTACHE}
        cycles={VELOS}
        modifiable={true}
      />,
    );

    await userEvent.click(screen.getByRole("radio", { name: "Aucun vélo" }));

    expect(rattacherCycle).toHaveBeenCalledWith({
      interventionId: 3,
      cycleId: null,
    });
  });

  it("coche le vélo déjà rattaché, d'après le serveur et non un état local", async () => {
    render(
      <BlocCycle
        interventionId={3}
        cycle={RATTACHE}
        cycles={VELOS}
        modifiable={true}
      />,
    );

    expect(screen.getByRole("radio", { checked: true })).toHaveAccessibleName(
      /Decathlon Elops 900/,
    );
  });

  it("coche « Aucun vélo » quand la colonne est NULL", () => {
    // L'état par défaut de toute intervention venue du tunnel. Une sentinelle
    // et non la chaîne vide : Radix lit `""` comme « rien de coché », et le
    // bouton ne pourrait jamais s'afficher retenu.
    render(
      <BlocCycle
        interventionId={3}
        cycle={null}
        cycles={VELOS}
        modifiable={true}
      />,
    );

    expect(screen.getByRole("radio", { checked: true })).toHaveAccessibleName(
      "Aucun vélo",
    );
  });

  it("affiche le refus du serveur sans le traduire", async () => {
    rattacherCycle.mockResolvedValue({
      data: { ok: false, message: "Intervention introuvable." },
    });

    render(
      <BlocCycle
        interventionId={3}
        cycle={null}
        cycles={VELOS}
        modifiable={true}
      />,
    );

    await userEvent.click(screen.getByRole("radio", { name: /Moustache/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Intervention introuvable.",
    );
  });

  it("renvoie vers « Mes vélos » quand le client n'en a aucun", async () => {
    render(
      <BlocCycle
        interventionId={3}
        cycle={null}
        cycles={[]}
        modifiable={true}
      />,
    );

    // Aucun sélecteur : il n'y aurait qu'une option, « Aucun vélo », qui est
    // déjà l'état courant.
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Ajouter un vélo/ }),
    ).toHaveAttribute("href", "/mon-compte/cycles");
  });

  it("ne présente aucune violation axe, sélecteur rendu", async () => {
    const vue = render(
      <BlocCycle
        interventionId={3}
        cycle={RATTACHE}
        cycles={VELOS}
        modifiable={true}
      />,
    );

    // Garde anti-régression : un audit qui ne vérifie pas qu'il a quelque chose
    // à auditer redevient vert et muet le jour où la cible change (leçon
    // PR #25, note 7).
    expect(vue.container.querySelectorAll('[role="radio"]').length).toBe(3);

    await expect(axe(vue.container)).resolves.toHaveNoViolations();
  });
});

describe("BlocCycle - intervention verrouillée", () => {
  it("rend le vélo en lecture, sans sélecteur", () => {
    // Le statut décide, pas l'onglet. Un sélecteur ici proposerait un geste que
    // les trois gardes serveur refuseraient.
    render(
      <BlocCycle
        interventionId={3}
        cycle={RATTACHE}
        cycles={[]}
        modifiable={false}
      />,
    );

    const bloc = screen.getByRole("region", { name: "Vélo concerné" });

    expect(within(bloc).getByText(/Decathlon Elops 900/)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("ne rend rien du tout quand aucun vélo n'a été désigné", () => {
    // C'est l'état de toutes les interventions venues du tunnel : « Aucun
    // vélo » sur un rendez-vous terminé n'apprendrait rien.
    const { container } = render(
      <BlocCycle
        interventionId={3}
        cycle={null}
        cycles={[]}
        modifiable={false}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
