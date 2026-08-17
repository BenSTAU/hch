// @vitest-environment node
//
// Helper métier de la configuration société. CLAUDE.md §Server Actions impose
// de le séparer de la Server Action : pas de `revalidatePath`, pas de
// `redirect`, pas de contexte Next — donc testable ici, en isolation.
//
// Ce qu'il porte et qui ne peut pas vivre ailleurs : le **diff**. Écrire les
// cinq champs du formulaire à chaque soumission produirait cinq entrées
// d'audit dont quatre décriraient un changement qui n'a pas eu lieu, et
// tamponnerait `updated_by` sur des lignes que personne n'a touchées.
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const update = vi.fn();
const tx = { appSetting: { findMany, update } };

vi.mock("@/lib/db/client", () => ({
  db: {
    appSetting: { findMany },
    $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
  },
}));

const writeAuditLog = vi.fn();
vi.mock("@/lib/audit/log", () => ({
  writeAuditLog: (entry: unknown, client: unknown) =>
    writeAuditLog(entry, client),
}));

const { listAppSettings, lireContactSociete, updateAppSettings } =
  await import("./parametres");

const CURRENT = [
  {
    key: "company.name",
    value: "LeCycleLyonnais",
    valueType: "string",
    description: "Raison sociale",
    updatedAt: new Date("2026-08-05T10:00:00Z"),
  },
  {
    key: "company.email",
    value: "contact@homecyclhome.fr",
    valueType: "string",
    description: "Adresse de contact publique",
    updatedAt: new Date("2026-08-05T10:00:00Z"),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue(CURRENT);
});

describe("listAppSettings", () => {
  it("renvoie les paramètres triés par clé", async () => {
    // Ordre stable : la page est un formulaire, et des champs qui changent de
    // place d'un rendu à l'autre sont un défaut d'utilisabilité autant qu'un
    // test E2E instable.
    await listAppSettings();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { key: "asc" } }),
    );
  });
});

