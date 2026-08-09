import type { ReactNode } from "react";

import { getCurrentUser } from "@/lib/auth/dal";
import { AppHeader } from "@/components/layouts/app-header";

/// Layout de l'espace connecté — il porte l'en-tête, donc la déconnexion.
///
/// ⚠️ **Ce n'est pas une garde.** La lecture ci-dessous sert à AFFICHER un nom,
/// et le fait qu'elle redirige un visiteur sans session est un effet du DAL,
/// pas un rempart : le Partial Rendering ne rejoue pas un layout en navigation
/// client, un contrôle posé ici deviendrait donc obsolète sans que rien ne le
/// signale (CLAUDE.md §Authentication). Chaque page garde son propre
/// `requireAdmin()` — c'est lui qui refuse, et lui seul.
export default async function EspaceConnecteLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentUser();

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader user={user} />
      {children}
    </div>
  );
}
