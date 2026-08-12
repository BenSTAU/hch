import Link from "next/link";

import { cn } from "@/lib/utils";

import { ONGLETS_TOURNEE, type CleOnglet } from "./onglets";

/// Onglets porteurs de l'espace technicien, en tête de contenu - sur le modèle
/// d'`en-tete-espace.tsx` côté client.
///
/// ── Ils REMPLACENT la barre latérale, ils ne la doublent pas
///
/// ⚠️ **`md:hidden`, et c'est le point.** T1 n'a aucune barre d'onglets : ses
/// trois vues vivent dans la barre latérale, et rien d'autre. Mais cette barre
/// disparaît sous 768 px (`<nav class="hidden md:flex …">`, `code.html:125`)
/// **sans rien pour la remplacer** - la maquette laisse le mobile sans
/// navigation, et c'est le trou que la DoD demande de combler.
///
/// Les rendre à toutes les tailles a été essayé et rejeté en recette le
/// 2026-08-12 : au-delà de `md` la page portait alors deux navigations pour
/// trois vues, une rangée que la maquette n'a pas. Chacune règne sur sa
/// tranche - onglets en dessous, barre latérale au-dessus.
///
/// ── Des liens, pas un composant `Tabs`
///
/// Les trois vues sont trois **routes**. Un `Tabs` Radix bascule des panneaux
/// dans une même page : pas d'URL, donc pas de page partageable, pas de retour
/// arrière, et plus de cible pour le `next=` de la redirection de connexion. Le
/// motif ARIA d'une navigation est un `nav` de liens avec `aria-current`.
///
/// ── Sans compteurs, contrairement au modèle client
///
/// `en-tete-espace.tsx` affiche « À venir (2) · Passées (5) ». Ici deux motifs
/// s'y opposent, et aucun n'est une préférence : le compteur d'« Aujourd'hui »
/// serait rendu au serveur à côté d'une liste qui se repolle toutes les 30 s
/// (PLAN S1 §6.1), donc il divergerait visiblement de la puce vivante du même
/// écran ; et celui de « Cette semaine » dépendrait du sélecteur 7 j / 30 j,
/// donc afficherait un nombre différent selon la page depuis laquelle on le
/// lit. Chaque vue porte à la place ses propres puces de synthèse, cohérentes
/// par construction. Arbitrage du 2026-08-12.
export function EnTeteTournee({ actif }: { actif: CleOnglet }) {
  return (
    <nav aria-label="Mes interventions" className="md:hidden">
      <ul className="flex items-center gap-6 overflow-x-auto border-b border-border">
        {ONGLETS_TOURNEE.map((onglet) => {
          const courant = onglet.cle === actif;

          return (
            <li key={onglet.cle}>
              <Link
                href={onglet.href}
                aria-current={courant ? "page" : undefined}
                className={cn(
                  "-mb-px inline-block border-b-2 px-1 pb-3 text-sm font-semibold whitespace-nowrap transition-colors",
                  courant
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {onglet.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
