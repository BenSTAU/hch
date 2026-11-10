import "server-only";

import { writeAuditLog } from "@/lib/audit/log";
import { db } from "@/lib/db/client";
import type { HorairesSemaine } from "@/lib/creneaux/derivation";
import {
  cleHoraires,
  JOURS_SEMAINE,
  lirePlageHoraire,
} from "@/lib/creneaux/horaires";
import { validateSettingValue } from "@/lib/validations/parametres";

/// Helper métier, pas Server Action : aucun `revalidatePath`, aucun
/// `redirect`, aucun accès au contexte Next (CLAUDE.md §Server Actions). Ces
/// deux-là jettent hors contexte et rendraient ce module intestable.
export type AppSettingRow = {
  key: string;
  value: string | null;
  valueType: string;
  description: string | null;
  updatedAt: Date;
};

/// `version` est l'`updated_at` lu à l'ouverture de l'écran, en ISO. C'est le
/// jeton de concurrence : `app_settings` porte une colonne de version, on n'en
/// fabrique donc pas une (contrairement à `services`, qui n'en a aucune et
/// passe par une empreinte de contenu).
export type SettingEntry = { key: string; value: string; version: string };

export type UpdateSettingsResult =
  | { ok: true; changedKeys: string[] }
  | { ok: false; reason: "unknown_keys"; keys: string[] }
  | { ok: false; reason: "invalid_values"; keys: string[] }
  | { ok: false; reason: "stale"; keys: string[] };

/// Tri par clé : la page est un formulaire, et des champs qui changent de
/// place d'un rendu à l'autre sont un défaut d'utilisabilité autant qu'un test
/// E2E instable.
export async function listAppSettings(): Promise<AppSettingRow[]> {
  return db.appSetting.findMany({
    select: {
      key: true,
      value: true,
      valueType: true,
      description: true,
      updatedAt: true,
    },
    orderBy: { key: "asc" },
  });
}

/// Applique une soumission du formulaire de configuration société.
///
/// Trois propriétés que l'appelant ne peut pas obtenir autrement :
///   · **tout ou rien** - une soumission partiellement appliquée laisse
///     l'écran et la base en désaccord sans que personne sache ce qui est
///     passé ;
///   · **diff** - écrire les cinq champs à chaque envoi produirait cinq
///     entrées d'audit dont quatre décrivent un changement qui n'a pas eu
///     lieu, et tamponnerait `updated_by` sur des lignes intactes ;
///   · **audit dans la transaction** - cf. `src/lib/audit/log.ts` ;
///   · **refus d'écraser une ligne modifiée depuis l'ouverture de l'écran** -
///     ferme le défaut ouvert par l'agent testeur en T-J0-05 (constat B5) :
///     la modification du premier administrateur écrasée sans avertissement,
///     et une entrée d'audit du second affirmant un `before` qui n'était déjà
///     plus l'état réel.
///
/// Le patron est décrit au-dessus de `modifierForfait`. Ici le jeton est la
/// colonne `updated_at`, qui existe, plutôt qu'une empreinte de contenu.
export async function updateAppSettings(
  entries: SettingEntry[],
  actorId: string,
): Promise<UpdateSettingsResult> {
  try {
    return await transactionSettings(entries, actorId);
  } catch (erreur) {
    if (erreur instanceof ConcurrenceDetectee) {
      return { ok: false, reason: "stale", keys: [erreur.cle] };
    }
    throw erreur;
  }
}

/// ⚠️ **Une exception, et non un `return`.** Un `return` depuis le rappel de
/// `$transaction` **commite** : les lignes déjà écrites par la boucle
/// resteraient, et le « tout ou rien » serait faux. Seul un `throw` annule.
/// C'est le premier refus du module à survenir **après** une écriture.
class ConcurrenceDetectee extends Error {
  constructor(readonly cle: string) {
    super(`Ligne de configuration modifiée entre-temps : ${cle}`);
    this.name = "ConcurrenceDetectee";
  }
}

