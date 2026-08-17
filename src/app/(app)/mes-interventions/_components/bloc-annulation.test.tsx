// Bloc d'annulation du panneau de detail - `US-INTERVENTION-ANNULER-CLIENT`,
// ecran **C8**.
//
// Ce fichier ne rejoue pas la fenetre H-24 elle-meme : elle vit dans un module
// pur, `src/lib/interventions/annulation.ts`, et y est testee. Ce qui se joue
// ici est ce que l'ecran EN FAIT :
//
//   · **deux etats exclusifs** - le bouton dans la fenetre, le bandeau de
//     contact au-dela. Jamais un bouton grise sans recours, que le client
//     cliquerait sans comprendre ;
//   · **aucun contournement passe H-24** - SPEC §7.2 assume un traitement hors
//     systeme, et aucune US v1 ne permet a l'administration d'annuler a la
//     place du client. Un bouton « demander l'annulation » serait une file de
//     leads, que Constitution §1.2 s'interdit ;
//   · **le refus serveur fait basculer l'ecran** - un onglet reste ouvert
//     pendant que la fenetre se referme doit atterrir sur le contact, pas sur
//     une alerte rouge repetee.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

const annulerIntervention = vi.fn();
vi.mock("@/lib/actions/interventions/annuler-intervention", () => ({
  annulerIntervention: (args: unknown) => annulerIntervention(args),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => toastSuccess(message),
    error: (message: string) => toastError(message),
  },
}));

const { BlocAnnulation } = await import("./bloc-annulation");

type Contact = Parameters<typeof BlocAnnulation>[0]["contact"];

const RDV = new Date("2026-08-20T08:00:00.000Z");
const CONTACT = { telephone: "+33639980000", email: "contact@exemple.fr" };

/// `maintenant` place a `heures` avant le rendez-vous.
function aMoins(heures: number): Date {
  return new Date(RDV.getTime() - heures * 3_600_000);
}

function monter(heuresAvant: number, contact: Contact = CONTACT) {
  return render(
    <BlocAnnulation
      interventionId={847}
      appointmentAt={RDV}
      maintenant={aMoins(heuresAvant)}
      contact={contact}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  annulerIntervention.mockResolvedValue({ data: { ok: true } });
});

