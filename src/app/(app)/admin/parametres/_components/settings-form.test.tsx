// Formulaire de configuration société.
//
// Écran **sans maquette** : [[maquettage]] décrit 22 écrans et aucun ne couvre
// `/admin/parametres` (vérifié au plan de T-J0-05). L'UI est donc inventée, et
// ces tests sont la seule spécification qu'elle possède.
//
// Le formulaire est **générique** : il se construit à partir des lignes de
// `app_settings`, une ligne = un champ, `description` en label. C'est ce que
// le dictionnaire vend comme raison d'être du modèle clé-valeur - *« ajouter
// un nouveau champ société ne requiert pas de migration SQL »*. Un formulaire
// à cinq champs codés en dur annulerait cette propriété.
//
// Les vérifications RGAA ci-dessous sont manuelles - elles décrivent ce que la
// structure DOIT porter. `jest-axe`, posé en T-J0-09, les complète sans les
// remplacer : un audit outillé attrape ce qu'on n'a pas pensé à écrire, pas ce
// qu'on a décidé de rendre.
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const updateSettings = vi.fn();
vi.mock("@/lib/actions/parametres/update-settings", () => ({
  updateSettings: (input: unknown) => updateSettings(input),
}));

const { SettingsForm } = await import("./settings-form");

/// Le jeton de concurrence que la page rend avec chaque ligne, depuis
/// T-B1-01 : une **empreinte opaque de la valeur**, que le formulaire doit
/// renvoyer telle quelle pour que le serveur sache sur quelle version porte la
/// soumission.
///
/// Un jeton distinct par ligne, et c'est l'oracle : le jeton porte LA LIGNE
/// depuis le constat F3, donc un formulaire qui enverrait celui du voisin, ou
/// un seul jeton pour tout le lot, doit rougir ici.
const VERSION_NOM = "3rHk9pQw2sXc1vBn4mLz8A";
const VERSION_SIRET = "7yTg5fRd3eWq6uIo0pAs9B";

const SETTINGS = [
  {
    key: "company.name",
    value: "LeCycleLyonnais",
    valueType: "string" as const,
    description: "Raison sociale affichée sur le site et les factures",
    updatedAt: new Date("2026-08-05T10:00:00Z").toISOString(),
    version: VERSION_NOM,
  },
  {
    key: "company.siret",
    value: "",
    valueType: "string" as const,
    description: "Numéro SIRET, mentionné sur les factures",
    updatedAt: new Date("2026-08-05T10:00:00Z").toISOString(),
    version: VERSION_SIRET,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  // `useAction` appelle `.then()` sur le retour de l'action : une valeur par
  // défaut est nécessaire, sans quoi chaque test qui soumet sans stub explicite
  // échoue sur `Cannot read properties of undefined`. Défaut du premier jet de
  // ce fichier - l'oracle était bon, le montage incomplet.
  updateSettings.mockResolvedValue({ data: { changedKeys: [] } });
});