describe("updateAppSettings — cas nominal", () => {
  it("écrit la valeur modifiée et signe la ligne", async () => {
    const result = await updateAppSettings(
      [{ key: "company.name", value: "Le Cycle Lyonnais" }],
      "admin-1",
    );

    expect(result).toEqual({ ok: true, changedKeys: ["company.name"] });
    expect(update).toHaveBeenCalledWith({
      where: { key: "company.name" },
      data: { value: "Le Cycle Lyonnais", updatedBy: "admin-1" },
    });
  });

  it("écrit une entrée d'audit portant le diff", async () => {
    await updateAppSettings(
      [{ key: "company.name", value: "Le Cycle Lyonnais" }],
      "admin-1",
    );

    expect(writeAuditLog).toHaveBeenCalledWith(
      {
        entityType: "app_settings",
        entityId: "company.name",
        action: "UPDATE",
        actorId: "admin-1",
        details: { before: "LeCycleLyonnais", after: "Le Cycle Lyonnais" },
      },
      tx,
    );
  });

  it("n'écrit pas les valeurs inchangées", async () => {
    const result = await updateAppSettings(
      [
        { key: "company.name", value: "LeCycleLyonnais" },
        { key: "company.email", value: "nouveau@homecyclhome.fr" },
      ],
      "admin-1",
    );

    expect(result).toEqual({ ok: true, changedKeys: ["company.email"] });
    expect(update).toHaveBeenCalledOnce();
    expect(writeAuditLog).toHaveBeenCalledOnce();
  });

  it("ne touche à rien quand rien n'a changé", async () => {
    const result = await updateAppSettings(
      [{ key: "company.name", value: "LeCycleLyonnais" }],
      "admin-1",
    );

    expect(result).toEqual({ ok: true, changedKeys: [] });
    expect(update).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("audite dans la transaction, pas à côté", async () => {
    // Si la trace était écrite avec le client global, un rollback de la
    // transaction laisserait une entrée d'audit décrivant une modification
    // qui n'a jamais été committée.
    await updateAppSettings(
      [{ key: "company.name", value: "Autre" }],
      "admin-1",
    );

    expect(writeAuditLog).toHaveBeenCalledWith(expect.anything(), tx);
  });
});

describe("updateAppSettings — refus", () => {
  it("refuse une clé absente de la base sans rien écrire", async () => {
    // La table est clé-valeur et le formulaire est piloté par ses lignes :
    // une clé inconnue vient forcément d'ailleurs que de l'écran. `upsert`
    // ici laisserait n'importe qui peupler la configuration société.
    const result = await updateAppSettings(
      [{ key: "company.inexistante", value: "x" }],
      "admin-1",
    );

    expect(result).toEqual({
      ok: false,
      reason: "unknown_keys",
      keys: ["company.inexistante"],
    });
    expect(update).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuse une valeur incompatible avec son `value_type`", async () => {
    findMany.mockResolvedValue([
      {
        key: "company.tva",
        value: "20",
        valueType: "number",
        description: "Taux de TVA",
        updatedAt: new Date(),
      },
    ]);

    const result = await updateAppSettings(
      [{ key: "company.tva", value: "vingt" }],
      "admin-1",
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid_values",
      keys: ["company.tva"],
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuse le lot entier plutôt que d'en écrire la moitié", async () => {
    // Tout ou rien : une soumission partiellement appliquée laisse l'écran et
    // la base en désaccord, et l'administrateur ne sait pas ce qui est passé.
    const result = await updateAppSettings(
      [
        { key: "company.name", value: "Le Cycle Lyonnais" },
        { key: "company.inexistante", value: "x" },
      ],
      "admin-1",
    );

    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});

// Le journal d'audit est la pièce qu'on produit en cas de contestation
// (Constitution §4.2), et deux défauts symétriques le rendent inutilisable :
// une trace qui décrit une modification qui n'a pas eu lieu, et une
// modification qui n'en laisse aucune. `NULL` en base et chaîne vide au
// formulaire décrivent le même état, c'est là que la confusion naîtrait.

describe("updateAppSettings — frontière NULL / chaîne vide", () => {
  const NULLABLE = [
    {
      key: "company.siret",
      value: null,
      valueType: "string",
      description: "Numéro SIRET",
      updatedAt: new Date("2026-08-05T10:00:00Z"),
    },
  ];

  it("ne voit pas une modification là où une ligne NULL reçoit une chaîne vide", async () => {
    // Le cas se produit à CHAQUE soumission du formulaire : un champ jamais
    // renseigné arrive en `""` alors que la base porte `NULL`. Les distinguer
    // produirait une entrée d'audit par soumission sur chaque champ vide, et
    // tamponnerait `updated_by` sur des lignes que personne n'a touchées.
    findMany.mockResolvedValue(NULLABLE);

    const result = await updateAppSettings(
      [{ key: "company.siret", value: "" }],
      "admin-1",
    );

    expect(result).toEqual({ ok: true, changedKeys: [] });
    expect(update).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("trace `before: null` quand une ligne NULL est renseignée", async () => {
    // Le diff doit dire `null`, pas `""` : la première écriture d'une clé et
    // la modification d'une clé déjà vide ne sont pas le même événement.
    findMany.mockResolvedValue(NULLABLE);

    await updateAppSettings(
      [{ key: "company.siret", value: "12345678900011" }],
      "admin-1",
    );

    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "company.siret",
        details: { before: null, after: "12345678900011" },
      }),
      tx,
    );
  });

  it("écrit une chaîne vide, pas un NULL, quand un champ est effacé", async () => {
    // Constat : l'effacement d'un champ rempli stocke `''`. La colonne reste
    // NULLable et le seed pose des `''`, donc les deux valeurs coexistent en
    // base pour un même état métier « non renseigné ». Sans conséquence tant
    // que toute lecture passe par `value ?? ""` — mais une requête SQL directe
    // écrite plus tard avec `WHERE value IS NULL` ne verrait pas ces lignes.
    const result = await updateAppSettings(
      [{ key: "company.name", value: "" }],
      "admin-1",
    );

    expect(result).toEqual({ ok: true, changedKeys: ["company.name"] });
    expect(update).toHaveBeenCalledWith({
      where: { key: "company.name" },
      data: { value: "", updatedBy: "admin-1" },
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: { before: "LeCycleLyonnais", after: "" },
      }),
      tx,
    );
  });
});

describe("updateAppSettings — ordre des contrôles", () => {
  it("annonce la clé inconnue avant la valeur invalide", async () => {
    // L'ordre n'est pas cosmétique : `invalid_values` renvoie les clés
    // fautives à l'utilisateur, `unknown_keys` non. Si une clé inconnue
    // pouvait ressortir par la branche `invalid_values`, le message d'erreur
    // réfléchirait une valeur choisie par l'appelant. Ce test est ce qui
    // interdit d'inverser les deux blocs.
    findMany.mockResolvedValue([
      {
        key: "company.tva",
        value: "20",
        valueType: "number",
        description: "Taux de TVA",
        updatedAt: new Date("2026-08-05T10:00:00Z"),
      },
    ]);

    const result = await updateAppSettings(
      [
        { key: "company.tva", value: "vingt" },
        { key: "<img src=x onerror=alert(1)>", value: "x" },
      ],
      "admin-1",
    );

    expect(result).toEqual({
      ok: false,
      reason: "unknown_keys",
      keys: ["<img src=x onerror=alert(1)>"],
    });
    expect(update).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("valide TOUT le lot avant d'écrire quoi que ce soit", async () => {
    // La première entrée est valide et modifiée, la seconde est invalide.
    // Écrire au fil de la boucle laisserait la première appliquée et sa trace
    // écrite, pour une soumission refusée. Le `$transaction` ne suffirait pas
    // à le rattraper ici : la fonction RETOURNE le refus, elle ne lève pas,
    // donc la transaction serait committée.
    findMany.mockResolvedValue([
      ...CURRENT,
      {
        key: "company.tva",
        value: "20",
        valueType: "number",
        description: "Taux de TVA",
        updatedAt: new Date("2026-08-05T10:00:00Z"),
      },
    ]);

    const result = await updateAppSettings(
      [
        { key: "company.name", value: "Le Cycle Lyonnais" },
        { key: "company.tva", value: "vingt" },
      ],
      "admin-1",
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid_values",
      keys: ["company.tva"],
    });
    expect(update).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("laisse passer une ligne INCHANGÉE dont la valeur stockée est invalide", async () => {
    // ⚠️ Seules les entrées MODIFIÉES sont validées. Valider tout le lot
    // soumis rendrait le formulaire entier insoumettable dès qu'une ligne
    // stockée viole son `value_type` (seed, migration, UPDATE manuel), y
    // compris pour des champs sans rapport, le lot étant tout-ou-rien.
    findMany.mockResolvedValue([
      {
        key: "company.tva",
        value: "vingt",
        valueType: "number",
        description: "Taux de TVA",
        updatedAt: new Date("2026-08-05T10:00:00Z"),
      },
      ...CURRENT,
    ]);

    const result = await updateAppSettings(
      [
        { key: "company.tva", value: "vingt" },
        { key: "company.name", value: "Le Cycle Lyonnais" },
      ],
      "admin-1",
    );

    expect(result).toEqual({ ok: true, changedKeys: ["company.name"] });
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "company.name" } }),
    );
  });
});

describe("updateAppSettings — signature de l'écriture", () => {
  it("signe chaque ligne modifiée du même acteur, et aucune autre", async () => {
    // `updated_by` (dictionnaire §app_settings) et `actor_id`
    // (§audit_logs) doivent désigner le même compte, et n'apparaître que sur
    // les lignes réellement touchées. Une signature posée sur une ligne
    // intacte ferait porter à un administrateur une modification qu'il n'a pas
    // faite.
    await updateAppSettings(
      [
        { key: "company.name", value: "Le Cycle Lyonnais" },
        { key: "company.email", value: "contact@homecyclhome.fr" },
      ],
      "admin-1",
    );

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "company.name" } }),
    );
    expect(writeAuditLog).toHaveBeenCalledOnce();
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "app_settings",
        action: "UPDATE",
        actorId: "admin-1",
      }),
      tx,
    );
  });

  it("nomme la TABLE dans `entityType`, pas le modèle Prisma", async () => {
    // L'index `(entity_type, entity_id)` de la migration 003 sert à relire le
    // journal en SQL. `AppSetting` y serait introuvable.
    await updateAppSettings(
      [{ key: "company.name", value: "Autre" }],
      "admin-1",
    );

    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "app_settings" }),
      tx,
    );
  });
});

