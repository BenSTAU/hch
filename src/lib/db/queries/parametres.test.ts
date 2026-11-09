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

const { listAppSettings, lireContactSociete, updateAppSettings } =
  await import("./parametres");

/// Le jeton de concurrence que l'écran a rendu : l'`updated_at` des fixtures,
/// en ISO. Une soumission qui le porte décrit l'état courant ; toute autre
/// valeur décrit une fiche périmée.
const VERSION = "2026-08-05T10:00:00.000Z";

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

describe("updateAppSettings — cas nominal", () => {
  it("écrit la valeur modifiée et signe la ligne", async () => {
    const result = await updateAppSettings(
      [{ key: "company.name", value: "Le Cycle Lyonnais", version: VERSION }],
      "admin-1",
    );

    expect(result).toEqual({ ok: true, changedKeys: ["company.name"] });
    expect(updateMany).toHaveBeenCalledWith({
      where: { key: "company.name", updatedAt: new Date(VERSION) },
      data: { value: "Le Cycle Lyonnais", updatedBy: "admin-1" },
    });
  });

  it("écrit une entrée d'audit portant le diff", async () => {
    await updateAppSettings(
      [{ key: "company.name", value: "Le Cycle Lyonnais", version: VERSION }],
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
        { key: "company.name", value: "LeCycleLyonnais", version: VERSION },
        {
          key: "company.email",
          value: "nouveau@homecyclhome.fr",
          version: VERSION,
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
      [{ key: "company.name", value: "LeCycleLyonnais", version: VERSION }],
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
      [{ key: "company.name", value: "Autre", version: VERSION }],
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
      [{ key: "company.inexistante", value: "x", version: VERSION }],
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
        updatedAt: new Date(VERSION),
      },
    ]);

    const result = await updateAppSettings(
      [{ key: "company.tva", value: "vingt", version: VERSION }],
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
        { key: "company.name", value: "Le Cycle Lyonnais", version: VERSION },
        { key: "company.inexistante", value: "x", version: VERSION },
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
      [{ key: "company.siret", value: "", version: VERSION }],
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
      [{ key: "company.siret", value: "12345678900011", version: VERSION }],
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
      [{ key: "company.name", value: "", version: VERSION }],
      "admin-1",
    );

    expect(result).toEqual({ ok: true, changedKeys: ["company.name"] });
    expect(updateMany).toHaveBeenCalledWith({
      where: { key: "company.name", updatedAt: new Date(VERSION) },
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
        { key: "company.tva", value: "vingt", version: VERSION },
        { key: "<img src=x onerror=alert(1)>", value: "x", version: VERSION },
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
        { key: "company.name", value: "Le Cycle Lyonnais", version: VERSION },
        { key: "company.tva", value: "vingt", version: VERSION },
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
        { key: "company.tva", value: "vingt", version: VERSION },
        { key: "company.name", value: "Le Cycle Lyonnais", version: VERSION },
      ],
      "admin-1",
    );

    expect(result).toEqual({ ok: true, changedKeys: ["company.name"] });
    expect(updateMany).toHaveBeenCalledOnce();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "company.name", updatedAt: new Date(VERSION) },
      }),
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
        { key: "company.name", value: "Le Cycle Lyonnais", version: VERSION },
        {
          key: "company.email",
          value: "contact@homecyclhome.fr",
          version: VERSION,
        },
      ],
      "admin-1",
    );

    expect(updateMany).toHaveBeenCalledOnce();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "company.name", updatedAt: new Date(VERSION) },
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
      [{ key: "company.name", value: "Autre", version: VERSION }],
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
          version: "2026-01-01T00:00:00.000Z",
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
      [{ key: "company.name", value: "Le Cycle Lyonnais", version: VERSION }],
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
        { key: "company.name", value: "Le Cycle Lyonnais", version: VERSION },
        {
          key: "company.email",
          value: "nouveau@homecyclhome.fr",
          version: VERSION,
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

  it("fait porter le prédicat sur l'`updated_at` lu, pas sur celui du navigateur", async () => {
    // Le jeton reçu sert à produire le message ; c'est la valeur relue en base
    // qui entre dans le `WHERE`. Les confondre ferait écrire un prédicat
    // choisi par l'appelant.
    await updateAppSettings(
      [{ key: "company.name", value: "Le Cycle Lyonnais", version: VERSION }],
      "admin-1",
    );

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "company.name", updatedAt: new Date(VERSION) },
      }),
    );
  });

  it("ne refuse pas une ligne resoumise sans modification", async () => {
    // Un champ non touché est resoumis tel quel à chaque envoi. Son jeton EST
    // contrôlé comme les autres - le contrôle précède la comparaison de
    // valeur - mais il décrit l'état courant, donc rien ne le refuse, et
    // l'absence de changement le sort du lot avant l'écriture.
    //
    // ⚠️ Ne pas lire ce test comme « une ligne non modifiée échappe au
    // contrôle » : c'est l'inverse, et T11 ci-dessus fige ce que donne une
    // ligne non modifiée dont le jeton a vieilli.
    const resultat = await updateAppSettings(
      [{ key: "company.name", value: "LeCycleLyonnais", version: VERSION }],
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
        { key: "company.name", value: "Le Cycle Lyonnais", version: VERSION },
        {
          key: "company.email",
          value: "nouveau@homecyclhome.fr",
          version: VERSION,
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
      [{ key: "company.name", value: "Le Cycle Lyonnais", version: VERSION }],
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
      [{ key: "company.inexistante", value: "x", version: VERSION }],
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
        { key: "company.name", value: "Premier", version: VERSION },
        { key: "company.name", value: "Second", version: VERSION },
      ],
      "attaquant",
    );

    expect(resultat.ok).toBe(false);
    expect(transactionAnnulee).toHaveBeenCalledOnce();
  });
});

describe("updateAppSettings, portée du jeton sur le lot", () => {
  it("refuse le lot quand une ligne NON éditée a bougé", async () => {
    // Le formulaire resoumet ses cinq champs à chaque envoi, chacun avec son
    // jeton. Si un autre administrateur a touché `company.email` pendant que
    // celui-ci ne modifiait que `company.name`, le lot est refusé EN ENTIER.
    //
    // ⚠️ C'est la lecture stricte, et elle contredit le commentaire du test
    // « ne refuse pas une ligne resoumise sans modification », qui affirme
    // qu'un champ non touché n'a « aucune raison d'être contrôlé ». Le code
    // contrôle le jeton AVANT de comparer la valeur
    // (`src/lib/db/queries/parametres.ts`, boucle de `transactionSettings`) :
    // ce test fixe le comportement réel, pour qu'un relâchement futur de
    // l'ordre des contrôles ne passe pas inaperçu.
    findMany.mockResolvedValue([
      { ...CURRENT[0], updatedAt: new Date(VERSION) },
      {
        ...CURRENT[1],
        // Ligne touchée par quelqu'un d'autre depuis le rendu de l'écran.
        updatedAt: new Date("2026-08-05T11:30:00.000Z"),
      },
    ]);

    const resultat = await updateAppSettings(
      [
        { key: "company.name", value: "Le Cycle Lyonnais", version: VERSION },
        {
          key: "company.email",
          // Valeur INCHANGÉE : l'administrateur n'a pas touché ce champ.
          value: "contact@homecyclhome.fr",
          version: VERSION,
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
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});