describe("SettingsForm - structure accessible", () => {
  it("rend un champ par paramètre, étiqueté par sa description", () => {
    render(<SettingsForm settings={SETTINGS} />);

    expect(
      screen.getByLabelText(
        "Raison sociale affichée sur le site et les factures",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Numéro SIRET, mentionné sur les factures"),
    ).toBeInTheDocument();
  });

  it("retombe sur la clé quand la description est absente", () => {
    // `description` est NULLable. Un champ sans label est un champ
    // inutilisable au lecteur d'écran (RGAA 11.1) - la clé est laide mais
    // elle est un label.
    render(
      <SettingsForm settings={[{ ...SETTINGS[0]!, description: null }]} />,
    );

    expect(screen.getByLabelText("company.name")).toBeInTheDocument();
  });

  it("pré-remplit chaque champ avec sa valeur courante", () => {
    render(<SettingsForm settings={SETTINGS} />);

    expect(
      screen.getByLabelText(
        "Raison sociale affichée sur le site et les factures",
      ),
    ).toHaveValue("LeCycleLyonnais");
  });

  it("porte une région de statut annoncée sans que l'utilisateur la cherche", () => {
    render(<SettingsForm settings={SETTINGS} />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("SettingsForm - soumission", () => {
  it("envoie toutes les clés avec leurs valeurs courantes", async () => {
    const user = userEvent.setup();
    render(<SettingsForm settings={SETTINGS} />);

    await user.clear(
      screen.getByLabelText(
        "Raison sociale affichée sur le site et les factures",
      ),
    );
    await user.type(
      screen.getByLabelText(
        "Raison sociale affichée sur le site et les factures",
      ),
      "Le Cycle Lyonnais",
    );
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        settings: [
          {
            key: "company.name",
            value: "Le Cycle Lyonnais",
            version: VERSION_NOM,
          },
          { key: "company.siret", value: "", version: VERSION_SIRET },
        ],
      }),
    );
  });

  it("n'envoie jamais la clé sous une forme modifiable par l'utilisateur", async () => {
    // Les clés sont la seule chose que le serveur accepte : elles proviennent
    // du rendu serveur et ne doivent apparaître dans aucun champ éditable.
    render(<SettingsForm settings={SETTINGS} />);

    for (const input of screen.getAllByRole("textbox")) {
      expect(input).not.toHaveValue("company.name");
    }
  });

  it("confirme l'enregistrement", async () => {
    updateSettings.mockResolvedValue({
      data: { changedKeys: ["company.name"] },
    });
    const user = userEvent.setup();
    render(<SettingsForm settings={SETTINGS} />);

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/enregistr/i),
    );
  });

  it("dit explicitement quand rien n'a changé", async () => {
    // Sans ça, une soumission sans modification affiche « enregistré » alors
    // qu'aucune écriture n'a eu lieu - le message ment sur l'état de la base.
    updateSettings.mockResolvedValue({ data: { changedKeys: [] } });
    const user = userEvent.setup();
    render(<SettingsForm settings={SETTINGS} />);

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/aucune/i),
    );
  });

  it("affiche le refus renvoyé par l'action", async () => {
    updateSettings.mockResolvedValue({ data: { error: "Valeur invalide." } });
    const user = userEvent.setup();
    render(<SettingsForm settings={SETTINGS} />);

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Valeur invalide."),
    );
  });

  it("affiche l'erreur serveur générique sans la laisser passer sous silence", async () => {
    updateSettings.mockResolvedValue({
      serverError: "Une erreur est survenue. Réessayez dans un instant.",
    });
    const user = userEvent.setup();
    render(<SettingsForm settings={SETTINGS} />);

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/erreur/i),
    );
  });

  it("désactive le bouton pendant la soumission", async () => {
    // Double soumission : deux écritures concurrentes sur les mêmes clés
    // produisent deux entrées d'audit dont l'une décrit un diff déjà appliqué.
    let resolve: (value: unknown) => void = () => {};
    updateSettings.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const user = userEvent.setup();
    render(<SettingsForm settings={SETTINGS} />);

    await user.click(screen.getByRole("button", { name: /enregistrer/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /enregistr/i })).toBeDisabled(),
    );
    resolve({ data: { changedKeys: [] } });
  });
});

// Sondes ajoutées par l'agent testeur.
//
// Le fichier corrige lui-même un montage incomplet (`mockResolvedValue` par
// défaut dans `beforeEach`). La correction est juste et n'affaiblit aucun
// oracle : elle donne à `useAction` de quoi résoudre sa promesse, ce que
// l'action réelle fait toujours. Elle a en revanche un effet de bord -
// **tous** les cas non stubés passent désormais par la branche « succès sans
// changement ». Les tests ci-dessous couvrent les branches que ce défaut
// rendait invisibles.

describe("SettingsForm - état de la valeur", () => {
  it("affiche un champ vide quand la valeur est NULL en base", () => {
    // `app_settings.value` est NULLable. Un `null` rendu tel quel produirait
    // un champ non contrôlé portant la chaîne « null ».
    render(<SettingsForm settings={[{ ...SETTINGS[0]!, value: null }]} />);

    expect(
      screen.getByLabelText(
        "Raison sociale affichée sur le site et les factures",
      ),
    ).toHaveValue("");
  });

  it("soumet la chaîne vide pour un champ effacé, pas la valeur d'origine", async () => {
    // C'est la soumission qui porte l'effacement. Si le formulaire retombait
    // sur `setting.value` faute de saisie, un champ vidé se réécrirait tout
    // seul et l'administrateur ne pourrait plus jamais effacer une clé.
    const user = userEvent.setup();
    render(<SettingsForm settings={SETTINGS} />);

    await user.clear(
      screen.getByLabelText(
        "Raison sociale affichée sur le site et les factures",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        settings: [
          { key: "company.name", value: "", version: VERSION_NOM },
          { key: "company.siret", value: "", version: VERSION_SIRET },
        ],
      }),
    );
  });
});

