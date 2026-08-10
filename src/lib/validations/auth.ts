import { z } from "zod";

/// Message **volontairement identique** pour les quatre causes de refus -
/// email inconnu, mot de passe faux, compte désactivé, compte jamais activé.
/// Toute variation rouvrirait l'énumération des comptes (Constitution §4.2,
/// SPEC §6.1, US-COMPTE-CONNECTER §Cas d'erreur).
export const LOGIN_REFUSED_MESSAGE =
  "Identifiants invalides ou compte non activé — vérifiez votre email d'activation si vous venez de créer un compte";

/// `US-COMPTE-CONNECTER` §Cas d'erreur. La durée annoncée est la **constante**
/// du verrou, pas le délai restant : elle est identique pour tout le monde et
/// ne date aucune tentative. Une échéance à la seconde, elle, dirait quand le
/// 5e échec a eu lieu, donc l'activité d'un tiers sur cette adresse.
///
/// Le chiffre est là parce que le blocage est **ferme** depuis l'amendement du
/// 2026-08-09 (SPEC §298-309) : sous l'ancienne fenêtre glissante, aucune durée
/// n'était vraie, le verrou pouvant être tenu indéfiniment. Écart de forme
/// assumé avec la lettre de la SPEC, qui garde « quelques minutes ».
///
/// Ce message est distinct du refus générique, et ce n'est pas une fuite : le
/// compteur vit dans `rate_limits`, table sans clé étrangère qui compte pour
/// toute chaîne tentée. Il apparaît donc à l'identique sur une adresse qui n'a
/// aucun compte (PLAN S4 §11.2).
export const LOGIN_RATE_LIMITED_MESSAGE =
  "Trop de tentatives - réessayez dans 10 minutes";

export const loginSchema = z.object({
  // `users.email` est une VARCHAR sous index unique ordinaire, donc comparée
  // octet par octet par Postgres, et le seed écrit en minuscules : sans
  // `.toLowerCase()`, « Admin@HomeCyclHome.fr » ne trouve aucun compte.
  // Couvre la lecture seule - cf. TASKS T-J0-04 §Notes write-back PR #5 (5).
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
// Inscription et activation - `US-COMPTE-CREER`, `US-COMPTE-ACTIVER`
// ─────────────────────────────────────────────────────────────────────────

/// Message **volontairement unique** pour les trois issues de l'inscription -
/// email libre, compte existant non activé, compte existant déjà activé
/// (US-COMPTE-CREER §Cas d'erreur, Constitution §4.2).
export const SIGNUP_ACKNOWLEDGED_MESSAGE =
  "Si un compte existe pour cet email, un email d'activation vient d'être envoyé";

// Il n'existe **aucun** message d'échec d'envoi côté utilisateur, et c'est une
// décision : l'arbitrage du 2026-08-08 (constat B2 de l'agent testeur T-V3-02)
// donne la Constitution §4.2 gagnante contre l'échec bruyant côté utilisateur
// d'ADR-017. Un tel message ne pourrait naître que sur un chemin ayant TENTÉ un
// envoi, donc jamais sur « compte déjà activé » - il classerait les adresses.
// Le bruit d'ADR-017 vit désormais dans les logs (`src/lib/email/dispatch.ts`),
// et le recours côté client est le renvoi d'activation.

/// 12 caractères - `US-COMPTE-CREER` §Contexte, aligné sur ADR-005 v2.
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
/// bornes ici, le refus viendrait de Postgres - donc après le hachage bcrypt et
/// pendant l'insertion, en 500 au lieu d'un message de formulaire.
/// Passe un numéro français en E.164, seule forme que le CHECK de
/// `users.phone` accepte. `06 12 34 56 78` et `+33 6 12 34 56 78` désignent le
/// même abonné ; les refuser sur la forme serait un obstacle sans objet.
///
/// Rend `undefined` sur une chaîne vide - le champ est facultatif, et écrire
/// `""` en base ferait échouer le CHECK au lieu de laisser NULL.
export function normaliserTelephoneFr(valeur: string): string | undefined {
  const compact = valeur.replace(/[\s.\-()]/g, "");
  if (compact === "") return undefined;
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  // `0X…` national : l'indicatif France remplace le zéro de tête.
  if (/^0[1-9][0-9]{8}$/.test(compact)) return `+33${compact.slice(1)}`;
  return compact;
}

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
    /// Optionnel, et il le reste : `/inscription` ne le demande pas, seul le
    /// bloc « Vos coordonnées » du récapitulatif (C5) le collecte. Le rendre
    /// obligatoire fermerait un parcours déjà livré.
    ///
    /// Normalisé en E.164 avant validation : `users.phone` porte un CHECK SQL
    /// strict posé en migration 001, et la maquette C5 propose `06 12 34 56 78`
    /// - un numéro national, que ce CHECK refuserait tel quel.
    phone: z
      .string()
      .trim()
      .transform(normaliserTelephoneFr)
      .refine(
        (valeur) => valeur === undefined || /^\+[1-9][0-9]{7,14}$/.test(valeur),
        "Téléphone invalide — exemple : 06 12 34 56 78",
      )
      .optional(),
    /// Destination de retour après activation, posée par le tunnel de
    /// réservation (C5). **Non validée ici**, même motif qu'à la connexion :
    /// le schéma dit que c'est du texte, `safeNextPath` dit si c'est une
    /// destination. La rejeter ferait échouer une inscription par ailleurs
    /// valide.
    next: z.string().optional(),
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
  /// Destination de retour, voyagée depuis l'inscription au travers du lien
  /// d'email. Même traitement que partout ailleurs : `safeNextPath` arbitre,
  /// pas le schéma, sinon un `next` malformé casserait une activation valide.
  next: z.string().optional(),
});

export const resendActivationSchema = z.object({
  email: z
    .string()
    .min(1, "Renseignez votre adresse email")
    .email("Email invalide")
    .toLowerCase(),
});
