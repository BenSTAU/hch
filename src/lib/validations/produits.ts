import { z } from "zod";

/// Schémas du domaine `produits`.

/// Une ligne de panier. **Aucun prix** ne traverse : `unit_price_snapshot` est
/// lu en base au moment de la vente (Constitution §4.1). Un prix reçu de
/// l'écran serait un prix choisi par l'acheteur.
export const lignePanierSchema = z.object({
  productId: z.number().int().positive(),
  /// Positive et entière, sans plafond ici : le seul plafond qui vaille est le
  /// stock disponible, et il se vérifie sous verrou au moment d'écrire. Un
  /// maximum inventé dans le schéma refuserait des ventes légitimes le jour où
  /// le catalogue se réapprovisionne.
  quantity: z.number().int().positive(),
});

/// Panier du tunnel (T=0).
///
/// L'unicité est une contrainte de MODÈLE avant d'être une règle de saisie : la
/// clé primaire de `intervention_products` est le couple
/// `(intervention_id, product_id)`. Deux lignes du même produit feraient échouer
/// l'écriture en base, et l'écran doit les avoir fusionnées avant d'envoyer.
export const panierSchema = z
  .array(lignePanierSchema)
  .refine(
    (lignes) =>
      new Set(lignes.map((ligne) => ligne.productId)).size === lignes.length,
    "Un produit ne peut figurer qu'une fois dans le panier.",
  )
  .default([]);

/// Ajout T+n - `US-INTERVENTION-PRODUIT-AJOUTER`.
///
/// `quantity` est le **delta** ajouté, pas la quantité cible de la ligne.
export const ajouterProduitSchema = z.object({
  interventionId: z.number().int().positive(),
  productId: z.number().int().positive(),
  quantity: z.number().int().positive(),
});

/// Retrait T+n - `US-INTERVENTION-PRODUIT-SUPPRIMER`. La ligne part entière,
/// il n'y a donc pas de quantité à transporter.
export const retirerProduitSchema = z.object({
  interventionId: z.number().int().positive(),
  productId: z.number().int().positive(),
});

export type LignePanierInput = z.infer<typeof lignePanierSchema>;
