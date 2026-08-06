import type { Metadata } from "next";

import { safeNextPath } from "@/lib/auth/next-path";

import { ConnexionView } from "./_components/connexion-view";

export const metadata: Metadata = {
  title: "Connexion — HomeCycl'Home",
};

/// Page asynchrone depuis T-J0-05 : elle lit le `next=` que `src/proxy.ts`
/// pose sur sa redirection, et Next 16 type `searchParams` en `Promise`. Tout
/// le rendu vit dans `ConnexionView`, synchrone et donc testable sous RTL.
///
/// La destination est validée **ici aussi**, en plus de la Server Action. Ce
/// n'est pas redondant : filtrer au rendu évite qu'une valeur hostile traverse
/// jusqu'au navigateur, et l'action reste seule responsable de sa propre
/// sécurité — elle est appelable sans jamais passer par cette page.
export default async function ConnexionPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;

  // Un paramètre répété (`?next=a&next=b`) arrive en tableau. On ne devine pas
  // lequel comptait : aucun des deux.
  const destination = typeof next === "string" ? safeNextPath(next) : null;

  return <ConnexionView next={destination ?? undefined} />;
}
