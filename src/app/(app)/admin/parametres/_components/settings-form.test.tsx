// Formulaire de configuration société.
//
// Écran **sans maquette** : [[maquettage]] décrit 22 écrans et aucun ne couvre
// `/admin/parametres` (vérifié au plan de T-J0-05). L'UI est donc inventée, et
// ces tests sont la seule spécification qu'elle possède.
//
// Le formulaire est **générique** : il se construit à partir des lignes de
// `app_settings`, une ligne = un champ, `description` en label. C'est ce que
// le dictionnaire vend comme raison d'être du modèle clé-valeur — *« ajouter
// un nouveau champ société ne requiert pas de migration SQL »*. Un formulaire
// à cinq champs codés en dur annulerait cette propriété.
//
// `jest-axe` arrive en T-J0-09 : les vérifications RGAA ci-dessous sont
// manuelles et ne remplacent pas un audit outillé.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const updateSettings = vi.fn();
vi.mock("@/lib/actions/parametres/update-settings", () => ({
  updateSettings: (input: unknown) => updateSettings(input),
}));

const { SettingsForm } = await import("./settings-form");

const SETTINGS = [
  {
    key: "company.name",
    value: "LeCycleLyonnais",
    valueType: "string" as const,
    description: "Raison sociale affichée sur le site et les factures",
    updatedAt: new Date("2026-08-05T10:00:00Z").toISOString(),
  },
  {
    key: "company.siret",
    value: "",
    valueType: "string" as const,
    description: "Numéro SIRET, mentionné sur les factures",
    updatedAt: new Date("2026-08-05T10:00:00Z").toISOString(),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  // `useAction` appelle `.then()` sur le retour de l'action : une valeur par
  // défaut est nécessaire, sans quoi chaque test qui soumet sans stub explicite
  // échoue sur `Cannot read properties of undefined`. Défaut du premier jet de
  // ce fichier — l'oracle était bon, le montage incomplet.
  updateSettings.mockResolvedValue({ data: { changedKeys: [] } });
});

describe("SettingsForm — structure accessible", () => {
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
    // inutilisable au lecteur d'écran (RGAA 11.1) — la clé est laide mais
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

describe("SettingsForm — soumission", () => {
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
          { key: "company.name", value: "Le Cycle Lyonnais" },
          { key: "company.siret", value: "" },
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
    // qu'aucune écriture n'a eu lieu — le message ment sur l'état de la base.
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

// ───────────────────────────────────────────────────────────────────────────
// Sondes ajoutées par l'agent testeur (T-J0-05).
//
// Le fichier corrige lui-même un montage incomplet (`mockResolvedValue` par
// défaut dans `beforeEach`). La correction est juste et n'affaiblit aucun
// oracle : elle donne à `useAction` de quoi résoudre sa promesse, ce que
// l'action réelle fait toujours. Elle a en revanche un effet de bord —
// **tous** les cas non stubés passent désormais par la branche « succès sans
// changement ». Les tests ci-dessous couvrent les branches que ce défaut
// rendait invisibles.
// ───────────────────────────────────────────────────────────────────────────

describe("SettingsForm — état de la valeur", () => {
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
          { key: "company.name", value: "" },
          { key: "company.siret", value: "" },
        ],
      }),
    );
  });
});

describe("SettingsForm — accessibilité (contrôles manuels, jest-axe en T-J0-09)", () => {
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
    // dit rien de `empty:hidden`, qui pose `display:none` tant que la région
    // est vide en conditions réelles. Ce point-là ne se vérifie qu'au
    // navigateur.
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
    // ⚠️ CE TEST EST ROUGE — bug rapporté, pas corrigé ici.
    //
    // `SettingsForm` lit `result.data?.error` et `result.serverError`, jamais
    // `result.validationErrors`. Quand Zod refuse la charge utile, l'action
    // renvoie donc un résultat que le formulaire n'interprète pas : le bouton
    // se réactive, aucune région ne bouge, et l'administrateur voit un clic
    // sans effet.
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
