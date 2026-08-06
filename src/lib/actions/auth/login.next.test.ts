// @vitest-environment node
//
// Destination post-connexion — la boucle que T-J0-04 a laissée ouverte.
//
// `src/proxy.ts:35` pose `?next=<chemin>` sur sa redirection depuis le
// 2026-08-05, et rien ne le lisait : le proxy produisait une valeur que
// personne ne consommait. La DoD de T-J0-05 ferme la boucle **et** nomme le
// risque qui vient avec — *« vecteur d'open redirect le jour où la boucle se
// ferme »*.
//
// Fichier séparé de `login.test.ts` : celui-ci laisse `redirect()` lever pour
// prouver que next-safe-action ne l'avale pas, on ne peut donc pas y observer
// la destination sans casser cette preuve. Ici, `next/navigation` est mocké et
// c'est la destination qu'on regarde.
import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateWithPassword = vi.fn();
vi.mock("@/lib/auth/authenticate", () => ({
  authenticateWithPassword: (email: string, password: string) =>
    authenticateWithPassword(email, password),
}));

vi.mock("@/lib/auth/session", () => ({ createSession: vi.fn() }));

const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

const { login } = await import("./login");

const CREDENTIALS = {
  email: "admin@homecyclhome.fr",
  password: "bon-mot-de-passe",
};

/// Destination par défaut, celle que T-J0-05 fait exister. Avant cette tâche,
/// le chemin nominal de la connexion aboutissait sur un 404.
const DEFAULT_DESTINATION = "/admin/parametres";

beforeEach(() => {
  vi.clearAllMocks();
  authenticateWithPassword.mockResolvedValue({
    ok: true,
    user: { id: "admin-1", roles: ["ROLE_ADMIN"] },
  });
});

describe("login — destination", () => {
  it("suit un `next` interne", async () => {
    await login({ ...CREDENTIALS, next: "/admin/parametres?onglet=societe" });

    expect(redirect).toHaveBeenCalledWith("/admin/parametres?onglet=societe");
  });

  it("retombe sur la destination par défaut sans `next`", async () => {
    await login(CREDENTIALS);

    expect(redirect).toHaveBeenCalledWith(DEFAULT_DESTINATION);
  });
});

describe("login — `next` hostile", () => {
  // Un `next` refusé ne doit pas faire échouer la connexion : elle a réussi.
  // Il doit être ignoré au profit de la destination par défaut.
  const HOSTILES = [
    "https://phishing.example",
    "//phishing.example",
    "/\\phishing.example",
    "/%2Fphishing.example",
    "javascript:alert(1)",
    "admin/parametres",
  ];

  for (const next of HOSTILES) {
    it(`ignore \`${next}\` et redirige vers la destination par défaut`, async () => {
      await login({ ...CREDENTIALS, next });

      expect(redirect).toHaveBeenCalledWith(DEFAULT_DESTINATION);
    });
  }

  it("ne redirige jamais hors du site, quelle que soit la forme", async () => {
    for (const next of HOSTILES) {
      redirect.mockClear();
      await login({ ...CREDENTIALS, next });
      const [destination] = redirect.mock.calls[0] ?? [];
      expect(destination).toMatch(/^\/[^/\\]/);
    }
  });

  it("n'ouvre pas la redirection à un échec de connexion", async () => {
    // Le `next` est consommé APRÈS l'authentification. Un refus ne doit
    // déclencher aucune navigation, sans quoi la page de connexion devient un
    // redirecteur ouvert utilisable sans aucun compte.
    authenticateWithPassword.mockResolvedValue({ ok: false });

    await login({ ...CREDENTIALS, next: "/admin/parametres" });

    expect(redirect).not.toHaveBeenCalled();
  });
});
