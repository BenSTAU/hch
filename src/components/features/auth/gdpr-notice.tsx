import Link from "next/link";

import { CHEMIN_POLITIQUE_CONFIDENTIALITE } from "@/components/layouts/site-navigation";

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

export function GdprNotice({ finalite }: { finalite: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      Vos données personnelles sont collectées pour {finalite}. Vous disposez de
      droits d&apos;accès, de rectification et d&apos;effacement — voir la{" "}
      {/* La constante et non le littéral : la route existe depuis T-V3-12, et
          « une route recopiée est une route qui diverge » (relevé par l'agent
          testeur, E10). Le lien pointait dans le vide jusque-là. */}
      <Link
        href={CHEMIN_POLITIQUE_CONFIDENTIALITE}
        className="underline underline-offset-4"
      >
        politique de confidentialité
      </Link>
      .
    </p>
  );
}
