import "server-only";

import { cache } from "react";

import { db } from "@/lib/db/client";

/// Lecture publique du catalogue des forfaits - `US-FORFAIT-CONSULTER`.
///
/// ⚠️ Domaine `forfaits` mais modèle Prisma `Service` : c'est la seule couture
/// entre les deux vocabulaires, ici et nulle part ailleurs.

/// DTO et non l'entité Prisma : `price` est un `Decimal` de decimal.js, non
/// sérialisable vers un composant client, et un `select` élargi ferait fuir
/// `isActive` vers la vue publique.
export type ForfaitPublic = {
  id: number;
  label: string;
  description: string | null;
  /// En minutes ([[mcd-dictionnaire]] §services).
  duration: number;
  /// Chaîne à deux décimales, jamais un `number` : un DECIMAL(10,2) qui passe
  /// par un flottant binaire perd ses centimes. C'est elle qui sera figée en
  /// `price_snapshot` à la réservation (Constitution §4.1).
  price: string;
};

/// `cache()` de React : le layout public et la page appellent tous deux cette
/// lecture dans le même rendu. Sans lui, deux requêtes identiques par visite,
/// sur une base jointe par tunnel SSH.
export const listForfaitsPublics = cache(async (): Promise<ForfaitPublic[]> => {
  const forfaits = await db.service.findMany({
    // La vue publique MASQUE les forfaits inactifs, là où la vue admin les
    // grise. Deux règles opposées sur la même table : le filtre appartient à
    // la requête, sinon la prochaine surface héritera du mauvais défaut.
    where: { isActive: true },
    select: {
      id: true,
      label: true,
      description: true,
      duration: true,
      price: true,
    },
    // Prix croissant, `id` départageant : un ordre dépendant de l'insertion
    // rendrait le test E2E instable au premier seed rejoué.
    orderBy: [{ price: "asc" }, { id: "asc" }],
  });

  return forfaits.map((forfait) => ({
    ...forfait,
    // `toFixed(2)` et non `toString()` : Prisma normalise `85.00` en `85`.
    price: forfait.price.toFixed(2),
  }));
});
