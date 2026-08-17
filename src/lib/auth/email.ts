/// Forme canonique d'une adresse email pour `users.email`. Premier des deux
/// filets ; le second est le CHECK SQL `email = lower(email)`, qui tient aussi
/// face à un script de maintenance. Postgres compare une VARCHAR octet par
/// octet : sans normalisation, « Admin@HomeCyclHome.fr » ne trouve aucun
/// compte à la lecture et crée un doublon à l'écriture.
///
/// Aucun aliasing, délibérément : `c.durand@…` et `cdurand@…` sont deux
/// adresses distinctes pour tout le monde sauf Gmail.
///
/// ⚠️ Les deux filets ne définissent pas la même forme : `String.trim()` retire
/// tout le WhiteSpace Unicode, le `btrim()` du CHECK seulement l'espace ASCII.
/// Une insertion portant une espace insécable passerait le CHECK sans être
/// normalisée au sens de ce module.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
