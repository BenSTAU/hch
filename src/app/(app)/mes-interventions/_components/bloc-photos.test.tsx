// Depot de photo T+n, depuis le panneau de detail.
//
// Deux moments pour une seule US (`US-INTERVENTION-PHOTOS-AJOUTER`) : le tunnel
// (T=0, T-V3-08) et l'intervention deja planifiee (T+n, ici). La difference
// n'est pas cosmetique - au T=0 les lignes `photos` naissent dans la
// transaction de validation, au T+n l'intervention preexiste et l'ecriture est
// immediate.
//
// Ce que ce fichier verifie :
//
//   · **les vignettes passent par la route controlee**, jamais par un chemin
//     disque. Une photo prise au domicile de quelqu'un ne doit pas dependre du
//     seul caractere non devinable de son URL ;
//   · **l'envoi est en deux temps** - l'endpoint depouille l'EXIF et rend un
//     chemin, l'action ecrit la ligne. Un seul chemin de traitement d'image
//     pour les deux moments ;
//   · **le quota borne l'ecran** sans decider : celui qui decide est compte
//     dans la transaction, deux onglets ouverts le franchiraient sinon.
//
// L'endpoint est intercepte par **MSW** et non par `vi.mock(fetch)` : ADR-014
// §2 reserve la frontiere reseau a MSW, et `vi.mock` remplacerait une fonction
// au lieu de couvrir une frontiere.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/node";

const ajouterPhoto = vi.fn();
vi.mock("@/lib/actions/interventions/ajouter-photo", () => ({
  ajouterPhoto: (args: unknown) => ajouterPhoto(args),
}));

const { BlocPhotos } = await import("./bloc-photos");

const CHEMIN = "uploads/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.webp";

/// Une image minuscule, mais un vrai `File` : le composant lit `name` et pose
/// le fichier dans un `FormData`.
function fichier(nom = "velo.jpg") {
  return new File([new Uint8Array([1, 2, 3])], nom, { type: "image/jpeg" });
}

/// `*` en tete : le composant appelle une URL RELATIVE, que jsdom resout contre
/// son origine. Le motif absorbe l'origine quelle qu'elle soit.
function endpointUpload(reponse: () => Response) {
  return http.post("*/api/upload-intervention-photo", reponse);
}

beforeEach(() => {
  vi.clearAllMocks();
  ajouterPhoto.mockResolvedValue({ data: { ok: true, nbPhotos: 1 } });
  server.use(
    endpointUpload(() => HttpResponse.json({ ok: true, url: CHEMIN })),
  );
});

describe("BlocPhotos - vignettes", () => {
  it("sert chaque photo par la route controlee, jamais par son chemin disque", () => {
    render(
      <BlocPhotos
        interventionId={42}
        photos={[{ id: 7 }, { id: 9 }]}
        modifiable
      />,
    );

    const vignettes = screen.getAllByRole("img");

    expect(vignettes[0]).toHaveAttribute("src", "/api/intervention-photos/7");
    expect(vignettes[1]).toHaveAttribute("src", "/api/intervention-photos/9");
  });

  it("nomme chaque vignette, sans jamais recopier le nom du fichier d'origine", () => {
    // Le nom d'origine n'atteint jamais le disque (`enregistrerPhoto` renomme
    // en UUID) et n'a aucune raison de reapparaitre ici : il peut porter le
    // prenom ou la date de qui a pris la photo.
    render(<BlocPhotos interventionId={42} photos={[{ id: 7 }]} modifiable />);

    expect(
      screen.getByRole("img", { name: "Photo 1 de l'intervention" }),
    ).toBeInTheDocument();
  });

  it("le dit quand aucune photo n'est jointe", () => {
    render(<BlocPhotos interventionId={42} photos={[]} modifiable />);

    expect(
      screen.getByText(/Aucune photo jointe à cette intervention/),
    ).toBeInTheDocument();
  });

  it("montre les vignettes meme sans depot possible", () => {
    // Une intervention cloturee garde ses photos consultables ; ce qui
    // disparait est la zone de depot.
    render(
      <BlocPhotos
        interventionId={42}
        photos={[{ id: 7 }]}
        modifiable={false}
      />,
    );

    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(
      screen.queryByText(/Ajouter une photo pour le technicien/),
    ).toBeNull();
  });
});

