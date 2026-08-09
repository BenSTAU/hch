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
export const reserverSchema = z
  .object({
    serviceId: z.number().int().positive(),
    adresse: adresseSelectionneeSchema,
    debut: instantSchema,
    /// Renseigné en visiteur, ignoré si une session existe — c'est la session
    /// qui fait foi quand il y en a une.
    guestEmail: z
      .email("Renseignez une adresse email valide.")
      .max(180)
      .optional(),
  })
  .transform((valeur) => ({
    ...valeur,
    // Normalisation identique à celle de `users.email`, que le CHECK
    // `users_email_normalized` impose en base : sans elle, le rattachement
    // post-inscription comparerait « Camille@… » à « camille@… » et ne
    // trouverait rien.
    guestEmail: valeur.guestEmail?.trim().toLowerCase(),
  }));

export type ReserverInput = z.infer<typeof reserverSchema>;
