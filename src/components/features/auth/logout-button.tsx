import { LogOut } from "lucide-react";

import { logout } from "@/lib/actions/auth/logout";
import { Button } from "@/components/ui/button";

/// Bouton de déconnexion — `US-COMPTE-DECONNECTER`.
///
/// Un `<form action={…}>` et non un `onClick` : la déconnexion est une
/// mutation, donc une Server Action, et le formulaire part en POST que React
/// ait hydraté ou non. Un bouton sans formulaire ne fait strictement rien tant
/// que le JavaScript n'est pas chargé, et sur un poste partagé c'est le pire
/// moment pour que la déconnexion soit décorative.
///
/// Composant **serveur** : il ne porte aucun état, et la frontière `"use
/// client"` n'a donc aucune raison de descendre jusqu'ici.
export function LogoutButton() {
  return (
    <form action={logout}>
      <Button type="submit" variant="outline" size="sm">
        <LogOut aria-hidden="true" data-icon="inline-start" />
        Se déconnecter
      </Button>
    </form>
  );
}
