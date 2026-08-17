import { z } from "zod";

import { MOTIF_ANNULATION_MAX } from "@/lib/interventions/annulation";
import { MAX_PHOTOS } from "@/lib/photos/stockage";

import { adresseSelectionneeSchema } from "./adresses";
import { panierSchema } from "./produits";

/// Schémas du domaine `interventions`.

/// Un instant transporté en chaîne ISO. `Date` ne survit pas à la frontière
/// client/serveur d'une Server Action sans sérialisation explicite ; on valide
/// donc la chaîne, puis on la convertit une seule fois, ici.
const instantSchema = z
  .string()
  .refine((valeur) => !Number.isNaN(Date.parse(valeur)), "Créneau invalide.")
  .transform((valeur) => new Date(valeur));

/// Un chemin rendu par `POST /api/upload-intervention-photo`.
///
/// La forme est vérifiée **strictement** : c'est une valeur qui vient du client
/// et qui finit dans `photos.url`. Sans ce motif, un appelant direct y écrirait
/// `../../etc/passwd` ou l'URL d'un tiers, et la route de lecture servirait ce
/// qu'il aurait choisi.
///
/// Un seul motif pour les deux moments du dépôt - la validation du tunnel (T=0)
/// et l'ajout depuis l'espace client (T+n). Deux copies finiraient par diverger,
/// et c'est la plus permissive des deux qui déciderait.
const cheminPhotoSchema = z
  .string()
  .regex(/^uploads\/[0-9a-f-]{36}\.webp$/, "Photo inconnue.");

/// Lecture de la grille de créneaux.
///
/// `zoneId` vient du client, et c'est assumé : une grille de créneaux n'est pas
/// une donnée sensible, et la rafraîchir toutes les 30 secondes en re-géocodant
/// l'adresse ferait un appel réseau sortant par cycle et par visiteur. Ce qui
/// doit être infalsifiable, c'est la **réservation** - et `reserverSchema`
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
/// 2026-08-09) - il n'y a plus d'email de visiteur à transporter.
export const reserverSchema = z.object({
  serviceId: z.number().int().positive(),
  adresse: adresseSelectionneeSchema,
  debut: instantSchema,
  /// Chemins rendus par `POST /api/upload-intervention-photo`, renvoyés tels
  /// quels par l'écran.
  photos: z
    .array(cheminPhotoSchema)
    .max(MAX_PHOTOS, "Cinq photos au maximum.")
    .default([]),
  /// Panier composé pendant le tunnel (T=0). Il ne porte que des identifiants
  /// et des quantités : les prix sont lus en base au moment de la vente, dans
  /// la transaction de la réservation (Constitution §4.1 et §2.6).
  panier: panierSchema,
  /// Vélo désigné à C5, `null` pour « Aucun vélo » - ajouté le 2026-08-16.
  ///
  /// **Facultatif par nature** : `interventions.cycle_id` est NULLable et le
  /// rattachement ne conditionne rien. Le défaut vaut `null`, donc une charge
  /// utile qui ne porte pas le champ reste valide - c'est ce qui laisse les
  /// appelants antérieurs inchangés.
  ///
  /// ⚠️ **L'identifiant n'est pas une preuve de propriété.** `cycles.id` est un
  /// `SERIAL` énumérable et cette action est un endpoint POST public : la
  /// vérification vit dans la transaction, pas ici.
  cycleId: z.number().int().positive().nullable().default(null),
});

export type ReserverInput = z.infer<typeof reserverSchema>;

/// Dépôt d'une photo sur une intervention déjà planifiée (T+n) -
/// `US-INTERVENTION-PHOTOS-AJOUTER`, versant espace client.
///
/// Une photo à la fois, et non un tableau : au T+n l'intervention existe, donc
/// chaque ligne s'écrit immédiatement. Grouper l'envoi ferait échouer les cinq
/// pour une seule qui franchit le quota.
export const ajouterPhotoSchema = z.object({
  interventionId: z.number().int().positive(),
  url: cheminPhotoSchema,
});

/// Démarrage d'une intervention par son technicien -
/// `US-INTERVENTION-DEMARRER`.
///
/// Un seul champ, et **aucun `techId`** : le technicien vient de la session,
/// via `techActionClient`. Le recevoir en charge utile serait le démarrage de
/// l'intervention d'autrui pour qui sait poster, exactement ce que
/// `lister-tournee.ts` refuse déjà d'exposer.
///
/// Pas d'instant non plus : `started_at` est daté par le serveur, dans la
/// transaction. Une horloge reçue du client daterait un jalon d'exécution sur
/// la montre du navigateur.
export const demarrerInterventionSchema = z.object({
  interventionId: z.number().int().positive(),
});

/// Motif d'annulation - `US-INTERVENTION-ANNULER-CLIENT` §Cas d'erreur, « Motif
/// d'annulation requis ».
///
/// Champ **libre et obligatoire**. Les deux bornes ne viennent d'aucune source :
/// `interventions.cancellation_reason` est un TEXT sans contrainte, et l'US ne
/// dit que « obligatoire ». Arbitrées le 2026-08-11 - trois caractères pour que
/// « . » ne vaille pas motif, le plafond dans le module pur parce que la zone de
/// saisie le porte aussi.
///
/// `trim` AVANT `min` : sans lui, une suite d'espaces satisfait la longueur et
/// s'écrit en base comme un motif vide.
export const annulerInterventionSchema = z.object({
  interventionId: z.number().int().positive(),
  motif: z
    .string()
    .trim()
    // Deux bornes, deux messages. 🐛: un motif de
    // deux caractères renvoyait « Motif d'annulation requis. », libellé que
    // l'US §Cas d'erreur réserve au champ VIDE. Dire « requis » à qui vient
    // d'écrire quelque chose est une réponse fausse.
    .min(1, "Motif d'annulation requis.")
    .min(3, "Motif trop court : décrivez brièvement la raison.")
    .max(
      MOTIF_ANNULATION_MAX,
      `Motif trop long (${MOTIF_ANNULATION_MAX} caractères maximum).`,
    ),
});
