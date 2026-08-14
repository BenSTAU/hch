/// Règles d'encaissement terrain - `US-PAIEMENT-ENREGISTRER`, écran **T4**.
///
/// **Module pur** : aucun import, aucun `server-only`. C'est sa raison d'être,
/// et c'est le même motif que `src/lib/interventions/annulation.ts` - la modale
/// de clôture est un composant **client**, `src/lib/db/queries/paiements.ts` est
/// marqué `server-only`, et `src/lib/validations/paiements.ts` tire Zod. Les
/// trois modes et les bornes doivent être lisibles des deux côtés de la
/// frontière, sinon la valeur affichée diverge de la valeur appliquée.
///
/// ⚠️ Ne rien mettre ici qui ne soit **qu'**une valeur ou un calcul. Ce module
/// part dans le paquet envoyé au navigateur.

/// Les trois modes de Constitution §2.3, dans l'ordre de la maquette T4.
///
/// Les valeurs sont celles du CHECK SQL et du dictionnaire §payments, pas des
/// libellés : `CB | CASH | CHECK`. `CHECK` désigne le chèque et non une
/// contrainte, homonymie héritée du dictionnaire.
export const METHODES_PAIEMENT = ["CB", "CASH", "CHECK"] as const;

export type MethodePaiement = (typeof METHODES_PAIEMENT)[number];

/// Libellés d'interface.
///
/// ⚠️ **Les sous-titres de la maquette ne sont pas portés** - « Terminal
/// mobile », « Rendu de monnaie », « Ordre : HomeCycl'Home ». Les deux premiers
/// affirment un équipement et une pratique qu'aucune US, aucun réglage et aucun
/// seed ne portent ; le troisième code en dur une raison sociale que
/// `app_settings` détient déjà. Même traitement que la référence
/// `#INT-2026-1042` et la fenêtre d'arrivée de T2, retirées pour ce motif.
export const LIBELLE_METHODE: Record<MethodePaiement, string> = {
  CB: "Carte bancaire",
  CASH: "Espèces",
  CHECK: "Chèque",
};

/// Plafond du montant encaissé : la capacité de `DECIMAL(10,2)`, soit huit
/// chiffres avant la virgule.
///
/// ⚠️ **Ce n'est pas le garde-fou F1**, qui reste v2. F-17/F1 porte sur
/// l'**écart au `price_snapshot`** - la hausse abusive, tension Constitution
/// §2.3 contre §3.1 - et exigera une borne relative, un motif et une trace
/// d'audit. Ici c'est de l'intégrité de type : au-delà, la base rejette
/// l'écriture avec une erreur de dépassement numérique que rien ne traduirait
/// en message. Ne pas lire plus tard que v1 a implémenté F1.
export const MONTANT_MAX = "99999999.99";

/// Deux décimales au plus, huit chiffres avant la virgule, séparateur point ou
/// virgule. La virgule est acceptée parce qu'un clavier mobile français la
/// propose en premier, et qu'un refus de saisie pour un séparateur est une
/// mauvaise réponse à quelqu'un debout dans une cour d'immeuble.
const MOTIF_MONTANT = /^\d{1,8}([.,]\d{1,2})?$/;

/// Ramène une saisie à la forme canonique `123.45`, ou `null` si elle n'est pas
/// un montant.
///
/// La normalisation vit **ici** et pas dans le schéma Zod pour que la modale
/// puisse en dépendre si besoin, et pour qu'un test la couvre sans monter Zod.
/// Le retour est une **chaîne** : `Prisma.Decimal` se construit dessus sans
/// jamais passer par un flottant, où `85.10` ne vaut pas exactement 85,10.
export function normaliserMontant(saisie: string): string | null {
  const nettoye = saisie.trim();

  if (!MOTIF_MONTANT.test(nettoye)) return null;

  return nettoye.replace(",", ".");
}

/// Vrai si le montant canonique est strictement positif.
///
/// Un encaissement à 0 est un `UNPAID` sous une étiquette fausse : la branche
/// de refus existe pour ça, elle passe l'intervention en `CANCELLED` et le
/// dossier ne raconte pas la même histoire.
///
/// Comparaison sur la chaîne de chiffres et non sur un flottant : `Number()`
/// suffirait pour ce test précis, mais l'habitude de convertir un montant en
/// nombre est exactement celle qui perd les centimes ailleurs.
export function montantStrictementPositif(canonique: string): boolean {
  return /[1-9]/.test(canonique);
}
