import Link from "next/link";

import { cn } from "@/lib/utils";

/// Titre et onglets de l'espace client — bandeau commun à **C8** et **C10**.
///
/// « À venir » et « Passées » sont deux **routes** (`/mes-interventions/a-venir`
/// et `/mes-interventions/passees`), nommées comme telles par les deux US dans
/// leurs critères d'erreur. Un `Tabs` Radix bascule des panneaux dans une même
/// page : il ne produirait pas d'URL, donc pas de page partageable, pas de
/// retour arrière, et le `next=` de la redirection de connexion n'aurait plus
/// de cible. Le motif ARIA correct pour une navigation est un `nav` de liens
/// avec `aria-current`, et c'est ce qui est écrit ici.
///
/// La cloche et la roue dentée de C8 (aucune US), et sur C10 le bouton
/// « Exporter historique (PDF) » et les trois cartes de statistiques
/// (« Total interventions », « Total dépensé », « Technicien le plus
/// fréquent »), qu'aucun critère d'acceptation ne demande.

export type OngletEspace = "a-venir" | "passees";

const ONGLETS = [
  { cle: "a-venir", href: "/mes-interventions/a-venir", label: "À venir" },
  { cle: "passees", href: "/mes-interventions/passees", label: "Passées" },
] as const;

export function EnTeteEspace({
  sousTitre,
  actif,
  compteurs,
}: {
  sousTitre: string;
  actif: OngletEspace;
  compteurs: { aVenir: number; passees: number };
}) {
  return (
    <header className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 rounded-2xl border border-border/60 bg-card px-5 py-5 md:px-8">
        <h1 className="font-heading text-3xl font-extrabold tracking-tighter text-primary">
          Mes interventions
        </h1>
        <p className="text-sm text-muted-foreground">{sousTitre}</p>
      </div>

      <nav aria-label="Filtrer mes interventions">
        <ul className="flex items-center gap-6 border-b border-border">
          {ONGLETS.map((onglet) => {
            const courant = onglet.cle === actif;
            const compteur =
              onglet.cle === "a-venir" ? compteurs.aVenir : compteurs.passees;

            return (
              <li key={onglet.cle}>
                <Link
                  href={onglet.href}
                  // `aria-current="page"` et non un `aria-selected` : ce sont
                  // des liens de navigation, pas des onglets d'un widget.
                  aria-current={courant ? "page" : undefined}
                  className={cn(
                    "-mb-px inline-block border-b-2 px-1 pb-3 text-sm font-semibold transition-colors",
                    courant
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {onglet.label} ({compteur})
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