describe("SettingsForm - accessibilité (contrôles manuels, jest-axe en T-J0-09)", () => {
  it("associe chaque champ à une description qui existe réellement", () => {
    // `aria-describedby` pointant sur un `id` absent est un attribut mort :
    // le lecteur d'écran n'annonce rien et rien ne le signale à l'écran
    // (RGAA 11.x). Le lien doit être vérifié, pas supposé.
    render(<SettingsForm settings={SETTINGS} />);

    for (const champ of screen.getAllByRole("textbox")) {
      const describedBy = champ.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      for (const id of (describedBy ?? "").split(/\s+/)) {
        expect(document.getElementById(id)).not.toBeNull();
      }
    }
  });

  it("expose ses deux régions d'annonce dès le premier rendu", () => {
    // Une région live insérée en même temps que son contenu n'est pas
    // annoncée de façon fiable : elle doit préexister. `alert` et `status`
    // sont bien dans le DOM avant toute soumission.
    //
    // Limite explicite de ce test : jsdom n'applique pas Tailwind, donc il ne
    // dit rien du rendu réel des deux régions. `empty:hidden`, que cette note
    // visait à l'origine, a depuis été retiré de `settings-form.tsx` - c'est
    // précisément lui qui rendait l'annonce peu fiable.
    render(<SettingsForm settings={SETTINGS} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("efface le message d'erreur quand la soumission suivante réussit", async () => {
    // Une erreur qui survit à la correction fait croire à un échec permanent.
    updateSettings
      .mockResolvedValueOnce({ data: { error: "Valeur invalide." } })
      .mockResolvedValueOnce({ data: { changedKeys: ["company.name"] } });
    const user = userEvent.setup();
    render(<SettingsForm settings={SETTINGS} />);

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Valeur invalide."),
    );

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/enregistr/i),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("");
  });

  it("ne laisse jamais une soumission échouer en silence", async () => {
    // Ce test a été ROUGE : `SettingsForm` lisait `result.data?.error` et
    // `result.serverError`, jamais `result.validationErrors`. Quand Zod
    // refusait la charge utile, le bouton se réactivait, aucune région ne
    // bougeait, et l'administrateur voyait un clic sans effet. Corrigé depuis
    // (`settings-form.tsx` lit désormais les trois canaux) - le test est vert
    // et garde le cas sous surveillance.
    //
    // Atteignable : `updateSettingsSchema` exige `settings.min(1)`, et la page
    // rend zéro champ si `app_settings` est vide (base fraîche non seedée,
    // lignes supprimées). Le formulaire soumet alors `settings: []`.
    //
    // Le formulaire frère traite déjà ce cas
    // (`src/app/(auth)/connexion/_components/login-form.tsx:21-23`), ce qui
    // rend l'écart d'autant plus visible. WCAG 3.3.1 « Identification des
    // erreurs » (niveau A) demande que l'erreur soit signalée en texte.
    updateSettings.mockResolvedValue({
      validationErrors: {
        settings: { _errors: ["Aucun paramètre à enregistrer"] },
      },
    });
    const user = userEvent.setup();
    render(<SettingsForm settings={SETTINGS} />);

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent ?? "").not.toHaveLength(0),
    );
  });
});

