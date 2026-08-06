/// Validation de la destination post-connexion posée par `src/proxy.ts`.
///
/// La valeur est **contrôlée par l'attaquant** et atterrit dans un
/// `redirect()` : c'est la définition de l'open redirect. Pas de `server-only`,
/// la fonction est pure — cf. TASKS T-J0-05 §DoD.

/// C0, DEL et C1. Testé par point de code plutôt que par une classe de
/// caractères : un `\r` posé tel quel dans un littéral de regex est invisible
/// à la relecture, et sa variante échappée oblige à désactiver
/// `no-control-regex`.
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
    if (code >= 0x80 && code <= 0x9f) return true;
  }
  return false;
}

export function safeNextPath(
  candidate: string | null | undefined,
): string | null {
  if (typeof candidate !== "string" || candidate.length === 0) return null;

  // Les DEUX formes sont examinées, brute et décodée : `/%2Fphishing.example`
  // passe tous les contrôles sous sa forme brute et se décode en
  // `//phishing.example`, soit exactement ce qu'on refuse.
  let decoded: string;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    return null;
  }

  for (const value of [candidate, decoded]) {
    if (hasControlCharacter(value)) return null;
    if (!value.startsWith("/")) return null;
    // `//hôte` est une URL protocol-relative : elle commence par un slash et
    // pointe ailleurs, ce qui trompe un contrôle naïf. Et plusieurs
    // navigateurs lisent l'antislash comme un slash dans une autorité, donc
    // `/\hôte` vaut `//hôte` sans jamais en avoir la forme.
    if (value.startsWith("//")) return null;
    if (value.includes("\\")) return null;
  }

  return candidate;
}
