import { z } from "zod";

/// Message unique de refus. Il est **volontairement identique** pour toutes les
/// causes — email inconnu, mot de passe faux, compte désactivé, compte jamais
/// activé. Toute variation ici rouvrirait l'énumération des comptes
/// (Constitution §4.2, SPEC §6.1, US-COMPTE-CONNECTER §Cas d'erreur).
export const LOGIN_REFUSED_MESSAGE =
  "Identifiants invalides ou compte non activé — vérifiez votre email d'activation si vous venez de créer un compte";

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Renseignez votre adresse email")
    .email("Format d'adresse email invalide"),
  // Aucune règle de complexité à la connexion : elle appartient à
  // l'inscription. La contrôler ici révélerait la politique appliquée aux
  // comptes existants, et refuserait un ancien mot de passe encore valide.
  password: z.string().min(1, "Renseignez votre mot de passe"),
});

export type LoginInput = z.infer<typeof loginSchema>;
