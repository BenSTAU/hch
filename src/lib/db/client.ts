import "server-only";

import { PrismaClient } from "@prisma/client";

// Singleton : sans lui, le hot-reload du serveur de développement instancie un
// PrismaClient à chaque rechargement de module et épuise le pool de connexions.
// Ici le coût serait doublé — chaque connexion est un canal multiplexé dans le
// tunnel SSH vers la base distante, et c'est aussi pourquoi la chaîne de
// connexion porte `connection_limit=5`.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

// En production le module n'est évalué qu'une fois : rien à mémoriser.
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
