/// Quotas de dépôt des photos client — [[module-3-interventions]] §Quotas.
///
/// **Module pur** : aucun import, aucun `server-only`. C'est sa raison d'être.
/// Les deux écrans de dépôt sont des composants **clients** (la zone de dépôt du
/// tunnel et celle du panneau de détail), et `stockage.ts`, où ces constantes
/// vivaient, tire `sharp` puis `node:fs` : un composant client qui l'importe
/// fait échouer le build sur `Can't resolve 'fs'`.
///
/// L'alternative était de recopier les valeurs dans chaque écran, ce que
/// `etape-photos.tsx` faisait déjà de son côté. Un quota affiché qui diverge du
/// quota appliqué fait promettre à l'interface ce que le serveur refuse, et le
/// défaut ne se voit qu'au moment du refus.
///
/// ⚠️ Ne rien mettre ici qui ne soit **qu'**une valeur. Ce module part dans le
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