describe("SettingsForm - audit outillé", () => {
  it("ne présente aucune violation axe", async () => {
    const { container } = render(<SettingsForm settings={SETTINGS} />);

    // RGAA niveau A sur toute l'application v1 (PLAN S4 §2). Le pendant E2E
    // couvre `/connexion`, mise en AA par la même section - ici on tient la
    // baseline sur l'écran d'administration.
    expect(await axe(container)).toHaveNoViolations();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Tests ajoutés par l'agent testeur (verify-only) sur la PR de fond de
// T-B1-01, constat F3.
// ─────────────────────────────────────────────────────────────────────────

const NOM = "Raison sociale affichée sur le site et les factures";
const SIRET = "Numéro SIRET, mentionné sur les factures";

describe("SettingsForm, les champs que le refus désigne", () => {
  // ⚠️ **Aucun test ne couvrait `aria-invalid` sur ce formulaire**, ni pour
  // `invalidKeys` (livré en T-J0-05) ni pour `staleKeys` (ajouté par le
  // constat F3). Le marquage pouvait disparaître entièrement sans qu'un seul
  // oracle bouge, alors que c'est lui qui donne son intérêt à la granularité
  // par clé : un refus qui ne désigne personne vaut un refus de tout le
  // formulaire, et la DoD 6 serait tenue côté serveur seulement.

  it("marque la ligne périmée, et ne marque pas sa voisine", async () => {
    updateSettings.mockResolvedValue({
      data: {
        error: "Ces paramètres ont été modifiés entre-temps.",
        invalidKeys: [],
        staleKeys: ["company.name"],
      },
    });
    const user = userEvent.setup();
    render(<SettingsForm settings={SETTINGS} />);

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(screen.getByLabelText(NOM)).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
    // La ligne que personne n'a touchée reste saine : `aria-invalid="false"`
    // serait déjà une affirmation de trop, l'attribut doit être absent.
    expect(screen.getByLabelText(SIRET)).not.toHaveAttribute("aria-invalid");
  });

  it("marque la ligne invalide, et ne marque pas sa voisine", async () => {
    updateSettings.mockResolvedValue({
      data: {
        error: "Valeur invalide pour : company.siret",
        invalidKeys: ["company.siret"],
        staleKeys: [],
      },
    });
    const user = userEvent.setup();
    render(<SettingsForm settings={SETTINGS} />);

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(screen.getByLabelText(SIRET)).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
    expect(screen.getByLabelText(NOM)).not.toHaveAttribute("aria-invalid");
  });

  it("ne marque rien quand le refus ne vient d'aucun champ affiché", async () => {
    // `unknown_keys` : l'action renvoie deux listes vides. Un formulaire qui
    // marquerait tout par prudence ferait chercher une faute dans des champs
    // corrects.
    updateSettings.mockResolvedValue({
      data: {
        error: "Paramètre inconnu - la page a peut-être changé, rechargez-la.",
        invalidKeys: [],
        staleKeys: [],
      },
    });
    const user = userEvent.setup();
    render(<SettingsForm settings={SETTINGS} />);

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent ?? "").not.toHaveLength(0),
    );
    expect(screen.getByLabelText(NOM)).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText(SIRET)).not.toHaveAttribute("aria-invalid");
  });

  it("survit à une charge utile sans les deux listes", async () => {
    // Robustesse du contrat client : l'action les renvoie toujours
    // aujourd'hui, mais `result.data` est typé optionnel côté hook et un refus
    // émis par un autre chemin (`serverError`) n'en porte aucune. Un accès
    // direct au tableau ferait planter le rendu au lieu d'afficher le refus.
    updateSettings.mockResolvedValue({
      data: { error: "Refus sans détail" },
    });
    const user = userEvent.setup();
    render(<SettingsForm settings={SETTINGS} />);

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Refus sans détail"),
    );
    expect(screen.getByLabelText(NOM)).not.toHaveAttribute("aria-invalid");
  });
});

describe("SettingsForm, d'où vient le jeton resoumis", () => {
  it("reprend le jeton du dernier rendu, pas celui du premier", async () => {
    // ⚠️ **Moitié client d'un risque que seul l'E2E peut clore.**
    //
    // Après une écriture, `updateSettings` appelle `revalidatePath`, Next
    // rerend la page et le formulaire reçoit de nouveaux jetons. Sans cette
    // propagation, une SECONDE modification du même champ sans rechargement
    // resoumettrait le jeton d'avant, et serait refusée en `stale` sur la
    // propre écriture de l'administrateur.
    //
    // Ce test tient ce qui est tenable sous RTL : quand les props changent, le
    // formulaire resoumet les NOUVEAUX jetons, et la valeur déjà saisie dans
    // le champ n'est pas réinitialisée au passage (le `key` de la ligne ne
    // bouge pas, l'`<input>` n'est pas remonté).
    //
    // Ce qu'il ne prouve pas, et qui reste à vérifier en E2E : que la
    // revalidation atteigne réellement le client. Playwright n'est pas
    // exécutable sur ce poste (pas de base de test), le cas est remonté dans
    // le rapport.
    const user = userEvent.setup();
    const { rerender } = render(<SettingsForm settings={SETTINGS} />);

    await user.clear(screen.getByLabelText(NOM));
    await user.type(screen.getByLabelText(NOM), "Premier nom");

    const APRES_ECRITURE = [
      {
        ...SETTINGS[0]!,
        value: "Premier nom",
        version: "JetonApresEcriture1A",
      },
      { ...SETTINGS[1]! },
    ];
    rerender(<SettingsForm settings={APRES_ECRITURE} />);

    // La saisie survit au rerendu : sinon la seconde modification repartirait
    // d'un champ vidé sans que l'administrateur l'ait demandé.
    expect(screen.getByLabelText(NOM)).toHaveValue("Premier nom");

    await user.clear(screen.getByLabelText(NOM));
    await user.type(screen.getByLabelText(NOM), "Second nom");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        settings: [
          {
            key: "company.name",
            value: "Second nom",
            version: "JetonApresEcriture1A",
          },
          { key: "company.siret", value: "", version: VERSION_SIRET },
        ],
      }),
    );
  });
});
