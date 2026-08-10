import type { ReactNode } from "react";

/// Coquille du tunnel de réservation - écrans **C2 à C5**.
///
/// Groupe distinct de `(marketing)`, et c'est tout le sujet : les quatre
/// maquettes remplacent l'en-tête du site par une barre d'étapes ne portant
/// qu'un seul contrôle de sortie (`c2:112-142`, `c3:108-140`, `c4:112-133`,
/// `c5:115-160`). Empiler la nav publique et le stepper donnerait deux
/// navigations concurrentes en haut du même écran, et refermerait le débat que
/// T-V3-13 avait tranché à la mesure : 185 px d'en-tête en 375 px.
///
/// L'URL ne bouge pas d'un caractère - un groupe entre parenthèses ne segmente
/// pas le chemin, et `/reserver` reste hors du matcher `/client/:path*` de
/// `src/proxy.ts` (Constitution §3.2).
///
/// Aucune lecture ici, donc aucun `<Suspense>` à poser : le layout n'accède ni
/// à la base, ni à une source runtime.
export default function TunnelLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">{children}</div>
  );
}
