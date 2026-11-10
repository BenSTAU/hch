// @vitest-environment node
//
// Helper métier de la configuration société. CLAUDE.md §Server Actions impose
// de le séparer de la Server Action : pas de `revalidatePath`, pas de
// `redirect`, pas de contexte Next - donc testable ici, en isolation.
//
// Ce qu'il porte et qui ne peut pas vivre ailleurs : le **diff**. Écrire les
// cinq champs du formulaire à chaque soumission produirait cinq entrées
// d'audit dont quatre décriraient un changement qui n'a pas eu lieu, et
// tamponnerait `updated_by` sur des lignes que personne n'a touchées.
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const updateMany = vi.fn();
const tx = { appSetting: { findMany, updateMany } };

/// Ajouté par l'agent testeur (T-B1-01). Un `$transaction` qui se contente
/// d'appeler son rappel ne distingue pas un `return` d'un `throw`, et c'est
/// exactement la distinction dont dépend le « tout ou rien » : seul un `throw`
/// annule les lignes déjà écrites par la boucle. Ce mouchard rend la
/// différence observable, sinon remplacer le `throw` par un `return` laisserait
/// toute la suite verte.
const transactionAnnulee = vi.fn();

vi.mock("@/lib/db/client", () => ({
  db: {
    appSetting: { findMany },
    $transaction: async (callback: (client: typeof tx) => unknown) => {
      try {
        return await callback(tx);
      } catch (erreur) {
        transactionAnnulee(erreur);
        throw erreur;
      }
    },
  },
}));

const writeAuditLog = vi.fn();
vi.mock("@/lib/audit/log", () => ({
  writeAuditLog: (entry: unknown, client: unknown) =>
    writeAuditLog(entry, client),
}));

const { jetonLigne, listAppSettings, lireContactSociete, updateAppSettings } =
  await import("./parametres");

/// Le jeton de concurrence que l'écran a rendu pour UNE ligne : l'empreinte de
/// sa valeur stockée, fabriquée par `listAppSettings` et renvoyée telle quelle
/// par le formulaire. Une soumission qui le porte décrit l'état courant de
/// cette ligne, toute autre valeur décrit une ligne périmée.
///
/// ⚠️ **Un jeton par LIGNE**, et plus un par formulaire. `app_settings` n'est
/// pas une fiche, c'est N lignes indépendantes dans un même écran (T-B1-01,
/// constat F3). La fonction réelle est employée ici, comme `lireForfaitAdmin`
/// l'est dans `forfaits.test.ts` : la fabrique est unique ou elle ne sert à
/// rien.
const jeton = jetonLigne;

/// Un jeton qui ne décrit aucun état stocké. 22 caractères base64url, comme
/// ceux que produit `empreinteValeur`.
const JETON_PERIME = "Zzzz00000000000000000A";

/// Pour une clé absente de la base : `unknownKeys` filtre avant tout contrôle
/// de version, la valeur du jeton n'entre donc jamais en jeu.
const JETON_SANS_OBJET = JETON_PERIME;

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
  // L'écriture conditionnelle apparie par défaut. Les tests de concurrence
  // forcent `{ count: 0 }` pour simuler le commit d'un concurrent.
  updateMany.mockResolvedValue({ count: 1 });
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

