// Écran C11 - liste, ajout et modification des vélos du client.
//
// Ce que ce fichier vérifie :
//
//   · **ce que l'écran ENVOIE** - quatre champs et, en modification, la cible.
//     Jamais un propriétaire : `cycles.id` est un SERIAL, et un propriétaire
//     venu de l'écran ferait de l'usurpation une question d'entier ;
//   · **l'année vide part en `null`, pas en `0`** - `Number("")` vaut zéro, ce
//     qui serait refusé comme « antérieure à 1900 » sur un champ facultatif ;
//   · **un refus de validation ne vide pas la saisie** qu'il demande de
//     corriger ;
//   · **l'état vide** porte le libellé de l'US et son appel à l'action.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { axe } from "jest-axe";
import type { ReactNode } from "react";

const ajouterCycle = vi.fn();
vi.mock("@/lib/actions/cycles/ajouter-cycle", () => ({
  ajouterCycle: (args: unknown) => ajouterCycle(args),
}));

const modifierCycle = vi.fn();
vi.mock("@/lib/actions/cycles/modifier-cycle", () => ({
  modifierCycle: (args: unknown) => modifierCycle(args),
}));

const toastSucces = vi.fn();
const toastErreur = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => toastSucces(message),
    error: (message: string) => toastErreur(message),
  },
}));

const { CyclesVue } = await import("./cycles-vue");

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

/// `hasMemory` : sans lui l'adaptateur GÈLE les paramètres sur leur valeur
/// initiale, et une sélection changée revient à la précédente (leçon T-V3-08).
function Enveloppe({
  children,
  searchParams = "",
}: {
  children: ReactNode;
  searchParams?: string;
}) {
  return (
    <NuqsTestingAdapter searchParams={searchParams} hasMemory>
      {children}
    </NuqsTestingAdapter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  ajouterCycle.mockResolvedValue({
    data: {
      ok: true,
      cycle: {
        id: 13,
        brand: "Trek",
        model: null,
        type: "CLASSIC",
        year: null,
      },
    },
  });
  modifierCycle.mockResolvedValue({
    data: { ok: true, cycle: { ...VELOS[0] } },
  });
});

describe("CyclesVue - liste", () => {
  it("rend marque, modèle, année et type de chaque vélo", () => {
    render(
      <Enveloppe>
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );

    const premier = screen.getByRole("heading", {
      name: "Decathlon Elops 900",
    }).parentElement?.parentElement;

    expect(premier).not.toBeNull();
    expect(
      within(premier as HTMLElement).getByText("Année d'achat : 2023"),
    ).toBeInTheDocument();
    expect(
      within(premier as HTMLElement).getByText("Classique"),
    ).toBeInTheDocument();
  });

  it("dit l'absence d'année plutôt que de masquer la ligne", () => {
    // Le champ est facultatif : une carte sans ligne laisserait croire à une
    // donnée perdue.
    render(
      <Enveloppe>
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );

    expect(
      screen.getByText("Année d'achat non renseignée"),
    ).toBeInTheDocument();
  });

  it("conserve l'ordre reçu du serveur, sans le retrier", () => {
    // Le tri est `id DESC` côté base (B1). Un tri côté écran serait une seconde
    // vérité, et c'est celle qui décide de l'affichage qui gagnerait.
    render(
      <Enveloppe>
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );

    const titres = screen
      .getAllByRole("heading", { level: 3 })
      .map((titre) => titre.textContent);

    expect(titres).toEqual(["Decathlon Elops 900", "Moustache"]);
  });
});

describe("CyclesVue - état vide", () => {
  it("porte le libellé de l'US et son appel à l'action", async () => {
    render(
      <Enveloppe>
        <CyclesVue cycles={[]} />
      </Enveloppe>,
    );

    expect(
      screen.getByText("Vous n'avez pas encore ajouté de cycle"),
    ).toBeInTheDocument();

    // Le CTA ouvre le formulaire : l'ajout n'a pas de route à lui, il vit sur
    // cet écran (`US-CYCLE-AJOUTER` §Cas nominal).
    await userEvent.click(
      screen.getByRole("button", { name: "Ajouter un cycle" }),
    );

    expect(
      screen.getByRole("heading", { name: "Nouveau vélo" }),
    ).toBeInTheDocument();
  });
});

