// Modale de cloture et d'encaissement - `US-INTERVENTION-MARQUER-FAITE`
// couplee a `US-PAIEMENT-ENREGISTRER`, ecran **T4**.
//
// Ce fichier ne rejoue ni la transaction, ni le verrou, ni les bornes du
// montant : les deux premiers vivent dans `queries/paiements.ts`, la troisieme
// dans le schema Zod, et les trois y sont testees. Ce qui se joue ici est ce
// que l'ECRAN en fait :
//
//   · **la surface nomme son effet avant de l'engager**, et c'est la DoD sur
//     l'irreversibilite. Le montant, le mode, l'encart « Action irreversible »
//     et le libelle du bouton sont les quatre elements qui la portent ;
//   · **le montant est PREREGLE sur le total et MODIFIABLE** - la maquette le
//     fige a « 25 € », l'US le veut modifiable (D9) ;
//   · **la branche de refus dit qu'elle annule**, avant d'annuler. Le
//     technicien doit le savoir au moment de choisir, pas le decouvrir dans sa
//     liste ;
//   · **aucun champ de carte, aucune redirection** - Constitution §2.3, c'est
//     un enregistrement declaratif.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { formatPrixEuros } from "@/lib/format";

const cloturerIntervention = vi.fn();
vi.mock("@/lib/actions/paiements/cloturer-intervention", () => ({
  cloturerIntervention: (args: unknown) => cloturerIntervention(args),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => toastSuccess(message),
    // Les OPTIONS sont transmises, pas avalees : la duree allongee des refus
    // est une decision (un message d'erreur se lit, la ou un succes se
    // constate), et un double qui la perd rendrait le test incapable de la
    // voir disparaitre.
    error: (message: string, options?: unknown) => toastError(message, options),
  },
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const { ModaleCloture } = await import("./modale-cloture");

function monter(total = "97.90") {
  return render(<ModaleCloture interventionId={847} total={total} />);
}

/// Ouvre la modale et rend l'utilisateur virtuel.
async function ouvrir(total?: string) {
  const utilisateur = userEvent.setup();
  monter(total);
  await utilisateur.click(
    screen.getByRole("button", { name: /Marquer comme faite/ }),
  );
  return utilisateur;
}

function champMontant(): HTMLInputElement {
  return screen.getByLabelText(/Montant à encaisser/);
}

beforeEach(() => {
  vi.clearAllMocks();
  cloturerIntervention.mockResolvedValue({
    data: { ok: true, issue: "encaisse" },
  });
});

describe("ModaleCloture - la surface qui nomme son effet", () => {
  it("n'ouvre rien tant que le technicien n'a pas clique", () => {
    // 🔴 Aucun acte irreversible atteignable en un clic depuis l'ecran au
    // repos : le hub ne porte que le declencheur, la decision se prend
    // ailleurs.
    monter();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(cloturerIntervention).not.toHaveBeenCalled();
  });

  it("annonce l'irreversibilite AVANT de l'engager", async () => {
    await ouvrir();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Action irréversible/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Confirmer la clôture/ }),
    ).toBeInTheDocument();
  });

  it("le declencheur annonce qu'il ouvre une boite de dialogue", async () => {
    // 🐛 Relevé par l'agent testeur sur le bloc d'annulation (PR #33) :
    // `DialogTrigger` pose `aria-haspopup="dialog"`, un bouton nu ne le fait
    // pas, et `jest-axe` ne le signale pas.
    monter();

    expect(
      screen.getByRole("button", { name: /Marquer comme faite/ }),
    ).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("ne pose AUCUN champ de carte ni redirection de paiement", async () => {
    // Constitution §2.3 : aucun paiement en ligne. Ni Stripe, ni redirection,
    // ni champ de carte - c'est un enregistrement declaratif de ce qui a ete
    // encaisse sur place.
    await ouvrir();

    const dialogue = screen.getByRole("dialog");

    expect(dialogue.querySelector("form[action^='http']")).toBeNull();
    expect(dialogue.querySelector("iframe")).toBeNull();
    expect(
      screen.queryByLabelText(/numéro de carte|cryptogramme|expiration/i),
    ).not.toBeInTheDocument();
    // Le mode « Carte bancaire » designe le terminal du technicien, pas une
    // saisie en ligne : il reste un simple choix.
    expect(screen.getByRole("radio", { name: "Carte bancaire" })).toBeChecked();
  });
});

describe("ModaleCloture - le montant", () => {
  it("est prerégle sur le TOTAL recu, forfait plus produits", async () => {
    // Cadrage du plancher V2, D9. La SPEC preregle sur `price_snapshot`, qui
    // est le forfait seul : toute intervention avec produits serait
    // sous-facturee par defaut.
    await ouvrir("124.80");

    expect(champMontant()).toHaveValue("124.80");
  });

  it("est MODIFIABLE, contre la maquette qui le fige", async () => {
    const utilisateur = await ouvrir();

    await utilisateur.clear(champMontant());
    await utilisateur.type(champMontant(), "70.00");

    expect(champMontant()).toHaveValue("70.00");
  });

  it("part tel quel a l'action, sans conversion en nombre", async () => {
    // 🔴 `85.10` n'a pas de representation binaire exacte. Le montant traverse
    // en CHAINE de bout en bout, et c'est le schema qui le normalise.
    const utilisateur = await ouvrir();

    await utilisateur.clear(champMontant());
    await utilisateur.type(champMontant(), "85,10");
    await utilisateur.click(
      screen.getByRole("button", { name: /Confirmer la clôture/ }),
    );

    expect(cloturerIntervention).toHaveBeenCalledWith({
      issue: "encaisse",
      interventionId: 847,
      montant: "85,10",
      methode: "CB",
    });
  });

  it("transmet le mode choisi", async () => {
    const utilisateur = await ouvrir();

    await utilisateur.click(screen.getByRole("radio", { name: "Espèces" }));
    await utilisateur.click(
      screen.getByRole("button", { name: /Confirmer la clôture/ }),
    );

    expect(cloturerIntervention).toHaveBeenCalledWith(
      expect.objectContaining({ methode: "CASH" }),
    );
  });

  it("ne porte pas les sous-titres inventes de la maquette", async () => {
    // « Terminal mobile », « Rendu de monnaie », « Ordre : HomeCycl'Home » :
    // les deux premiers affirment un equipement et une pratique qu'aucune US ne
    // porte, le troisieme code en dur une raison sociale que `app_settings`
    // detient deja.
    await ouvrir();

    expect(screen.queryByText(/Terminal mobile/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Rendu de monnaie/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ordre :/)).not.toBeInTheDocument();
  });

  it("ne porte pas la reference inventee #INT-2026-1042", async () => {
    // Format invente ; l'identifiant reel est le SERIAL, deja dans l'URL. Deja
    // retire de T2 pour le meme motif.
    await ouvrir();

    expect(screen.queryByText(/INT-2026/)).not.toBeInTheDocument();
  });

  it("ne porte AUCUN champ de notes internes", async () => {
    // 🔻 DoD : `US-INTERVENTION-COMMENTAIRE-AJOUTER` est v2 et specifie
    // « horodatage + auteur », donc une COLLECTION et pas un champ. Ecrire
    // `interventions.tech_comment` ici poserait une donnee dont la v2 devrait
    // decider si elle la migre.
    await ouvrir();

    expect(screen.queryByLabelText(/notes/i)).not.toBeInTheDocument();
  });
});

describe("ModaleCloture - la branche de refus", () => {
  async function ouvrirRefus() {
    const utilisateur = await ouvrir();
    await utilisateur.click(
      screen.getByRole("button", { name: /Le client refuse le paiement/ }),
    );
    return utilisateur;
  }

  it("dit que l'intervention sera ANNULEE, pas terminee", async () => {
    // 🔴 `US-PAIEMENT-ENREGISTRER` §Fallback : le statut passe a `CANCELLED`.
    // Le technicien doit le savoir au moment de choisir, pas le decouvrir dans
    // sa liste.
    await ouvrirRefus();

    expect(screen.getByText(/passera en/)).toHaveTextContent("Annulée");
  });

  it("exige un motif et le transmet", async () => {
    const utilisateur = await ouvrirRefus();

    await utilisateur.type(
      screen.getByLabelText(/Motif du refus/),
      "Client absent",
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /Clôturer sans encaissement/ }),
    );

    expect(cloturerIntervention).toHaveBeenCalledWith({
      issue: "refuse",
      interventionId: 847,
      motif: "Client absent",
    });
  });

  it("n'emporte AUCUN montant, meme si le technicien en avait saisi un", async () => {
    // 🔴 L'union discriminee interdit « refus avec un montant » a la
    // compilation. Ce test verifie que l'ecran ne le reconstitue pas a
    // l'execution en traînant l'etat du panneau precedent.
    const utilisateur = await ouvrir();

    await utilisateur.clear(champMontant());
    await utilisateur.type(champMontant(), "999.00");
    await utilisateur.click(
      screen.getByRole("button", { name: /Le client refuse le paiement/ }),
    );
    await utilisateur.type(
      screen.getByLabelText(/Motif du refus/),
      "Client absent",
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /Clôturer sans encaissement/ }),
    );

    const envoye = cloturerIntervention.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;

    expect(envoye).not.toHaveProperty("montant");
    expect(envoye).not.toHaveProperty("methode");
  });

  it("laisse revenir a l'encaissement sans rien envoyer", async () => {
    const utilisateur = await ouvrirRefus();

    await utilisateur.click(screen.getByRole("button", { name: "Retour" }));

    expect(champMontant()).toBeInTheDocument();
    expect(cloturerIntervention).not.toHaveBeenCalled();
  });

  it("rouvre TOUJOURS sur l'encaissement, jamais sur le refus", async () => {
    // Rouvrir la modale sur le formulaire de refus parce qu'on l'avait
    // entrouvert la fois d'avant serait une mauvaise surprise sur un acte
    // irreversible.
    const utilisateur = await ouvrirRefus();

    await utilisateur.keyboard("{Escape}");
    await utilisateur.click(
      screen.getByRole("button", { name: /Marquer comme faite/ }),
    );

    expect(champMontant()).toBeInTheDocument();
    expect(screen.queryByLabelText(/Motif du refus/)).not.toBeInTheDocument();
  });
});

