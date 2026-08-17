import "server-only";

import { createHash, randomBytes } from "node:crypto";

/// Jetons à usage unique de `verification_tokens`. Pattern imposé par
/// [[mcd-dictionnaire]] : 32 octets aléatoires URL-safe dans l'email, SHA-256
/// en base, comparaison sur le hash. Le clair ne vit que dans l'URL, donc une
/// fuite de base ne donne aucun lien utilisable.
///
/// Pas de bcrypt, et ce n'est pas un oubli : il protège un secret à faible
/// entropie contre une attaque hors ligne. 32 octets aléatoires ne se devinent
/// pas, et le coût se paierait à chaque clic sur un lien.

/// 24 h — `US-COMPTE-ACTIVER` §Cas d'erreur. Le reset de mot de passe est à 1 h
/// (T-V3-05) : le contraste est délibéré, la surface d'attaque d'un reset est
/// plus large que celle d'une activation initiale.
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/// `base64url` et non `base64` : le jeton voyage dans une query string, où un
/// `+`, un `/` ou un `=` se fait ré-encoder par le client de messagerie ou le
/// navigateur — et le hash ne correspond alors plus à rien.
export function generateVerificationToken(): {
  token: string;
  tokenHash: string;
} {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashVerificationToken(token) };
}

export function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verificationTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS);
}
