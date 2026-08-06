import { z } from "zod";

/// Message **volontairement identique** pour les quatre causes de refus —
/// email inconnu, mot de passe faux, compte désactivé, compte jamais activé.
/// Toute variation rouvrirait l'énumération des comptes (Constitution §4.2,
/// SPEC §6.1, US-COMPTE-CONNECTER §Cas d'erreur).
export const LOGIN_REFUSED_MESSAGE =
  "Identifiants invalides ou compte non activé — vérifiez votre email d'activation si vous venez de créer un compte";

export const loginSchema = z.object({
  // `users.email` est une VARCHAR sous index unique ordinaire, donc comparée
  // octet par octet par Postgres, et le seed écrit en minuscules : sans
  // `.toLowerCase()`, « Admin@HomeCyclHome.fr » ne trouve aucun compte.
  // Couvre la lecture seule — cf. TASKS T-J0-04 §Notes write-back PR #5 (5).
  email: z
    .string()
    .min(1, "Renseignez votre adresse email")
    .email("Format d'adresse email invalide")
    .toLowerCase(),
  // Aucune règle de complexité à la connexion : la contrôler ici révélerait la
  // politique appliquée aux comptes existants, et refuserait un ancien mot de
  // passe encore valide.
  password: z.string().min(1, "Renseignez votre mot de passe"),
  // Destination posée par `src/proxy.ts`, **non validée ici** à dessein : le
  // schéma dit que c'est du texte, `safeNextPath` dit si c'est une
  // destination. La rejeter ferait échouer une connexion par ailleurs valide,
  // donc bloquerait la connexion d'autrui par un simple lien.
  next: z.string().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
