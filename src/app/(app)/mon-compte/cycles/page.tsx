import { LifeBuoy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { requireEspaceClient } from "@/lib/auth/permissions";
import { listerCyclesDuClient } from "@/lib/db/queries/cycles";
import { Button } from "@/components/ui/button";
import { CHEMIN_RESERVATION } from "@/components/layouts/site-navigation";

import { CyclesVue } from "./_components/cycles-vue";

export const metadata: Metadata = {
  title: "Mes vélos - HomeCycl'Home",
};

/// Écran **C11** - `US-CYCLES-LISTER`, `US-CYCLE-AJOUTER`, `US-CYCLE-MODIFIER`.
///
/// Le voisin `/mon-compte/supprimer` est ouvert à tous les rôles ; celui-ci ne
/// l'est pas, et le critère n'est pas le préfixe : une surface qui relève du
/// **fait d'avoir un compte** reste ouverte, une surface qui relève du **fait
/// d'être client** est cloisonnée. Le droit à l'oubli est le premier - « un
/// droit de toute personne fichée, pas un parcours client » -, une liste de
/// vélos le second. Constitution §3.1 amendée en granularité par route le
/// 2026-08-14.
///
/// L'argument qui a tranché : laissée ouverte, cette page donnerait au
/// technicien une liste de vélos qu'il ne peut rattacher à rien, puisque
/// `/mes-interventions/*` lui répond déjà 403. Une surface morte par
/// construction.
///
/// Sept éléments, tous faute de colonne au dictionnaire §cycles, qui en porte
/// six et aucune de plus :
///
///   · la **barre de KPI** (« Total vélos », « Interventions », « Plus
///     entretenu ») - seul le compte existe, et il est passé dans le titre de
///     la liste ; les deux autres rendraient zéro sur toute la démo, `cycle_id`
///     n'ayant aucun écrivain avant cette tâche ;
///   · le marqueur **« Vélo principal ⭐ »** et son interrupteur ;
///   · l'**import de photo** du vélo ;
///   · **« Dernière révision : il y a 2 mois »** ;
///   · les pastilles **« RÉVISION SUGGÉRÉE »** et **« RÉVISION URGENTE »** ;
///   · le **champ de recherche** de la barre haute ;
///   · les icônes **notifications** et **réglages** de la barre haute.
///
/// Conservé, parce que la DoD le demande et que c'est une trouvaille Stitch :
/// le bloc « Besoin d'aide ? ». Il vit ici plutôt que dans la barre latérale de
/// la coquille, qui est partagée : l'y poser l'afficherait aussi sur C8 et C10,
/// où rien ne le demande.
export default async function CyclesPage() {
  const user = await requireEspaceClient();

  const cycles = await listerCyclesDuClient({ userId: user.id });

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl font-extrabold tracking-tighter">
          Mes vélos
        </h1>
        <p className="text-muted-foreground">
          Vos cycles enregistrés, à rattacher à vos rendez-vous.
        </p>
      </header>

      <NuqsAdapter>
        <CyclesVue cycles={cycles} />
      </NuqsAdapter>

      <aside className="flex flex-col items-start gap-3 rounded-2xl bg-primary p-5 text-primary-foreground">
        <span className="flex items-center gap-2 font-heading text-base font-bold">
          <LifeBuoy aria-hidden="true" className="size-5" />
          Besoin d&apos;aide ?
        </span>
        <p className="text-sm text-primary-foreground/80">
          Un technicien se déplace chez vous, à la date qui vous arrange.
        </p>
        <Button asChild variant="secondary">
          <Link href={CHEMIN_RESERVATION}>Prendre rendez-vous</Link>
        </Button>
      </aside>
    </>
  );
}
