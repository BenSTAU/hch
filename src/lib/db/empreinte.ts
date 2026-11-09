import "server-only";

import { createHash } from "node:crypto";

/// Jeton de version d'une fiche d'administration, pour refuser l'enregistrement
/// d'une fiche modifiée depuis son ouverture.
///
/// Employé par `services`, qui n'a **aucune colonne de version** (dictionnaire
/// §services). `app_settings` porte `updated_at` et utilise cette colonne : on
/// ne fabrique pas une version là où il en existe une.
///
/// ⚠️ **Un aller-retour A puis B puis A est invisible** : deux états identiques
/// donnent la même empreinte. Sans conséquence, l'état enregistré étant alors
/// celui que l'administrateur avait sous les yeux.
///
/// ⚠️ **Ce jeton n'est pas un secret** : il part au navigateur en champ caché.
/// Il date, il ne protège pas. Ce qui refuse l'écriture est le prédicat de
/// l'`updateMany`, côté serveur.

/// Un `Decimal` n'en fait pas partie : il se normalise en chaîne à deux
/// décimales avant d'arriver ici, comme partout où un prix traverse une
/// frontière.
export type ValeurEmpreinte = string | number | boolean | null;

/// 22 caractères base64url portent 132 bits. SHA-256 n'a pas de biais connu
/// sur ses bits de poids fort, la troncature est sûre.
const LONGUEUR = 22;

/// Encodage **injectif** : un simple `join("|")` donnerait la même empreinte à
/// `["a|b", ""]` et à `["a", "b|"]`, donc deux fiches différentes passeraient
/// l'une pour l'autre. D'où la longueur en préfixe.
function encoder(valeur: ValeurEmpreinte): string {
  // `services.description` est NULLable : une colonne vidée n'est pas une
  // colonne contenant la chaîne vide.
  if (valeur === null) return "~";

  const texte = typeof valeur === "string" ? valeur : String(valeur);
  return `${String(texte.length)}:${texte}`;
}

export function empreinteFiche(valeurs: readonly ValeurEmpreinte[]): string {
  const hash = createHash("sha256");
  for (const valeur of valeurs) hash.update(encoder(valeur), "utf8");
  return hash.digest("base64url").slice(0, LONGUEUR);
}
