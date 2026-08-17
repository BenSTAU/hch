// La vue de la tournee du jour - `US-INTERVENTIONS-LISTER-TECH-DU-JOUR`,
// ecran **T1**.
//
// Ce fichier eprouve ce que la SPEC §Cas nominal enumere ligne par ligne, plus
// deux proprietes qui n'ont aucune autre surface :
//
//   · **les six elements** de chaque ligne y sont tous - une omission se voit
//     ici et nulle part ailleurs, la requete les rendant tous ;
//   · **l'action contextuelle suit le statut** - « Demarrer » sur les seules
//     lignes `PLANNED`, depuis T-V2-02.
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { axe } from "jest-axe";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { InterventionTournee } from "@/lib/db/queries/interventions";

// La `queryFn` est une Server Action : elle tire `safe-action`, donc la DAL et
// Prisma. Doublee ici - ce que ce fichier eprouve est le RENDU, et la garde de
// l'action a son propre test.
vi.mock("@/lib/actions/interventions/lister-tournee", () => ({
  listerTournee: vi.fn(() => Promise.resolve({ data: undefined })),
}));

// Le bouton « Demarrer » de chaque ligne `PLANNED` appelle sa propre Server
// Action, et `useRouter` pour rafraichir apres coup. Les deux sont doubles :
// ce fichier eprouve le RENDU de la vue, la garde et la transition ayant leurs
// propres tests (`demarrer-intervention.test.ts`, `interventions.test.ts`).
vi.mock("@/lib/actions/interventions/demarrer-intervention", () => ({
  demarrerIntervention: vi.fn(() => Promise.resolve({ data: { ok: true } })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { TourneeVue } = await import("./tournee-vue");

/// `retry: false` : une `queryFn` doublee qui rend `undefined` fait lever la
/// notre, et trois rejeux avec temporisation feraient expirer le test.
function Enveloppe({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/// Minuit du 13 aout 2026 a Paris - CEST, donc 22 h UTC la veille.
const DEBUT_JOURNEE = "2026-08-12T22:00:00.000Z";

function intervention(
  surcharge: Partial<InterventionTournee> = {},
): InterventionTournee {
  return {
    id: 1,
    status: "PLANNED",
    // 10 h 00 a Paris.
    appointmentAt: "2026-08-13T08:00:00.000Z",
    durationSnapshot: 60,
    forfait: "Révision complète",
    client: { nom: "Sophie Dumas", telephone: "+33612345678" },
    adresse: {
      street: "12 rue de la République",
      zipCode: "69002",
      city: "Lyon",
    },
    point: { lon: 4.8357, lat: 45.764 },
    produits: [],
    ...surcharge,
  };
}

function afficher(interventions: InterventionTournee[]) {
  return render(
    <Enveloppe>
      <TourneeVue
        initialData={{ interventions, debutJournee: DEBUT_JOURNEE }}
        mapsApiKey={null}
      />
    </Enveloppe>,
  );
}

/// La LISTE, et elle seule.
///
/// ⚠️ **Oracles bornes le 2026-08-12 - regle du test rouge, cas 3.** Quatre
/// d'entre eux interrogeaient tout le document par `screen.getByText`, et sont
/// devenus ambigus quand la colonne droite a recu le bloc « A VENIR » de T1 :
/// il redit l'heure et le nom du prochain rendez-vous, deliberement, donc deux
/// noeuds portent le meme texte. La propriete visee n'a pas bouge - c'est la
/// LIGNE qui doit porter ces six elements - seule sa portee etait implicite.
function liste() {
  return within(
    screen.getByRole("region", { name: "Mes interventions du jour" }),
  );
}

describe("TourneeVue - les six elements de chaque ligne", () => {
  it("affiche heure, statut, forfait, duree, client, telephone, adresse et produits", () => {
    afficher([
      intervention({
        produits: [{ productId: 2, label: "Antivol en U", quantity: 1 }],
      }),
    ]);

    const ligne = screen.getByRole("listitem");

    // Heure de debut ET de fin : la fin se deduit de `durationSnapshot`, la
    // duree FIGEE a la reservation (Constitution §4.1).
    expect(within(ligne).getByText("10:00")).toBeInTheDocument();
    expect(within(ligne).getByText("11:00")).toBeInTheDocument();

    expect(within(ligne).getByText("Planifiée")).toBeInTheDocument();
    expect(within(ligne).getByText("Révision complète")).toBeInTheDocument();
    expect(within(ligne).getByText("60 min")).toBeInTheDocument();
    expect(within(ligne).getByText("Sophie Dumas")).toBeInTheDocument();
    expect(within(ligne).getByText("+33612345678")).toBeInTheDocument();

    // Adresse COMPLETE, pas la seule ville : le technicien s'y rend.
    expect(
      within(ligne).getByText(/12 rue de la République, 69002 Lyon/),
    ).toBeInTheDocument();

    expect(within(ligne).getByText(/Antivol en U/)).toBeInTheDocument();
  });

  it("rend l'heure en heure de PARIS, pas en UTC", () => {
    afficher([intervention()]);

    // 08 h 00 UTC = 10 h 00 a Paris en aout. Un formatage en UTC afficherait
    // « 08:00 » et enverrait le technicien deux heures trop tot.
    expect(liste().getByText("10:00")).toBeInTheDocument();
    expect(screen.queryByText("08:00")).not.toBeInTheDocument();
  });

  it("porte la valeur machine de l'horaire dans un `<time>`", () => {
    const { container } = afficher([intervention()]);

    const balise = container.querySelector("time");
    expect(balise).toHaveAttribute("datetime", "2026-08-13T08:00:00.000Z");
  });

  it("affiche le nom COMPLET du client, jamais l'initiale", () => {
    afficher([intervention()]);

    // `abregerNom` abrege le TECHNICIEN pour le client. L'appliquer ici
    // masquerait le nom du client a la personne qui va sonner chez lui
    // (Constitution §1.1), et la SPEC exige « client (nom ET telephone) ».
    expect(liste().getByText("Sophie Dumas")).toBeInTheDocument();
    expect(screen.queryByText("Sophie D.")).not.toBeInTheDocument();
  });

  it("rend le telephone appelable", () => {
    afficher([intervention()]);

    expect(screen.getByRole("link", { name: "+33612345678" })).toHaveAttribute(
      "href",
      "tel:+33612345678",
    );
  });

  it("affiche une mention neutre quand le telephone manque", () => {
    // Compte pseudonymise : le droit a l'oubli remet `users.phone` a NULL, et
    // l'intervention lui survit (Constitution §4.1, pas de FK cassee). La ligne
    // doit se rendre, pas casser ni laisser un vide inexplicable.
    afficher([
      intervention({
        client: { nom: "Utilisateur Anonymisé", telephone: null },
      }),
    ]);

    expect(screen.getByText("Téléphone non renseigné")).toBeInTheDocument();
    expect(liste().getByText("Utilisateur Anonymisé")).toBeInTheDocument();

    // ⚠️ **Assertion resserrée par T-V2-02** (règle du test rouge, cas 3), même
    // motif que dans `ligne-tournee.test.tsx` : elle prenait « aucun lien du
    // tout » pour « aucun lien téléphone », et la ligne porte désormais un lien
    // vers son détail. Ce qu'elle voulait dire est ci-dessous.
    expect(
      screen
        .getAllByRole("link")
        .filter((lien) => lien.getAttribute("href")?.startsWith("tel:")),
    ).toHaveLength(0);
  });

  it("n'affiche aucun bloc produits quand il n'y en a pas", () => {
    afficher([intervention({ produits: [] })]);

    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
  });

  it("affiche la quantite seulement au-dela de un", () => {
    afficher([
      intervention({
        produits: [
          { productId: 2, label: "Antivol en U", quantity: 1 },
          { productId: 1, label: "Chambre à air", quantity: 3 },
        ],
      }),
    ]);

    expect(
      screen.getByText(/Antivol en U · Chambre à air × 3/),
    ).toBeInTheDocument();
  });
});

describe("TourneeVue - le jour, jamais le statut", () => {
  it("affiche les quatre statuts, terminaux compris", () => {
    // La SPEC §Cas nominal exige que `DONE` et `CANCELLED` restent affiches en
    // fin de journee, pour la tracabilite de la tournee. C'est la regle INVERSE
    // de l'onglet « A venir » du client.
    afficher([
      intervention({ id: 1, status: "PLANNED" }),
      intervention({ id: 2, status: "IN_PROGRESS" }),
      intervention({ id: 3, status: "DONE" }),
      intervention({ id: 4, status: "CANCELLED" }),
    ]);

    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("Planifiée")).toBeInTheDocument();
    expect(screen.getByText("En cours")).toBeInTheDocument();
    expect(screen.getByText("Terminée")).toBeInTheDocument();
    expect(screen.getByText("Annulée")).toBeInTheDocument();
  });

  it("affiche un statut inconnu tel quel plutot que de l'escamoter", () => {
    // Symptome d'une divergence entre le CHECK SQL et la table de libelles.
    // Le masquer la rendrait invisible jusqu'au support.
    afficher([intervention({ status: "CONFIRMED" })]);

    expect(screen.getByText("CONFIRMED")).toBeInTheDocument();
  });
});

describe("TourneeVue - l'en-tete", () => {
  it("titre la journee listee", () => {
    afficher([intervention()]);

    expect(
      screen.getByRole("heading", { level: 1, name: /jeudi 13 août/i }),
    ).toBeInTheDocument();
  });

  it("compte les interventions", () => {
    afficher([intervention({ id: 1 }), intervention({ id: 2 })]);

    expect(screen.getByText("2 interventions")).toBeInTheDocument();
  });

  it("accorde le singulier", () => {
    afficher([intervention()]);

    expect(screen.getByText("1 intervention")).toBeInTheDocument();
  });

  it("somme le travail estime HORS interventions annulees", () => {
    // ⚠️ Sommer la duree d'une annulee dans du « travail estime » serait faux,
    // et c'est un total qu'un jury recalcule a la main sur trois lignes.
    afficher([
      intervention({ id: 1, durationSnapshot: 60 }),
      intervention({ id: 2, durationSnapshot: 110 }),
      intervention({ id: 3, durationSnapshot: 240, status: "CANCELLED" }),
    ]);

    // 60 + 110 = 170 min, et surtout pas 410.
    expect(screen.getByText("2 h 50 de travail estimé")).toBeInTheDocument();
    expect(screen.queryByText(/6 h 50/)).not.toBeInTheDocument();
  });

  it("n'affiche aucun chip de duree quand tout est annule", () => {
    afficher([intervention({ status: "CANCELLED" })]);

    expect(screen.queryByText(/travail estimé/)).not.toBeInTheDocument();
  });
});

describe("TourneeVue - la journee vide", () => {
  it("affiche un message explicite, pas une liste vide", () => {
    afficher([]);

    expect(
      screen.getByText("Aucune intervention prévue aujourd'hui."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText("Aucune intervention")).toBeInTheDocument();
  });
});

// ⚠️ **Ce bloc s'appelait « ce que T-V2-01 ne pose pas » et affirmait
// qu'AUCUN lien de detail n'etait rendu.** L'oracle etait juste pour son
// moment - la route `/interventions/[id]` n'existait pas, un lien y aurait
// mene a un 404 - et T-V2-02 le rend faux en livrant la route, le lien et
// l'action contextuelle ensemble, comme la DoD le prevoyait. Regle du test
// rouge, cas 3 : test fautif parce qu'il fige un etat transitoire qu'un
// changement legitime leve. Il est **remplace par son symetrique**, pas
// supprime : ce qui etait « aucun lien » devient « le bon lien, et le bouton
// sur les seules lignes qui l'admettent ».
describe("TourneeVue - le lien et l'action contextuelle (T-V2-02)", () => {
  it("ouvre le detail depuis chaque ligne, quel que soit son statut", () => {
    // Cadrage D4. Les deux statuts terminaux y arrivent en lecture seule.
    afficher([
      intervention({ id: 1, status: "PLANNED" }),
      intervention({ id: 2, status: "IN_PROGRESS" }),
      intervention({ id: 3, status: "DONE" }),
      intervention({ id: 4, status: "CANCELLED" }),
    ]);

    const cibles = screen
      .getAllByRole("link")
      .map((lien) => lien.getAttribute("href"))
      .filter((href) => href?.startsWith("/interventions/"));

    expect(cibles).toEqual([
      "/interventions/1",
      "/interventions/2",
      "/interventions/3",
      "/interventions/4",
    ]);
  });

  it("ne propose « Demarrer » que sur les lignes PLANNED", () => {
    // 🔴 SPEC §Cas nominal : « "Demarrer" si PLANNED, "Ouvrir detail" si
    // IN_PROGRESS, lecture seule si DONE ou CANCELLED ». « Ouvrir detail » EST
    // le lien de la carte, teste ci-dessus ; le seul bouton reel est celui de
    // `PLANNED`. Un bouton sur une ligne terminale serait le bouton inerte que
    // la DoD interdit nommement.
    afficher([
      intervention({ id: 1, status: "PLANNED" }),
      intervention({ id: 2, status: "IN_PROGRESS" }),
      intervention({ id: 3, status: "DONE" }),
      intervention({ id: 4, status: "CANCELLED" }),
    ]);

    expect(
      screen.getAllByRole("button", { name: /Démarrer l'intervention/ }),
    ).toHaveLength(1);
  });

  it("ne rend aucun bouton sur une tournee sans ligne PLANNED", () => {
    afficher([
      intervention({ id: 3, status: "DONE" }),
      intervention({ id: 4, status: "CANCELLED" }),
    ]);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("ne monte pas la carte sans cle Maps", () => {
    // `HCH_MAPS_API_KEY` est facultative : absente, la liste sert de repli, et
    // c'est le meme chemin de code que lorsque le script ne charge pas.
    const { container } = afficher([intervention()]);

    expect(container.querySelector("[aria-hidden='true'].relative")).toBeNull();
    expect(
      screen.queryByText(/Chargement de la carte/),
    ).not.toBeInTheDocument();
  });
});

describe("TourneeVue - le second chemin du DTO", () => {
  // ⚠️ Tous les tests ci-dessus ne
  // rendent que `initialData`, le PREMIER des deux chemins par lesquels ce DTO
  // traverse la frontiere. Le second - le retour de la Server Action au polling -
  // n'etait rendu nulle part : la `queryFn` est doublee sur un `{ data:
  // undefined }` qui fait toujours lever. Or c'est precisement le chemin dont le
  // module dit qu'une divergence « ne se verrait qu'apres 30 secondes
  // d'affichage correct ».

  it("remplace la liste affichee par ce que rend la Server Action", async () => {
    const { listerTournee } =
      await import("@/lib/actions/interventions/lister-tournee");

    vi.mocked(listerTournee).mockResolvedValue({
      data: {
        interventions: [
          intervention({
            id: 99,
            forfait: "Diagnostic express",
            client: { nom: "Karim Benali", telephone: "+33700000000" },
          }),
        ],
        debutJournee: DEBUT_JOURNEE,
      },
    } as never);

    afficher([intervention({ id: 1, forfait: "Révision complète" })]);

    // La forme rendue par l'action se rend exactement comme `initialData` : meme
    // heure de Paris, meme nom complet, meme telephone appelable.
    expect(await screen.findByText("Diagnostic express")).toBeInTheDocument();
    expect(liste().getByText("Karim Benali")).toBeInTheDocument();
    expect(liste().getByText("10:00")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "+33700000000" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Révision complète")).not.toBeInTheDocument();
  });

  it("CONSERVE la liste affichee quand le rafraichissement echoue", async () => {
    // Session expiree, panne reseau, action refusee : la tournee deja affichee
    // ne doit pas se vider sous le technicien en pleine journee.
    //
    // ⚠️ L'echec est **silencieux** - `useQuery` n'expose ici que `data`, jamais
    // `isError`, et rien a l'ecran ne dit que la liste a cesse de se rafraichir.
    // Constate, pas prescrit : aucune DoD ni US ne demande d'indicateur. Remonte
    // dans le rapport.
    const { listerTournee } =
      await import("@/lib/actions/interventions/lister-tournee");

    vi.mocked(listerTournee).mockRejectedValue(new Error("réseau coupé"));

    afficher([intervention({ forfait: "Révision complète" })]);

    await waitFor(() => {
      expect(listerTournee).toHaveBeenCalled();
    });

    expect(screen.getByText("Révision complète")).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toBeInTheDocument();
  });
});

describe("TourneeVue - accessibilite", () => {
  it("ordonne la tournee dans une liste ORDONNEE", () => {
    // L'ordre chronologique EST l'information : c'est la tournee dans l'ordre
    // ou elle se fait, pas un ensemble.
    const { container } = afficher([intervention()]);

    expect(container.querySelector("ol")).not.toBeNull();
  });

  it("ne presente aucune violation axe sur une tournee chargee", async () => {
    const vue = afficher([
      intervention({ id: 1, status: "PLANNED" }),
      intervention({
        id: 2,
        status: "CANCELLED",
        client: { nom: "Utilisateur Anonymisé", telephone: null },
        produits: [{ productId: 2, label: "Antivol en U", quantity: 2 }],
      }),
    ]);

    await expect(axe(vue.container)).resolves.toHaveNoViolations();
  });

  it("ne presente aucune violation axe sur une journee vide", async () => {
    const vue = afficher([]);

    await expect(axe(vue.container)).resolves.toHaveNoViolations();
  });
});
