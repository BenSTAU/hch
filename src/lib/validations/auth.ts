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

// ─────────────────────────────────────────────────────────────────────────
// Inscription et activation — `US-COMPTE-CREER`, `US-COMPTE-ACTIVER`
// ─────────────────────────────────────────────────────────────────────────

/// Message **volontairement unique** pour les trois issues de l'inscription —
/// email libre, compte existant non activé, compte existant déjà activé
/// (US-COMPTE-CREER §Cas d'erreur, Constitution §4.2).
export const SIGNUP_ACKNOWLEDGED_MESSAGE =
  "Si un compte existe pour cet email, un email d'activation vient d'être envoyé";

// Il n'existe **aucun** message d'échec d'envoi côté utilisateur, et c'est une
// décision : l'arbitrage du 2026-08-08 (constat B2 de l'agent testeur T-V3-02)
// donne la Constitution §4.2 gagnante contre l'échec bruyant côté utilisateur
// d'ADR-017. Un tel message ne pourrait naître que sur un chemin ayant TENTÉ un
// envoi, donc jamais sur « compte déjà activé » — il classerait les adresses.
// Le bruit d'ADR-017 vit désormais dans les logs (`src/lib/email/dispatch.ts`),
// et le recours côté client est le renvoi d'activation.

/// 12 caractères — `US-COMPTE-CREER` §Contexte, aligné sur ADR-005 v2.
const PASSWORD_MIN_LENGTH = 12;

/// bcrypt tronque **silencieusement** au-delà de 72 octets. Sans cette borne,
/// deux mots de passe distincts de 80 caractères ouvriraient le même compte, et
/// l'utilisateur croirait avoir choisi le second. Dette relevée par l'agent
/// testeur en T-J0-04 et explicitement reportée « au schéma d'inscription »
/// (src/lib/validations/auth.test.ts, « n'impose aucune longueur maximale »).
const PASSWORD_MAX_BYTES = 72;

const REQUIS = "Ce champ est requis";

/// En **octets** et non en caractères : 24 emoji de 4 octets font 96 octets pour
/// 24 caractères perçus, et une borne sur `.length` laisserait passer la
/// troncature.
function tientDansBcrypt(valeur: string): boolean {
  return new TextEncoder().encode(valeur).length <= PASSWORD_MAX_BYTES;
}

/// Largeurs alignées sur les colonnes (`prisma/schema.prisma:52-54`). Sans
/// bornes ici, le refus viendrait de Postgres — donc après le hachage bcrypt et
/// pendant l'insertion, en 500 au lieu d'un message de formulaire.
export const signupSchema = z
  .object({
    firstname: z.string().trim().min(1, REQUIS).max(100, REQUIS),
    lastname: z.string().trim().min(1, REQUIS).max(100, REQUIS),
    email: z
      .string()
      .min(1, REQUIS)
      .email("Email invalide")
      .max(180, "Email invalide")
      .toLowerCase(),
    password: z
      .string()
      .min(
        PASSWORD_MIN_LENGTH,
        `Mot de passe : ${PASSWORD_MIN_LENGTH} caractères minimum`,
      )
      .refine(
        tientDansBcrypt,
        `Mot de passe : ${PASSWORD_MAX_BYTES} octets maximum`,
      ),
    passwordConfirmation: z.string().min(1, REQUIS),
  })
  // `path` explicite : sans lui l'erreur flotte au niveau du formulaire, et
  // aucun champ ne peut la porter par `aria-describedby` (WCAG 3.3.1 AA).
  .refine((data) => data.password === data.passwordConfirmation, {
    message: "Les mots de passe ne correspondent pas",
    path: ["passwordConfirmation"],
  });

export type SignupInput = z.infer<typeof signupSchema>;

/// Le jeton est du `base64url` de 32 octets, soit 43 caractères. Le borner ici
/// évite une requête en base par lien malformé, et coupe court à une charge de
/// plusieurs mégaoctets dans la query string.
export const activationSchema = z.object({
  token: z
    .string()
    .min(1, "Lien invalide")
    .max(64, "Lien invalide")
    .regex(/^[A-Za-z0-9_-]+$/, "Lien invalide"),
});

export const resendActivationSchema = z.object({
  email: z
    .string()
    .min(1, "Renseignez votre adresse email")
    .email("Email invalide")
    .toLowerCase(),
});
