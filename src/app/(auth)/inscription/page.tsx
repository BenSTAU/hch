import type { Metadata } from "next";

import { InscriptionView } from "./_components/inscription-view";

export const metadata: Metadata = {
  title: "Créer un compte — HomeCycl'Home",
};

/// Synchrone : contrairement à la connexion, cette page ne lit aucune source
/// runtime — pas de `searchParams`, pas de `cookies`. Rien à envelopper dans
/// `<Suspense>` ni à marquer `"use cache"`.
export default function InscriptionPage() {
  return <InscriptionView />;
}
