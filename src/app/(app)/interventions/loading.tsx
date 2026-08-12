import { Skeleton } from "@/components/ui/skeleton";

/// Squelette de l'espace technicien, rendu pendant que la page lit la base.
///
/// ── Pourquoi ici et pas à la racine de `app/`
///
/// Un `loading.tsx` racine s'applique à **toute** navigation, y compris entre
/// deux pages statiques : la coquille entière disparaîtrait le temps d'un
/// rendu, ce qui est plus désagréable que pas de squelette du tout. Les deux
/// endroits qui attendent réellement quelque chose sont les espaces connectés,
/// qui interrogent une base jointe par tunnel SSH.
///
/// ⚠️ Il ne couvre PAS la barre latérale : elle vit dans `layout.tsx`, qui
/// reste monté pendant le chargement. Le squelette prend la place du contenu,
/// donc la navigation demeure utilisable pendant l'attente.
///
/// Les dimensions suivent celles des vraies lignes (`ligne-tournee.tsx`) : un
/// squelette dont la hauteur diffère du contenu final fait sauter la page à
/// l'arrivée, ce qui est un décalage cumulatif de mise en page.
export default function ChargementEspaceTechnicien() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-10 w-72" />

      <div className="flex gap-2">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-44" />
      </div>

      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((rang) => (
          <Skeleton key={rang} className="h-36 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
