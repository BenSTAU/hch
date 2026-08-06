import { z } from "zod";

/// Les cinq types de valeur d'`app_settings`, tenus par un CHECK SQL en
/// migration 002. La liste est dupliquée ici parce que Prisma ne représente
/// pas les CHECK : c'est la seule duplication, et elle est adjacente à la
/// fonction qui l'exerce.
export const SETTING_VALUE_TYPES = [
  "string",
  "number",
  "boolean",
  "json",
  "url",
] as const;

export type SettingValueType = (typeof SETTING_VALUE_TYPES)[number];

export function isSettingValueType(value: string): value is SettingValueType {
  return (SETTING_VALUE_TYPES as readonly string[]).includes(value);
}

/// Un couple clé/valeur soumis par le formulaire. La valeur est TOUJOURS du
/// texte : `app_settings.value` est une colonne TEXT, et `value_type` dit à la
/// lecture comment la relire. Convertir ici trahirait le modèle.
const settingEntrySchema = z.object({
  key: z
    .string()
    .min(1, "Clé de paramètre manquante")
    // `key` est VARCHAR(100). Sans cette borne, un dépassement devient une
    // erreur Postgres 22001 rendue en 500 au lieu d'un refus lisible.
    .max(100, "Clé de paramètre trop longue"),
  value: z.string(),
});

export const updateSettingsSchema = z.object({
  settings: z
    .array(settingEntrySchema)
    .min(1, "Aucun paramètre à enregistrer")
    .refine(
      (entries) => new Set(entries.map((e) => e.key)).size === entries.length,
      // Deux valeurs pour une même ligne : l'ordre d'écriture désignerait
      // silencieusement le gagnant, et l'entrée d'audit décrirait un diff qui
      // n'a jamais existé.
      { message: "Une même clé ne peut être soumise deux fois" },
    ),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

/// Résultat de la vérification d'une valeur contre son type déclaré. Union
/// discriminée porteuse d'un motif : l'écran compte plusieurs champs, un refus
/// sans cause n'y est pas actionnable.
export type SettingValueCheck = { ok: true } | { ok: false; reason: string };

export function validateSettingValue(
  valueType: string,
  value: string,
): SettingValueCheck {
  // Le type est contrôlé AVANT la porte du vide : dans l'ordre inverse, un
  // `value_type` inconnu passait tant que la valeur était vide et échouait dès
  // qu'elle ne l'était plus — deux verdicts contradictoires sur la même ligne.
  // Le CHECK SQL de la migration 002 rend le cas inatteignable aujourd'hui ;
  // l'ordre, lui, ne dépend pas de la base. Relevé par l'agent testeur (T-J0-05).
  if (!isSettingValueType(valueType)) {
    return { ok: false, reason: `Type de valeur inconnu : ${valueType}` };
  }

  // Le vide est « non renseigné », pas une valeur mal typée : `value` est
  // NULLable en base, et `company.siret` comme `company.address` sont seedées
  // vides. Sans cette porte, un champ typé ne pourrait plus jamais être effacé
  // une fois rempli.
  if (value === "") return { ok: true };

  switch (valueType) {
    case "string":
      return { ok: true };

    case "number": {
      // `Number("  ")` vaut 0 et `Number("")` aussi : la conversion implicite
      // de JavaScript accepte des chaînes qui ne sont pas des nombres écrits.
      // `Infinity` est un nombre pour `Number.isNaN` mais pas une valeur
      // stockable.
      const parsed = Number(value.trim());
      if (value.trim() === "" || !Number.isFinite(parsed)) {
        return { ok: false, reason: "Renseignez un nombre" };
      }
      return { ok: true };
    }

    case "boolean":
      if (value !== "true" && value !== "false") {
        return { ok: false, reason: "Renseignez `true` ou `false`" };
      }
      return { ok: true };

    case "json":
      try {
        JSON.parse(value);
        return { ok: true };
      } catch {
        return { ok: false, reason: "Renseignez un JSON valide" };
      }

    case "url": {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return { ok: false, reason: "Renseignez une URL complète" };
      }
      // `new URL("javascript:alert(1)")` réussit. Restreindre les schémas est
      // le contrôle qui compte : ces valeurs finissent dans des `href`.
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { ok: false, reason: "Seuls http et https sont acceptés" };
      }
      return { ok: true };
    }

    default: {
      // Exhaustivité forcée : ajouter un type à SETTING_VALUE_TYPES sans le
      // traiter ici casse la compilation, pas la production.
      const exhaustive: never = valueType;
      return { ok: false, reason: `Type non traité : ${String(exhaustive)}` };
    }
  }
}
