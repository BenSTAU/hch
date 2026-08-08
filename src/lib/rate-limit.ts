import "server-only";

import { db } from "@/lib/db/client";

/// Compteur anti-abus à fenêtre glissante — PLAN S4 §11, table `rate_limits`
/// (migration 014, T-V3-01). Un helper pour les trois usages : renvois
/// d'activation (ici), échecs de connexion (T-V3-03), demandes de
/// réinitialisation (T-V3-05).
///
/// La table n'a **aucune clé étrangère**, et c'est le cœur de la décision. Un
/// compteur porté par des colonnes de `users` n'existerait pas pour un email
/// inconnu : « trop de tentatives » ne s'afficherait que pour les comptes
/// existants, ce qui en fait un oracle d'énumération — la fuite exacte que le
/// durcissement à temps constant de T-J0-04 a fermée. Ce module ne consulte donc
/// jamais `users` : il ne sait pas si la clé désigne un compte, et ne doit pas le
/// savoir.

export const ACTIVATION_RESEND_LIMIT = 3;
export const ACTIVATION_RESEND_WINDOW_MS = 24 * 60 * 60 * 1000;

/// La plus large des trois fenêtres. Purger sur la fenêtre de l'appelant
/// effacerait les lignes que les deux autres usages comptent encore.
const PURGE_MS = 24 * 60 * 60 * 1000;

/// Trois usages partagent la table : sans préfixe, un échec de connexion
/// consommerait le quota de renvoi d'activation du même email.
export function activationRateLimitKey(email: string): string {
  return `activation:${email}`;
}

export type RateLimitVerdict =
  { allowed: true } | { allowed: false; retryAfterMs: number };

/// Décompte une tentative sur `key`. Autorise et enregistre tant que la fenêtre
/// n'est pas pleine, refuse sans rien écrire ensuite.
///
/// Rien n'est enregistré sur un refus, volontairement : sinon chaque tentative
/// refusée repousse l'échéance et le plafond devient un bannissement définitif.
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  options: { now?: Date } = {},
): Promise<RateLimitVerdict> {
  const now = options.now ?? new Date();

  // Purge opportuniste à la lecture, pas de tâche planifiée (PLAN S4 §11.2).
  await db.rateLimit.deleteMany({
    where: { attemptedAt: { lt: new Date(now.getTime() - PURGE_MS) } },
  });

  const dansLaFenetre = await db.rateLimit.findMany({
    where: { key, attemptedAt: { gte: new Date(now.getTime() - windowMs) } },
    orderBy: { attemptedAt: "asc" },
    take: limit,
    select: { attemptedAt: true },
  });

  if (dansLaFenetre.length >= limit) {
    // Le délai part de la tentative la PLUS ANCIENNE : c'est elle qui sortira de
    // la fenêtre la première, donc elle qui libère un jeton. Partir de la plus
    // récente ferait attendre une fenêtre entière à quelqu'un dont le quota se
    // libère dans une minute.
    const plusAncienne = dansLaFenetre[0]!.attemptedAt.getTime();
    return {
      allowed: false,
      retryAfterMs: plusAncienne + windowMs - now.getTime(),
    };
  }

  await db.rateLimit.create({ data: { key, attemptedAt: now } });
  return { allowed: true };
}