describe("CyclesVue - ajout", () => {
  async function ouvrirFormulaire() {
    await userEvent.click(
      screen.getByRole("button", { name: "Ajouter un vélo" }),
    );
  }

  it("envoie les quatre champs, sans propriétaire ni identifiant", async () => {
    render(
      <Enveloppe>
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );
    await ouvrirFormulaire();

    await userEvent.type(screen.getByLabelText(/Marque/), "Trek");
    await userEvent.type(screen.getByLabelText("Modèle"), "FX 2");
    await userEvent.click(screen.getByRole("radio", { name: "Cargo" }));
    await userEvent.type(screen.getByLabelText("Année d'achat"), "2024");
    await userEvent.click(screen.getByRole("button", { name: "Ajouter" }));

    expect(ajouterCycle).toHaveBeenCalledWith({
      brand: "Trek",
      model: "FX 2",
      type: "CARGO",
      year: 2024,
    });
  });

  it("envoie null et non zéro quand l'année n'est pas saisie", async () => {
    // `Number("")` vaut 0, refusé comme antérieur à 1900 : un champ facultatif
    // deviendrait bloquant.
    render(
      <Enveloppe>
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );
    await ouvrirFormulaire();

    await userEvent.type(screen.getByLabelText(/Marque/), "Trek");
    await userEvent.click(screen.getByRole("button", { name: "Ajouter" }));

    expect(ajouterCycle).toHaveBeenCalledWith(
      expect.objectContaining({ year: null, model: "" }),
    );
  });

  it("retient CLASSIC par défaut, le type étant obligatoire", async () => {
    render(
      <Enveloppe>
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );
    await ouvrirFormulaire();

    expect(screen.getByRole("radio", { checked: true })).toHaveAccessibleName(
      "Classique",
    );
  });

  it("annonce le vélo ajouté avec son libellé d'US, et referme", async () => {
    render(
      <Enveloppe>
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );
    await ouvrirFormulaire();

    await userEvent.type(screen.getByLabelText(/Marque/), "Trek");
    await userEvent.click(screen.getByRole("button", { name: "Ajouter" }));

    expect(toastSucces).toHaveBeenCalledWith("Cycle Trek ajouté");
    expect(
      screen.queryByRole("heading", { name: "Nouveau vélo" }),
    ).not.toBeInTheDocument();
  });
});

