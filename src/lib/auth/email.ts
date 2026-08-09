/// Forme canonique d'une adresse email pour `users.email`.
///
/// Dette reportée de T-J0-04 : le `.toLowerCase()` des schémas Zod referme le
/// symptôme à la LECTURE — Postgres compare une VARCHAR octet par octet, et
/// « Admin@HomeCyclHome.fr » ne trouvait aucun compte. Il ne protège de rien à
/// l'ÉCRITURE : une insertion qui échapperait au schéma créerait un doublon que
/// l'index unique laisserait passer.
///
/// Premier des deux filets. Le second est le CHECK SQL `email = lower(email)`,
/// qui tient aussi face à un script de maintenance ou à une écriture future.
///
/// Ce qui n'est PAS fait ici, délibérément : aucun aliasing. `c.durand@…` et
/// `cdurand@…` sont deux adresses distinctes pour tout le monde sauf Gmail, et
/// les fondre ferait refuser une inscription légitime au nom d'un doublon qui
/// n'existe pas.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
