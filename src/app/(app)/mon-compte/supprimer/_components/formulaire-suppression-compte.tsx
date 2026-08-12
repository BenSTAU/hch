"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";

import { supprimerCompte } from "@/lib/actions/users/supprimer-compte";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/// Confirmation du droit à l'oubli - `US-COMPTE-SUPPRIMER` §Cas nominal.
///
/// ── La double confirmation de l'US, dans l'ordre qu'elle décrit
///
/// « Je clique sur le bouton **et je vois une modale d'avertissement fort** »,
/// puis « je confirme **en saisissant mon mot de passe** ». Les deux gestes sont
/// distincts et le second n'est pas atteignable sans le premier : c'est la
/// protection contre le clic accidentel que l'US nomme.
///
/// `DialogTrigger` et non un bouton nu : Radix y pose `aria-haspopup="dialog"`,
/// `aria-expanded` et `aria-controls`, et il piège le focus dans le panneau.
/// Rien de tout cela n'est signalé par `jest-axe` quand ça manque - leçon
/// T-V3-11, relevée par l'agent testeur.
///
/// ── Pas de message de succès ici, et c'est structurel
///
/// L'action détruit la session puis redirige vers l'accueil : ce composant se
/// démonte, et tout message posé dedans partirait avec lui. Le message final de
/// l'US vit donc sur la page d'accueil. Les refus, eux, ne mutent rien et
/// laissent l'écran en place : une alerte à côté du champ est la bonne surface.
/// C'est la doctrine des trois surfaces établie en T-V3-11 (PR #36), appliquée
/// à un cas où une seule des trois est nécessaire.
export function FormulaireSuppressionCompte() {
  const [enCours, demarrer] = useTransition();
  const [ouvert, setOuvert] = useState(false);
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);

  function confirmer() {
    setErreur(null);
    demarrer(async () => {
      const resultat = await supprimerCompte({ motDePasse });

      const refusZod =
        resultat?.validationErrors?.motDePasse?._errors?.[0] ??
        resultat?.validationErrors?._errors?.[0];
      if (refusZod) {
        setErreur(refusZod);
        return;
      }

      if (resultat?.serverError) {
        setErreur(resultat.serverError);
        return;
      }

      const donnees = resultat?.data;
      if (donnees && !donnees.ok) {
        setErreur(donnees.message);
        return;
      }

      // Succès : la redirection serveur a déjà eu lieu, il n'y a rien à faire.
      // Le mot de passe est tout de même retiré de l'état - le composant peut
      // survivre le temps que la navigation se peigne.
      setMotDePasse("");
    });
  }

  return (
    <Dialog
      open={ouvert}
      onOpenChange={(prochain) => {
        setOuvert(prochain);
        if (!prochain) {
          setErreur(null);
          setMotDePasse("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="destructive" className="self-start">
          <Trash2 aria-hidden="true" />
          Supprimer mon compte
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmation de suppression</DialogTitle>
          {/* La maquette C12 écrit « Toutes vos données seront effacées ».
              Non porté : PLAN S4 §4.4 l'interdit explicitement, une formule
              qui promet la disparition exposerait à un rappel CNIL alors que
              l'opération est une pseudonymisation. */}
          <DialogDescription>
            Cette action est irréversible. Vos informations personnelles seront
            remplacées par des valeurs anonymes, et vous serez déconnecté
            immédiatement.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="mot-de-passe-suppression">
            Pour confirmer, saisissez votre mot de passe
          </Label>
          <Input
            id="mot-de-passe-suppression"
            name="motDePasse"
            type="password"
            // `current-password` et non `new-password` : c'est bien le secret
            // existant qu'on demande, et un gestionnaire de mots de passe qui
            // en proposerait un nouveau ferait échouer la confirmation.
            autoComplete="current-password"
            value={motDePasse}
            aria-invalid={erreur ? true : undefined}
            aria-describedby={erreur ? "erreur-suppression" : undefined}
            onChange={(evenement) => {
              setMotDePasse(evenement.target.value);
            }}
          />

          {erreur ? (
            <p
              id="erreur-suppression"
              role="alert"
              className="text-sm text-destructive"
            >
              {erreur}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={enCours}>
              Conserver mon compte
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={enCours}
            onClick={confirmer}
          >
            {enCours ? "Suppression..." : "Supprimer définitivement mon compte"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
