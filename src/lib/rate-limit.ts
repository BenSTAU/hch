import "server-only";

import { db } from "@/lib/db/client";

/// Compteur anti-abus à fenêtre glissante — PLAN S4 §11, table `rate_limits`
/// (migration 014, T-V3-01). Un helper pour les trois usages : renvois
/// d'activation, échecs de connexion (T-V3-03), demandes de réinitialisation
/// (T-V3-05).
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

/// `US-COMPTE-CONNECTER` §Cas d'erreur : « 5 tentatives échouées dans les 15
/// dernières minutes ». Ce sont les ÉCHECS qui comptent, pas les soumissions —
/// d'où les deux temps (`peekRateLimit` puis `recordRateLimitAttempt`) là où
/// l'activation décompte d'un seul geste.
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

/// La plus large des trois fenêtres. Purger sur la fenêtre de l'appelant
/// effacerait les lignes que les deux autres usages comptent encore.
const PURGE_MS = 24 * 60 * 60 * 1000;

/// Quotas des surfaces publiques du tunnel — **valeurs non prescrites par le
/// vault**, posées ici faute de mieux et à faire arbitrer (cf. body de PR).
///
/// Motif : `verifierAdresse` et `listerCreneaux` sont ouvertes au visiteur
/// anonyme et déclenchent, pour la première, un appel sortant vers la BAN de
/// l'IGN. Sans quota, elles servent de relais et peuvent faire blacklister
/// l'IP du VPS — la géolocalisation de tout le produit tomberait avec elle.
/// Relevé par l'agent testeur.
export const GEOCODAGE_LIMIT = 30;
export const GEOCODAGE_WINDOW_MS = 10 * 60 * 1000;

/// Dépôt de photos : cinq mégaoctets par fichier, et rien ne ramasse les
/// orphelins d'un tunnel abandonné. Le quota des cinq photos ne mord qu'à la
/// validation ; celui-ci borne le DISQUE.
export const UPLOAD_LIMIT = 30;
export const UPLOAD_WINDOW_MS = 60 * 60 * 1000;

/// Clé d'un appelant anonyme. L'adresse IP est le seul discriminant
/// disponible — imparfait derrière un NAT, mais c'est ce que le proxy expose,
/// et l'alternative est de ne rien compter du tout.
export function anonymousRateLimitKey(
  surface: string,
  ip: string | null,
): string {
  return `${surface}:${ip ?? "inconnue"}`;
}

export function uploadRateLimitKey(userId: string): string {
  return `upload:${userId}`;
}

/// Cinq usages partagent la table : sans préfixe, un échec de connexion
/// consommerait le quota de renvoi d'activation du même email.
export function activationRateLimitKey(email: string): string {
  return `activation:${email}`;
}

export function loginRateLimitKey(email: string): string {
  return `login:${email}`;
}

export type RateLimitVerdict =
  { allowed: true } | { allowed: false; retryAfterMs: number };

/// Lit l'état du quota **sans rien écrire**.
///
/// La connexion ne peut pas décompter à l'entrée : la SPEC compte les
/// tentatives ÉCHOUÉES, et on ne sait pas si l'authentification échoue avant de
/// l'avoir tentée. Décompter d'avance ferait tomber le plafond sur les
/// connexions réussies — cinq connexions légitimes dans le quart d'heure, un
/// technicien qui change d'appareil, et le compte se ferme.
export async function peekRateLimit(
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

  return { allowed: true };
}

/// Inscrit une tentative sur `key`, sans relire la fenêtre — l'appelant vient
/// de le faire, et chaque aller-retour se paie dans le tunnel SSH.
export async function recordRateLimitAttempt(
  key: string,
  options: { now?: Date } = {},
): Promise<void> {
  await db.rateLimit.create({
    data: { key, attemptedAt: options.now ?? new Date() },
  });
}

/// Efface le compteur d'une clé. Appelé après une connexion réussie : quatre
/// erreurs de frappe suivies du bon mot de passe ne doivent pas laisser quatre
/// tentatives armées pour le quart d'heure suivant.
///
/// PLAN S4 §11 ne dit rien du sort du compteur après un succès. Le trou a été
/// **remonté avant écriture** et tranché par Benjamin le 2026-08-09 — write-back
/// dû vers S4 §11.
///
/// Portée réelle : 1 à 4 échecs. À 5, plus aucun succès ne peut survenir pour
/// déclencher la purge — c'est le plafond qui gouverne.
export async function clearRateLimit(key: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key } });
}

/// Décompte une tentative sur `key`. Autorise et enregistre tant que la fenêtre
/// n'est pas pleine, refuse sans rien écrire ensuite.
///
/// Rien n'est enregistré sur un refus, volontairement : sinon chaque tentative
/// refusée repousse l'échéance et le plafond devient un bannissement définitif.
///
/// Reste l'entrée des deux usages qui décomptent **à l'appel** — renvoi
/// d'activation, et demande de réinitialisation en T-V3-05. La connexion, elle,
/// compose `peek` et `record` autour de la vérification du mot de passe.
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  options: { now?: Date } = {},
): Promise<RateLimitVerdict> {
  const now = options.now ?? new Date();

  const verdict = await peekRateLimit(key, limit, windowMs, { now });
  if (!verdict.allowed) return verdict;

  await recordRateLimitAttempt(key, { now });
  return { allowed: true };
}
