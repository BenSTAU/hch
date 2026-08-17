import Link from "next/link";

import { LIENS_LEGAUX, NAV_PUBLIQUE } from "./site-navigation";

/// Pied de page de la coquille publique — porté de C1 (`code.html:478-518`).
///
///   · fond `surface-container-low` et **`rounded-t-xl`** — le pied de page de
///     C1 est une dalle aux angles supérieurs arrondis, pas un bandeau plein ;
///   · maille **4 colonnes** au-delà de `md`, gouttière de 16 px
///     (`gutter-bento`), `py-12` ;
///   · titres de colonne en `headline-sm` (20 px), liens en `body-sm` (14 px) ;
///   · barre de copyright séparée : `border-t`, `mt-8`, `py-6`, centrée.
///
/// La colonne de marque occupe **deux** cellules, la maquette en alignant
/// quatre dont une qui n'est pas portée.
///
/// Trois retraits :
///   · « **Mes factures** » (`code.html:500`) contredit Constitution §2.3 — le
///     paiement est encaissé sur le terrain, il n'y a pas de facture en ligne ;
///   · « **Recrutement** » (`code.html:509`, et C13 `code.html:285`) est hors
///     périmètre v1 ;
///   · « **CGV** » (`code.html:507`) est remplacé par `/accessibilite` — le
///     triplet de [[s4-nf-transverses|PLAN S4]] §4.2 fait foi contre les trois
///     autres qui circulaient dans les artefacts.
///
/// Et « © 2024 » devient **2026** ([[maquettage]] §Notes portage, bloc Global).
///
/// La colonne « Compte » disparaît avec « Mes factures » : il n'y restait
/// qu'un « Se connecter » qu'un visiteur authentifié verrait quand même, alors
/// que le pied de page ne varie pas selon la session.
export function SiteFooter() {
  return (
    <footer className="mt-auto rounded-t-xl bg-secondary">
      <div className="mx-auto grid w-full max-w-[1920px] grid-cols-1 gap-4 px-5 py-12 md:grid-cols-4 md:px-16">
        <div className="flex flex-col gap-4 md:col-span-2">
          <span className="font-heading text-xl font-bold tracking-tight text-primary">
            HomeCycl&apos;Home
          </span>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
            L&apos;atelier de réparation vélo qui vient à vous, partout dans la
            métropole lyonnaise.
          </p>
        </div>

        {/* Les deux `nav` sont nommés : la page en porte un troisième dans
            l'en-tête, et trois repères `navigation` anonymes sont annoncés à
            l'identique par un lecteur d'écran (WCAG 1.3.1, RGAA A). */}
        <nav aria-labelledby="pied-service" className="flex flex-col gap-4">
          <h2
            id="pied-service"
            className="font-heading text-xl font-bold tracking-tight"
          >
            Le service
          </h2>
          <ul className="flex flex-col gap-2">
            {NAV_PUBLIQUE.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-sm text-muted-foreground transition-colors hover:text-primary"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-labelledby="pied-legal" className="flex flex-col gap-4">
          <h2
            id="pied-legal"
            className="font-heading text-xl font-bold tracking-tight"
          >
            Informations légales
          </h2>
          <ul className="flex flex-col gap-2">
            {LIENS_LEGAUX.map((lien) => (
              <li key={lien.href}>
                <Link
                  href={lien.href}
                  className="text-sm text-muted-foreground transition-colors hover:text-primary"
                >
                  {lien.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="mt-8 border-t border-border/40">
        <p className="mx-auto w-full max-w-[1920px] px-5 py-6 text-center text-sm text-muted-foreground md:px-16">
          © 2026 HomeCycl&apos;Home Lyon. Réparation de vélos à domicile.
        </p>
      </div>
    </footer>
  );
}