describe("ModaleCloture - ce qu'elle fait des reponses", () => {
  it("affiche le refus de Zod a cote du champ, sans fermer", async () => {
    // Le schema est la seule source des bornes, l'ecran ne les redit pas. La
    // modale reste ouverte : rien n'a mute, donc rien n'a ete revalide, et le
    // technicien doit pouvoir corriger sa saisie.
    cloturerIntervention.mockResolvedValue({
      validationErrors: {
        montant: { _errors: ["Un encaissement ne peut pas être nul."] },
      },
    });

    const utilisateur = await ouvrir();
    await utilisateur.click(
      screen.getByRole("button", { name: /Confirmer la clôture/ }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Un encaissement ne peut pas être nul.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("remonte une panne serveur sans fermer non plus", async () => {
    cloturerIntervention.mockResolvedValue({
      serverError: "Une erreur est survenue. Réessayez dans un instant.",
    });

    const utilisateur = await ouvrir();
    await utilisateur.click(
      screen.getByRole("button", { name: /Confirmer la clôture/ }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Une erreur est");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("ferme et rafraichit sur un refus METIER", async () => {
    // Le statut a change sous les yeux du technicien - un autre onglet a
    // cloture, ou le client vient d'annuler. Laisser la modale ouverte sur un
    // formulaire condamne inviterait a reessayer contre un etat faux.
    cloturerIntervention.mockResolvedValue({
      data: {
        ok: false,
        message: "Cette intervention est déjà clôturée ou annulée.",
      },
    });

    const utilisateur = await ouvrir();
    await utilisateur.click(
      screen.getByRole("button", { name: /Confirmer la clôture/ }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith(
      "Cette intervention est déjà clôturée ou annulée.",
      { duration: 8_000 },
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("ferme, annonce le montant encaisse et rafraichit au succes", async () => {
    // Le hub se demonte au rafraichissement : le message vit dans le `Toaster`
    // du layout, qui reste monte. Le montant est le seul chiffre que le geste
    // vient de figer.
    const utilisateur = await ouvrir();
    await utilisateur.click(
      screen.getByRole("button", { name: /Confirmer la clôture/ }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // ⚠️ Le montant est compose par `formatPrixEuros`, donc par `Intl` : il
    // porte une espace fine INSECABLE (U+202F) avant l'euro. Une chaine tapee
    // a la main avec une espace ordinaire echoue sur une difference invisible a
    // la relecture du diff. Le format est teste chez lui, pas ici.
    expect(toastSuccess).toHaveBeenCalledWith(
      `Intervention clôturée, ${formatPrixEuros("97.90")} encaissés`,
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("annonce un montant LISIBLE quand le technicien a saisi une virgule", async () => {
    // 🔴 **Ajout de l'agent testeur, 2026-08-14. ROUGE a l'ecriture.**
    //
    // Le champ accepte deliberement la virgule - c'est ecrit dans
    // `modale-cloture.tsx` (« un clavier mobile francais la propose en
    // premier ») et dans `encaissement.ts`, et l'E2E « un montant ajuste est
    // celui qui est encaisse » prouve que « 42,50 » atteint la base en 42.50.
    //
    // Le TOAST, lui, ne compose pas la valeur normalisee : il compose l'etat
    // local du champ, brut. `formatPrixEuros` fait `Number("85,10")`, qui vaut
    // `NaN`, et `Intl` rend « NaN € ». Le technicien lit donc « Intervention
    // cloturee, NaN € encaisses » sur le seul geste irreversible du parcours,
    // au moment precis ou il verifie le chiffre qu'il vient de figer.
    //
    // Le test existant ne le voyait pas : il ne clot que sur la valeur
    // preréglee, qui porte un point parce qu'elle vient de `toFixed(2)`.
    const utilisateur = await ouvrir();

    await utilisateur.clear(champMontant());
    await utilisateur.type(champMontant(), "85,10");
    await utilisateur.click(
      screen.getByRole("button", { name: /Confirmer la clôture/ }),
    );

    expect(toastSuccess).toHaveBeenCalledWith(
      `Intervention clôturée, ${formatPrixEuros("85.10")} encaissés`,
    );
  });

  it("annonce l'absence d'encaissement sur la branche de refus", async () => {
    cloturerIntervention.mockResolvedValue({
      data: { ok: true, issue: "refuse" },
    });

    const utilisateur = await ouvrir();
    await utilisateur.click(
      screen.getByRole("button", { name: /Le client refuse le paiement/ }),
    );
    await utilisateur.type(
      screen.getByLabelText(/Motif du refus/),
      "Client absent",
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /Clôturer sans encaissement/ }),
    );

    expect(toastSuccess).toHaveBeenCalledWith(
      "Intervention clôturée sans encaissement",
    );
  });

  it("laisse l'echappement refermer sans rien envoyer", async () => {
    // Motif WAI-ARIA du dialogue modal, et propriete deja figee sur la
    // confirmation de demarrage.
    const utilisateur = await ouvrir();

    await utilisateur.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(cloturerIntervention).not.toHaveBeenCalled();
  });
});

describe("ModaleCloture - accessibilite", () => {
  it("ne presente aucune violation, panneau d'encaissement", async () => {
    await ouvrir();

    await expect(axe(screen.getByRole("dialog"))).resolves.toHaveNoViolations();
  });

  it("ne presente aucune violation, panneau de refus", async () => {
    const utilisateur = await ouvrir();
    await utilisateur.click(
      screen.getByRole("button", { name: /Le client refuse le paiement/ }),
    );

    await expect(axe(screen.getByRole("dialog"))).resolves.toHaveNoViolations();
  });
});