describe("CyclesVue - modification", () => {
  it("préremplit les quatre champs du vélo choisi", async () => {
    render(
      <Enveloppe>
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Modifier Decathlon Elops 900" }),
    );

    expect(screen.getByLabelText(/Marque/)).toHaveValue("Decathlon");
    expect(screen.getByLabelText("Modèle")).toHaveValue("Elops 900");
    expect(screen.getByLabelText("Année d'achat")).toHaveValue(2023);
    expect(screen.getByRole("radio", { checked: true })).toHaveAccessibleName(
      "Classique",
    );
  });

  it("envoie la cible avec les champs, et rien du propriétaire", async () => {
    render(
      <Enveloppe>
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Modifier Moustache" }),
    );
    await userEvent.clear(screen.getByLabelText(/Marque/));
    await userEvent.type(screen.getByLabelText(/Marque/), "Moustache Bikes");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(modifierCycle).toHaveBeenCalledWith({
      cycleId: 7,
      brand: "Moustache Bikes",
      model: "",
      type: "ELECTRIC",
      year: null,
    });
  });

  it("rouvre vierge après avoir édité, sans garder la saisie précédente", async () => {
    // Le remontage par `key` est ce qui réinitialise les champs non contrôlés.
    render(
      <Enveloppe>
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Modifier Decathlon Elops 900" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Ajouter un vélo" }),
    );

    expect(screen.getByLabelText(/Marque/)).toHaveValue("");
  });

  it("ouvre le formulaire depuis l'URL, et n'affiche RIEN sur un identifiant inconnu", () => {
    // `cycles.id` est un SERIAL : un message « cycle introuvable » distinct du
    // cas nominal confirmerait l'existence du vélo d'un tiers.
    const { rerender } = render(
      <Enveloppe searchParams="?cycle=12">
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );

    expect(
      screen.getByRole("heading", { name: "Modifier le vélo" }),
    ).toBeInTheDocument();

    rerender(
      <Enveloppe searchParams="?cycle=9999">
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("CyclesVue - refus", () => {
  it("affiche le message de Zod SANS vider la saisie à corriger", async () => {
    ajouterCycle.mockResolvedValue({
      validationErrors: { brand: { _errors: ["Marque requise"] } },
    });

    render(
      <Enveloppe>
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Ajouter un vélo" }),
    );
    await userEvent.type(screen.getByLabelText("Modèle"), "Elops");
    await userEvent.type(screen.getByLabelText(/Marque/), " ");
    await userEvent.click(screen.getByRole("button", { name: "Ajouter" }));

    expect(await screen.findByText("Marque requise")).toBeInTheDocument();
    // React 19 réinitialise un formulaire non contrôlé quand son action est une
    // fonction : ce test est la garde qui interdit d'y revenir.
    expect(screen.getByLabelText("Modèle")).toHaveValue("Elops");
  });

  it("lie le message au champ, pour qu'un lecteur d'écran l'annonce", async () => {
    ajouterCycle.mockResolvedValue({
      validationErrors: { year: { _errors: ["Année d'achat invalide"] } },
    });

    render(
      <Enveloppe>
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Ajouter un vélo" }),
    );
    await userEvent.type(screen.getByLabelText(/Marque/), "Trek");
    await userEvent.type(screen.getByLabelText("Année d'achat"), "1800");
    await userEvent.click(screen.getByRole("button", { name: "Ajouter" }));

    const champ = await screen.findByLabelText("Année d'achat");

    expect(champ).toHaveAccessibleDescription("Année d'achat invalide");
    expect(champ).toHaveAttribute("aria-invalid", "true");
  });

  it("garde AUSSI le type et l'année choisis, pas seulement les champs texte", async () => {
    // Ajouté par l'agent testeur. Le test voisin ne couvre que « Modèle », donc
    // que les champs non contrôlés. Le type vit dans un `useState` et l'année
    // dans un troisième `defaultValue` : trois mécanismes de survie distincts
    // pour une même promesse, « un refus n'efface pas la saisie qu'il demande
    // de corriger ». Deux d'entre eux n'étaient pas exercés.
    ajouterCycle.mockResolvedValue({
      validationErrors: { brand: { _errors: ["Marque requise"] } },
    });

    render(
      <Enveloppe>
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Ajouter un vélo" }),
    );
    // Une espace, et non un champ laissé vide : `required` est posé sur
    // « Marque », et jsdom applique la validation interactive du navigateur -
    // un champ vide ne soumettrait pas du tout, donc ne prouverait rien.
    await userEvent.type(screen.getByLabelText(/Marque/), " ");
    await userEvent.click(screen.getByRole("radio", { name: "Cargo" }));
    await userEvent.type(screen.getByLabelText("Année d'achat"), "2019");
    await userEvent.click(screen.getByRole("button", { name: "Ajouter" }));

    expect(await screen.findByText("Marque requise")).toBeInTheDocument();
    expect(screen.getByRole("radio", { checked: true })).toHaveAccessibleName(
      "Cargo",
    );
    expect(screen.getByLabelText("Année d'achat")).toHaveValue(2019);
  });

  it("affiche une panne serveur en tête, sans la confondre avec un refus de champ", async () => {
    // Ajouté par l'agent testeur. La branche `serverError` n'était exercée sur
    // aucun des deux écrans du domaine. C'est celle de toute exception non
    // interceptée : sans elle, la soumission reste sans retour et le formulaire
    // paraît avoir abouti.
    ajouterCycle.mockResolvedValue({
      serverError: "Une erreur est survenue. Réessayez dans un instant.",
    });

    render(
      <Enveloppe>
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Ajouter un vélo" }),
    );
    await userEvent.type(screen.getByLabelText(/Marque/), "Trek");
    await userEvent.click(screen.getByRole("button", { name: "Ajouter" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Une erreur est survenue.",
    );
    // Le panneau reste ouvert : rien n'a été écrit, la saisie doit pouvoir être
    // resoumise.
    expect(
      screen.getByRole("heading", { name: "Nouveau vélo" }),
    ).toBeInTheDocument();
  });

  it("porte le focus sur le message de refus, pour qui navigue au clavier", async () => {
    // Ajouté par l'agent testeur. Le composant pose un `useEffect` et un
    // `tabIndex={-1}` pour ça, et rien ne le vérifiait : sans le focus, une
    // soumission refusée ne déplace rien sous le curseur, et le message est
    // annoncé loin du point où l'utilisateur se trouve (RGAA A, même geste que
    // le formulaire de connexion).
    ajouterCycle.mockResolvedValue({
      validationErrors: { brand: { _errors: ["Marque requise"] } },
    });

    render(
      <Enveloppe>
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Ajouter un vélo" }),
    );
    await userEvent.type(screen.getByLabelText(/Marque/), " ");
    await userEvent.click(screen.getByRole("button", { name: "Ajouter" }));

    const alerte = await screen.findByRole("alert");

    expect(alerte).toHaveFocus();
  });

  it("passe un refus métier en toast, le panneau se refermant", async () => {
    modifierCycle.mockResolvedValue({
      data: { ok: false, message: "Cycle introuvable." },
    });

    render(
      <Enveloppe>
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Modifier Moustache" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(toastErreur).toHaveBeenCalledWith("Cycle introuvable.");
    expect(
      screen.queryByRole("heading", { name: "Modifier le vélo" }),
    ).not.toBeInTheDocument();
  });
});

describe("CyclesVue - accessibilité", () => {
  it("nomme le groupe de boutons radio du type", () => {
    // 🐛 Le groupe était ANONYME : mesuré par l'agent testeur (C1), son nom
    // accessible rendait la chaîne vide. Le `<fieldset><legend>` groupe bien et
    // axe ne signale rien, mais c'est le `role="radiogroup"` qu'un lecteur
    // d'écran annonce en y entrant, et c'est lui qui n'avait pas de nom. Les
    // deux autres groupes du dépôt le posent, dont celui du rattachement dans
    // cette même PR.
    //
    // Aucun audit axe n'attrape ce défaut, d'où ce test à part : une garde de
    // comptage prouve que la cible est rendue, pas qu'elle est nommée.
    render(
      <Enveloppe searchParams="?cycle=12">
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );

    expect(screen.getByRole("radiogroup")).toHaveAccessibleName(/Type de vélo/);
  });

  it("ne présente aucune violation axe, formulaire ouvert", async () => {
    const vue = render(
      <Enveloppe searchParams="?cycle=12">
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );

    // Garde anti-régression : sans elle, l'audit resterait vert le jour où le
    // formulaire cesse d'être rendu dans ce container (leçon PR #25, note 7).
    expect(vue.container.querySelectorAll('[role="radio"]').length).toBe(3);

    await expect(axe(vue.container)).resolves.toHaveNoViolations();
  });

  it("ne présente aucune violation axe sur l'état vide", async () => {
    // Ajouté par l'agent testeur. L'audit voisin ne couvre qu'UN état, celui du
    // formulaire ouvert sur une liste peuplée. L'état vide est un arbre DOM
    // distinct - section en pointillés, texte, CTA - et c'est le premier écran
    // que voit tout nouveau client : il n'était audité nulle part.
    const vue = render(
      <Enveloppe>
        <CyclesVue cycles={[]} />
      </Enveloppe>,
    );

    // Garde : sans elle, l'audit resterait vert si l'état vide cessait d'être
    // rendu.
    expect(
      within(vue.container).getByRole("button", { name: "Ajouter un cycle" }),
    ).toBeInTheDocument();

    await expect(axe(vue.container)).resolves.toHaveNoViolations();
  });

  it("ne présente aucune violation axe sur un formulaire en erreur", async () => {
    // Ajouté par l'agent testeur. Troisième état non audité, et le seul qui
    // pose des attributs ARIA calculés : `aria-invalid`, `aria-describedby`
    // pointant sur un `id` conditionnel. Un `describedby` orphelin est
    // précisément ce qu'axe attrape, et rien ne l'exerçait.
    ajouterCycle.mockResolvedValue({
      validationErrors: {
        brand: { _errors: ["Marque requise"] },
        year: { _errors: ["Année d'achat invalide"] },
      },
    });

    const vue = render(
      <Enveloppe>
        <CyclesVue cycles={VELOS} />
      </Enveloppe>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Ajouter un vélo" }),
    );
    await userEvent.type(screen.getByLabelText(/Marque/), " ");
    await userEvent.click(screen.getByRole("button", { name: "Ajouter" }));

    expect(await screen.findByText("Marque requise")).toBeInTheDocument();
    expect(
      vue.container.querySelectorAll("[aria-describedby]").length,
    ).toBeGreaterThan(0);

    await expect(axe(vue.container)).resolves.toHaveNoViolations();
  });
});
