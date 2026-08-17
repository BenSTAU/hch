import "server-only";

import { db } from "@/lib/db/client";

/// Compteur anti-abus, PLAN S4 §11, table `rate_limits`. Deux régimes :
///
/// - **fenêtre glissante** pour les renvois d'activation et les demandes de
///   réinitialisation. Un plafond d'envois quotidien, où une tentative sortie
///   par le haut libère un jeton. `consumeRateLimit` sert ces deux usages.
/// - **blocage ferme** pour les échecs de connexion. Cinq échecs arment un
///   verrou de 10 minutes, puis le compteur repart de zéro. `peekLoginLockout`
///   sert ce seul usage.
///
/// ⚠️ La table n'a **aucune clé étrangère**, et c'est le cœur de la décision :
/// un compteur porté par des colonnes de `users` n'existerait pas pour un email
/// inconnu, donc « trop de tentatives » ne s'afficherait que pour les comptes
/// existants - un oracle d'énumération. Ce module ne consulte jamais `users`,
/// il ne sait pas si la clé désigne un compte et ne doit pas le savoir.

export const ACTIVATION_RESEND_LIMIT = 3;
export const ACTIVATION_RESEND_WINDOW_MS = 24 * 60 * 60 * 1000;

/// `US-COMPTE-CONNECTER` §Cas d'erreur, amendée le 2026-08-09 : « 5 tentatives
/// échouées » puis « **pendant 10 minutes fermes** puis compteur remis à zéro ».
/// Ce sont les ÉCHECS qui comptent, pas les soumissions, d'où les deux temps
/// (`peekLoginLockout` puis `recordRateLimitAttempt`) là où l'activation
/// décompte d'un seul geste.
///
/// Le nom ne dit plus « fenêtre » : la durée ne glisse plus, elle expire. La
/// version glissante permettait de tenir le verrou indéfiniment sur le compte
/// d'un tiers à raison d'une requête toutes les 3 minutes (PLAN S4 §11.1,
/// encart du 2026-08-09).
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_LOCKOUT_MS = 10 * 60 * 1000;

/// La plus large des fenêtres. Purger sur la fenêtre de l'appelant effacerait
/// les lignes que les autres usages comptent encore.
const PURGE_MS = 24 * 60 * 60 * 1000;

/// Dépôt de photos : cinq mégaoctets par fichier, et rien ne ramasse les
/// orphelins d'un tunnel abandonné. Le quota des cinq photos ne mord qu'à la
/// validation ; celui-ci borne le DISQUE.
export const UPLOAD_LIMIT = 30;
export const UPLOAD_WINDOW_MS = 60 * 60 * 1000;

export function uploadRateLimitKey(userId: string): string {
  return `upload:${userId}`;
}

/// Quatre usages partagent la table - activation, réinitialisation, connexion,
/// dépôt de photos - et tous sont keyés sur l'utilisateur ou son email, aucun
/// sur l'IP (PLAN S4 §11.1). Sans préfixe, un échec de connexion consommerait
/// le quota de renvoi d'activation du même email.
export function activationRateLimitKey(email: string): string {
  return `activation:${email}`;
}

export function loginRateLimitKey(email: string): string {
  return `login:${email}`;
}

export type RateLimitVerdict =
  { allowed: true } | { allowed: false; retryAfterMs: number };

/// Purge opportuniste à la lecture, pas de tâche planifiée (PLAN S4 §11.2).
async function purgerLignesPerimees(now: Date): Promise<void> {
  await db.rateLimit.deleteMany({
    where: { attemptedAt: { lt: new Date(now.getTime() - PURGE_MS) } },
  });
}

