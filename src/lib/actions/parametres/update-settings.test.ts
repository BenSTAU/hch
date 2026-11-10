// @vitest-environment node
//
// Server Action de modification de la configuration société.
//
// S'exerce ici et pas sur la page, parce que c'est ici que la garde compte :
// une Server Action exportée est un endpoint POST public (ADR-006 v2), et un
// non-administrateur n'a aucun besoin de l'écran pour l'appeler.
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
vi.mock("@/lib/auth/permissions", () => ({
  requireAdmin: () => requireAdmin(),
}));

const updateAppSettings = vi.fn();
vi.mock("@/lib/db/queries/parametres", () => ({
  updateAppSettings: (entries: unknown, actorId: string) =>
    updateAppSettings(entries, actorId),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePath(p),
}));

const { updateSettings } = await import("./update-settings");

/// Reproduit l'erreur que lève réellement `forbidden()` de Next.
///
/// Le premier jet de ce fichier levait une `Error` dont le MESSAGE valait
/// `NEXT_HTTP_ERROR_FALLBACK;403`, et le test échouait : next-safe-action
/// 8.6.0 ne reconnaît une erreur de framework que par sa propriété **`digest`**
/// (`errors-9ViDxi_K.mjs:22-26`), et ne la relance que dans ce cas
/// (`index.mjs:441`). Une erreur ordinaire est convertie en `serverError`
/// générique par `handleServerError`.
///
/// L'oracle était donc faux sur le mécanisme, pas sur le comportement attendu.
/// Le corriger est aussi ce qui rend le test utile : il vérifie maintenant que
/// le 403 **traverse** next-safe-action au lieu d'être avalé - un garde qui
/// lèverait autre chose qu'un `forbidden()` rendrait une erreur 500 générique
/// là où Next doit rendre une page 403.
function forbiddenError(): Error {
  const error = new Error("NEXT_HTTP_ERROR_FALLBACK;403");
  Object.assign(error, { digest: "NEXT_HTTP_ERROR_FALLBACK;403" });
  return error;
}

const ADMIN = {
  id: "admin-1",
  email: "admin@homecyclhome.fr",
  firstname: "Admin",
  lastname: "Principal",
  roles: ["ROLE_ADMIN"],
};

/// Jeton de concurrence transporté par le formulaire. Sa valeur n'importe pas
/// ici : c'est le helper métier qui le compare, l'action ne fait que le
/// relayer.
const VERSION = "2026-08-05T10:00:00.000Z";

const PAYLOAD = {
  settings: [
    { key: "company.name", value: "Le Cycle Lyonnais", version: VERSION },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(ADMIN);
  updateAppSettings.mockResolvedValue({
    ok: true,
    changedKeys: ["company.name"],
  });
});

