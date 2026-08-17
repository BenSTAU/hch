import "server-only";

/// Codes Prisma que le parcours d'authentification traite comme des **issues
/// métier**, pas comme des pannes : les deux naissent d'une course entre
/// requêtes concurrentes, que la base a arbitrée. Les laisser remonter à
/// `handleServerError` créerait un comportement observable de plus.
export const PRISMA_UNIQUE_VIOLATION = "P2002";
export const PRISMA_RECORD_NOT_FOUND = "P2025";

/// Reconnaissance par le `code` plutôt que par
/// `Prisma.PrismaClientKnownRequestError` : ce type vient du client généré, et
/// l'importer rendrait ces modules dépendants d'un `prisma generate` préalable.
/// Le `code` est stable et documenté, la forme de la classe non.
export function isPrismaError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === code
  );
}
