"use client";

import { CalendarX2, Mail, Phone, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { annulerIntervention } from "@/lib/actions/interventions/annuler-intervention";
import {
  annulationOuverte,
  MOTIF_ANNULATION_MAX,
} from "@/lib/interventions/annulation";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type ContactSociete = {
  telephone: string | null;
  email: string | null;
};

/// Bloc « Annuler cette intervention » du panneau de détail -
/// `US-INTERVENTION-ANNULER-CLIENT`, écran **C8**.
///
/// ── Deux états, une seule source pour la bascule
///
/// `annulationOuverte` est la fonction que le helper métier applique côté
/// serveur. L'écran ne recalcule pas sa propre fenêtre : deux expressions de la
/// même règle finiraient par diverger, et l'écart s'appellerait « le bouton
/// était actif mais ça n'a pas marché ».
///
/// ── L'horloge vient du serveur
///
/// `maintenant` descend de la page, il n'est pas lu au rendu. Un `new Date()`
/// ici rendrait une valeur au serveur et une autre à l'hydratation, donc un
/// bouton potentiellement actif d'un côté et inactif de l'autre - la divergence
/// d'hydratation payée sur le stepper du tunnel (PR #29 note 8).
///
/// Corollaire assumé : un onglet resté ouvert pendant que la fenêtre se referme
/// continue de proposer le bouton. C'est le double filet qui tranche - l'action
/// refuse, et sa réponse fait basculer ce bloc sur le bandeau de contact.
/// L'inverse (rafraîchir l'écran à la minute) coûterait un `setInterval` sur
/// une bascule qui, en pratique, se joue une fois par rendez-vous.
export function BlocAnnulation({
  interventionId,
  appointmentAt,
  maintenant,
  contact,
}: {
  interventionId: number;
  appointmentAt: Date;
  maintenant: Date;
  contact: ContactSociete;
}) {
  const [enCours, demarrer] = useTransition();
  const [ouvert, setOuvert] = useState(false);
  const [motif, setMotif] = useState("");
  /// Refus **qui laissent ce bloc en place** : ceux de Zod et une panne
  /// serveur. Ni l'un ni l'autre ne mute quoi que ce soit, donc rien n'est
  /// revalidé et la modale reste ouverte sur la même intervention - une alerte
  /// à côté du champ est alors la bonne surface.
  ///
  /// Les refus **métier** ne passent plus par ici : voir `confirmer`.
  const [erreur, setErreur] = useState<string | null>(null);
  // Bascule vers le bandeau de contact quand le serveur refuse pour cause de
  // fenêtre dépassée, sur un écran qui la croyait encore ouverte.
  const [refusee, setRefusee] = useState(false);

  const dansLaFenetre =
    !refusee && annulationOuverte(appointmentAt, maintenant);

  if (!dansLaFenetre) {
    return <BandeauHorsFenetre contact={contact} />;
  }

  function confirmer() {
    setErreur(null);
    demarrer(async () => {
      const resultat = await annulerIntervention({ interventionId, motif });

      // `validationErrors` porte le refus de Zod - motif vide ou trop long. Le
      // schéma est la seule source de ces deux bornes, l'écran ne les redit pas.
      const refusZod =
        resultat?.validationErrors?.motif?._errors?.[0] ??
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
        // La fenêtre s'est refermée pendant que l'onglet était ouvert. Rien
        // n'a changé en base, la ligne reste dans la liste, donc ce bloc reste
        // monté : il bascule sur le bandeau de contact, qui EST le message.
        if (donnees.fenetreDepassee) {
          setOuvert(false);
          setRefusee(true);
          return;
        }

        // 🐛 **Les deux autres refus passent par le toast, pas par une alerte
        // locale.** Rouge de la barrière CI du 2026-08-11, vert en local.
        //
        // `introuvable` et `non_annulable` disent tous deux que la ligne n'est
        // plus dans « À venir » - elle a changé de propriétaire, ou son statut
        // n'est plus `PLANNED`. La Server Action revalide donc, et la liste
        // revient sans elle : ce composant **se démonte**, emportant l'alerte
        // qu'on venait d'y poser. Et s'il ne se démonte pas, parce que le
        // client a d'autres rendez-vous, il se rattache au premier de la liste
        // et afficherait une erreur qui parle d'un AUTRE rendez-vous.
        //
        // C'est exactement le raisonnement déjà appliqué au message de succès
        // ci-dessous, que je n'avais pas étendu aux refus en ajoutant la
        // revalidation. Le local a survécu en `pnpm dev`, où l'aller-retour RSC
        // est assez lent pour que l'alerte s'affiche avant le démontage ; face
        // à l'image de production, le démontage gagne. La course n'était pas un
        // aléa, c'est la barrière qui l'a rendue déterministe.
        //
        // Durée allongée : un message d'erreur se lit, là où « Intervention
        // annulée » se constate.
        setOuvert(false);
        toast.error(donnees.message, { duration: 8_000 });
        return;
      }

      // La ligne quitte la liste au même instant (elle passe en « Passées ») :
      // ce composant se démonte, et un message rendu ici disparaîtrait avec
      // lui. Le toast vit dans le `Toaster` du layout, qui reste monté.
      setOuvert(false);
      setMotif("");
      toast.success("Intervention annulée");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Dialog
        open={ouvert}
        onOpenChange={(prochain) => {
          setOuvert(prochain);
          if (!prochain) setErreur(null);
        }}
      >
        {/* 🐛 `DialogTrigger` et non un bouton nu, relevé par l'agent testeur.
            Radix y pose `aria-haspopup="dialog"`, `aria-expanded` et
            `aria-controls` : sans eux, un lecteur d'écran annonce un bouton
            ordinaire là où le geste ouvre une boîte de dialogue modale, et rien
            ne dit qu'elle est ouverte. `jest-axe` ne le signale pas. */}
        <DialogTrigger asChild>
          <Button type="button" variant="destructive" className="self-start">
            <CalendarX2 aria-hidden="true" />
            Annuler cette intervention
          </Button>
        </DialogTrigger>

        <DialogContent>
          <DialogHeader>
            <DialogTitle>Annuler cette intervention</DialogTitle>
            <DialogDescription>
              Le créneau sera libéré et le technicien prévenu. Cette action est
              définitive : pour un nouveau rendez-vous, il faudra réserver à
              nouveau.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            {/* Obligatoire (US §Cas d'erreur, « Motif d'annulation requis »).
                Pas de `required` HTML : la validation qui fait foi est celle du
                schéma, côté serveur, et un blocage natif du navigateur
                empêcherait de l'éprouver. */}
            <Label htmlFor="motif-annulation">Motif de l&apos;annulation</Label>
            <Textarea
              id="motif-annulation"
              name="motif"
              value={motif}
              maxLength={MOTIF_ANNULATION_MAX}
              aria-invalid={erreur ? true : undefined}
              aria-describedby={erreur ? "erreur-annulation" : undefined}
              placeholder="Empêchement, report, vélo déjà réparé..."
              onChange={(evenement) => {
                setMotif(evenement.target.value);
              }}
            />
            <p className="text-sm text-muted-foreground">
              Il aide le technicien à organiser sa tournée.
            </p>

            {erreur ? (
              <p
                id="erreur-annulation"
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
                Conserver le rendez-vous
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={enCours}
              onClick={confirmer}
            >
              {enCours ? "Annulation..." : "Confirmer l'annulation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Le libellé de la maquette dit « Annulation **gratuite** jusqu'à 24h ».
          Non porté : Constitution §2.3 exclut tout paiement en ligne, il n'y a
          donc rien à ne pas facturer, et le mot promet un remboursement qui
          n'a pas d'objet. Divergence signalée pour write-back. */}
      <p className="text-sm text-muted-foreground">
        Annulation possible en ligne jusqu&apos;à 24 h avant le rendez-vous.
      </p>
    </div>
  );
}

/// Passé H-24 : le self-service se ferme et renvoie vers l'atelier.
///
/// **Aucun contournement**, et c'est une consigne explicite : SPEC §7.2 assume
/// un traitement hors système pour ce cas, et écrit qu'aucune US v1 côté
/// administration ne permet d'annuler à la place du client. Un bouton
/// « demander l'annulation » serait une file de leads, que Constitution §1.2
/// s'interdit.
function BandeauHorsFenetre({ contact }: { contact: ContactSociete }) {
  return (
    <section
      aria-labelledby="annulation-fermee"
      className="flex gap-4 rounded-2xl border border-destructive/20 bg-destructive/10 p-5"
    >
      <TriangleAlert
        aria-hidden="true"
        className="size-6 shrink-0 text-destructive"
      />

      <div className="flex flex-col gap-2">
        <h3
          id="annulation-fermee"
          className="font-heading text-base font-bold text-destructive"
        >
          Annulation impossible en ligne
        </h3>
        <p className="text-sm text-destructive">
          Le délai d&apos;annulation de 24 h est dépassé. Pour toute urgence ou
          modification de dernière minute, contactez-nous directement.
        </p>

        {/* Les deux coordonnées viennent d'`app_settings` : c'est
            l'administrateur qui les tient à jour, et un numéro en dur dans le
            code aurait vieilli sans que personne le voie. Vides, elles ne
            rendent rien plutôt qu'un lien mort. */}
        {contact.telephone || contact.email ? (
          <div className="mt-1 flex flex-wrap gap-3">
            {contact.telephone ? (
              <Button asChild variant="destructive" size="sm">
                <a href={`tel:${contact.telephone}`}>
                  <Phone aria-hidden="true" />
                  {contact.telephone}
                </a>
              </Button>
            ) : null}
            {contact.email ? (
              <Button asChild variant="outline" size="sm">
                <a href={`mailto:${contact.email}`}>
                  <Mail aria-hidden="true" />
                  {contact.email}
                </a>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
