import Link from "next/link";

import { Button } from "@/components/ui/button";

/// Rendu par Next sur toute route inconnue, et par un appel explicite à
/// `notFound()`. Audit de conformité du 2026-08-12 : le DEFAULT de CLAUDE.md
/// §Architecture App Router nomme ce fichier parmi les conventions standard, et
/// aucune des trois n'existait.
///
/// Sans lui, un 404 rend la page par défaut de Next : en anglais, hors de la
/// palette, sans en-tête ni pied de page. C'est la surface la plus banale du
/// produit - une URL mal recopiée suffit - et c'était la seule à ne ressembler
/// à rien.
///
/// Aucune suggestion de route, aucun moteur de recherche interne : le produit
/// n'a ni l'un ni l'autre, et les inventer ici poserait des liens qu'aucune US
/// ne porte. Un retour à l'accueil, et c'est tout - même sobriété que
/// `forbidden.tsx`.
///
/// Elle vit à la racine de `app/` et non dans un groupe de routes : Next ne
/// resout `not-found` d'un groupe que pour les routes de ce groupe, et une
/// URL inconnue n'appartient par définition à aucun.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="font-heading text-3xl font-bold">Page introuvable</h1>
      <p className="text-sm text-muted-foreground">
        Cette adresse ne correspond à aucune page. Le lien que vous avez suivi
        est peut-être ancien, ou l&apos;adresse a été mal recopiée.
      </p>
      <Button asChild className="self-start">
        <Link href="/">Retour à l&apos;accueil</Link>
      </Button>
    </main>
  );
}
