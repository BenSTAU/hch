import "server-only";

import { writeAuditLog } from "@/lib/audit/log";
import { db } from "@/lib/db/client";
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

export type SettingEntry = { key: string; value: string };

export type UpdateSettingsResult =
  | { ok: true; changedKeys: string[] }
  | { ok: false; reason: "unknown_keys"; keys: string[] }
  | { ok: false; reason: "invalid_values"; keys: string[] };

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
///   · **tout ou rien** — une soumission partiellement appliquée laisse
///     l'écran et la base en désaccord sans que personne sache ce qui est
///     passé ;
///   · **diff** — écrire les cinq champs à chaque envoi produirait cinq
///     entrées d'audit dont quatre décrivent un changement qui n'a pas eu
///     lieu, et tamponnerait `updated_by` sur des lignes intactes ;
///   · **audit dans la transaction** — cf. `src/lib/audit/log.ts`.
export async function updateAppSettings(
  entries: SettingEntry[],
  actorId: string,
): Promise<UpdateSettingsResult> {
  return db.$transaction(async (tx) => {
    const current = await tx.appSetting.findMany({
      where: { key: { in: entries.map((entry) => entry.key) } },
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
    const changed: { key: string; before: string | null; after: string }[] = [];

    for (const entry of entries) {
      const row = byKey.get(entry.key);
      if (!row) continue; // inatteignable : `unknownKeys` a déjà filtré

      // `null` en base et chaîne vide dans le formulaire décrivent le même
      // état — « non renseigné ». Les distinguer ferait passer un champ vide
      // resoumis tel quel pour une modification.
      if ((row.value ?? "") === entry.value) continue;

      // La validation ne porte QUE sur ce qui change. Sinon une ligne dont la
      // valeur stockée ne respecte pas son `value_type` — posée par un seed,
      // une migration ou un UPDATE SQL manuel — rendrait le formulaire entier
      // insoumettable, y compris pour des champs sans rapport, puisque le lot
      // est tout-ou-rien. Relevé par l'agent testeur sur T-J0-05 (B6).
      if (!validateSettingValue(row.valueType, entry.value).ok) {
        invalidKeys.push(entry.key);
        continue;
      }

      changed.push({ key: entry.key, before: row.value, after: entry.value });
    }

    if (invalidKeys.length > 0) {
      return { ok: false, reason: "invalid_values", keys: invalidKeys };
    }

    for (const change of changed) {
      await tx.appSetting.update({
        where: { key: change.key },
        // `updatedBy` vient de l'appelant, jamais de la soumission — c'est la
        // Server Action qui le tire de la session.
        data: { value: change.after, updatedBy: actorId },
      });

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
