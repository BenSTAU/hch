import "server-only";

/// Codes d'erreur Prisma que le parcours d'authentification traite comme des
/// **issues métier**, pas comme des pannes.
///
/// Les deux naissent d'une course entre deux requêtes concurrentes, et dans les
/// deux cas la base a bien fait son travail — c'est elle qui arbitre. Les laisser
/// remonter à `handleServerError` produirait « une erreur est survenue » là où le
/// parcours a une réponse à donner, et créerait un comportement observable de
/// plus (agent testeur T-V3-02, B4 et B5).
export const PRISMA_UNIQUE_VIOLATION = "P2002";
export const PRISMA_RECORD_NOT_FOUND = "P2025";

/// Reconnaissance par le code, sans importer `Prisma.PrismaClientKnownRequestError`.
///
/// Le type vient du client généré : l'importer rendrait ces modules dépendants
/// d'un artefact que `prisma generate` doit avoir produit, ce qui n'est pas vrai
/// partout où le typage tourne. Le `code` est stable et documenté, la forme de la
/// classe non.
export function isPrismaError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === code
  );
}
