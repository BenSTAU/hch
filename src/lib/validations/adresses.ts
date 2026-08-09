import { z } from "zod";

/// Schémas du domaine `adresses`.
///
/// Ils valident la **forme** de ce qui arrive, jamais la véracité du lieu :
/// c'est le re-géocodage serveur qui tranche si l'adresse existe et où elle se
/// trouve. Une validation qui accepterait un point sur la foi de la charge
/// utile déplacerait la décision côté client.

/// Bornes du système WGS84. Elles n'attestent de rien de géographique — leur
/// seul rôle est d'écarter les valeurs qui feraient lever PostGIS à la
/// planification plutôt qu'à l'exécution.
const longitudeSchema = z
  .number()
  .min(-180, "Longitude hors bornes.")
  .max(180, "Longitude hors bornes.");

const latitudeSchema = z
  .number()
  .min(-90, "Latitude hors bornes.")
  .max(90, "Latitude hors bornes.");

/// Une suggestion BAN telle que l'écran la renvoie.
///
/// `lon` et `lat` figurent ici parce qu'ils arrivent — l'écran a affiché un
/// point et le poste au serveur — **pas** parce qu'ils font foi. La Server
/// Action les remplace par ceux qu'elle obtient en re-géocodant `label`. Les
/// accepter puis les écraser est ce qui rend le test « coordonnées forgées hors
/// zone → refus » signifiant : sans eux dans le schéma, il n'y aurait rien à
/// forger et le test ne prouverait rien.
export const adresseSelectionneeSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Sélectionnez une adresse dans la liste.")
    .max(255, "Adresse trop longue."),
  street: z.string().trim().min(1).max(255),
  postcode: z
    .string()
    .trim()
    .regex(/^\d{5}$/, "Code postal invalide."),
  city: z.string().trim().min(1).max(100),
  /// Code INSEE : 5 caractères, et **pas** cinq chiffres — la Corse s'écrit
  /// `2A004` / `2B033`. Une regex numérique rejetterait deux départements.
  citycode: z
    .string()
    .trim()
    .regex(/^[0-9][0-9AB][0-9]{3}$/i, "Code commune invalide."),
  lon: longitudeSchema,
  lat: latitudeSchema,
});

export type AdresseSelectionnee = z.infer<typeof adresseSelectionneeSchema>;

/// Vérification d'une adresse — ouverte au visiteur anonyme.
///
/// `US-ADRESSE-SAISIR` s'exerce dans le tunnel, où la réservation précède
/// l'inscription (Constitution §3.2). Exiger une session ici fermerait le
/// tunnel au guest, ce que S4 §6.2 v1 prescrivait à tort.
export const verifierAdresseSchema = adresseSelectionneeSchema;

/// Ajout d'une adresse au profil — authentifié, hors tunnel.
///
/// `label` étant déjà pris par le libellé BAN, le mémo de l'utilisateur
/// s'appelle `memo` côté schéma et alimente `addresses.label` en base. La
/// couture est ici et nulle part ailleurs.
export const ajouterAdresseSchema = adresseSelectionneeSchema.extend({
  memo: z
    .string()
    .trim()
    .max(100, "Libellé trop long.")
    .optional()
    .transform((valeur) => (valeur === "" ? undefined : valeur)),
});

export type AjouterAdresseInput = z.infer<typeof ajouterAdresseSchema>;

export const supprimerAdresseSchema = z.object({
  /// `addresses.id` est un SERIAL — un entier positif, jamais un UUID.
  adresseId: z.number().int().positive(),
});