async function transactionSettings(
  entries: SettingEntry[],
  actorId: string,
): Promise<UpdateSettingsResult> {
  return db.$transaction(async (tx) => {
    const current = await tx.appSetting.findMany({
      where: { key: { in: entries.map((entry) => entry.key) } },
      select: { key: true, value: true, valueType: true, updatedAt: true },
    });
    const byKey = new Map(current.map((row) => [row.key, row]));

    // La table est clé-valeur et le formulaire est piloté par ses lignes : une
    // clé absente vient forcément d'ailleurs que de l'écran. Un `upsert` ici
    // laisserait n'importe qui peupler la configuration société.
    const unknownKeys = entries
      .map((entry) => entry.key)
      .filter((key) => !byKey.has(key));
    if (unknownKeys.length > 0) {
      return { ok: false, reason: "unknown_keys", keys: unknownKeys };
    }

    const invalidKeys: string[] = [];
    const staleKeys: string[] = [];
    const changed: {
      key: string;
      before: string | null;
      after: string;
      /// L'`updated_at` lu dans CETTE transaction, pas celui envoyé par le
      /// navigateur : c'est lui qui sert de prédicat à l'écriture.
      version: Date;
    }[] = [];

    for (const entry of entries) {
      const row = byKey.get(entry.key);
      if (!row) continue; // inatteignable : `unknownKeys` a déjà filtré

      // Fenêtre des minutes. Comparé avant la validation de la valeur : un
      // refus de concurrence ne se corrige pas en changeant le champ, il se
      // corrige en rechargeant.
      if (row.updatedAt.toISOString() !== entry.version) {
        staleKeys.push(entry.key);
        continue;
      }

      // `null` en base et chaîne vide dans le formulaire décrivent le même
      // état - « non renseigné ». Les distinguer ferait passer un champ vide
      // resoumis tel quel pour une modification.
      if ((row.value ?? "") === entry.value) continue;

      // La validation ne porte QUE sur ce qui change. Sinon une ligne dont la
      // valeur stockée ne respecte pas son `value_type` - posée par un seed,
      // une migration ou un UPDATE SQL manuel - rendrait le formulaire entier
      // insoumettable, y compris pour des champs sans rapport, puisque le lot
      // est tout-ou-rien.
      if (!validateSettingValue(row.valueType, entry.value).ok) {
        invalidKeys.push(entry.key);
        continue;
      }

      changed.push({
        key: entry.key,
        before: row.value,
        after: entry.value,
        version: row.updatedAt,
      });
    }

    // Le refus de concurrence passe AVANT celui de validation : une valeur
    // invalide dans un formulaire déjà périmé n'a plus d'intérêt, la ligne
    // fautive n'étant même plus celle que l'administrateur a sous les yeux.
    if (staleKeys.length > 0) {
      return { ok: false, reason: "stale", keys: staleKeys };
    }

    if (invalidKeys.length > 0) {
      return { ok: false, reason: "invalid_values", keys: invalidKeys };
    }

    for (const change of changed) {
      // `updateMany` et non `update`, pour le `where` élargi : c'est lui qui
      // ferme la fenêtre des millisecondes.
      //
      // ⚠️ **Piège de précision.** La colonne est un `TIMESTAMP(6)` lu en
      // `Date` JavaScript, qui ne va qu'à la milliseconde. Les lignes
      // actuelles ont toutes été écrites par Prisma, donc à la milliseconde
      // (vérifié en base le 2026-11-09). Une ligne insérée en SQL brut
      // tomberait sur le `DEFAULT CURRENT_TIMESTAMP`, qui porte des
      // microsecondes, et serait refusée en boucle sans cause visible : si
      // `app_settings` reçoit un jour des lignes par migration, ce prédicat
      // devra tronquer.
      const ecriture = await tx.appSetting.updateMany({
        where: { key: change.key, updatedAt: change.version },
        // `updatedBy` vient de l'appelant, jamais de la soumission - c'est la
        // Server Action qui le tire de la session.
        data: { value: change.after, updatedBy: actorId },
      });

      // Un succès vide est un refus. Le traiter autrement écrirait une trace
      // d'audit pour une modification qui n'a pas eu lieu.
      if (ecriture.count === 0) throw new ConcurrenceDetectee(change.key);

      await writeAuditLog(
        {
          entityType: "app_settings",
          entityId: change.key,
          action: "UPDATE",
          actorId,
          details: { before: change.before, after: change.after },
        },
        tx,
      );
    }

    return { ok: true, changedKeys: changed.map((change) => change.key) };
  });
}