describe("BlocAnnulation - dans la fenetre", () => {
  it("propose le bouton et annonce la regle des 24 h", () => {
    monter(48);

    expect(
      screen.getByRole("button", { name: /Annuler cette intervention/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/jusqu'à 24 h avant/)).toBeInTheDocument();
  });

  it("ne promet AUCUNE gratuite", () => {
    // La maquette C8 ecrit « Annulation gratuite jusqu'a 24h ». Non porte :
    // Constitution §2.3 exclut tout paiement en ligne, il n'y a donc rien a ne
    // pas facturer, et le mot promet un remboursement sans objet.
    monter(48);

    expect(screen.queryByText(/gratuit/i)).toBeNull();
  });

  it("demande un motif dans la modale avant de confirmer", async () => {
    const utilisateur = userEvent.setup();
    monter(48);

    await utilisateur.click(
      screen.getByRole("button", { name: /Annuler cette intervention/ }),
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/Motif de l'annulation/)).toBeInTheDocument();
  });

  it("envoie l'identifiant et le motif saisi", async () => {
    const utilisateur = userEvent.setup();
    monter(48);

    await utilisateur.click(
      screen.getByRole("button", { name: /Annuler cette intervention/ }),
    );
    await utilisateur.type(
      screen.getByLabelText(/Motif de l'annulation/),
      "Report",
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /Confirmer l'annulation/ }),
    );

    expect(annulerIntervention).toHaveBeenCalledWith({
      interventionId: 847,
      motif: "Report",
    });
  });

  it("annonce le succes par un message qui survit au demontage", async () => {
    // La ligne quitte la liste au meme instant : elle passe en « Passees », donc
    // ce composant se demonte. Un message rendu ICI disparaitrait avec lui,
    // c'est le motif du toast plutot que d'un bandeau local.
    const utilisateur = userEvent.setup();
    monter(48);

    await utilisateur.click(
      screen.getByRole("button", { name: /Annuler cette intervention/ }),
    );
    await utilisateur.type(
      screen.getByLabelText(/Motif de l'annulation/),
      "Report",
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /Confirmer l'annulation/ }),
    );

    expect(toastSuccess).toHaveBeenCalledWith("Intervention annulée");
  });

  it("affiche le refus de motif renvoye par le schema", async () => {
    annulerIntervention.mockResolvedValue({
      validationErrors: { motif: { _errors: ["Motif d'annulation requis."] } },
    });
    const utilisateur = userEvent.setup();
    monter(48);

    await utilisateur.click(
      screen.getByRole("button", { name: /Annuler cette intervention/ }),
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /Confirmer l'annulation/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Motif d'annulation requis.",
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    // Un refus de schema ne mute rien, donc rien n'est revalide et ce bloc
    // reste monte : l'alerte a cote du champ est la bonne surface, et le toast
    // serait de trop.
    expect(toastError).not.toHaveBeenCalled();
  });

  it("annonce un refus METIER par un message qui survit au demontage", async () => {
    // 🐛 **Rouge de la barriere CI du 2026-08-11, vert en local.**
    //
    // `introuvable` et `non_annulable` disent que la ligne n'est plus dans
    // « A venir » : la Server Action revalide, la liste revient sans elle, et
    // ce composant SE DEMONTE. Une alerte posee ici part avec lui. Le local a
    // survecu en `pnpm dev`, ou l'aller-retour RSC est assez lent pour que
    // l'alerte s'affiche d'abord ; face a l'image de production, le demontage
    // gagne.
    //
    // jsdom ne peut pas reproduire le demontage - il vient de la revalidation
    // Next, hors de portee d'un test de composant. Ce que ce test verrouille
    // est donc la DECISION : le message part au `Toaster` du layout, qui reste
    // monte. La preuve du comportement, elle, est dans `gp-03`.
    annulerIntervention.mockResolvedValue({
      data: {
        ok: false,
        message: "Intervention introuvable.",
        fenetreDepassee: false,
      },
    });
    const utilisateur = userEvent.setup();
    monter(48);

    await utilisateur.click(
      screen.getByRole("button", { name: /Annuler cette intervention/ }),
    );
    await utilisateur.type(
      screen.getByLabelText(/Motif de l'annulation/),
      "Report",
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /Confirmer l'annulation/ }),
    );

    expect(toastError).toHaveBeenCalledWith("Intervention introuvable.");
    expect(toastSuccess).not.toHaveBeenCalled();
    // Et la modale se ferme : la laisser ouverte proposerait de reessayer un
    // geste que le serveur vient de refuser deux fois de suite.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("n'envoie QU'UNE annulation sur deux clics rapproches", async () => {
    // Le pendant a l'ecran du verrou de ligne : deux envois pour la meme
    // intervention ecrivent deux entrees d'audit et deux emails au technicien
    // (le second `UPDATE` etant, lui, inoffensif). Le serveur les rattrape
    // desormais, mais un ecran qui les emet reste un ecran qui produit du bruit
    // dans la piece qu'on produit en cas de contestation.
    //
    // `disabled={enCours}` est la garde attendue : `useTransition` passe en
    // attente des le premier clic et n'en sort qu'a la resolution.
    let resoudre: (valeur: { data: { ok: true } }) => void = () => undefined;
    annulerIntervention.mockReturnValue(
      new Promise<{ data: { ok: true } }>((resolution) => {
        resoudre = resolution;
      }),
    );
    const utilisateur = userEvent.setup();
    monter(48);

    await utilisateur.click(
      screen.getByRole("button", { name: /Annuler cette intervention/ }),
    );
    await utilisateur.type(
      screen.getByLabelText(/Motif de l'annulation/),
      "Report",
    );

    const confirmer = screen.getByRole("button", {
      name: /Confirmer l'annulation/,
    });
    await utilisateur.click(confirmer);
    await utilisateur.click(confirmer);

    expect(annulerIntervention).toHaveBeenCalledTimes(1);

    resoudre({ data: { ok: true } });
  });

  it("bascule sur le contact quand le serveur repond que la fenetre est passee", async () => {
    // L'ecran a ete rendu a H-25 et le client confirme a H-23 : c'est le double
    // filet qui tranche, et sa reponse doit changer l'etat plutot que
    // d'afficher une alerte que rien ne resout.
    annulerIntervention.mockResolvedValue({
      data: {
        ok: false,
        message: "Annulation impossible à moins de 24 h du rendez-vous.",
        fenetreDepassee: true,
      },
    });
    const utilisateur = userEvent.setup();
    monter(25);

    await utilisateur.click(
      screen.getByRole("button", { name: /Annuler cette intervention/ }),
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /Confirmer l'annulation/ }),
    );

    expect(
      await screen.findByText(/Annulation impossible en ligne/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Annuler cette intervention/ }),
    ).toBeNull();
  });

  it("ne laisse pas la page inerte quand la modale disparait sous elle", async () => {
    // Ce refus-la est le seul qui DEMONTE la modale au lieu de la fermer : le
    // composant rend le bandeau de contact, et le `Dialog` ouvert s'en va avec
    // lui dans le meme rendu. Or une modale Radix pose `pointer-events: none`
    // sur `<body>` tant qu'elle est ouverte, et c'est son demontage qui le
    // retire. S'il ne se jouait pas, la page resterait visible et entierement
    // inerte - un defaut qu'aucune assertion de visibilite ne voit, ni ici ni
    // en E2E ou `toBeVisible` passerait tout autant.
    annulerIntervention.mockResolvedValue({
      data: {
        ok: false,
        message: "Annulation impossible à moins de 24 h du rendez-vous.",
        fenetreDepassee: true,
      },
    });
    const utilisateur = userEvent.setup();
    monter(25);

    await utilisateur.click(
      screen.getByRole("button", { name: /Annuler cette intervention/ }),
    );
    // Le prealable qui rend l'assertion suivante discriminante : sans cette
    // ligne, un jour ou Radix cesserait de poser l'attribut, le test passerait
    // en ne mesurant plus rien.
    expect(document.body.style.pointerEvents).toBe("none");

    await utilisateur.click(
      screen.getByRole("button", { name: /Confirmer l'annulation/ }),
    );

    await screen.findByText(/Annulation impossible en ligne/);

    expect(document.body.style.pointerEvents).not.toBe("none");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("BlocAnnulation - hors fenetre", () => {
  it("ferme le self-service a EXACTEMENT H-24, comme le serveur", () => {
    // La borne exacte est testee dans le module pur et dans la transaction ;
    // elle ne l'etait sur AUCUNE des deux surfaces d'ecran. C'est pourtant la
    // seule valeur ou les deux formulations de l'US (`> 24 h` au nominal,
    // `<= 24 h` au cas d'erreur) pourraient diverger, et un ecran qui
    // trancherait l'egalite dans l'autre sens proposerait un bouton que la
    // transaction refuse - exactement l'ecart que la prop `maintenant` et le
    // module partage cherchent a rendre impossible.
    monter(24);

    expect(
      screen.getByText(/Annulation impossible en ligne/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Annuler cette intervention/ }),
    ).toBeNull();
  });

  it("remplace le bouton par le renvoi vers l'atelier", () => {
    monter(23);

    expect(
      screen.getByText(/Annulation impossible en ligne/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Annuler cette intervention/ }),
    ).toBeNull();
  });

  it("n'offre AUCUN contournement", () => {
    // SPEC §7.2 : traitement hors systeme assume, aucune US v1 cote
    // administration. Ne pas coder de porte derobee est une consigne, pas un
    // oubli - ce test la rend opposable.
    monter(23);

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/demander l'annulation/i)).toBeNull();
    expect(screen.queryByText(/liste d'attente/i)).toBeNull();
  });

  it("porte les coordonnees lues dans app_settings", () => {
    monter(23);

    expect(screen.getByRole("link", { name: /\+33639980000/ })).toHaveAttribute(
      "href",
      "tel:+33639980000",
    );
    expect(
      screen.getByRole("link", { name: /contact@exemple\.fr/ }),
    ).toHaveAttribute("href", "mailto:contact@exemple.fr");
  });

  it("ne rend aucun lien mort quand les coordonnees sont vides", () => {
    // `app_settings.value` est NULLable et l'administrateur peut vider le champ.
    // Un `tel:` construit sur une chaine vide serait un lien qui ne fait rien.
    monter(23, { telephone: null, email: null });

    expect(
      screen.getByText(/Annulation impossible en ligne/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("BlocAnnulation - accessibilite", () => {
  it("ne presente aucune violation dans la fenetre", async () => {
    const vue = monter(48);

    await expect(axe(vue.container)).resolves.toHaveNoViolations();
  });

  it("ne presente aucune violation modale ouverte", async () => {
    const utilisateur = userEvent.setup();
    const vue = monter(48);

    await utilisateur.click(
      screen.getByRole("button", { name: /Annuler cette intervention/ }),
    );

    // La modale est portalisee : elle vit hors du conteneur rendu, et scanner
    // `vue.container` seul ne verrait rien. C'est le document entier qui compte.
    await expect(axe(document.body)).resolves.toHaveNoViolations();
    vue.unmount();
  });

  it("nomme « Fermer » le bouton de fermeture de la modale", async () => {
    // `dialog.tsx:78-83` traduit le « Close » du registry shadcn et demande que
    // le report soit refait si le fichier est regenere - exactement la consigne
    // qui accompagne le `Sheet` de la coquille publique, et celle-la EST tenue
    // par un test depuis la PR #21. La modale d'annulation est le premier
    // usage de `Dialog` dans l'application : sans cet oracle, la regeneration
    // remettrait un nom accessible anglais sans que rien ne l'attrape.
    const utilisateur = userEvent.setup();
    monter(48);

    await utilisateur.click(
      screen.getByRole("button", { name: /Annuler cette intervention/ }),
    );

    expect(screen.getByRole("button", { name: "Fermer" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Close$/i })).toBeNull();
  });

  it("ne presente aucune violation hors fenetre", async () => {
    const vue = monter(23);

    await expect(axe(vue.container)).resolves.toHaveNoViolations();
  });
});
