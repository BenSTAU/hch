/// Règles d'encaissement terrain - `US-PAIEMENT-ENREGISTRER`, écran **T4**.
///
/// **Module pur, sans `server-only`, et c'est sa raison d'être** : la modale de
/// clôture est un composant client, quand `db/queries/paiements.ts` est
/// `server-only` et `validations/paiements.ts` tire Zod. Les trois modes et les
/// bornes doivent être lisibles des deux côtés, sinon la valeur affichée
/// diverge de la valeur appliquée.
///
/// ⚠️ Ne rien mettre ici qui ne soit **qu'**une valeur ou un calcul : ce module
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
/// ⚠️ **Les sous-titres de la maquette ne sont pas portés** : « Terminal
/// mobile » et « Rendu de monnaie » affirment un équipement et une pratique
/// qu'aucune US ne porte, « Ordre : HomeCycl'Home » coderait en dur une raison
/// sociale qu'`app_settings` détient.
export const LIBELLE_METHODE: Record<MethodePaiement, string> = {
  CB: "Carte bancaire",
  CASH: "Espèces",
  CHECK: "Chèque",
};

/// Deux décimales au plus, **huit chiffres avant la virgule**, séparateur point
/// ou virgule.
///
/// ⚠️ **C'est cette forme, et elle seule, qui borne la capacité.** Huit
/// chiffres plus deux décimales, c'est exactement `DECIMAL(10,2)` : rien de
/// plus grand que `99999999.99` ne franchit le motif, donc une seconde borne
/// numérique en aval serait inatteignable.
///
/// ⚠️ **Ce n'est pas le garde-fou de la hausse abusive**, qui reste v2 : il
/// porte sur l'écart au `price_snapshot` et exigera une borne relative, un
/// motif et une trace d'audit. Ici c'est de l'intégrité de type.
///
/// La virgule est acceptée parce qu'un clavier mobile français la propose en
/// premier, et qu'un refus de saisie pour un séparateur est une mauvaise
/// réponse à quelqu'un debout dans une cour d'immeuble.
const MOTIF_MONTANT = /^\d{1,8}([.,]\d{1,2})?$/;

/// Ramène une saisie à la forme canonique `123.45`, ou `null` si elle n'est pas
/// un montant.
///
/// Ici et pas dans le schéma Zod, pour que la modale puisse en dépendre. Le
/// retour est une **chaîne** : `Prisma.Decimal` se construit dessus sans jamais
/// passer par un flottant, où `85.10` ne vaut pas exactement 85,10.
export function normaliserMontant(saisie: string): string | null {
  const nettoye = saisie.trim();

  if (!MOTIF_MONTANT.test(nettoye)) return null;

  return nettoye.replace(",", ".");
}

/// Vrai si le montant canonique est strictement positif.
///
/// Un encaissement à 0 est un `UNPAID` sous une étiquette fausse : la branche
/// de refus existe pour ça.
///
/// Comparaison sur la chaîne de chiffres et non sur un flottant : `Number()`
/// suffirait ici, mais convertir un montant en nombre est l'habitude qui perd
/// les centimes ailleurs.
export function montantStrictementPositif(canonique: string): boolean {
  return /[1-9]/.test(canonique);
}
