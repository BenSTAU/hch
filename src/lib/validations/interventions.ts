import { z } from "zod";

import { adresseSelectionneeSchema } from "./adresses";

/// Schémas du domaine `interventions`.

/// Un instant transporté en chaîne ISO. `Date` ne survit pas à la frontière
/// client/serveur d'une Server Action sans sérialisation explicite ; on valide
/// donc la chaîne, puis on la convertit une seule fois, ici.
const instantSchema = z
  .string()
  .refine((valeur) => !Number.isNaN(Date.parse(valeur)), "Créneau invalide.")
  .transform((valeur) => new Date(valeur));

/// Lecture de la grille de créneaux.
///
/// `zoneId` vient du client, et c'est assumé : une grille de créneaux n'est pas
/// une donnée sensible, et la rafraîchir toutes les 30 secondes en re-géocodant
/// l'adresse ferait un appel réseau sortant par cycle et par visiteur. Ce qui
/// doit être infalsifiable, c'est la **réservation** — et `reserverSchema`
/// ci-dessous repart du libellé, pas d'un identifiant de zone.
export const listerCreneauxSchema = z.object({
  serviceId: z.number().int().positive(),
  zoneId: z.number().int().positive(),
});

/// Validation d'une réservation.
///
/// L'adresse arrive **entière**, pas sous forme d'identifiant : l'action
/// re-géocode son libellé et recalcule la zone. Un `addressId` reçu du client
/// désignerait l'adresse d'un autre, et un `zoneId` reçu du client
/// contournerait la sectorisation (Constitution §2.2).
///
/// Aucun champ d'identité : le client vient de la SESSION. La validation exige
/// un compte créé, activé et connecté (Constitution §3.2, alignée le
/// 2026-08-09) — il n'y a plus d'email de visiteur à transporter.
export const reserverSchema = z.object({
  serviceId: z.number().int().positive(),
  adresse: adresseSelectionneeSchema,
  debut: instantSchema,
});

export type ReserverInput = z.infer<typeof reserverSchema>;
