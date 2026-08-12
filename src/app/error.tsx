"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/// Frontière d'erreur racine - rendue quand un rendu jette hors des cas que
/// Next traite lui-même (`notFound()`, `forbidden()`, `redirect()`).
///
/// ⚠️ **Un `error.tsx` est OBLIGATOIREMENT un Client Component.** Next lui passe
/// `reset`, une fonction, ce qui exclut le rendu serveur. C'est la seule raison
/// du `"use client"` ici, pas un besoin d'interactivité.
///
/// ── Ce qui est affiché, et ce qui ne l'est surtout pas
///
/// **Jamais `error.message`.** Une erreur Prisma non interceptée porte l'hôte et
/// l'utilisateur de la base ; une erreur applicative peut porter un identifiant
/// ou un email. C'est la même règle que `handleServerError` de
/// `src/lib/safe-action.ts`, qui rend déjà un message générique pour ce motif.
/// Next masque de lui-même les messages en production, mais s'appuyer sur ce
/// masquage laisserait fuiter en développement et sur toute erreur relancée.
///
/// `error.digest` est en revanche affiché : c'est un hachage produit par Next,
/// sans contenu, et c'est ce qui permet de relier ce que voit la personne à la
/// ligne correspondante des journaux du conteneur.
///
/// ── `reset()` plutôt qu'un rechargement
///
/// Il rejoue le segment fautif sans repasser par le serveur ni perdre l'état du
/// reste de l'application. Utile sur une panne transitoire - la base jointe par
/// tunnel, un appel BAN qui expire.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Journalisé côté navigateur, donc visible dans la console de la personne
    // et dans les traces du serveur de développement. En production, Next a
    // déjà journalisé l'erreur serveur avec ce même `digest`.
    console.error("[error] rendu interrompu :", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="font-heading text-3xl font-bold">
        Une erreur est survenue
      </h1>
      <p className="text-sm text-muted-foreground">
        Cette page n&apos;a pas pu s&apos;afficher. Réessayez dans un instant.
      </p>

      {error.digest ? (
        // Le seul détail technique montré, et il ne dit rien de l'erreur : il
        // sert à la retrouver dans les journaux si la personne le communique.
        <p className="text-xs text-muted-foreground">
          Référence : <code>{error.digest}</code>
        </p>
      ) : null}

      <Button onClick={reset} className="self-start">
        Réessayer
      </Button>
    </main>
  );
}
