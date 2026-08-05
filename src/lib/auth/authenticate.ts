import "server-only";

import { findUserForLogin } from "@/lib/db/queries/auth";

import { verifyPassword } from "./password";

export type AuthenticatedUser = {
  id: string;
  roles: string[];
};

/// Union discriminée plutôt qu'un `User | null` : la branche d'échec ne porte
/// **aucun motif**, et c'est délibéré. Un `reason` ici finirait tôt ou tard
/// dans un message d'erreur, et l'anti-énumération tomberait sans que personne
/// ne s'en aperçoive (Constitution §4.2, SPEC §6.1).
export type AuthenticationResult =
  { ok: true; user: AuthenticatedUser } | { ok: false };

const REFUSED: AuthenticationResult = { ok: false };

export async function authenticateWithPassword(
  email: string,
  password: string,
): Promise<AuthenticationResult> {
  const user = await findUserForLogin(email);

  // Les quatre causes de refus — email inconnu, pas de provider local, mot de
  // passe faux, compte désactivé — produisent le même objet. C'est ce que
  // vérifie le test `renvoie un refus strictement identique`.
  if (!user) return REFUSED;

  const local = user.authProviders[0];
  if (!local?.passwordHash) return REFUSED;

  const ok = await verifyPassword(password, local.passwordHash);
  if (!ok) return REFUSED;

  if (!user.isActive) return REFUSED;

  return { ok: true, user: { id: user.id, roles: user.roles } };
}
