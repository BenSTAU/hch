/// Validation de la destination post-connexion.
///
/// `src/proxy.ts` pose `?next=<chemin>` sur sa redirection ; cette fonction
/// est le seul endroit qui a le droit de transformer cette valeur en
/// destination. Elle est **contrôlée par l'attaquant** : un lien
/// `https://hch.glanford.eu/connexion?next=https://phishing.example` porte le
/// vrai domaine, sert la vraie page, encaisse une vraie connexion, puis dépose
/// l'utilisateur ailleurs. C'est l'open redirect nommé par la DoD de T-J0-05.
///
/// Pas de `server-only` ici : la fonction est pure, sans I/O ni secret.

/// Caractères de contrôle C0 et DEL, testés par point de code plutôt que par
/// une classe de caractères : un `\r` ou un `\t` posé tel quel dans un
/// littéral de regex est invisible à la relecture, et sa variante échappée
/// oblige à désactiver `no-control-regex`. La boucle dit ce qu'elle refuse.
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function safeNextPath(
  candidate: string | null | undefined,
): string | null {
  if (typeof candidate !== "string" || candidate.length === 0) return null;

  // Décodage AVANT contrôle, pas après : `/%2Fphishing.example` passe tous les
  // tests de forme sur sa version brute et se décode en `//phishing.example`,
  // soit exactement ce qu'on refuse. Les deux formes doivent survivre au même
  // examen.
  let decoded: string;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    // Séquence d'échappement invalide — rien à valider, rien à suivre.
    return null;
  }

  for (const value of [candidate, decoded]) {
    // Un saut de ligne dans une destination est un vecteur d'injection
    // d'en-tête ; une tabulation ou un espace en tête masque le schéma.
    if (hasControlCharacter(value)) return null;
    // Un chemin du même site commence par un slash, et un seul. `//hôte` est
    // une URL protocol-relative — elle commence par un slash et pointe
    // ailleurs, ce qui est précisément ce qui trompe un contrôle naïf.
    if (!value.startsWith("/")) return null;
    if (value.startsWith("//")) return null;
    // Plusieurs navigateurs traitent l'antislash comme un slash dans une
    // autorité : `/\hôte` est reçu comme `//hôte` sans jamais avoir la forme
    // qu'on filtre au-dessus.
    if (value.includes("\\")) return null;
  }

  return candidate;
}