describe("updateAppSettings - cas nominal", () => {
  it("écrit la valeur modifiée et signe la ligne", async () => {
    const result = await updateAppSettings(
      [
        {
          key: "company.name",
          value: "Le Cycle Lyonnais",
          version: jeton("LeCycleLyonnais"),
        },
      ],
      "admin-1",
    );

    expect(result).toEqual({ ok: true, changedKeys: ["company.name"] });
    expect(updateMany).toHaveBeenCalledWith({
      where: { key: "company.name", value: "LeCycleLyonnais" },
      data: { value: "Le Cycle Lyonnais", updatedBy: "admin-1" },
    });
  });

  it("écrit une entrée d'audit portant le diff", async () => {
    await updateAppSettings(
      [
        {
          key: "company.name",
          value: "Le Cycle Lyonnais",
          version: jeton("LeCycleLyonnais"),
        },
      ],
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
        {
          key: "company.name",
          value: "LeCycleLyonnais",
          version: jeton("LeCycleLyonnais"),
        },
        {
          key: "company.email",
          value: "nouveau@homecyclhome.fr",
          version: jeton("contact@homecyclhome.fr"),
        },
      ],
      "admin-1",
    );

    expect(result).toEqual({ ok: true, changedKeys: ["company.email"] });
    expect(updateMany).toHaveBeenCalledOnce();
    expect(writeAuditLog).toHaveBeenCalledOnce();
  });

  it("ne touche à rien quand rien n'a changé", async () => {
    const result = await updateAppSettings(
      [
        {
          key: "company.name",
          value: "LeCycleLyonnais",
          version: jeton("LeCycleLyonnais"),
        },
      ],
      "admin-1",
    );

    expect(result).toEqual({ ok: true, changedKeys: [] });
    expect(updateMany).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("audite dans la transaction, pas à côté", async () => {
    // Si la trace était écrite avec le client global, un rollback de la
    // transaction laisserait une entrée d'audit décrivant une modification
    // qui n'a jamais été committée.
    await updateAppSettings(
      [
        {
          key: "company.name",
          value: "Autre",
          version: jeton("LeCycleLyonnais"),
        },
      ],
      "admin-1",
    );

    expect(writeAuditLog).toHaveBeenCalledWith(expect.anything(), tx);
  });
});

describe("updateAppSettings - refus", () => {
  it("refuse une clé absente de la base sans rien écrire", async () => {
    // La table est clé-valeur et le formulaire est piloté par ses lignes :
    // une clé inconnue vient forcément d'ailleurs que de l'écran. `upsert`
    // ici laisserait n'importe qui peupler la configuration société.
    const result = await updateAppSettings(
      [{ key: "company.inexistante", value: "x", version: JETON_SANS_OBJET }],
      "admin-1",
    );

    expect(result).toEqual({
      ok: false,
      reason: "unknown_keys",
      keys: ["company.inexistante"],
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuse une valeur incompatible avec son `value_type`", async () => {
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
      [{ key: "company.tva", value: "vingt", version: jeton("20") }],
      "admin-1",
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid_values",
      keys: ["company.tva"],
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("refuse le lot entier plutôt que d'en écrire la moitié", async () => {
    // Tout ou rien : une soumission partiellement appliquée laisse l'écran et
    // la base en désaccord, et l'administrateur ne sait pas ce qui est passé.
    const result = await updateAppSettings(
      [
        {
          key: "company.name",
          value: "Le Cycle Lyonnais",
          version: jeton("LeCycleLyonnais"),
        },
        { key: "company.inexistante", value: "x", version: JETON_SANS_OBJET },
      ],
      "admin-1",
    );

    expect(result.ok).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

// Le journal d'audit est la pièce qu'on produit en cas de contestation
// (Constitution §4.2), et deux défauts symétriques le rendent inutilisable :
// une trace qui décrit une modification qui n'a pas eu lieu, et une
// modification qui n'en laisse aucune. `NULL` en base et chaîne vide au
// formulaire décrivent le même état, c'est là que la confusion naîtrait.

describe("updateAppSettings - frontière NULL / chaîne vide", () => {
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
      [{ key: "company.siret", value: "", version: jeton(null) }],
      "admin-1",
    );

    expect(result).toEqual({ ok: true, changedKeys: [] });
    expect(updateMany).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("trace `before: null` quand une ligne NULL est renseignée", async () => {
    // Le diff doit dire `null`, pas `""` : la première écriture d'une clé et
    // la modification d'une clé déjà vide ne sont pas le même événement.
    findMany.mockResolvedValue(NULLABLE);

    await updateAppSettings(
      [{ key: "company.siret", value: "12345678900011", version: jeton(null) }],
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
    // que toute lecture passe par `value ?? ""` - mais une requête SQL directe
    // écrite plus tard avec `WHERE value IS NULL` ne verrait pas ces lignes.
    const result = await updateAppSettings(
      [{ key: "company.name", value: "", version: jeton("LeCycleLyonnais") }],
      "admin-1",
    );

    expect(result).toEqual({ ok: true, changedKeys: ["company.name"] });
    expect(updateMany).toHaveBeenCalledWith({
      where: { key: "company.name", value: "LeCycleLyonnais" },
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

describe("updateAppSettings - ordre des contrôles", () => {
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
        { key: "company.tva", value: "vingt", version: jeton("20") },
        {
          key: "<img src=x onerror=alert(1)>",
          value: "x",
          version: JETON_SANS_OBJET,
        },
      ],
      "admin-1",
    );

    expect(result).toEqual({
      ok: false,
      reason: "unknown_keys",
      keys: ["<img src=x onerror=alert(1)>"],
    });
    expect(updateMany).not.toHaveBeenCalled();
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
        {
          key: "company.name",
          value: "Le Cycle Lyonnais",
          version: jeton("LeCycleLyonnais"),
        },
        { key: "company.tva", value: "vingt", version: jeton("20") },
      ],
      "admin-1",
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid_values",
      keys: ["company.tva"],
    });
    expect(updateMany).not.toHaveBeenCalled();
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
        { key: "company.tva", value: "vingt", version: jeton("vingt") },
        {
          key: "company.name",
          value: "Le Cycle Lyonnais",
          version: jeton("LeCycleLyonnais"),
        },
      ],
      "admin-1",
    );

    expect(result).toEqual({ ok: true, changedKeys: ["company.name"] });
    expect(updateMany).toHaveBeenCalledOnce();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "company.name", value: "LeCycleLyonnais" },
      }),
    );
  });
});

describe("updateAppSettings - signature de l'écriture", () => {
  it("signe chaque ligne modifiée du même acteur, et aucune autre", async () => {
    // `updated_by` (dictionnaire §app_settings) et `actor_id`
    // (§audit_logs) doivent désigner le même compte, et n'apparaître que sur
    // les lignes réellement touchées. Une signature posée sur une ligne
    // intacte ferait porter à un administrateur une modification qu'il n'a pas
    // faite.
    await updateAppSettings(
      [
        {
          key: "company.name",
          value: "Le Cycle Lyonnais",
          version: jeton("LeCycleLyonnais"),
        },
        {
          key: "company.email",
          value: "contact@homecyclhome.fr",
          version: jeton("contact@homecyclhome.fr"),
        },
      ],
      "admin-1",
    );

    expect(updateMany).toHaveBeenCalledOnce();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "company.name", value: "LeCycleLyonnais" },
      }),
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
      [
        {
          key: "company.name",
          value: "Autre",
          version: jeton("LeCycleLyonnais"),
        },
      ],
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

describe("updateAppSettings, refus d'une ligne modifiée entre-temps", () => {
  // Ferme le constat B5 de l'agent testeur sur T-J0-05 : deux administrateurs
  // simultanés, la modification du premier écrasée sans avertissement, et une
  // entrée d'audit du second affirmant un `before` qui n'était déjà plus
  // l'état réel. Un journal qui ment est pire qu'un journal absent.
  it("refuse un jeton qui ne décrit plus l'état courant", async () => {
    const resultat = await updateAppSettings(
      [
        {
          key: "company.name",
          value: "Le Cycle Lyonnais",
          version: JETON_PERIME,
        },
      ],
      "admin-2",
    );

    expect(resultat).toEqual({
      ok: false,
      reason: "stale",
      keys: ["company.name"],
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuse quand l'écriture conditionnelle n'apparie aucune ligne", async () => {
    // Le jeton était bon à la lecture, mais un concurrent a commité juste
    // après : PostgreSQL réévalue le `WHERE` et le second n'apparie plus rien.
    updateMany.mockResolvedValue({ count: 0 });

    const resultat = await updateAppSettings(
      [
        {
          key: "company.name",
          value: "Le Cycle Lyonnais",
          version: jeton("LeCycleLyonnais"),
        },
      ],
      "admin-2",
    );

    expect(resultat).toEqual({
      ok: false,
      reason: "stale",
      keys: ["company.name"],
    });
    // La trace ne doit PAS être écrite : elle décrirait une modification qui
    // n'a pas eu lieu.
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("annule les lignes déjà écrites quand une suivante est périmée", async () => {
    // Le point dur du lot tout-ou-rien : ce refus survient APRÈS une écriture.
    // Un `return` depuis le rappel de `$transaction` commiterait la première
    // ligne ; seul un `throw` annule.
    updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const resultat = await updateAppSettings(
      [
        {
          key: "company.name",
          value: "Le Cycle Lyonnais",
          version: jeton("LeCycleLyonnais"),
        },
        {
          key: "company.email",
          value: "nouveau@homecyclhome.fr",
          version: jeton("contact@homecyclhome.fr"),
        },
      ],
      "admin-2",
    );

    expect(resultat).toEqual({
      ok: false,
      reason: "stale",
      keys: ["company.email"],
    });
  });

  it("conditionne l'écriture à la valeur lue de la ligne", async () => {
    // ⚠️ Ce test fige la PRÉSENCE du prédicat, pas sa provenance.
    //
    // Son libellé disait « sur l'`updated_at` lu, pas sur celui du
    // navigateur », et c'était une affirmation invérifiable : le contrôle de
    // version qui précède garantit que les deux valeurs décrivent le même état
    // sur tout chemin qui atteint l'écriture, donc un prédicat construit
    // depuis la charge utile rendrait ce test vert à l'identique. Relevé par
    // la session vérificatrice (É3).
    //
    // Ce qui mord ici : retirer `value` du `where` fait rougir, et c'est cette
    // clause qui ferme la fenêtre des millisecondes. Depuis le constat F2,
    // elle porte la valeur LUE et non l'`updated_at` - le même instrument que
    // le jeton, au lieu de deux.
    await updateAppSettings(
      [
        {
          key: "company.name",
          value: "Le Cycle Lyonnais",
          version: jeton("LeCycleLyonnais"),
        },
      ],
      "admin-1",
    );

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "company.name", value: "LeCycleLyonnais" },
      }),
    );
  });

  it("ne refuse pas une ligne resoumise sans modification", async () => {
    // Un champ non touché est resoumis tel quel à chaque envoi. La
    // comparaison de valeur le sort du lot AVANT tout contrôle de jeton :
    // rien n'est écrit sur cette ligne, donc il n'y a rien à y écraser.
    //
    // ⚠️ Depuis le constat F3, une ligne non modifiée échappe bel et bien au
    // contrôle, et c'est voulu : le test « ne refuse personne pour une ligne
    // qu'il n'a pas touchée » ci-dessous fige l'autre face de cette règle.
    const resultat = await updateAppSettings(
      [
        {
          key: "company.name",
          value: "LeCycleLyonnais",
          version: jeton("LeCycleLyonnais"),
        },
      ],
      "admin-1",
    );

    expect(resultat).toEqual({ ok: true, changedKeys: [] });
    expect(updateMany).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Tests ajoutés par l'agent testeur (verify-only) sur T-B1-01.
// ─────────────────────────────────────────────────────────────────────────

describe("updateAppSettings, le lot est vraiment annulé", () => {
  it("sort du rappel de transaction par une exception, pas par un `return`", async () => {
    // Le test « annule les lignes déjà écrites » ci-dessus n'observe que le
    // RÉSULTAT, et un `return { ok: false, reason: "stale" }` depuis le rappel
    // produirait exactement le même résultat tout en COMMITANT la première
    // ligne. C'est le mutant qu'il faut tuer : ici, l'oracle est le fait que
    // le rappel ait rejeté.
    updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await updateAppSettings(
      [
        {
          key: "company.name",
          value: "Le Cycle Lyonnais",
          version: jeton("LeCycleLyonnais"),
        },
        {
          key: "company.email",
          value: "nouveau@homecyclhome.fr",
          version: jeton("contact@homecyclhome.fr"),
        },
      ],
      "admin-2",
    );

    expect(transactionAnnulee).toHaveBeenCalledOnce();
    expect(transactionAnnulee).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ConcurrenceDetectee" }),
    );
  });

  it("n'annule rien quand le lot passe", async () => {
    // Contrôle du mouchard : sans ce test, un `$transaction` qui annulerait
    // toujours rendrait le précédent vert pour une mauvaise raison.
    await updateAppSettings(
      [
        {
          key: "company.name",
          value: "Le Cycle Lyonnais",
          version: jeton("LeCycleLyonnais"),
        },
      ],
      "admin-1",
    );

    expect(transactionAnnulee).not.toHaveBeenCalled();
  });

  it("n'annule rien sur un refus qui précède toute écriture", async () => {
    // `unknown_keys`, `invalid_values` et le refus de jeton surviennent AVANT
    // la boucle d'écriture : ils peuvent sortir par `return`, et ils doivent,
    // sinon chaque refus de saisie remonterait une exception au lieu d'un
    // résultat.
    const resultat = await updateAppSettings(
      [{ key: "company.inexistante", value: "x", version: JETON_SANS_OBJET }],
      "admin-1",
    );

    expect(resultat.ok).toBe(false);
    expect(transactionAnnulee).not.toHaveBeenCalled();
  });
});

describe("updateAppSettings, lot hostile", () => {
  it("ne laisse pas une clé répétée écrire deux fois", async () => {
    // **Second filet, pas premier.** `updateSettingsSchema` refuse déjà les
    // clés répétées (`src/lib/validations/parametres.ts`, `.refine` d'unicité),
    // donc la Server Action n'en laisse pas passer. Ce test couvre l'appel
    // DIRECT du helper, que la prochaine surface d'administration fera peut-être
    // sans repasser par ce schéma : les deux entrées portent le même jeton, la
    // seconde écriture n'apparie plus, et l'écriture conditionnelle annule le
    // lot au lieu de laisser l'ordre d'écriture désigner un gagnant.
    //
    // ⚠️ L'oracle porte sur la SÛRETÉ, pas sur le libellé du refus : le lot
    // doit être annulé et aucune trace écrite. Le `reason` retourné est
    // aujourd'hui `stale`, ce qui décrit mal la cause ; ce test reste valable
    // si ce libellé change.
    updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const resultat = await updateAppSettings(
      [
        {
          key: "company.name",
          value: "Premier",
          version: jeton("LeCycleLyonnais"),
        },
        {
          key: "company.name",
          value: "Second",
          version: jeton("LeCycleLyonnais"),
        },
      ],
      "attaquant",
    );

    expect(resultat.ok).toBe(false);
    expect(transactionAnnulee).toHaveBeenCalledOnce();
  });
});

describe("updateAppSettings, granularité du jeton", () => {
  it("ne refuse personne pour une ligne qu'il n'a pas touchée", async () => {
    // ⚠️ **Renversement assumé d'un comportement délibéré** (T-B1-01,
    // constat F3). Ce fichier figeait l'inverse - « refuse le lot quand une
    // ligne NON éditée a bougé » - parce que le contrôle de jeton précédait la
    // comparaison de valeur. Ce n'était pas un oubli : c'était écrit et testé.
    //
    // La DoD 6 tranche dans l'autre sens, et voici pourquoi : `app_settings`
    // n'est pas une fiche, c'est N lignes indépendantes dans un même
    // formulaire, qui resoumet ses cinq champs à chaque envoi. Sous l'ancienne
    // règle, un administrateur était refusé parce qu'un collègue avait touché
    // une AUTRE clé - un écran partagé se bloquait lui-même.
    //
    // Ici, `company.email` a bougé sous l'écran et n'est pas le champ que
    // l'administrateur a édité : il le resoumet tel que l'écran l'affichait,
    // et c'est son jeton qui l'atteste. Rien n'est écrit sur cette ligne, donc
    // rien n'y est écrasé - la valeur du collègue reste.
    findMany.mockResolvedValue([
      { ...CURRENT[0] },
      { ...CURRENT[1], value: "autre-contact@homecyclhome.fr" },
    ]);

    const resultat = await updateAppSettings(
      [
        {
          key: "company.name",
          value: "Le Cycle Lyonnais",
          version: jeton("LeCycleLyonnais"),
        },
        {
          key: "company.email",
          // Valeur INCHANGÉE : l'administrateur n'a pas touché ce champ, et
          // son jeton décrit l'état d'avant.
          value: "contact@homecyclhome.fr",
          version: jeton("contact@homecyclhome.fr"),
        },
      ],
      "admin-2",
    );

    expect(resultat).toEqual({ ok: true, changedKeys: ["company.name"] });
    expect(updateMany).toHaveBeenCalledOnce();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "company.name", value: "LeCycleLyonnais" },
      }),
    );
  });

  it("tient la frontière NULL / chaîne vide dans le jeton", async () => {
    // Le point où cette règle pouvait se perdre. Une ligne jamais renseignée
    // porte `NULL` en base et se rend `""` au formulaire : son jeton est donc
    // fabriqué sur la valeur RENDUE (`jetonLigne`). Sans cette normalisation,
    // un champ vide passerait pour édité à chaque soumission, et un collègue
    // qui l'a renseigné entre-temps ferait refuser tout le lot.
    findMany.mockResolvedValue([
      { ...CURRENT[0] },
      {
        key: "company.siret",
        // Renseigné par un collègue depuis le rendu de l'écran.
        value: "12345678900011",
        valueType: "string",
        description: "Numéro SIRET",
        updatedAt: new Date("2026-08-05T10:00:00Z"),
      },
    ]);

    const resultat = await updateAppSettings(
      [
        {
          key: "company.name",
          value: "Le Cycle Lyonnais",
          version: jeton("LeCycleLyonnais"),
        },
        { key: "company.siret", value: "", version: jeton(null) },
      ],
      "admin-2",
    );

    expect(resultat).toEqual({ ok: true, changedKeys: ["company.name"] });
  });

  it("refuse la ligne qu'il a touchée, et nomme celle-là", async () => {
    // L'autre face de la même règle, et c'est elle qui tient la DoD 5 sur cet
    // écran : sur la ligne réellement modifiée, un jeton qui ne décrit plus
    // l'état stocké est refusé. Le refus nomme cette clé, et c'est ce que le
    // formulaire marque en `aria-invalid`.
    findMany.mockResolvedValue([
      { ...CURRENT[0], value: "Nom posé par un collègue" },
      { ...CURRENT[1] },
    ]);

    const resultat = await updateAppSettings(
      [
        {
          key: "company.name",
          value: "Le Cycle Lyonnais",
          version: jeton("LeCycleLyonnais"),
        },
      ],
      "admin-2",
    );

    expect(resultat).toEqual({
      ok: false,
      reason: "stale",
      keys: ["company.name"],
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Tests ajoutés par l'agent testeur (verify-only) sur la PR de fond de
// T-B1-01, constats F2 et F3.
// ─────────────────────────────────────────────────────────────────────────

describe("jetonLigne, la fabrique est vraiment unique", () => {
  // ⚠️ **Le trou le plus coûteux du dispositif, et il n'était pas couvert.**
  //
  // `listAppSettings` fabrique le jeton que l'écran rend, et la boucle de
  // `transactionSettings` le refabrique pour le comparer. Les deux appellent
  // `jetonLigne`, mais AUCUN test ne reliait les deux bouts : tous les tests
  // existants construisent leur jeton à la main, donc ils exercent la boucle
  // contre elle-même et resteraient verts si `listAppSettings` fabriquait son
  // jeton autrement - sur la valeur brute au lieu de la valeur rendue, sur
  // `updatedAt`, sur une constante.
  //
  // Le mode d'échec est celui que le module nomme au-dessus de
  // `listAppSettings` : « tout enregistrement serait refusé sans cause
  // visible ». Il ne se verrait qu'à l'usage, et il ne casserait rien d'autre.
  it("fait accepter une soumission construite depuis la lecture de l'écran", async () => {
    const lues = await listAppSettings();
    const ligne = lues.find((courante) => courante.key === "company.name");

    const resultat = await updateAppSettings(
      [
        {
          key: "company.name",
          value: "Le Cycle Lyonnais",
          version: ligne?.version ?? "",
        },
      ],
      "admin-1",
    );

    expect(resultat).toEqual({ ok: true, changedKeys: ["company.name"] });
  });

  it("fait accepter la première saisie d'une ligne NULL en base", async () => {
    // Le point exact où la normalisation `?? ""` pouvait se perdre : la base
    // rend `null`, le formulaire rend `""`. Si les deux bouts ne normalisaient
    // pas pareil, une clé jamais renseignée serait la seule à ne jamais
    // pouvoir être enregistrée - et `company.siret` comme `company.address`
    // sont dans ce cas au seed.
    findMany.mockResolvedValue([
      {
        key: "company.siret",
        value: null,
        valueType: "string",
        description: "Numéro SIRET",
        updatedAt: new Date("2026-08-05T10:00:00Z"),
      },
    ]);

    const lues = await listAppSettings();

    const resultat = await updateAppSettings(
      [
        {
          key: "company.siret",
          value: "12345678900011",
          version: lues[0]?.version ?? "",
        },
      ],
      "admin-1",
    );

    expect(resultat).toEqual({ ok: true, changedKeys: ["company.siret"] });
  });

  it("rend un jeton distinct par ligne, jamais un jeton de lot", async () => {
    // Le jeton porte LA LIGNE depuis le constat F3. Deux lignes de valeurs
    // différentes qui partageraient un jeton ramèneraient la granularité au
    // formulaire sans que rien ne le dise.
    const lues = await listAppSettings();

    expect(lues).toHaveLength(2);
    expect(lues[0]?.version).not.toBe(lues[1]?.version);
    expect(lues[0]?.version).toBe(jetonLigne("LeCycleLyonnais"));
  });

  it("garde `updatedAt`, que l'écran affiche encore", async () => {
    // `updated_at` ne décide plus rien (constat F2) mais il reste la seule
    // information que `US-SOCIETE-AFFICHER` motive, « vérifier qu'elles sont à
    // jour ». Le retirer de la sélection casserait l'écran sans toucher au
    // contrôle de concurrence.
    const lues = await listAppSettings();

    expect(lues[0]?.updatedAt).toEqual(new Date("2026-08-05T10:00:00Z"));
  });
});

describe("updateAppSettings, ce que l'ordre des trois contrôles laisse passer", () => {
  it("laisse tomber en silence l'écriture d'un appelant qui forge son jeton", async () => {
    // ⚠️ **Caractérisation d'un trou réel, dans la direction sûre.**
    //
    // Le jeton n'est pas un secret : c'est l'empreinte d'une valeur connue,
    // sans sel. Un appelant direct de la Server Action peut donc fabriquer
    // `jetonLigne(<valeur qu'il soumet>)`, ce qui fait tomber son entrée dans
    // le contrôle 2 - « champ non édité » - et sortir de la boucle.
    //
    // Conséquence : il PERD son écriture, il n'en gagne aucune. Pour écraser
    // la ligne d'un autre, il devrait produire `jetonLigne(<valeur stockée>)`,
    // donc connaître l'état courant, donc ne pas être périmé. L'asymétrie est
    // dans le bon sens, et c'est ce que ce test fige : le jour où l'ordre des
    // contrôles bougerait, ce test dirait dans quel sens.
    //
    // Le défaut résiduel est le MESSAGE, pas l'écriture : le résultat est
    // `ok: true` avec zéro changement, et l'écran afficherait « Aucune
    // modification à enregistrer » pour une soumission qui en demandait une.
    // Inaccessible depuis l'écran, qui renvoie le jeton qu'il a reçu.
    const resultat = await updateAppSettings(
      [
        {
          key: "company.name",
          value: "Valeur de l'attaquant",
          version: jetonLigne("Valeur de l'attaquant"),
        },
      ],
      "attaquant",
    );

    expect(resultat).toEqual({ ok: true, changedKeys: [] });
    expect(updateMany).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("accepte l'aller-retour A puis B puis A, sur l'état réellement stocké", async () => {
    // Deux états identiques donnent la même empreinte : un cycle A → B → A est
    // invisible au jeton, et le module le documente. Ce que ce test ajoute est
    // la conséquence sur l'ÉCRITURE - `before` est lu sur la ligne dans la
    // transaction, pas déduit du jeton, donc le prédicat et l'audit décrivent
    // l'état réel même quand le jeton ne distingue pas.
    const resultat = await updateAppSettings(
      [
        {
          key: "company.name",
          value: "Le Cycle Lyonnais",
          version: jetonLigne("LeCycleLyonnais"),
        },
      ],
      "admin-1",
    );

    expect(resultat).toEqual({ ok: true, changedKeys: ["company.name"] });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: { before: "LeCycleLyonnais", after: "Le Cycle Lyonnais" },
      }),
      tx,
    );
  });

  it("nomme TOUTES les lignes éditées périmées, pas seulement la première", async () => {
    // Le refus est devenu une liste de clés pour que le formulaire les marque
    // (`staleKeys`). Un `return` au premier périmé donnerait un `aria-invalid`
    // sur un champ et rien sur l'autre, alors que les deux afficheront une
    // valeur différente au rechargement.
    findMany.mockResolvedValue([
      { ...CURRENT[0], value: "Nom posé par un collègue" },
      { ...CURRENT[1], value: "autre@homecyclhome.fr" },
    ]);

    const resultat = await updateAppSettings(
      [
        {
          key: "company.name",
          value: "Le Cycle Lyonnais",
          version: jetonLigne("LeCycleLyonnais"),
        },
        {
          key: "company.email",
          value: "nouveau@homecyclhome.fr",
          version: jetonLigne("contact@homecyclhome.fr"),
        },
      ],
      "admin-2",
    );

    expect(resultat).toEqual({
      ok: false,
      reason: "stale",
      keys: ["company.name", "company.email"],
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("ne refuse pas la ligne non éditée dont un collègue a vidé la valeur", async () => {
    // La frontière `NULL` / chaîne vide sur la ligne NON éditée, dans l'autre
    // sens que le test livré : l'écran avait rendu une valeur, un collègue l'a
    // effacée. Une soumission qui ne touche pas ce champ ne doit rien refuser,
    // et ne rien écrire - sinon elle restaurerait la valeur effacée.
    findMany.mockResolvedValue([
      { ...CURRENT[0] },
      { ...CURRENT[1], value: null },
    ]);

    const resultat = await updateAppSettings(
      [
        {
          key: "company.name",
          value: "Le Cycle Lyonnais",
          version: jetonLigne("LeCycleLyonnais"),
        },
        {
          key: "company.email",
          value: "contact@homecyclhome.fr",
          version: jetonLigne("contact@homecyclhome.fr"),
        },
      ],
      "admin-2",
    );

    expect(resultat).toEqual({ ok: true, changedKeys: ["company.name"] });
    expect(updateMany).toHaveBeenCalledOnce();
  });

  it("refuse la ligne éditée dont un collègue a vidé la valeur", async () => {
    // Même situation, mais le champ EST édité : le jeton décrit « une valeur
    // qui n'est plus là », donc l'enregistrer écraserait l'effacement du
    // collègue et l'audit affirmerait un `before` faux.
    findMany.mockResolvedValue([{ ...CURRENT[1], value: null }]);

    const resultat = await updateAppSettings(
      [
        {
          key: "company.email",
          value: "nouveau@homecyclhome.fr",
          version: jetonLigne("contact@homecyclhome.fr"),
        },
      ],
      "admin-2",
    );

    expect(resultat).toEqual({
      ok: false,
      reason: "stale",
      keys: ["company.email"],
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("n'écrase pas une ligne devenue NULL que le prédicat ne retrouve plus", async () => {
    // Le seul angle mort du jeton pris seul : `jetonLigne(null)` et
    // `jetonLigne("")` sont égaux, donc un passage de `""` à `NULL` (ou
    // l'inverse) entre le rendu et la soumission ne le fait pas broncher.
    // C'est le prédicat de l'`updateMany` qui ferme le cas - son `where` porte
    // la valeur LUE dans la transaction - et le `count === 0` lève plutôt que
    // de laisser passer. Ce test tient la ceinture ET la bretelle.
    findMany.mockResolvedValue([
      {
        key: "company.siret",
        value: "",
        valueType: "string",
        description: "Numéro SIRET",
        updatedAt: new Date("2026-08-05T10:00:00Z"),
      },
    ]);
    updateMany.mockResolvedValue({ count: 0 });

    const resultat = await updateAppSettings(
      [
        {
          key: "company.siret",
          value: "12345678900011",
          version: jetonLigne(null),
        },
      ],
      "admin-2",
    );

    expect(resultat).toEqual({
      ok: false,
      reason: "stale",
      keys: ["company.siret"],
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { key: "company.siret", value: "" },
      data: { value: "12345678900011", updatedBy: "admin-2" },
    });
    expect(transactionAnnulee).toHaveBeenCalledOnce();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("laisse tomber une valeur invalide qu'un jeton forgé sort de la boucle", async () => {
    // Suite du premier test de ce describe, sur la branche de validation : le
    // contrôle 2 précède `validateSettingValue`, donc un jeton forgé fait
    // sortir l'entrée avant qu'elle soit validée. Encore une fois rien n'est
    // écrit, et encore une fois le résultat dit `ok`.
    //
    // ⚠️ Ce test CARACTÉRISE, il n'approuve pas : si l'ordre devait changer
    // pour refuser explicitement une entrée dont le jeton ne décrit ni l'état
    // stocké ni rien de rendu, c'est ici qu'il faudra le dire.
    findMany.mockResolvedValue([
      {
        key: "company.tva",
        value: "20",
        valueType: "number",
        description: "Taux de TVA",
        updatedAt: new Date("2026-08-05T10:00:00Z"),
      },
    ]);

    const resultat = await updateAppSettings(
      [{ key: "company.tva", value: "vingt", version: jetonLigne("vingt") }],
      "attaquant",
    );

    expect(resultat).toEqual({ ok: true, changedKeys: [] });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
