import "server-only";

import bcrypt from "bcrypt";

// Cost 10 : plancher OWASP retenu par ADR-005 v2. Le cost est encodé dans le
// hash lui-même, donc le relever plus tard ne casse pas les hashs existants —
// ils restent vérifiables, et se re-hashent à la prochaine connexion réussie.
const BCRYPT_COST = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  // bcrypt.compare lève sur un hash vide ou mal formé — cas réel, un compte
  // OAuth pur porte `password_hash = NULL`. On absorbe ici pour que l'appelant
  // n'ait pas à distinguer « mauvais mot de passe » de « pas de mot de passe » :
  // c'est exactement la distinction que l'anti-énumération interdit.
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
