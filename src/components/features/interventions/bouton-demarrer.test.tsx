// Le bouton de demarrage - `US-INTERVENTION-DEMARRER`, ecran **T2** et ligne
// `PLANNED` de la tournee.
//
// ⚠️ **Ajout de l'agent testeur, 2026-08-13.** Le composant n'avait AUCUN test
// co-localise : `hub-statut.test.tsx` et `tournee-vue.test.tsx` doublent sa
// Server Action et ne le cliquent jamais, donc ils prouvent seulement qu'il est
// RENDU. Tout ce qu'il decide apres le clic - la confirmation, le traitement
// des deux refus, l'invalidation, la garde du double envoi - n'avait pour seul
// oracle qu'un scenario E2E de chemin nominal.
//
// Quatre proprietes s'y jouent, et aucune n'est decorative :
//
//   · **la confirmation n'est pas contournable** - la transition est
//     irreversible (aucune US, aucun ADR ne prevoit `IN_PROGRESS → PLANNED`) et
//     elle ferme le panier d'un TIERS, le client ;
//   · **le refus metier remet l'ecran a jour** - sans quoi le technicien
//     reessaie contre une vue perimee (lecon PR #33) ;
//   · **un seul envoi par geste** - deux transitions concurrentes sont
//     rattrapees par le verrou serveur, mais un ecran qui les emet produit du
//     bruit dans `audit_logs`, la piece qu'on produit en cas de contestation ;
//   · **le focus initial va au REFUS** - c'est la moitie a11y de l'`AlertDialog`,
//     et cette primitive est ECRITE A LA MAIN dans ce depot.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

const demarrerIntervention = vi.fn();
vi.mock("@/lib/actions/interventions/demarrer-intervention", () => ({
  demarrerIntervention: (args: unknown) => demarrerIntervention(args),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => toastSuccess(message),
    error: (message: string, options?: unknown) => toastError(message, options),
  },
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => refresh() }),
}));

const { BoutonDemarrer } = await import("./bouton-demarrer");

const onDemarree = vi.fn();

function monter(avecRappel = true) {
  return render(
    <BoutonDemarrer
      interventionId={847}
      onDemarree={avecRappel ? onDemarree : undefined}
    />,
  );
}

