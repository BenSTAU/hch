import "server-only";

import type { Prisma } from "@prisma/client";

/// Aide à l'audit, partagée par les écrans d'administration.
///
/// `audit_logs.details` ne porte que les champs **modifiés**
/// (`US-FORFAIT-MODIFIER` §Cas nominal). Y écrire le formulaire entier
/// décrirait des changements qui n'ont pas eu lieu, ce qui contredit
/// Constitution §4.2 aussi sûrement qu'un journal absent.
///
/// ⚠️ **`{ before, after }` et non `{ avant, après }`** : `app_settings` écrit
/// déjà ce vocabulaire depuis T-J0-05, et une requête SQL sur `details` doit
/// interroger les deux entités d'un seul coup.

/// Un `Decimal` n'est pas comparable ici : il compare par référence sous
/// `Object.is` et ne se sérialise pas proprement vers `JSONB`. Il se normalise
/// en chaîne avant d'arriver.
export type ValeurAuditable = string | number | boolean | null;

export type DiffChamps = Record<
  string,
  { before: ValeurAuditable; after: ValeurAuditable }
>;

/// Un champ absent d'`apres` est **non soumis**, pas vidé : sans cette
/// distinction, un formulaire partiel effacerait les colonnes qu'il n'affiche
/// pas.
export function diffChamps(
  avant: Readonly<Record<string, ValeurAuditable>>,
  apres: Readonly<Record<string, ValeurAuditable>>,
): DiffChamps {
  const diff: DiffChamps = {};

  for (const [champ, valeurApres] of Object.entries(apres)) {
    const valeurAvant = avant[champ] ?? null;
    if (Object.is(valeurAvant, valeurApres)) continue;

    diff[champ] = { before: valeurAvant, after: valeurApres };
  }

  return diff;
}

export function champsModifies(diff: DiffChamps): string[] {
  return Object.keys(diff);
}

/// `Prisma.InputJsonValue` refuse un `Record` dont les valeurs sont `null` au
/// sens strict de TypeScript, là où `JSONB` les accepte. La conversion est
/// faite une fois ici plutôt que répétée en `as` dans chaque mutation.
export function detailsAudit(diff: DiffChamps): Prisma.InputJsonValue {
  return diff as unknown as Prisma.InputJsonValue;
}
