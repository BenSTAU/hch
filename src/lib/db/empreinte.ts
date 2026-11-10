import "server-only";

import { createHash } from "node:crypto";

/// Jeton de version d'une fiche d'administration, pour refuser l'enregistrement
/// d'une fiche modifiée depuis son ouverture.
///
/// **L'instrument unique du patron**, pour les onze écrans d'administration.
/// `services` n'a aucune colonne de version (dictionnaire §services), et
/// `app_settings` en a une, `updated_at`, qui a pourtant été **écartée** :
/// `TIMESTAMP(6)` contre un `Date` JavaScript à la milliseconde, le détail est
/// au-dessus d'`updateAppSettings`. Deux instruments pour un seul rôle, dont un
/// porteur d'un piège de précision, n'est pas ce qu'un patron doit léguer.
/// Arbitré le 2026-11-10 sur le constat F2 de la session vérificatrice.
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

/// Jeton d'une **ligne clé-valeur**, dont l'état tient dans une seule colonne -
/// `app_settings.value`. Chaque ligne est son unité de concurrence, là où une
/// fiche de forfait n'en forme qu'une à cinq colonnes.
///
/// Sur une valeur unique, le jeton est informationnellement équivalent à cette
/// valeur, et c'est précisément ce qui le rend juste ici : « périmé » veut dire
/// « la valeur stockée n'est plus celle que l'écran a rendue », exactement ce
/// que le prédicat de l'`updateMany` vérifie ensuite. L'empreinte garde la
/// valeur précédente hors du navigateur et laisse un seul instrument au patron.
///
/// ⚠️ Prend la valeur **telle que l'écran la rend**, donc déjà normalisée par
/// l'appelant. C'est `jetonLigne` de `queries/parametres.ts` qui tient cette
/// normalisation, parce que l'équivalence `NULL` / chaîne vide est une règle
/// d'`app_settings`, pas une propriété de l'empreinte.
export function empreinteValeur(valeur: string): string {
  return empreinteFiche([valeur]);
}