describe("lireContactSociete", () => {
  // Premier lecteur de `company.phone` et `company.email` hors du back-office :
  // elles etaient seedees depuis le jalon 0 et n'etaient affichees nulle part.
  // C'est `US-INTERVENTION-ANNULER-CLIENT` §Cas d'erreur qui les fait sortir,
  // en renvoyant le client vers l'atelier passe la fenetre H-24.
  it("rend les deux coordonnees telles que l'administrateur les tient", async () => {
    findMany.mockResolvedValue([
      { key: "company.phone", value: "+33639980000" },
      { key: "company.email", value: "contact@homecyclhome.fr" },
    ]);

    await expect(lireContactSociete()).resolves.toEqual({
      telephone: "+33639980000",
      email: "contact@homecyclhome.fr",
    });
  });

  it("ne lit QUE ces deux cles", async () => {
    // La table porte aussi le SIRET, l'adresse postale et les horaires : les
    // charger pour en afficher deux serait une lecture large sur un ecran
    // client.
    findMany.mockResolvedValue([]);

    await lireContactSociete();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: { in: ["company.phone", "company.email"] } },
      }),
    );
  });

  it("rend null sur une valeur absente, vide ou faite d'espaces", async () => {
    // `app_settings.value` est NULLable et l'administrateur peut vider le champ.
    // Une chaine vide qui traverserait produirait un `tel:` sans numero, donc
    // un lien qui ne fait rien - l'ecran doit pouvoir ne rien rendre.
    findMany.mockResolvedValue([
      { key: "company.phone", value: "   " },
      { key: "company.email", value: null },
    ]);

    await expect(lireContactSociete()).resolves.toEqual({
      telephone: null,
      email: null,
    });
  });
});