describe("updateSettings - administrateur", () => {
  it("accepte la modification et rend la main sur les clés changées", async () => {
    const result = await updateSettings(PAYLOAD);

    expect(result?.data).toEqual({ changedKeys: ["company.name"] });
  });

  it("signe l'écriture avec l'identifiant de la SESSION, pas de la charge utile", async () => {
    // `updated_by` ne se soumet pas. S'il venait du POST, n'importe qui
    // pourrait attribuer sa modification à un autre administrateur - et le
    // journal d'audit désignerait un innocent.
    await updateSettings({
      settings: [
        {
          key: "company.name",
          value: "X",
          version: VERSION,
          updatedBy: "victime",
        },
      ],
    } as unknown as typeof PAYLOAD);

    expect(updateAppSettings).toHaveBeenCalledWith(
      [{ key: "company.name", value: "X", version: VERSION }],
      "admin-1",
    );
  });

  it("revalide la page après écriture", async () => {
    await updateSettings(PAYLOAD);

    expect(revalidatePath).toHaveBeenCalledWith("/admin/parametres");
  });

  it("ne revalide pas quand l'écriture a été refusée", async () => {
    updateAppSettings.mockResolvedValue({
      ok: false,
      reason: "unknown_keys",
      keys: ["company.inexistante"],
    });

    const result = await updateSettings(PAYLOAD);

    expect(revalidatePath).not.toHaveBeenCalled();
    expect(result?.data).toMatchObject({ error: expect.any(String) });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Tests ajoutés par l'agent testeur (verify-only) sur la PR de fond de
// T-B1-01, constat F3.
// ─────────────────────────────────────────────────────────────────────────

describe("updateSettings, les clés que le refus désigne", () => {
  // ⚠️ **Rien ne couvrait ce canal, ni ici ni dans `settings-form.test.tsx`.**
  //
  // Depuis le constat F3, un refus de concurrence ne porte plus sur tout le
  // formulaire : l'action renvoie `staleKeys` pour que l'écran marque les
  // champs concernés en `aria-invalid` (RGAA 11.10). `invalidKeys` existait
  // déjà avec le même rôle. Les deux pouvaient disparaître de la charge utile
  // sans qu'un seul test rougisse - le seul oracle existant est un
  // `toMatchObject({ error })`, qui ignore les clés absentes.

  it("nomme les lignes périmées, et elles seules", async () => {
    updateAppSettings.mockResolvedValue({
      ok: false,
      reason: "stale",
      keys: ["company.name", "company.email"],
    });

    const result = await updateSettings(PAYLOAD);

    expect(result?.data).toEqual({
      error: expect.any(String),
      invalidKeys: [],
      staleKeys: ["company.name", "company.email"],
    });
  });

  it("nomme les lignes invalides, et elles seules", async () => {
    updateAppSettings.mockResolvedValue({
      ok: false,
      reason: "invalid_values",
      keys: ["company.tva"],
    });

    const result = await updateSettings(PAYLOAD);

    expect(result?.data).toEqual({
      error: expect.any(String),
      invalidKeys: ["company.tva"],
      staleKeys: [],
    });
  });

  it("ne marque aucun champ sur une clé inconnue", async () => {
    // `unknown_keys` ne peut pas venir de l'écran : aucun champ affiché ne
    // correspond, donc marquer quoi que ce soit désignerait un innocent.
    updateAppSettings.mockResolvedValue({
      ok: false,
      reason: "unknown_keys",
      keys: ["company.inexistante"],
    });

    const result = await updateSettings(PAYLOAD);

    expect(result?.data).toEqual({
      error: expect.any(String),
      invalidKeys: [],
      staleKeys: [],
    });
  });

  it("dit de recharger, et ne dit pas de corriger, sur un refus de concurrence", async () => {
    // Le seul geste qui règle ce refus est le rechargement : modifier le champ
    // le reproduirait à l'identique, le jeton resoumis étant toujours celui de
    // la version périmée.
    updateAppSettings.mockResolvedValue({
      ok: false,
      reason: "stale",
      keys: ["company.name"],
    });

    const result = await updateSettings(PAYLOAD);

    expect(result?.data?.error).toMatch(/recharge/i);
  });
});

describe("updateSettings - non-administrateur", () => {
  it("refuse un client sans jamais atteindre la base", async () => {
    requireAdmin.mockRejectedValue(forbiddenError());

    await expect(updateSettings(PAYLOAD)).rejects.toThrow();
    expect(updateAppSettings).not.toHaveBeenCalled();
  });

  it("garde la garde EN TÊTE d'action, avant toute lecture", async () => {
    // L'ordre est la garde. Une vérification placée après la lecture ou
    // l'écriture protège le résultat affiché, pas la donnée.
    requireAdmin.mockRejectedValue(forbiddenError());

    await updateSettings(PAYLOAD).catch(() => undefined);

    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(updateAppSettings).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateSettings - entrées hostiles", () => {
  it("refuse une charge utile vide", async () => {
    const result = await updateSettings({ settings: [] });

    expect(result?.validationErrors).toBeDefined();
    expect(updateAppSettings).not.toHaveBeenCalled();
  });

  it("refuse une charge utile malformée", async () => {
    const result = await updateSettings({
      settings: [{ key: "company.name" }],
    } as unknown as typeof PAYLOAD);

    expect(result?.validationErrors).toBeDefined();
    expect(updateAppSettings).not.toHaveBeenCalled();
  });

  it("ne réfléchit pas le détail d'une erreur serveur au navigateur", async () => {
    // `handleServerError` de `src/lib/safe-action.ts` : une erreur Prisma non
    // interceptée porte l'hôte, le port et l'utilisateur de la base.
    updateAppSettings.mockRejectedValue(
      new Error("connect ECONNREFUSED hch:motdepasse@localhost:5433"),
    );

    const result = await updateSettings(PAYLOAD);

    expect(JSON.stringify(result)).not.toContain("5433");
    expect(JSON.stringify(result)).not.toContain("motdepasse");
  });
});

// ⚠️ `rejects.toThrow()` accepte n'importe quel throw. Les tests ci-dessous
// exigent que ce soit BIEN le 403 qui traverse next-safe-action, et BIEN le
// `digest` qui décide : `isHTTPAccessFallbackError` le lit et ignore le
// message.

describe("updateSettings - le 403 traverse next-safe-action", () => {
  it("relance l'interruption avec son `digest` intact", async () => {
    // C'est le `digest` que Next relit pour choisir `src/app/forbidden.tsx` et
    // poser un vrai 403. Une erreur qui arriverait au client sans lui donnerait
    // une page d'erreur générique - visuellement un bug, pas un refus.
    requireAdmin.mockRejectedValue(forbiddenError());

    await expect(updateSettings(PAYLOAD)).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;403",
    });
  });

  it("relance aussi la redirection émise quand il n'y a pas de session", async () => {
    // `requireAdmin` délègue l'absence de session à la DAL, qui appelle
    // `redirect("/connexion")`. Les deux échecs sont distincts et doivent
    // TOUS DEUX sortir de l'action : l'un en 403, l'autre en navigation.
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/connexion;307;",
    });
    requireAdmin.mockRejectedValue(redirectError);

    await expect(updateSettings(PAYLOAD)).rejects.toMatchObject({
      digest: "NEXT_REDIRECT;replace;/connexion;307;",
    });
    expect(updateAppSettings).not.toHaveBeenCalled();
  });

  it("n'a pas relancé par hasard : sans `digest`, l'erreur est absorbée", async () => {
    // Contre-épreuve du correctif d'oracle. Si next-safe-action relançait tout
    // ce qui lève, les deux tests ci-dessus passeraient même avec une garde
    // cassée. Ici la garde échoue sur une erreur ordinaire : l'action ne lève
    // pas, elle renvoie un `serverError` générique. Aucune écriture non plus -
    // c'est ce qui compte.
    requireAdmin.mockRejectedValue(new Error("garde en panne"));

    const result = await updateSettings(PAYLOAD);

    expect(result?.serverError).toBeDefined();
    expect(JSON.stringify(result)).not.toContain("garde en panne");
    expect(updateAppSettings).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateSettings - où se place la garde dans la chaîne", () => {
  it("exécute la garde de rôle AVANT la validation Zod", async () => {
    // next-safe-action exécute les middlewares, PUIS `validateInputs`, PUIS le
    // corps. La garde vit en `.use()` sur `adminActionClient` et non dans le
    // corps : sinon une charge utile malformée serait refusée par Zod sans
    // authentification, et un anonyme lirait la forme du schéma.
    const result = await updateSettings({ settings: [] });

    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(result?.validationErrors).toBeDefined();
    expect(updateAppSettings).not.toHaveBeenCalled();
  });

  it("n'écrit rien tant que la garde n'a pas rendu un administrateur", async () => {
    // La vraie propriété de sécurité, elle, tient : quelle que soit la charge
    // utile, `updateAppSettings` n'est jamais atteint sans `requireAdmin()`
    // résolu.
    requireAdmin.mockRejectedValue(forbiddenError());

    await updateSettings(PAYLOAD).catch(() => undefined);
    await updateSettings({
      settings: [{ key: "company.name", value: "X", version: VERSION }],
    }).catch(() => undefined);

    expect(updateAppSettings).not.toHaveBeenCalled();
  });
});