/// Lecture d'une fenêtre glissante, **sans rien écrire** sur la clé.
///
/// Privée : depuis l'amendement du 2026-08-09, la connexion ne lit plus en
/// fenêtre glissante, et `consumeRateLimit` est le seul appelant qui reste. Un
/// lecteur exporté sans appelant serait une invitation à rouvrir le régime que
/// cet amendement ferme.
async function peekFenetreGlissante(
  key: string,
  limit: number,
  windowMs: number,
  now: Date,
): Promise<RateLimitVerdict> {
  await purgerLignesPerimees(now);

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

/// Lit l'état du verrou de connexion, régime **ferme** (SPEC §298-300).
/// Réservé au préfixe `login:`.
///
/// La connexion ne peut pas décompter à l'entrée : la SPEC compte les
/// tentatives ÉCHOUÉES, et on ne sait pas si l'authentification échoue avant de
/// l'avoir tentée. Décompter d'avance fermerait le compte au bout de cinq
/// connexions légitimes d'affilée.
///
/// ⚠️ Trois écarts avec la fenêtre glissante, tous nécessaires :
///
/// 1. aucune borne d'âge à la lecture, une ligne appartenant au cycle courant
///    tant que le verrou n'a pas expiré ;
/// 2. l'échéance est datée sur le **5e** échec et non sur le premier, sinon
///    insister la repousserait ;
/// 3. à l'expiration le compteur est **effacé** et pas seulement ignoré, sinon
///    la tentative suivante rearmerait le verrou toute seule.
///
/// Conséquence assumée : le compteur n'oublie plus au fil du temps. Seuls une
/// connexion réussie ou la purge des 24 h l'effacent.
export async function peekLoginLockout(
  key: string,
  limit: number,
  lockoutMs: number,
  options: { now?: Date } = {},
): Promise<RateLimitVerdict> {
  const now = options.now ?? new Date();

  await purgerLignesPerimees(now);

  const echecs = await db.rateLimit.findMany({
    where: { key },
    orderBy: { attemptedAt: "asc" },
    take: limit,
    select: { attemptedAt: true },
  });

  if (echecs.length < limit) return { allowed: true };

  // La limit-ième plus ancienne : c'est l'échec qui a fait tomber le verrou.
  // Lire les plus anciennes plutôt que les plus récentes est ce qui rend le
  // point de départ stable si deux échecs concurrents ont franchi le plafond.
  const declencheur = echecs[echecs.length - 1]!.attemptedAt;
  const finDuBlocage = declencheur.getTime() + lockoutMs;

  if (now.getTime() < finDuBlocage) {
    // Rien n'est enregistré sur un refus. C'était déjà vrai en fenêtre
    // glissante, et ça reste la condition pour que le verrou expire vraiment.
    return { allowed: false, retryAfterMs: finDuBlocage - now.getTime() };
  }

  // Remise à zéro. Bornée aux lignes RELUES, pas à la clé entière : un échec
  // concurrent enregistré entre la lecture et la suppression appartient au
  // cycle suivant et n'a pas à disparaître avec l'ancien.
  await db.rateLimit.deleteMany({
    where: { key, attemptedAt: { lte: declencheur } },
  });

  return { allowed: true };
}

/// Inscrit une tentative sur `key`, sans relire la fenêtre. L'appelant vient de
/// le faire, et chaque aller-retour se paie dans le tunnel SSH.
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
/// tentatives armées pour la suite.
///
/// PLAN S4 §11 ne dit rien du sort du compteur après un succès. Le trou a été
/// **remonté avant écriture** et tranché par Benjamin le 2026-08-09, write-back
/// dû vers S4 §11.
///
/// Portée réelle : 1 à 4 échecs. À 5, plus aucun succès ne peut survenir pour
/// déclencher la purge, c'est le verrou qui gouverne.
export async function clearRateLimit(key: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key } });
}

/// Décompte une tentative sur `key` en **fenêtre glissante**. Autorise et
/// enregistre tant que la fenêtre n'est pas pleine, refuse sans rien écrire
/// ensuite.
///
/// Rien n'est enregistré sur un refus, volontairement : sinon chaque tentative
/// refusée repousse l'échéance et le plafond devient un bannissement définitif.
///
/// Entrée des usages qui décomptent **à l'appel** : renvoi d'activation, dépôt
/// de photos, et demande de réinitialisation en T-V3-05. La connexion, elle,
/// compose `peekLoginLockout` et `recordRateLimitAttempt` autour de la
/// vérification du mot de passe, et suit le régime ferme.
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  options: { now?: Date } = {},
): Promise<RateLimitVerdict> {
  const now = options.now ?? new Date();

  const verdict = await peekFenetreGlissante(key, limit, windowMs, now);
  if (!verdict.allowed) return verdict;

  await recordRateLimitAttempt(key, { now });
  return { allowed: true };
}