function declencheur() {
  return screen.getByRole("button", { name: /Démarrer l'intervention/ });
}

function confirmation() {
  return screen.getByRole("button", { name: "Démarrer" });
}

beforeEach(() => {
  vi.clearAllMocks();
  demarrerIntervention.mockResolvedValue({ data: { ok: true } });
});

describe("BoutonDemarrer - la confirmation", () => {
  it("n'envoie RIEN au seul clic sur le declencheur", async () => {
    // 🔴 La propriete centrale du composant. Sur la ligne de tournee, le bouton
    // est petit et voisin de dix autres : un clic malencontreux couterait au
    // client une modification de panier qu'il ne pourra plus faire, et au
    // technicien une transition qu'aucun chemin ne defait.
    const utilisateur = userEvent.setup();
    monter();

    await utilisateur.click(declencheur());

    expect(demarrerIntervention).not.toHaveBeenCalled();
    expect(
      screen.getByRole("alertdialog", {
        name: "Démarrer cette intervention ?",
      }),
    ).toBeInTheDocument();
  });

  it("demande une ALERTE et non une boite de dialogue ordinaire", async () => {
    // `role="alertdialog"` n'est pas cosmetique : il annonce a un lecteur
    // d'ecran que la reponse engage, et Radix le reserve a `AlertDialog`.
    const utilisateur = userEvent.setup();
    monter();

    await utilisateur.click(declencheur());

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("annonce l'irreversibilite ET l'effet de bord sur le client", async () => {
    // Les deux moities du motif de la confirmation. Une modale qui ne dirait
    // que « Confirmer ? » ne serait qu'une friction de plus.
    const utilisateur = userEvent.setup();
    monter();

    await utilisateur.click(declencheur());

    expect(screen.getByRole("alertdialog")).toHaveAccessibleDescription(
      /ne peut pas être annulée/,
    );
    expect(
      screen.getByText(/plus modifier son panier ni ajouter de photos/),
    ).toBeInTheDocument();
  });

  it("pose le focus initial sur le REFUS", async () => {
    // 🔴 La moitie a11y de l'`AlertDialog`, et elle depend d'une chaine de refs
    // que ce depot assemble a la main : `AlertDialogPrimitive.Cancel asChild` →
    // `Button` du produit. Si la ref cessait d'etre transmise, le focus
    // tomberait sur le conteneur ou sur la validation, et le geste de sortie
    // cesserait d'etre celui que la touche Entree valide.
    const utilisateur = userEvent.setup();
    monter();

    await utilisateur.click(declencheur());

    expect(screen.getByRole("button", { name: "Pas encore" })).toHaveFocus();
  });

  it("n'envoie rien quand on repond « Pas encore »", async () => {
    const utilisateur = userEvent.setup();
    monter();

    await utilisateur.click(declencheur());
    await utilisateur.click(screen.getByRole("button", { name: "Pas encore" }));

    expect(demarrerIntervention).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("laisse la touche Echap refermer sans rien envoyer", async () => {
    // ⚠️ **Comportement CONSTATE, contraire a ce qu'affirme le commentaire de
    // `src/components/ui/alert-dialog.tsx`** (« ne se ferme ni au clic
    // exterieur ni a l'echappement »). Radix ne previent que l'interaction
    // EXTERIEURE sur un `AlertDialog` ; l'echappement reste actif, et le motif
    // WAI-ARIA de l'`alertdialog` l'exige. Ce qui compte pour la surete du
    // geste est tenu quand meme : sortir par megarde n'envoie rien.
    const utilisateur = userEvent.setup();
    monter();

    await utilisateur.click(declencheur());
    await utilisateur.keyboard("{Escape}");

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(demarrerIntervention).not.toHaveBeenCalled();
  });
});

describe("BoutonDemarrer - ce qu'il envoie", () => {
  it("poste le seul identifiant, jamais un technicien", async () => {
    // Le technicien vient de la SESSION, cote serveur. Un `techId` qui
    // partirait d'ici serait le demarrage de l'intervention d'autrui pour qui
    // sait poster.
    const utilisateur = userEvent.setup();
    monter();

    await utilisateur.click(declencheur());
    await utilisateur.click(confirmation());

    expect(demarrerIntervention).toHaveBeenCalledWith({ interventionId: 847 });
  });

  it("n'envoie QU'UNE transition sur deux clics rapproches", async () => {
    // Meme garde que le bloc d'annulation : `disabled={enCours}` pendant la
    // transition. Deux envois ecriraient deux entrees d'audit si le verrou
    // serveur cedait, et produisent de toute facon deux allers-retours.
    let resoudre: (valeur: unknown) => void = () => undefined;
    demarrerIntervention.mockReturnValue(
      new Promise((resolution) => {
        resoudre = resolution;
      }),
    );
    const utilisateur = userEvent.setup();
    monter();

    await utilisateur.click(declencheur());
    const valider = confirmation();
    await utilisateur.click(valider);
    await utilisateur.click(valider);

    expect(demarrerIntervention).toHaveBeenCalledTimes(1);

    resoudre({ data: { ok: true } });
  });
});

describe("BoutonDemarrer - ce qu'il fait de la reponse", () => {
  it("annonce le succes et remet les deux surfaces a jour", async () => {
    // La revalidation serveur suffit au detail, qui est un Server Component ;
    // elle ne touche pas le cache TanStack de la tournee, d'ou le rappel.
    const utilisateur = userEvent.setup();
    monter();

    await utilisateur.click(declencheur());
    await utilisateur.click(confirmation());

    expect(toastSuccess).toHaveBeenCalledWith("Intervention démarrée");
    expect(refresh).toHaveBeenCalled();
    expect(onDemarree).toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("affiche le refus metier ET rafraichit la vue perimee", async () => {
    // 🔴 La lecon de la PR #33. Le refus dit que le statut a change sous les
    // yeux du technicien : sans rafraichissement, l'ecran garde « Planifiee »
    // et son bouton, et le geste se rejoue indefiniment contre une liste
    // fausse.
    demarrerIntervention.mockResolvedValue({
      data: { ok: false, message: "Cette intervention est déjà démarrée." },
    });
    const utilisateur = userEvent.setup();
    monter();

    await utilisateur.click(declencheur());
    await utilisateur.click(confirmation());

    expect(toastError).toHaveBeenCalledWith(
      "Cette intervention est déjà démarrée.",
      expect.objectContaining({ duration: 8_000 }),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(onDemarree).toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("affiche l'erreur serveur sans rien pretendre du statut", async () => {
    // `serverError` est le message generique de `handleServerError` : la
    // transaction a pu echouer avant comme apres, donc rien ne dit que la vue
    // est perimee. Aucun rafraichissement ici, et c'est deliberement asymetrique
    // du refus metier ci-dessus.
    demarrerIntervention.mockResolvedValue({
      serverError: "Une erreur est survenue. Réessayez dans un instant.",
    });
    const utilisateur = userEvent.setup();
    monter();

    await utilisateur.click(declencheur());
    await utilisateur.click(confirmation());

    expect(toastError).toHaveBeenCalledWith(
      "Une erreur est survenue. Réessayez dans un instant.",
      expect.objectContaining({ duration: 8_000 }),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("fonctionne sans rappel d'invalidation - le detail n'en passe pas", async () => {
    // Le hub du detail se contente de la revalidation serveur. Un `onDemarree`
    // appele sans garde y jetterait.
    const utilisateur = userEvent.setup();
    monter(false);

    await utilisateur.click(declencheur());
    await utilisateur.click(confirmation());

    expect(toastSuccess).toHaveBeenCalledWith("Intervention démarrée");
    expect(refresh).toHaveBeenCalled();
  });
});

describe("BoutonDemarrer - accessibilite", () => {
  it("ne presente aucune violation, modale fermee", async () => {
    const vue = monter();

    await expect(axe(vue.container)).resolves.toHaveNoViolations();
  });

  it("ne presente aucune violation, modale ouverte", async () => {
    // La modale est portalisee : elle vit hors du conteneur rendu, c'est donc
    // le document entier qu'il faut scanner.
    const utilisateur = userEvent.setup();
    const vue = monter();

    await utilisateur.click(declencheur());

    await expect(axe(document.body)).resolves.toHaveNoViolations();
    vue.unmount();
  });

  it("laisse la page manipulable une fois la modale refermee", async () => {
    // Radix pose `pointer-events: none` sur `<body>` tant qu'une modale est
    // ouverte, et c'est sa fermeture qui le retire. S'il restait, la page
    // serait visible et entierement inerte - un defaut qu'aucune assertion de
    // visibilite ne voit. Meme oracle que le bloc d'annulation.
    const utilisateur = userEvent.setup();
    monter();

    await utilisateur.click(declencheur());
    expect(document.body.style.pointerEvents).toBe("none");

    await utilisateur.click(confirmation());

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.body.style.pointerEvents).not.toBe("none");
  });
});
