import "server-only";

import { cache } from "react";

import { db } from "@/lib/db/client";

/// Lecture publique du catalogue des forfaits — `US-FORFAIT-CONSULTER`.
///
/// Domaine `forfaits` et modèle Prisma `Service` : le glossaire les apparie
/// (forfait ↔ `services`), et CLAUDE.md §Folder structure impose le nom du
/// domaine dans les chemins. C'est la seule couture entre les deux vocabulaires,
/// elle est ici et nulle part ailleurs.
///
/// Helper métier, pas Server Action : aucun `revalidatePath`, aucun `redirect`,
/// aucun contexte Next — donc testable en isolation.

/// DTO, et non l'entité Prisma. Deux raisons, aucune cosmétique :
///
///   · `price` est un `Decimal` de decimal.js. Rendu tel quel dans un composant,
///     il traverse la frontière serveur/client comme un objet non sérialisable ;
///   · un `select` qui s'élargit un jour ferait fuir `isActive` et les colonnes
///     à venir vers la vue publique. La projection est décidée ici.
export type ForfaitPublic = {
  id: number;
  label: string;
  description: string | null;
  /// En minutes (dictionnaire §services champ 4).
  duration: number;
  /// Chaîne à deux décimales, jamais un `number` : un DECIMAL(10,2) qui passe
  /// par un flottant binaire perd ses centimes. C'est cette chaîne qui sera
  /// figée en `price_snapshot` à la réservation (Constitution §4.1).
  price: string;
};

/// `cache()` de React : le layout public et la page appellent tous deux cette
/// lecture dans le même rendu — le premier pour savoir s'il propose un appel à
/// la réservation, la seconde pour afficher la grille. Sans lui, deux requêtes
/// identiques par visite, sur une base jointe par tunnel SSH.
export const listForfaitsPublics = cache(async (): Promise<ForfaitPublic[]> => {
  const forfaits = await db.service.findMany({
    // La vue publique MASQUE les forfaits inactifs, là où la vue admin
    // (`US-FORFAIT-LISTER`) les grise. Deux règles opposées sur la même table :
    // le filtre appartient à la requête, pas à la vue, sinon la seconde surface
    // qui lira ce catalogue héritera du mauvais défaut.
    where: { isActive: true },
    select: {
      id: true,
      label: true,
      description: true,
      duration: true,
      price: true,
    },
    // Prix croissant : le visiteur compare, et une grille dont l'ordre dépend
    // de l'ordre d'insertion en base rend le test E2E instable au premier seed
    // rejoué. `id` départage deux forfaits au même prix.
    orderBy: [{ price: "asc" }, { id: "asc" }],
  });

  return forfaits.map((forfait) => ({
    ...forfait,
    // `toFixed(2)` et non `toString()` : Prisma normalise `85.00` en `85`, et
    // c'est au formateur d'afficher les centimes, pas à lui de les deviner.
    price: forfait.price.toFixed(2),
  }));
});
