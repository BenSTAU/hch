"use client";

import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { demarrerIntervention } from "@/lib/actions/interventions/demarrer-intervention";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/// « Démarrer l'intervention » - `US-INTERVENTION-DEMARRER`, maquette **T2**.
///
/// Un seul composant pour les **deux** surfaces : le bloc « Statut actuel » du
/// détail, et la ligne `PLANNED` de la tournée du jour. Deux boutons pour une
/// transition finiraient par diverger sur la confirmation ou sur le traitement
/// des refus, et c'est justement ce que la case 12 de la DoD demande de tenir
/// ensemble.
///
/// ── La confirmation n'est pas de la prudence décorative
///
/// La transition est **irréversible** : aucune US, aucun ADR, aucune ligne du
/// MCD ne prévoit un retour `IN_PROGRESS → PLANNED`. Et elle a un effet de bord
/// sur un tiers - le verrou `STATUT_MODIFIABLE = "PLANNED"` ferme au même
/// instant le panier du client et son dépôt de photos. Un clic malencontreux
/// depuis la liste, où la ligne est petite et voisine de dix autres, coûterait
/// au client une modification qu'il ne pourra plus faire.
///
/// `AlertDialog` et non `Dialog` : Radix y rend `role="alertdialog"`, pose le
/// focus initial sur le refus et neutralise le clic extérieur. L'échappement,
/// lui, referme, et sans rien envoyer - le motif WAI-ARIA l'exige, et un test
/// le fige. Ajout à la DoD, tranché par Benjamin à l'ouverture de la tâche : la
/// maquette T2 n'en porte pas, mais elle porte aussi une référence
/// `#INT-2026-1042` et une fenêtre d'arrivée fictives, toutes deux retirées.
///
/// ── Ce qu'il fait après coup, et pourquoi ça dépend de l'appelant
///
/// L'action revalide les deux chemins côté serveur. Ça suffit au **détail**,
/// qui est un Server Component : `router.refresh()` rejoue le rendu et le hub
/// bascule. Ça ne suffit pas à la **tournée**, dont la liste vit dans un cache
/// TanStack Query côté navigateur : sans `onDemarree`, la ligne resterait
/// « Planifiée » jusqu'au prochain cycle de 30 secondes, soit une demi-minute à
/// se demander si le clic a été pris.
export function BoutonDemarrer({
  interventionId,
  taille = "default",
  onDemarree,
}: {
  interventionId: number;
  /// `sm` sur la ligne de tournée, où le bouton accompagne un contenu dense.
  taille?: "default" | "sm";
  /// Passé par la vue cliente de la tournée pour invalider sa query. Absent sur
  /// le détail, qui se contente de la revalidation serveur.
  onDemarree?: () => void;
}) {
  const [enCours, demarrer] = useTransition();
  const [ouvert, setOuvert] = useState(false);
  const router = useRouter();

  function confirmer() {
    demarrer(async () => {
      const resultat = await demarrerIntervention({ interventionId });

      if (resultat?.serverError) {
        setOuvert(false);
        toast.error(resultat.serverError, { duration: 8_000 });
        return;
      }

      const donnees = resultat?.data;

      if (donnees && !donnees.ok) {
        // Refus métier : le statut a changé sous les yeux du technicien, parce
        // qu'un autre onglet a démarré, ou que le client vient d'annuler. La
        // durée est allongée, un message d'erreur se lit là où « Intervention
        // démarrée » se constate.
        setOuvert(false);
        toast.error(donnees.message, { duration: 8_000 });
        // L'écran est périmé dans les deux cas : on le remet à jour pour que le
        // bouton disparaisse au lieu d'inviter à réessayer.
        router.refresh();
        onDemarree?.();
        return;
      }

      setOuvert(false);
      toast.success("Intervention démarrée");
      router.refresh();
      onDemarree?.();
    });
  }

  return (
    <AlertDialog open={ouvert} onOpenChange={setOuvert}>
      {/* `AlertDialogTrigger` et non un bouton nu : Radix y pose
          `aria-haspopup="dialog"` et `aria-expanded`. Sans eux, un lecteur
          d'écran annonce un bouton ordinaire là où le geste ouvre une boîte de
          dialogue modale. Relevé par l'agent testeur sur le bloc d'annulation
          (PR #33), et `jest-axe` ne le signale pas. */}
      <AlertDialogTrigger asChild>
        <Button type="button" size={taille}>
          <Play aria-hidden="true" />
          Démarrer l&apos;intervention
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Démarrer cette intervention ?</AlertDialogTitle>
          <AlertDialogDescription>
            L&apos;heure de démarrage sera enregistrée. Le client ne pourra plus
            modifier son panier ni ajouter de photos, et cette action ne peut
            pas être annulée.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={enCours}>Pas encore</AlertDialogCancel>
          {/* `onClick` et non le comportement par défaut : `AlertDialogAction`
              ferme la boîte au clic, ce qui démonterait le composant avant la
              fin de la transition. La fermeture est pilotée par `confirmer`,
              une fois la réponse reçue. */}
          <AlertDialogAction
            disabled={enCours}
            onClick={(evenement) => {
              evenement.preventDefault();
              confirmer();
            }}
          >
            {enCours ? "Démarrage..." : "Démarrer"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
