/// Quotas de dépôt des photos client — [[module-3-interventions]] §Quotas.
///
/// **Module pur, sans `server-only`, et c'est sa raison d'être** : les deux
/// écrans de dépôt sont des composants clients, et `stockage.ts` tire `sharp`
/// puis `node:fs`, donc un client qui l'importe casse le build sur
/// `Can't resolve 'fs'`. Un quota recopié dans chaque écran divergerait du
/// quota appliqué, et le défaut ne se verrait qu'au refus.
///
/// ⚠️ Ne rien mettre ici qui ne soit **qu'**une valeur : ce module part dans le
/// paquet envoyé au navigateur.

/// Cinq photos par intervention. Compté **dans la transaction** d'écriture
/// (`src/lib/db/queries/photos.ts`) : l'écran ne fait qu'éviter des
/// allers-retours perdus.
export const MAX_PHOTOS = 5;

/// Cinq mégaoctets par photo, vérifiés **avant** de lire le corps de la requête.
export const MAX_OCTETS = 5 * 1024 * 1024;

/// Les formats acceptés à l'entrée, tels que l'attribut `accept` les attend.
/// La sortie est toujours du WebP, quel que soit l'entrant.
export const FORMATS_ACCEPTES =
  "image/jpeg,image/png,image/webp,image/heic,image/heif";
