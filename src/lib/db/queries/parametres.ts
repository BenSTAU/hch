import "server-only";

import { writeAuditLog } from "@/lib/audit/log";
import { db } from "@/lib/db/client";
import { empreinteValeur } from "@/lib/db/empreinte";
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
  /// Affichée par l'écran (« Modifié le »), et **plus jamais comparée** : le
  /// jeton de concurrence est `version`.
  updatedAt: Date;
  version: string;
};

/// `version` est l'empreinte de la valeur lue à l'ouverture de l'écran. C'est
/// le jeton de concurrence, le même instrument que pour les forfaits, et il
/// porte **une ligne** et non le formulaire entier.
export type SettingEntry = { key: string; value: string; version: string };

export type UpdateSettingsResult =
  | { ok: true; changedKeys: string[] }
  | { ok: false; reason: "unknown_keys"; keys: string[] }
  | { ok: false; reason: "invalid_values"; keys: string[] }
  | { ok: false; reason: "stale"; keys: string[] };

/// Le jeton d'une ligne, fabriqué sur la valeur **telle que l'écran la rend**
/// et non sur la valeur brute : `NULL` en base et chaîne vide au formulaire
/// décrivent le même état, « non renseigné », et le jeton doit dire la même
/// chose qu'eux. Sans cette normalisation, un champ jamais renseigné serait vu
/// comme édité à chaque soumission.
///
/// Exporté parce que c'est la **fabrique unique** : l'écran, le contrôle de
/// concurrence et les tests en dépendent tous, et deux calculs écrits
/// séparément divergeraient.
export function jetonLigne(valeur: string | null): string {
  return empreinteValeur(valeur ?? "");
}

/// Tri par clé : la page est un formulaire, et des champs qui changent de
/// place d'un rendu à l'autre sont un défaut d'utilisabilité autant qu'un test
/// E2E instable.
///
/// **Fabrique unique du jeton**, comme `versAdmin` l'est pour les forfaits :
/// celui que l'écran rend et celui que l'enregistrement recalcule doivent
/// sortir du même calcul. Deux calculs écrits séparément divergeraient, et tout
/// enregistrement serait refusé sans cause visible.
export async function listAppSettings(): Promise<AppSettingRow[]> {
  const lignes = await db.appSetting.findMany({
    select: {
      key: true,
      value: true,
      valueType: true,
      description: true,
      updatedAt: true,
    },
    orderBy: { key: "asc" },
  });

  return lignes.map((ligne) => ({
    ...ligne,
    version: jetonLigne(ligne.value),
  }));
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
/// Le patron est décrit au-dessus de `modifierForfait`, et c'est **le même
/// instrument** : une empreinte de contenu, pas la colonne `updated_at`.
///
/// ⚠️ **`updated_at` a été écarté comme jeton**, alors qu'il existe. Elle est
/// en `TIMESTAMP(6)` avec `DEFAULT CURRENT_TIMESTAMP`, donc une ligne posée
/// par du SQL porterait des microsecondes qu'un `Date` JavaScript perd : son
/// enregistrement serait refusé en boucle, sans cause visible. Le danger était
/// latent, pas actif, et aucune garde ne l'empêchait de devenir actif.
/// L'empreinte n'a pas cette faiblesse, et un patron dont onze écrans héritent
/// ne porte qu'un seul instrument. Arbitré le 2026-11-10 sur le constat F2 de
/// la session vérificatrice. La colonne reste écrite, elle ne décide plus.
///
/// ⚠️ **Granularité par CLÉ, et c'est ce que la DoD 6 tranche.** Une fiche de
/// forfait est une unité ; `app_settings` est N lignes indépendantes dans un
/// même formulaire, et ce formulaire resoumet ses N champs à chaque envoi. Le
/// contrôle ne porte donc que sur les lignes que l'administrateur a réellement
/// éditées, ce que leur jeton atteste : personne n'est refusé parce qu'un
/// collègue a touché une autre clé. Le tout-ou-rien demeure, sur les seules
/// lignes écrites, et un refus nomme exactement ces lignes.
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
      // `updatedAt` n'est plus lu : il ne décide plus rien, et le sélectionner
      // laisserait croire le contraire.
      select: { key: true, value: true, valueType: true },
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
    }[] = [];

    for (const entry of entries) {
      const row = byKey.get(entry.key);
      if (!row) continue; // inatteignable : `unknownKeys` a déjà filtré

      // `null` en base et chaîne vide dans le formulaire décrivent le même
      // état - « non renseigné ». Les distinguer ferait passer un champ vide
      // resoumis tel quel pour une modification.
      if ((row.value ?? "") === entry.value) continue;

      // ⚠️ **Le champ que l'administrateur n'a pas édité sort ici**, et c'est
      // ce qui donne sa granularité par clé au refus (DoD 6). La valeur
      // soumise est celle que l'écran avait rendue - son jeton l'atteste -
      // donc il n'y a rien à écrire sur cette ligne, et rien à écraser. Un
      // collègue a pu la changer entre-temps : ça ne doit pas refuser la
      // soumission d'un champ voisin, puisque celui-ci ne la touche pas.
      //
      // C'est le jeton qui le dit, et il est seul à pouvoir le dire : le
      // formulaire resoumet ses N champs à chaque envoi, l'état stocké ne
      // distingue donc pas « non édité » de « édité vers l'ancienne valeur ».
      // Conséquence assumée : retaper à l'identique ce que l'écran affiche
      // équivaut à ne pas y toucher.
      if (jetonLigne(entry.value) === entry.version) continue;

      // Reste une ligne réellement éditée. Son jeton doit décrire l'état
      // stocké, sans quoi l'enregistrer écraserait la modification d'un autre
      // administrateur - et l'entrée d'audit affirmerait un `before` qui
      // n'était déjà plus l'état réel.
      if (jetonLigne(row.value) !== entry.version) {
        staleKeys.push(entry.key);
        continue;
      }

      // La validation ne porte QUE sur ce qui change. Sinon une ligne dont la
      // valeur stockée ne respecte pas son `value_type` - posée par un seed,
      // une migration ou un UPDATE SQL manuel - rendrait le formulaire entier
      // insoumettable, y compris pour des champs sans rapport, puisque le lot
      // est tout-ou-rien.
      if (!validateSettingValue(row.valueType, entry.value).ok) {
        invalidKeys.push(entry.key);
        continue;
      }

      changed.push({ key: entry.key, before: row.value, after: entry.value });
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
      // `updateMany` et non `update`, pour le `where` élargi : il porte la
      // valeur LUE, et c'est lui qui ferme la fenêtre des millisecondes.
      const ecriture = await tx.appSetting.updateMany({
        where: { key: change.key, value: change.before },
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
