// @vitest-environment node
//
// Route de lecture des photos d'intervention.
//
// Elle existe parce que l'arbitrage du 2026-08-11 a tranche l'hypothese B :
// `uploads/` n'est pas servi statiquement, chaque vignette passe par un
// controle de propriete. Ce que ce fichier verifie n'est donc pas un rendu,
// c'est **une frontiere** - et une frontiere qui ne dit jamais ce qu'elle
// protege.
//
// La regle qui gouverne tout le fichier : **404 pour les quatre causes**.
// Anonyme, identifiant malforme, photo d'un tiers, fichier absent du disque.
// Un 401 distinct apprendrait a un visiteur non connecte quelles photos
// existent ; un 403 distinct confirmerait l'existence de celle d'autrui, sur
// une table dont la cle est un SERIAL.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getOptionalUser = vi.fn();
vi.mock("@/lib/auth/dal", () => ({
  getOptionalUser: () => getOptionalUser(),
}));

const chargerPhotoAutorisee = vi.fn();
vi.mock("@/lib/db/queries/photos", () => ({
  chargerPhotoAutorisee: (args: unknown) => chargerPhotoAutorisee(args),
}));

const lirePhoto = vi.fn();
vi.mock("@/lib/photos/stockage", () => ({
  lirePhoto: (url: string) => lirePhoto(url),
}));

const { GET } = await import("./route");

const CLIENT = "11111111-1111-4111-8111-111111111111";
const CHEMIN = "uploads/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.webp";

/// Le contexte que Next passe au handler. `params` est une PROMESSE depuis la
/// 15 (`node_modules/next/dist/docs/.../route.md`), et l'oublier ferait passer
/// un test sur une forme que le framework n'envoie plus.
function contexte(id: string) {
  return { params: Promise.resolve({ id }) } as Parameters<typeof GET>[1];
}

const requete = new Request("http://localhost/api/intervention-photos/7");

beforeEach(() => {
  vi.clearAllMocks();
  getOptionalUser.mockResolvedValue({ id: CLIENT });
  chargerPhotoAutorisee.mockResolvedValue({ url: CHEMIN });
  lirePhoto.mockResolvedValue(Buffer.from("RIFF....WEBP"));
});

describe("GET /api/intervention-photos/[id] - ce qu'elle sert", () => {
  it("rend l'image au proprietaire", async () => {
    const reponse = await GET(requete, contexte("7"));

    expect(reponse.status).toBe(200);
    expect(reponse.headers.get("Content-Type")).toBe("image/webp");
  });

  it("demande la photo AU NOM du compte connecte", async () => {
    // L'identifiant du demandeur vient de la session, jamais de l'URL. C'est la
    // clause `where` de la requete qui cloisonne, et elle ne peut pas etre
    // court-circuitee par un `if` oublie ici.
    //
    // ⚠️ `userId` et non `clientId` depuis T-V2-02 : la route ne sait plus si
    // le demandeur est le client ou le technicien affecte, et n'a pas a le
    // savoir. La regle entiere vit dans `chargerPhotoAutorisee`.
    await GET(requete, contexte("7"));

    expect(chargerPhotoAutorisee).toHaveBeenCalledWith({
      photoId: 7,
      userId: CLIENT,
    });
  });

  it("interdit a un cache partage de retenir la reponse", async () => {
    // La reponse depend de la session : un cache partage qui la retiendrait la
    // servirait au visiteur suivant. `private` et non `no-store` - le
    // navigateur du proprietaire a le droit de la garder.
    const reponse = await GET(requete, contexte("7"));

    expect(reponse.headers.get("Cache-Control")).toContain("private");
    expect(reponse.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("GET /api/intervention-photos/[id] - ce qu'elle refuse", () => {
  it("repond 404 a un visiteur anonyme, et n'interroge pas la base", async () => {
    getOptionalUser.mockResolvedValue(null);

    const reponse = await GET(requete, contexte("7"));

    expect(reponse.status).toBe(404);
    expect(chargerPhotoAutorisee).not.toHaveBeenCalled();
  });

  it("repond 404 sur la photo d'un tiers", async () => {
    chargerPhotoAutorisee.mockResolvedValue(null);

    const reponse = await GET(requete, contexte("7"));

    expect(reponse.status).toBe(404);
    expect(lirePhoto).not.toHaveBeenCalled();
  });

  it("repond 404 quand le fichier a disparu du disque", async () => {
    // Ligne en base sans fichier : restauration partielle, ou bind mount
    // `uploads/` non monte. Le client voit une image cassee, pas une erreur
    // serveur.
    lirePhoto.mockResolvedValue(null);

    const reponse = await GET(requete, contexte("7"));

    expect(reponse.status).toBe(404);
  });

  it("ecarte un identifiant qui n'est pas un entier positif avant la base", async () => {
    // `photos.id` est un SERIAL. Tout le reste vient de l'URL, donc de
    // n'importe qui, et n'a rien a faire dans une requete.
    for (const hostile of [
      "0",
      "-3",
      "1.5",
      "abc",
      "7; DROP TABLE photos",
      "",
    ]) {
      vi.clearAllMocks();
      getOptionalUser.mockResolvedValue({ id: CLIENT });

      const reponse = await GET(requete, contexte(hostile));

      expect(reponse.status).toBe(404);
      expect(chargerPhotoAutorisee).not.toHaveBeenCalled();
    }
  });

  it("ne dit jamais laquelle des quatre causes s'applique", async () => {
    // Le corps est vide et le statut identique dans les quatre cas : c'est ce
    // qui empeche de distinguer « cette photo n'existe pas » de « elle existe
    // et elle n'est pas a vous ».
    const cas = [
      () => getOptionalUser.mockResolvedValue(null),
      () => chargerPhotoAutorisee.mockResolvedValue(null),
      () => lirePhoto.mockResolvedValue(null),
    ];

    for (const poser of cas) {
      vi.clearAllMocks();
      getOptionalUser.mockResolvedValue({ id: CLIENT });
      chargerPhotoAutorisee.mockResolvedValue({ url: CHEMIN });
      lirePhoto.mockResolvedValue(Buffer.from("RIFF"));
      poser();

      const reponse = await GET(requete, contexte("7"));

      expect(reponse.status).toBe(404);
      expect(await reponse.text()).toBe("");
    }
  });
});
