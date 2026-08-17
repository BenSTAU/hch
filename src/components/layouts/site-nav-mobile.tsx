"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import { navigationPrincipale } from "./site-navigation";

/// Menu de navigation mobile — le burger de la coquille publique.
///
/// **C'est la seule feuille cliente du layout public**, et elle est montée
/// `md:hidden` : au-delà de `md`, la nav de `SiteHeader` s'affiche en ligne et
/// ce composant n'existe pas à l'écran. Pattern donut de CLAUDE.md §Architecture
/// App Router — la frontière `"use client"` descend au composant interactif, pas
/// au layout.
///
/// Un `Sheet` plutôt que la nav repliée en seconde ligne : replier donne
/// 185 px d'en-tête sur trois lignes en 375 px, mesuré au navigateur, soit un
/// quart de la hauteur mangée par une barre collante.
///
/// ⚠️ **Écart assumé** : [[s4-nf-transverses|PLAN S4]] §3.2 veut les pages
/// légales en Server Components purs, et elles héritent de cette coquille donc
/// du dialogue Radix. Une page sans navigation sous 768 px serait une
/// régression fonctionnelle, pas une économie. Coût borné : monté en mobile
/// seulement, et Radix ne rend le contenu qu'à l'ouverture.
///
/// `SheetTitle` n'est pas décoratif : Radix Dialog exige un nom accessible, et
/// sans lui la console avertit et le lecteur d'écran annonce un dialogue anonyme.
export function SiteNavMobile({
  children,
  roles = null,
}: {
  children?: React.ReactNode;
  /// Les rôles, jamais le DTO utilisateur : ce composant décide seulement
  /// quelle entrée d'espace afficher, il n'a rien à savoir de qui est connecté.
  /// `null` pour un visiteur anonyme.
  ///
  /// Ils prennent la place du booléen à T-V2-05 : un technicien voyait
  /// « Mes interventions » vers un espace qui lui répond désormais 403.
  roles?: readonly string[] | null;
}) {
  // L'état est piloté ici pour pouvoir **refermer au clic sur un lien** : les
  // entrées sont des ancres de la même page, donc aucune navigation ne remonte
  // le composant, et un panneau qui reste ouvert masque la section vers
  // laquelle on vient de sauter.
  const [ouvert, setOuvert] = useState(false);

  return (
    <Sheet open={ouvert} onOpenChange={setOuvert}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon-lg"
          className="md:hidden"
          aria-label="Ouvrir le menu"
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-72 gap-0">
        <SheetHeader>
          <SheetTitle className="font-heading text-xl font-extrabold tracking-tighter text-primary">
            HomeCycl&apos;Home
          </SheetTitle>
        </SheetHeader>

        <nav aria-label="Navigation principale" className="px-4 py-2">
          <ul className="flex flex-col">
            {navigationPrincipale(roles).map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOuvert(false)}
                  className="block rounded-xl px-2 py-3 text-base font-semibold text-foreground transition-colors hover:bg-secondary"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Les actions de session viennent du serveur, en `children` : ce
            composant-ci ne doit rien savoir de l'utilisateur. Un Client
            Component qui recevrait le DTO le sérialiserait dans la charge utile
            envoyée au navigateur. */}
        {children ? (
          <div className="mt-2 flex flex-col gap-3 border-t px-4 py-4">
            {children}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