/// Coordonnées de contact de la société - `company.phone` et `company.email`.
///
/// Premier lecteur de ces deux clés **hors du back-office** : elles étaient
/// seedées depuis le jalon 0 et n'étaient affichées nulle part. C'est
/// `US-INTERVENTION-ANNULER-CLIENT` §Cas d'erreur qui les fait sortir, en
/// renvoyant le client vers l'atelier passé la fenêtre H-24 - il faut alors lui
/// dire *comment* nous joindre, et la seule source qui fasse foi est celle que
/// l'administrateur tient à jour.
///
/// Les deux valeurs sont **facultatives** : la colonne est NULLable, un
/// administrateur peut vider le champ, et un `tel:` construit sur une chaîne
/// vide donnerait un lien mort. L'écran affiche ce qui existe.
export async function lireContactSociete(): Promise<{
  telephone: string | null;
  email: string | null;
}> {
  const lignes = await db.appSetting.findMany({
    where: { key: { in: ["company.phone", "company.email"] } },
    select: { key: true, value: true },
  });

  const parCle = new Map(lignes.map((ligne) => [ligne.key, ligne.value]));
  const lire = (cle: string): string | null => {
    const valeur = parCle.get(cle)?.trim();
    return valeur ? valeur : null;
  };

  return { telephone: lire("company.phone"), email: lire("company.email") };
}

/// Identité de la société, pour les mentions légales - `US-RGPD` §Critères,
/// « chaque page rappelle : nom entreprise, SIRET, coordonnées ».
///
/// Cinq clés d'`app_settings` et non des constantes : la LCEN impose que ces
/// mentions soient exactes, et un SIRET en dur vieillirait sans que personne le
/// voie.
///
/// Toutes facultatives, la colonne étant NULLable. La page signale ce qui
/// manque plutôt que d'afficher un trou : une mention légale absente est une
/// non-conformité, pas un détail de présentation.
export type IdentiteSociete = {
  nom: string | null;
  siret: string | null;
  adresse: string | null;
  telephone: string | null;
  email: string | null;
};

export async function lireIdentiteSociete(): Promise<IdentiteSociete> {
  const lignes = await db.appSetting.findMany({
    where: {
      key: {
        in: [
          "company.name",
          "company.siret",
          "company.address",
          "company.phone",
          "company.email",
        ],
      },
    },
    select: { key: true, value: true },
  });

  const parCle = new Map(lignes.map((ligne) => [ligne.key, ligne.value]));
  const lire = (cle: string): string | null => {
    const valeur = parCle.get(cle)?.trim();
    return valeur ? valeur : null;
  };

  return {
    nom: lire("company.name"),
    siret: lire("company.siret"),
    adresse: lire("company.address"),
    telephone: lire("company.phone"),
    email: lire("company.email"),
  };
}

/// Horaires d'ouverture de la société, lus depuis les sept clés
/// `business_hours.*`.
///
/// C'est le terme gauche de `planning(tech affecté à zone)` de la Constitution
/// §2.1. Il n'existe **pas** d'horaire par technicien en v1 : « planning
/// technicien » se lit *horaires de la société moins les créneaux déjà pris par
/// ce technicien*. Une table `zone_business_hours` a été écartée - une seule
/// zone, un seul technicien seedé, et elle exigerait un CRUD d'administration
/// que la V1 devrait porter.
///
/// Les valeurs illisibles sont remontées à part plutôt qu'avalées : une faute
/// de frappe de l'administrateur ferme une journée, et il faut pouvoir le voir
/// autrement qu'en constatant une grille vide.
export async function lireHorairesSemaine(): Promise<{
  horaires: HorairesSemaine;
  clesInvalides: string[];
}> {
  const lignes = await db.appSetting.findMany({
    where: { key: { in: JOURS_SEMAINE.map(cleHoraires) } },
    select: { key: true, value: true },
  });

  const parCle = new Map(lignes.map((ligne) => [ligne.key, ligne.value]));

  const horaires: HorairesSemaine = {};
  const clesInvalides: string[] = [];

  for (const jour of JOURS_SEMAINE) {
    const cle = cleHoraires(jour);
    const lecture = lirePlageHoraire(parCle.get(cle) ?? null);

    if (lecture.ouvert) {
      horaires[jour] = lecture.plage;
      continue;
    }

    // Fermé et illisible produisent la même grille - aucun créneau ce jour-là.
    // Seule la trace diffère.
    horaires[jour] = null;
    if (lecture.raison === "invalide") clesInvalides.push(cle);
  }

  return { horaires, clesInvalides };
}