describe("BlocPhotos - depot", () => {
  it("monte le fichier puis ecrit la ligne, dans cet ordre", async () => {
    const utilisateur = userEvent.setup();
    render(<BlocPhotos interventionId={42} photos={[]} modifiable />);

    await utilisateur.upload(
      screen.getByLabelText(/Ajouter une photo pour le technicien/),
      fichier(),
    );

    await waitFor(() => {
      expect(ajouterPhoto).toHaveBeenCalledWith({
        interventionId: 42,
        // Le chemin rendu par l'endpoint, jamais un nom choisi par l'ecran.
        url: CHEMIN,
      });
    });
  });

  it("n'ecrit aucune ligne quand l'endpoint refuse le fichier", async () => {
    // Poids, format, ou quota de debit. Une ligne ecrite sans fichier sur le
    // disque produirait une vignette definitivement cassee.
    server.use(
      endpointUpload(() =>
        HttpResponse.json(
          { ok: false, message: "Chaque photo doit peser 5 Mo au maximum." },
          { status: 413 },
        ),
      ),
    );

    const utilisateur = userEvent.setup();
    render(<BlocPhotos interventionId={42} photos={[]} modifiable />);

    await utilisateur.upload(
      screen.getByLabelText(/Ajouter une photo pour le technicien/),
      fichier(),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Chaque photo doit peser 5 Mo au maximum.",
    );
    expect(ajouterPhoto).not.toHaveBeenCalled();
  });

  it("montre le refus que l'action formule", async () => {
    ajouterPhoto.mockResolvedValue({
      data: { ok: false, message: "5 photos maximum par intervention." },
    });

    const utilisateur = userEvent.setup();
    render(<BlocPhotos interventionId={42} photos={[]} modifiable />);

    await utilisateur.upload(
      screen.getByLabelText(/Ajouter une photo pour le technicien/),
      fichier(),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "5 photos maximum par intervention.",
    );
  });
});

describe("BlocPhotos - quota", () => {
  it("desarme la zone de depot a cinq photos", () => {
    const photos = [1, 2, 3, 4, 5].map((id) => ({ id }));
    render(<BlocPhotos interventionId={42} photos={photos} modifiable />);

    expect(
      screen.getByLabelText(/Ajouter une photo pour le technicien/),
    ).toBeDisabled();
  });

  it("laisse la zone active a quatre", () => {
    const photos = [1, 2, 3, 4].map((id) => ({ id }));
    render(<BlocPhotos interventionId={42} photos={photos} modifiable />);

    expect(
      screen.getByLabelText(/Ajouter une photo pour le technicien/),
    ).toBeEnabled();
  });

  it("annonce les quotas reels, pas des valeurs inventees", () => {
    // `US-INTERVENTION-PHOTOS-AJOUTER` §Quotas : 5 photos, 5 Mo, JPG PNG WebP
    // HEIC. Un libelle qui divergerait des constantes ferait promettre a
    // l'ecran ce que le serveur refuse.
    render(<BlocPhotos interventionId={42} photos={[]} modifiable />);

    expect(
      screen.getByText(
        /JPG, PNG, WEBP ou HEIC, 5 Mo maximum, 5 photos au plus/,
      ),
    ).toBeInTheDocument();
  });

  it("n'offre aucune suppression", () => {
    // ⚠️ **Aucune US ne decrit le retrait d'une photo apres validation.** Le
    // bouton « supprimer » de la SPEC porte sur les vignettes du tunnel, AVANT
    // validation finale. Le manque est signale en PR, il n'est pas comble - et
    // ce test empeche qu'il soit comble par inadvertance.
    render(<BlocPhotos interventionId={42} photos={[{ id: 7 }]} modifiable />);

    expect(
      screen.queryByRole("button", { name: /Retirer|Supprimer/i }),
    ).toBeNull();
  });
});
