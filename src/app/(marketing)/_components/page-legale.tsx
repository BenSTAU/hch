import Link from "next/link";
import type { ReactNode } from "react";

import type { IdentiteSociete } from "@/lib/db/queries/parametres";
import {
  CHEMIN_MENTIONS_LEGALES,
  LIENS_LEGAUX,
} from "@/components/layouts/site-navigation";
import { cn } from "@/lib/utils";

/// Coquille des trois pages d'`US-RGPD` - écran **C13**.
///
/// ── Les onglets de la maquette deviennent trois routes
///
/// C13 dessine **une** page à trois onglets pilotés par `onclick` et
/// `classList.toggle` (`code.html:156-158, 299-322`). Le produit a trois URL
/// distinctes : le pied de page pointe trois liens (`US-RGPD` §Critères), et un
/// onglet ne se partage ni ne s'indexe. Les boutons deviennent donc des `Link`,
/// et l'onglet actif porte `aria-current="page"`.
///
/// Le gain n'est pas seulement sémantique : PLAN S4 §3.2 veut ces pages sans
/// JavaScript client propre, et la bascule d'onglets en aurait été.
///
/// ── Et le troisième onglet change de contenu
///
/// C13 nomme le troisième « Conditions Générales de Vente ». Le triplet qui
/// fait foi est celui de PLAN S4 §4.2 : la troisième page est
/// `/accessibilite`, et elle porte la déclaration RGAA formelle. Quatre
/// artefacts nommaient quatre triplets différents jusqu'au 2026-08-08, c'est
/// S4 qui l'emporte - le seul des quatre porté par une obligation de forme.
///
/// ── Le sommaire est une navigation, pas une liste
///
/// `aside` nommé, `nav` interne : trois repères `navigation` anonymes sur la
/// même page (en-tête, sommaire, pied de page) s'annoncent à l'identique
/// (WCAG 1.3.1, RGAA A). Masqué sous `md` comme dans la maquette - sur mobile
/// le contenu est plus court à parcourir que le sommaire à dérouler.
export function PageLegale({
  titre,
  chemin,
  miseAJour,
  sommaire,
  societe,
  children,
}: {
  titre: string;
  /// Route de la page rendue, pour marquer l'onglet actif.
  chemin: string;
  miseAJour: string;
  sommaire: readonly { id: string; label: string }[];
  /// Le rappel d'éditeur du pied de page. `US-RGPD` §Critères l'exige sur
  /// **chaque** page, pas seulement sur les mentions légales - écart relevé par
  /// l'agent testeur (E1). Le porter dans la coquille plutôt que de le
  /// recopier trois fois évite qu'une page diverge des deux autres.
  societe: IdentiteSociete;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-12 md:px-8">
      <h1 className="mb-6 text-3xl text-primary">{titre}</h1>

      <nav
        aria-label="Pages légales"
        className="mb-10 flex flex-wrap gap-2 rounded-2xl bg-secondary p-2"
      >
        {LIENS_LEGAUX.map((lien) => {
          const actif = lien.href === chemin;
          return (
            <Link
              key={lien.href}
              href={lien.href}
              aria-current={actif ? "page" : undefined}
              className={cn(
                "rounded-xl px-6 py-3 text-sm font-semibold transition-colors",
                "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                actif
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-background",
              )}
            >
              {lien.label}
            </Link>
          );
        })}
      </nav>

      <div className="grid gap-10 md:grid-cols-12">
        <aside
          aria-labelledby="sommaire-titre"
          className="hidden md:col-span-3 md:block"
        >
          <div className="sticky top-8 rounded-2xl bg-card p-6">
            <h2
              id="sommaire-titre"
              className="mb-4 font-heading text-lg font-bold text-primary"
            >
              Sommaire
            </h2>
            <nav aria-labelledby="sommaire-titre">
              <ul className="flex flex-col gap-2">
                {sommaire.map((entree) => (
                  <li key={entree.id}>
                    <a
                      href={`#${entree.id}`}
                      className="block text-sm text-muted-foreground transition-colors hover:text-primary"
                    >
                      {entree.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </aside>

        <div className="flex flex-col gap-10 md:col-span-9">
          {children}

          <div className="flex flex-col gap-1 border-t border-border pt-6 text-sm text-muted-foreground">
            <p>
              {[
                societe.nom,
                societe.siret ? `SIRET ${societe.siret}` : null,
                societe.adresse,
                societe.email,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p>
              Hébergeur : OVH SAS (France).{" "}
              {chemin === CHEMIN_MENTIONS_LEGALES ? null : (
                <Link
                  className="underline hover:text-primary"
                  href={CHEMIN_MENTIONS_LEGALES}
                >
                  Mentions légales complètes
                </Link>
              )}
            </p>
            <p>Dernière mise à jour : {miseAJour}</p>
          </div>
        </div>
      </div>
    </main>
  );
}

/// Section d'une page légale - titre ancré sur l'entrée de sommaire du même
/// identifiant.
export function SectionLegale({
  id,
  titre,
  children,
}: {
  id: string;
  titre: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="scroll-mt-8">
      <h2 id={id} className="mb-4 font-heading text-xl font-bold text-primary">
        {titre}
      </h2>
      <div className="flex flex-col gap-3 leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
