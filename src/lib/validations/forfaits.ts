import { z } from "zod";

/// Schémas du domaine `forfaits` - `US-FORFAIT-AJOUTER`, `US-FORFAIT-MODIFIER`.
/// Les messages sont repris de la SPEC, à la typographie près.

/// Bornes des TYPES, pas des règles métier inventées : `VARCHAR(150)`,
/// `DECIMAL(10,2)` et `INTEGER`. Les dépasser produirait une erreur Postgres
/// rendue en 500 là où la SPEC veut un message.
const LONGUEUR_LABEL = 150;
const PRIX_MAX = 99_999_999.99;
const DUREE_MAX = 2_147_483_647;

const MESSAGE_PRIX = "Le prix doit être un nombre positif";

/// Le prix voyage en **chaîne** : un DECIMAL(10,2) qui passe par un flottant
/// binaire perd ses centimes. La conversion en nombre ne sert qu'aux bornes.
const prixSchema = z
  .string()
  .trim()
  .min(1, MESSAGE_PRIX)
  // Un clavier français produit une virgule décimale ; la refuser serait un
  // refus de forme, pas de fond.
  .transform((valeur) => valeur.replace(",", "."))
  .refine((valeur) => /^\d+(\.\d{1,2})?$/.test(valeur), MESSAGE_PRIX)
  .refine((valeur) => Number(valeur) > 0, MESSAGE_PRIX)
  .refine((valeur) => Number(valeur) <= PRIX_MAX, MESSAGE_PRIX)
  // « 25 », « 25.0 » et « 25.00 » décrivent le même prix. Sans cette
  // normalisation, l'empreinte de version changerait sans que le prix bouge.
  .transform((valeur) => Number(valeur).toFixed(2));

const MESSAGE_DUREE = "La durée doit être un entier positif en minutes";

const dureeSchema = z
  .string()
  .trim()
  .refine((valeur) => /^\d+$/.test(valeur), MESSAGE_DUREE)
  .transform((valeur) => Number(valeur))
  .refine((valeur) => valeur > 0 && valeur <= DUREE_MAX, MESSAGE_DUREE);

const labelSchema = z
  .string()
  .trim()
  .min(1, "Le nom est requis")
  // La SPEC ne borne que par le bas. Message écrit ici, et il nomme la borne :
  // un refus muet sur une longueur fait raccourcir à l'aveugle.
  .max(
    LONGUEUR_LABEL,
    `Le nom ne doit pas dépasser ${String(LONGUEUR_LABEL)} caractères`,
  );

/// Chaîne vide et `NULL` décrivent le même état, « non renseigné ». Les
/// distinguer ferait bouger l'empreinte de version sans changement réel.
const descriptionSchema = z
  .string()
  .trim()
  .transform((valeur) => (valeur === "" ? null : valeur));

/// Les quatre champs que les deux US font saisir : « nom, durée en minutes,
/// prix TTC en euros, description optionnelle ».
const champsSaisis = {
  label: labelSchema,
  description: descriptionSchema,
  duration: dureeSchema,
  price: prixSchema,
};

/// ⚠️ **Pas d'`isActive` à la création.** `US-FORFAIT-AJOUTER` ne l'énumère pas
/// parmi ses champs et pose `is_active = true` en défaut. L'accepter ici
/// permettrait de créer un forfait déjà désactivé, état que rien ne spécifie,
/// alors que la désactivation est une action sur une fiche existante
/// (`US-FORFAIT-MODIFIER` §Désactivation et réactivation).
export const ajouterForfaitSchema = z.object(champsSaisis);

/// La modification transporte deux coordonnées de plus : l'identifiant de la
/// fiche et le jeton de version lu à son ouverture. Le jeton est opaque, il
/// n'est jamais interprété ici - une soumission sans jeton ne peut pas dire
/// sur quelle version elle porte, donc elle est refusée.
export const modifierForfaitSchema = z.object({
  id: z.number().int().positive(),
  version: z.string().min(1),
  ...champsSaisis,
  isActive: z.boolean(),
});

export type AjouterForfaitInput = z.infer<typeof ajouterForfaitSchema>;
export type ModifierForfaitInput = z.infer<typeof modifierForfaitSchema>;

/// Les trois colonnes triables de `US-FORFAIT-LISTER`.
///
/// ⚠️ Ici et non dans `lib/db/queries/forfaits.ts`, qui est `server-only` : le
/// tableau en a besoin pour construire ses en-têtes, et cette liste décrit une
/// entrée utilisateur avant de décrire une clé de tri Prisma.
export const TRIS_FORFAITS = ["label", "price", "duration"] as const;
export type TriForfaits = (typeof TRIS_FORFAITS)[number];
export type SensTriForfaits = "asc" | "desc";

/// Lecture du `searchParams` de la liste. Une valeur illisible **ne fait pas
/// échouer la page**, elle retombe sur le défaut : l'URL s'édite à la main, et
/// un tri inconnu passé tel quel à Prisma serait une injection de clé.
///
/// Défaut alphabétique sur `label`, ce que `US-FORFAIT-LISTER` demande.
export function lireTriForfaits(parametres: {
  tri?: string;
  sens?: string;
  page?: string;
}): { tri: TriForfaits; sens: SensTriForfaits; page: number } {
  const tri = TRIS_FORFAITS.find((candidat) => candidat === parametres.tri);
  const page = Number(parametres.page);

  return {
    tri: tri ?? "label",
    sens: parametres.sens === "desc" ? "desc" : "asc",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}
