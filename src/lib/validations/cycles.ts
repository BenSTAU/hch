import { z } from "zod";

/// Schémas du domaine `cycles`.

/// Les trois valeurs du CHECK SQL de la migration 007 (`init_cycles`), tenues
/// aussi par le dictionnaire §cycles champ 4. Cette liste doit rester leur
/// miroir exact : une quatrième valeur acceptée ici ferait échouer l'écriture
/// en base, donc la saisie qu'elle devait valider.
export const TYPES_CYCLE = ["CLASSIC", "ELECTRIC", "CARGO"] as const;

export type TypeCycle = (typeof TYPES_CYCLE)[number];

/// Borne basse de `year`, écrite par `US-CYCLE-AJOUTER` §Cas d'erreur.
export const ANNEE_MINIMALE = 1900;

/// Les quatre champs saisissables, partagés par l'ajout et la modification.
///
/// ⚠️ **Ces bornes sont applicatives et SEULES.** Le dictionnaire §cycles ne
/// pose aucun CHECK sur `year`, et la seule contrainte de base est le CHECK sur
/// `type` : une écriture qui ne passerait pas par ce schéma ne rencontrerait
/// aucun filet. Même régime que les bornes du montant de T-V2-03, et c'est ce
/// que la DoD demande d'écrire plutôt que de supposer.
export const champsCycleSchema = z.object({
  /// `trim` AVANT `min` : sans lui, une suite d'espaces satisfait la longueur
  /// et s'écrit en base comme une marque vide.
  brand: z
    .string()
    .trim()
    .min(1, "Marque requise")
    .max(100, "Marque trop longue (100 caractères maximum)"),

  /// Facultatif au dictionnaire, donc `null` en base et jamais chaîne vide :
  /// deux représentations de l'absence obligeraient chaque lecteur à tester les
  /// deux.
  model: z
    .string()
    .trim()
    .max(100, "Modèle trop long (100 caractères maximum)")
    .nullable()
    .default(null)
    .transform((valeur) => (valeur === "" ? null : valeur)),

  type: z.enum(TYPES_CYCLE, { error: "Type invalide" }),

  /// L'année courante est lue **au parse**, dans le corps du `refine`, et non à
  /// l'évaluation du module : ce schéma est importé par du code client, et une
  /// borne figée au chargement refuserait toute saisie de l'année en cours dès
  /// le passage de minuit du 31 décembre sur un onglet resté ouvert.
  year: z
    .number({ error: "Année d'achat invalide" })
    .int("Année d'achat invalide")
    .nullable()
    .default(null)
    .refine(
      (valeur) =>
        valeur === null ||
        (valeur >= ANNEE_MINIMALE && valeur <= new Date().getFullYear()),
      "Année d'achat invalide",
    ),
});

/// `cycles.id` est un `SERIAL`, donc énumérable. Il transite quand même : c'est
/// la cible de la modification. Ce qui ne transite **jamais** est le
/// propriétaire, pris dans la session par `authActionClient`.
const cycleIdSchema = z.number().int().positive();

/// Ajout - `US-CYCLE-AJOUTER`.
export const ajouterCycleSchema = champsCycleSchema;

/// Modification - `US-CYCLE-MODIFIER`. Les quatre champs voyagent ensemble,
/// modifiés ou non : le formulaire est le même que celui de l'ajout, et un
/// `PATCH` partiel rendrait indistinguables « champ absent » et « champ vidé ».
export const modifierCycleSchema = champsCycleSchema.extend({
  cycleId: cycleIdSchema,
});

/// Rattachement d'un vélo à une intervention `PLANNED`.
///
/// `cycleId: null` est le **détachement**, et il fait partie du contrat plutôt
/// que d'une action séparée : `interventions.cycle_id` est NULLable et le
/// rattachement est déclaré facultatif (dictionnaire §interventions champ 14).
/// Sans lui, une erreur de désignation serait définitive, ce qui contredirait
/// « facultatif ». Même frontière `PLANNED` que le rattachement lui-même.
export const rattacherCycleSchema = z.object({
  interventionId: z.number().int().positive(),
  cycleId: cycleIdSchema.nullable(),
});

export type ChampsCycleInput = z.infer<typeof champsCycleSchema>;
export type ModifierCycleInput = z.infer<typeof modifierCycleSchema>;
