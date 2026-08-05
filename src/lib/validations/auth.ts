import { z } from "zod";

/// Message unique de refus. Il est **volontairement identique** pour toutes les
/// causes — email inconnu, mot de passe faux, compte désactivé, compte jamais
/// activé. Toute variation ici rouvrirait l'énumération des comptes
/// (Constitution §4.2, SPEC §6.1, US-COMPTE-CONNECTER §Cas d'erreur).
export const LOGIN_REFUSED_MESSAGE =
  "Identifiants invalides ou compte non activé — vérifiez votre email d'activation si vous venez de créer un compte";

export const loginSchema = z.object({
  // `toLowerCase()` après validation : `users.email` est une VARCHAR(180) sous
  // index unique ordinaire, donc comparée octet par octet par Postgres, et le
  // seed écrit en minuscules. Sans normalisation, « Admin@HomeCyclHome.fr » ne
  // trouve aucun compte — et l'anti-énumération rend le refus incompréhensible
  // pour l'utilisateur, qui reçoit le message générique.
  //
  // Cette normalisation couvre la LECTURE, et elle déplace le risque plutôt
  // qu'elle ne le supprime — constat de l'agent testeur, T-J0-04.
  //
  // Avant : une ligne portant `Admin@HomeCyclHome.fr` restait atteignable en
  // saisissant la casse exacte. Après : la saisie est normalisée, la colonne
  // compare octet par octet, et cette ligne devient DÉFINITIVEMENT
  // inatteignable — son propriétaire ne peut plus jamais se connecter, et
  // l'anti-énumération lui sert le message générique.
  //
  // Sans effet aujourd'hui : le seed écrit en minuscules et il n'existe aucun
  // autre chemin d'écriture. Le jour où l'inscription publique ouvre, c'en est
  // un — et le profil Google ne garantit pas un email en minuscules.
  //
  // Conséquence, à porter dans la DoD de la tâche qui ouvre l'inscription :
  // TOUT chemin d'écriture de `users.email` normalise dès sa première ligne.
  // La vraie fermeture reste un index fonctionnel `lower(email)` ou une
  // colonne `citext` — la seule que personne ne peut oublier.
  email: z
    .string()
    .min(1, "Renseignez votre adresse email")
    .email("Format d'adresse email invalide")
    .toLowerCase(),
  // Aucune règle de complexité à la connexion : elle appartient à
  // l'inscription. La contrôler ici révélerait la politique appliquée aux
  // comptes existants, et refuserait un ancien mot de passe encore valide.
  password: z.string().min(1, "Renseignez votre mot de passe"),
});

export type LoginInput = z.infer<typeof loginSchema>;
