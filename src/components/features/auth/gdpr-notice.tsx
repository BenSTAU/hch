import Link from "next/link";

/// Mention RGPD au **point de collecte** — art. 13 RGPD, PLAN S4 §4.3.
///
/// Deux formulaires collectent des données personnelles et doivent la porter :
/// l'inscription (`US-COMPTE-CREER`, écran C6) et le bloc « Vos coordonnées »
/// du récapitulatif de réservation (`US-INTERVENTION-RESERVER`, écran C5), qui
/// **est** le formulaire d'inscription pré-rempli depuis le 2026-08-09.
///
/// C'est elle qui **remplace la case « J'accepte les CGV »** des deux maquettes.
/// Cette case n'est pas portée : elle suppose une page de conditions générales
/// hors périmètre v1, et une case de consentement obligatoire est une exigence
/// fonctionnelle qui ne s'invente pas au portage.
///
/// Extrait de `signup-form.tsx` au 2ᵉ usage, comme le veut la règle des deux
/// usages — pas avant.
export function GdprNotice({ finalite }: { finalite: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      Vos données personnelles sont collectées pour {finalite}. Vous disposez de
      droits d&apos;accès, de rectification et d&apos;effacement — voir la{" "}
      <Link
        href="/politique-confidentialite"
        className="underline underline-offset-4"
      >
        politique de confidentialité
      </Link>
      .
    </p>
  );
}
