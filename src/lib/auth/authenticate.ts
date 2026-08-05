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

/// Hash de leurre, cost 10, d'une valeur qui n'est le mot de passe de personne.
/// Il n'est pas là pour être trouvé mais pour être **comparé** : sans lui, les
/// sorties anticipées répondent en 0,03 ms là où une vraie vérification coûte
/// 21 ms, et l'existence d'un compte se lit au chronomètre — 1 300× à 16 000×
/// d'écart mesurés par l'agent testeur sur T-J0-04.
const DECOY_HASH =
  "$2b$10$nDF1izA/BI0SXMpBi0xXMuRqCk.NQcMvaKhnF4RuRJaE.yt/P27oC";

export async function authenticateWithPassword(
  email: string,
  password: string,
): Promise<AuthenticationResult> {
  const user = await findUserForLogin(email);

  // Les quatre causes de refus — email inconnu, pas de provider local, mot de
  // passe faux, compte désactivé — produisent le même objet ET consomment le
  // même temps. L'égalité des réponses ne suffit pas : le message est
  // identique depuis le début, c'est le chronomètre qui trahissait.
  if (!user) {
    await verifyPassword(password, DECOY_HASH);
    return REFUSED;
  }

  const local = user.authProviders[0];
  if (!local?.passwordHash) {
    await verifyPassword(password, DECOY_HASH);
    return REFUSED;
  }

  const ok = await verifyPassword(password, local.passwordHash);
  if (!ok) return REFUSED;

  // Après bcrypt, délibérément : remonter ce garde rouvrirait le canal que les
  // deux leurres ci-dessus viennent de fermer.
  if (!user.isActive) return REFUSED;

  return { ok: true, user: { id: user.id, roles: user.roles } };
}
