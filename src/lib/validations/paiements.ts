import { z } from "zod";

import { MOTIF_ANNULATION_MAX } from "@/lib/interventions/annulation";
import {
  METHODES_PAIEMENT,
  MONTANT_MAX,
  montantStrictementPositif,
  normaliserMontant,
} from "@/lib/paiements/encaissement";

/// Schémas du domaine `paiements`.

/// Clôture d'une intervention - `US-INTERVENTION-MARQUER-FAITE` couplée à
/// `US-PAIEMENT-ENREGISTRER`, écran **T4**.
///
/// ── Une union discriminée en ENTRÉE, et une seule action
///
/// Les deux branches ne diffèrent pas par un drapeau mais par leur charge :
/// l'encaissement porte un montant et un mode, le refus porte un motif. Un
/// objet plat aux quatre champs facultatifs rendrait représentable l'état
/// « refus avec un montant », que la couche d'accès devrait ensuite refuser à
/// la main. Le discriminant l'interdit à la compilation.
///
/// Deux Server Actions distinctes auraient dupliqué la garde de rôle, la garde
/// de propriété, le verrou et la relecture sous verrou, pour deux branches que
/// SPEC §Amendements A4 déclare indissociables.
///
/// ── Aucun `techId`, aucun instant
///
/// Le technicien vient de la session via `techActionClient`. `paid_at` et
/// `completed_at` sont datés serveur, dans la transaction : une horloge reçue du
/// client permettrait d'antidater un encaissement, et aucune US ne le demande
/// (DoD T-V2-03, case `paid_at` affiché non saisissable).
const interventionIdSchema = z.number().int().positive();

/// Le montant traverse en **chaîne**, jamais en nombre.
///
/// `85.10` n'a pas de représentation binaire exacte : converti en `number` puis
/// en `Decimal`, il arrive parfois à `85.099999…`. La chaîne canonique va
/// directement au constructeur de `Prisma.Decimal`.
///
/// Trois refus distincts et trois messages : une forme invalide, un zéro, un
/// dépassement de capacité. Un message unique ferait relire au technicien un
/// champ dont il ne saurait pas ce qui cloche.
const montantSchema = z
  .string()
  .transform((saisie, ctx) => {
    const canonique = normaliserMontant(saisie);

    if (canonique === null) {
      ctx.addIssue({
        code: "custom",
        message: "Montant invalide : deux décimales au maximum.",
      });
      return z.NEVER;
    }

    return canonique;
  })
  .refine(montantStrictementPositif, {
    // Le refus renvoie vers la branche prévue plutôt que de dire « invalide » :
    // un encaissement à zéro est un cas métier réel, il a juste son propre
    // chemin.
    message:
      "Un encaissement ne peut pas être nul. Utilisez « Clôturer sans encaissement ».",
  })
  .refine((canonique) => Number(canonique) <= Number(MONTANT_MAX), {
    message: `Montant trop élevé (${MONTANT_MAX} € au maximum).`,
  });

export const cloturerInterventionSchema = z.discriminatedUnion("issue", [
  z.object({
    issue: z.literal("encaisse"),
    interventionId: interventionIdSchema,
    montant: montantSchema,
    methode: z.enum(METHODES_PAIEMENT),
  }),

  z.object({
    issue: z.literal("refuse"),
    interventionId: interventionIdSchema,
    /// Le motif atterrit dans `interventions.cancellation_reason`, la **même**
    /// colonne que l'annulation client, lue par le **même** écran des passées.
    /// Les bornes sont donc celles de `MOTIF_ANNULATION_MAX`, relues et non
    /// recopiées : deux plafonds sur une colonne finiraient par diverger, et
    /// c'est le plus permissif qui déciderait.
    ///
    /// `trim` AVANT `min` : sans lui, une suite d'espaces satisfait la longueur
    /// et s'écrit en base comme un motif vide.
    motif: z
      .string()
      .trim()
      .min(1, "Motif requis.")
      .min(3, "Motif trop court : décrivez brièvement la raison du refus.")
      .max(
        MOTIF_ANNULATION_MAX,
        `Motif trop long (${MOTIF_ANNULATION_MAX} caractères maximum).`,
      ),
  }),
]);

export type CloturerInterventionInput = z.infer<
  typeof cloturerInterventionSchema
>;
