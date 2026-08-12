import { Skeleton } from "@/components/ui/skeleton";

/// Squelette de l'espace client - écrans **C8** et **C10**.
///
/// Même motif que celui de l'espace technicien, et même raison de ne pas vivre
/// à la racine de `app/` : ce sont les deux seules surfaces qui attendent une
/// lecture en base, sur une connexion jointe par tunnel SSH.
///
/// La barre latérale et le `Toaster` vivent dans `layout.tsx` et restent
/// montés : le squelette ne remplace que le contenu.
export default function ChargementEspaceClient() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-24 rounded-2xl" />
      <Skeleton className="h-10 w-64" />

      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((rang) => (
          <Skeleton key={rang} className="h-32 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
