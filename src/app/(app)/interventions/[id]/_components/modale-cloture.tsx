"use client";

import {
  CalendarClock,
  CheckCircle2,
  HandCoins,
  TriangleAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { cloturerIntervention } from "@/lib/actions/paiements/cloturer-intervention";
import { formatDateCourte, formatHeure, formatPrixEuros } from "@/lib/format";
import { MOTIF_ANNULATION_MAX } from "@/lib/interventions/annulation";
import {
  LIBELLE_METHODE,
  METHODES_PAIEMENT,
  normaliserMontant,
  type MethodePaiement,
} from "@/lib/paiements/encaissement";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/// Modale de clôture et d'encaissement - `US-INTERVENTION-MARQUER-FAITE`
/// couplée à `US-PAIEMENT-ENREGISTRER`, écran **T4**.
///
/// ── C'est elle, la surface qui nomme son effet avant de l'engager
///
/// La DoD demande qu'aucun acte irréversible ne soit atteignable en un clic
/// depuis l'écran au repos. Cette modale la satisfait **déjà**, et rien n'est à
/// empiler par-dessus : elle affiche le montant, force le choix d'un mode, porte
/// l'encart « Action irréversible » et son bouton nomme l'acte.
///
/// ⚠️ Ne pas ajouter d'`AlertDialog` de confirmation. « Démarrer » a dû
/// **fabriquer** sa surface faute d'en avoir une (un bouton seul dans une card,
/// et le même dans une ligne de liste dense). Ici elle existe. Empiler serait
/// deux confirmations pour une décision, deux pièges de focus Radix imbriqués
/// sur un écran RGAA A, et un geste de plus sur un téléphone en fin
/// d'intervention. La propriété est la DoD, pas le composant.
///
/// ── Deux branches, une modale
///
/// `US-PAIEMENT-ENREGISTRER` pose le refus de paiement en critère v1 : il ne
/// vit donc pas ailleurs, dans un second bouton du hub qui laisserait croire à
/// deux actes distincts. C'est **le même geste de clôture**, dont le résultat
/// diffère. Le second panneau réutilise le contexte déjà à l'écran et son motif
/// obligatoire est une délibération écrite, plus forte qu'un bouton à cliquer.
///
/// ── Trois choses de la maquette ne sont pas portées
///
/// La référence `#INT-2026-1042` est un format inventé (l'identifiant réel est
/// le SERIAL de l'URL, déjà retiré de T2). Les sous-titres des trois modes
/// affirment un équipement et une raison sociale que rien ne porte, cf.
/// `lib/paiements/encaissement.ts`. Et le champ « Notes internes (Optionnel) »
/// relève d'`US-INTERVENTION-COMMENTAIRE-AJOUTER`, qui est **v2** et spécifie
/// « horodatage + auteur » : c'est une collection, pas un champ, et écrire
/// `interventions.tech_comment` ici poserait une donnée dont la v2 devrait
/// décider si elle la migre.
export function ModaleCloture({
  interventionId,
  total,
}: {
  interventionId: number;
  /// Forfait plus produits, déjà calculé par la couche d'accès (cadrage du
  /// plancher V2, D9). Il n'est pas re-dérivé ici : deux formules pour un
  /// montant finiraient par diverger, et c'est celle de l'écran qui serait
  /// encaissée.
  total: string;
}) {
  const [ouvert, setOuvert] = useState(false);
  /// Le panneau courant. Remis à `encaisse` à chaque ouverture : rouvrir la
  /// modale sur le formulaire de refus parce qu'on l'avait entrouvert la fois
  /// d'avant serait une mauvaise surprise sur un acte irréversible.
  const [vue, setVue] = useState<"encaisse" | "refuse">("encaisse");

  return (
    <Dialog
      open={ouvert}
      onOpenChange={(prochain) => {
        setOuvert(prochain);
        if (!prochain) setVue("encaisse");
      }}
    >
      {/* `DialogTrigger` et non un bouton nu : Radix y pose
          `aria-haspopup="dialog"`, `aria-expanded` et `aria-controls`. Sans eux,
          un lecteur d'écran annonce un bouton ordinaire là où le geste ouvre une
          boîte de dialogue modale. Relevé par l'agent testeur sur le bloc
          d'annulation (PR #33), et `jest-axe` ne le signale pas. */}
      <DialogTrigger asChild>
        <Button type="button">
          <CheckCircle2 aria-hidden="true" />
          {/* Libellé de la SPEC au mot près (`US-INTERVENTION-AFFICHER` §Cas
              nominal et `US-INTERVENTION-MARQUER-FAITE` §Cas nominal). La
              maquette T4 titre sa modale « Clôturer l'intervention », ce que le
              titre ci-dessous reprend : deux surfaces, deux libellés, chacun
              tenu de sa source. */}
          Marquer comme faite
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {vue === "encaisse" ? (
          <PanneauEncaissement
            interventionId={interventionId}
            total={total}
            onRefus={() => {
              setVue("refuse");
            }}
            onTermine={() => {
              setOuvert(false);
            }}
          />
        ) : (
          <PanneauRefus
            interventionId={interventionId}
            onRetour={() => {
              setVue("encaisse");
            }}
            onTermine={() => {
              setOuvert(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/// Premier message de refus Zod, pour un champ donné puis pour la racine.
///
/// ⚠️ **Un accès direct ne compile pas sur une union discriminée.**
/// `validationErrors` prend alors la forme
/// `{ _errors } & ({ montant, methode } | { motif })`, et TypeScript refuse
/// `.montant` parce que la seconde branche ne le porte pas - ce qui est correct :
/// à la compilation, rien ne dit laquelle des deux le serveur a rejetée.
///
/// Le narrowing se fait donc à l'exécution, sur `unknown`, plutôt qu'en
/// dupliquant le composant par branche ou en cassant le typage de l'entrée. Le
/// contrat est celui de `zod` : chaque nœud porte un `_errors: string[]`.
function refusZod(erreurs: unknown, champ: string): string | null {
  const message = (noeud: unknown): string | null => {
    if (typeof noeud !== "object" || noeud === null) return null;

    const liste = (noeud as { _errors?: unknown })._errors;
    return Array.isArray(liste) && typeof liste[0] === "string"
      ? liste[0]
      : null;
  };

  if (typeof erreurs !== "object" || erreurs === null) return null;

  return (
    message((erreurs as Record<string, unknown>)[champ]) ?? message(erreurs)
  );
}

/// Le panneau nominal : montant, mode, encart d'irréversibilité.
function PanneauEncaissement({
  interventionId,
  total,
  onRefus,
  onTermine,
}: {
  interventionId: number;
  total: string;
  onRefus: () => void;
  onTermine: () => void;
}) {
  const [enCours, demarrer] = useTransition();
  const [montant, setMontant] = useState(total);
  const [methode, setMethode] = useState<MethodePaiement>("CB");
  /// L'instant affiché, gelé à l'ouverture du panneau. Cf. le commentaire du
  /// bloc de date plus bas : ce n'est PAS la valeur écrite en base.
  const [ouvertureLe] = useState(() => new Date());
  /// Refus **qui laissent la modale en place** : ceux de Zod et une panne
  /// serveur. Ni l'un ni l'autre ne mute quoi que ce soit, donc rien n'est
  /// revalidé et la modale reste ouverte sur la même intervention - une alerte
  /// à côté du champ est alors la bonne surface. Les refus **métier** partent en
  /// toast, cf. `confirmer`.
  const [erreur, setErreur] = useState<string | null>(null);
  const router = useRouter();

  function confirmer() {
    setErreur(null);
    demarrer(async () => {
      const resultat = await cloturerIntervention({
        issue: "encaisse",
        interventionId,
        montant,
        methode,
      });

      // `validationErrors` porte le refus de Zod - forme du montant, zéro,
      // dépassement de capacité. Le schéma est la seule source de ces bornes,
      // l'écran ne les redit pas.
      const refus = refusZod(resultat?.validationErrors, "montant");
      if (refus) {
        setErreur(refus);
        return;
      }

      if (resultat?.serverError) {
        setErreur(resultat.serverError);
        return;
      }

      const donnees = resultat?.data;

      // 🐛 **Aucune donnée reconnue ne vaut pas succès**, relevé par l'agent
      // testeur. La branche par défaut annonçait une clôture dès que ni Zod, ni
      // `serverError`, ni un refus métier n'avaient été reconnus - donc aussi
      // sur une réponse dont la forme aurait changé. Sur l'unique geste
      // irréversible du parcours, le défaut par défaut doit être le doute.
      if (!donnees) {
        setErreur("Réponse inattendue du serveur. Rechargez la page.");
        return;
      }

      if (!donnees.ok) {
        // Refus métier : le statut a changé sous les yeux du technicien, parce
        // qu'un autre onglet a clôturé ou que le client vient d'annuler. La
        // modale se ferme et l'écran se remet à jour - le laisser ouvert sur un
        // formulaire condamné inviterait à réessayer contre un état faux.
        onTermine();
        toast.error(donnees.message, { duration: 8_000 });
        router.refresh();
        return;
      }

      onTermine();
      // La maquette écrit « Intervention clôturée avec succès - Paiement 25 €
      // enregistré - Merci Marc L. ». Le remerciement au technicien par
      // lui-même n'est pas porté ; le montant, lui, l'est : c'est le seul
      // chiffre que le geste vient de figer.
      //
      // 🐛 **Le montant est NORMALISÉ avant d'être formaté**, relevé par l'agent
      // testeur. `formatPrixEuros` fait `Number(price)`, et le champ accepte
      // délibérément la virgule : « 85,10 » donnait `NaN`, donc « NaN € » sur le
      // seul retour que reçoit le technicien après un geste irréversible. La
      // base, elle, était juste - c'est l'écran qui mentait. `normaliserMontant`
      // vit dans un module pur, importable ici, et c'est sa raison d'être.
      // Le repli garde la saisie brute plutôt que d'afficher un vide : à ce
      // stade le serveur a accepté, donc la valeur EST normalisable.
      toast.success(
        `Intervention clôturée, ${formatPrixEuros(normaliserMontant(montant) ?? montant)} encaissés`,
      );
      router.refresh();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CheckCircle2 aria-hidden="true" className="size-5 text-primary" />
          Clôturer l&apos;intervention
        </DialogTitle>
        <DialogDescription>
          Enregistrez ce que vous avez encaissé sur place. Le paiement est
          déclaratif : aucun règlement en ligne n&apos;est possible.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-5">
        {/* Bloc « Montant à encaisser » de T4, en primary plein. Le montant y
            est un CHAMP et non un affichage : la maquette le fige à « 25 € »,
            alors que `US-PAIEMENT-ENREGISTRER` §Cas nominal le veut
            « modifiable ». */}
        <div className="flex flex-col gap-2 rounded-2xl bg-primary p-5 text-primary-foreground">
          <Label
            htmlFor="montant-encaisse"
            className="text-[0.6875rem] font-bold tracking-[0.08em] uppercase"
          >
            Montant à encaisser
          </Label>

          <div className="flex items-center gap-2">
            {/* `type="text"` avec `inputMode="decimal"` et non `type="number"` :
                sur un champ numérique, un navigateur en locale française rend
                une chaîne VIDE dès que la saisie porte une virgule, et le
                technicien perd ce qu'il vient de taper sans comprendre
                pourquoi. La forme est validée par le schéma, qui accepte les
                deux séparateurs. */}
            <Input
              id="montant-encaisse"
              name="montant"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={montant}
              onChange={(evenement) => {
                setMontant(evenement.target.value);
              }}
              aria-describedby={erreur ? "erreur-cloture" : undefined}
              aria-invalid={erreur ? true : undefined}
              className="h-auto border-0 bg-transparent p-0 font-heading text-4xl font-extrabold tracking-tighter text-tertiary-fixed shadow-none focus-visible:ring-0 md:text-4xl"
            />
            <span
              aria-hidden="true"
              className="font-heading text-4xl font-extrabold tracking-tighter text-tertiary-fixed"
            >
              €
            </span>
          </div>

          <p className="text-xs opacity-80">
            Préréglé sur le total de l&apos;intervention, forfait et produits
            compris.
          </p>
        </div>

        {/* 🔻 **La date d'encaissement est AFFICHÉE et pas saisissable**, case
            de la DoD qui manquait au premier jet (relevée par l'agent testeur).
            `US-PAIEMENT-ENREGISTRER` §Cas nominal liste « date-heure (préréglée
            à maintenant) » dans le formulaire, et ne qualifie de « modifiable »
            que le montant.

            ⚠️ **La valeur affichée est l'horloge du NAVIGATEUR, gelée à
            l'ouverture ; celle qui est écrite est datée serveur, dans la
            transaction.** Les deux diffèrent de la durée de la saisie, quelques
            secondes. C'est précisément pourquoi ce n'est pas un champ : une
            date reçue du client ouvrirait l'antidatage d'un encaissement, que
            Constitution §3.1 et l'absence d'US écartent toutes deux.

            Gelée par l'initialiseur de `useState` et non relue au rendu : sans
            ça l'heure avancerait à chaque frappe dans le champ du montant. Et
            aucune divergence d'hydratation à craindre - ce panneau ne se monte
            qu'au clic, bien après. */}
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarClock aria-hidden="true" className="size-4 shrink-0" />
          <span>
            Encaissement daté du{" "}
            <time dateTime={ouvertureLe.toISOString()}>
              {formatDateCourte(ouvertureLe)} à {formatHeure(ouvertureLe)}
            </time>
          </span>
        </p>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Mode de paiement</legend>

          {/* `RadioGroup` de Radix et non trois boutons : un groupe de radios
              se parcourt aux flèches, annonce sa position (« 1 sur 3 ») et n'en
              laisse cocher qu'un. Trois `<button aria-pressed>` réinventeraient
              tout ça de travers, ce que CLAUDE.md §Patterns composants
              proscrit. */}
          <RadioGroup
            value={methode}
            onValueChange={(valeur) => {
              setMethode(valeur as MethodePaiement);
            }}
            className="grid grid-cols-1 gap-2 sm:grid-cols-3"
          >
            {METHODES_PAIEMENT.map((valeur) => (
              <Label
                key={valeur}
                htmlFor={`methode-${valeur}`}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border p-4 text-sm font-medium",
                  methode === valeur
                    ? "border-primary bg-primary/5"
                    : "border-border",
                )}
              >
                <RadioGroupItem id={`methode-${valeur}`} value={valeur} />
                {LIBELLE_METHODE[valeur]}
              </Label>
            ))}
          </RadioGroup>
        </fieldset>

        {/* Encart « Action irréversible » de T4, en `tertiary-fixed` jaune.
            C'est lui qui nomme l'effet avant de l'engager, et c'est la moitié
            visible de la DoD sur l'irréversibilité. */}
        <p className="flex items-start gap-3 rounded-xl bg-tertiary-fixed/50 p-4 text-sm">
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          <span>
            <strong className="font-bold">Action irréversible.</strong>{" "}
            L&apos;intervention passera en « Terminée » et le paiement sera
            enregistré définitivement. Aucune modification n&apos;est possible
            ensuite.
          </span>
        </p>

        {erreur ? (
          <p
            id="erreur-cloture"
            role="alert"
            className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {erreur}
          </p>
        ) : null}

        {/* Le refus de paiement est un critère v1 de `US-PAIEMENT-ENREGISTRER`,
            pas une issue de secours : il est proposé ici, discrètement, parce
            que c'est le même geste de clôture dont le résultat diffère. */}
        <Button
          type="button"
          variant="link"
          disabled={enCours}
          onClick={onRefus}
          className="h-auto self-start p-0 text-sm text-muted-foreground"
        >
          <HandCoins aria-hidden="true" />
          Le client refuse le paiement
        </Button>
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={enCours}>
            Annuler
          </Button>
        </DialogClose>
        <Button type="button" disabled={enCours} onClick={confirmer}>
          {enCours ? "Clôture..." : "Confirmer la clôture"}
        </Button>
      </DialogFooter>
    </>
  );
}

/// Le panneau de refus - `US-PAIEMENT-ENREGISTRER` §Fallback client refuse de
/// payer.
///
/// ⚠️ **L'intervention passe à `CANCELLED`, pas à `DONE`**, et l'écran le dit
/// avant d'agir : le travail a eu lieu, mais le dossier ne peut pas se clore sur
/// un encaissement qui n'existe pas. Le technicien doit le savoir au moment de
/// choisir, pas le découvrir dans sa liste.
function PanneauRefus({
  interventionId,
  onRetour,
  onTermine,
}: {
  interventionId: number;
  onRetour: () => void;
  onTermine: () => void;
}) {
  const [enCours, demarrer] = useTransition();
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const router = useRouter();

  function confirmer() {
    setErreur(null);
    demarrer(async () => {
      const resultat = await cloturerIntervention({
        issue: "refuse",
        interventionId,
        motif,
      });

      const refus = refusZod(resultat?.validationErrors, "motif");
      if (refus) {
        setErreur(refus);
        return;
      }

      if (resultat?.serverError) {
        setErreur(resultat.serverError);
        return;
      }

      const donnees = resultat?.data;

      // Même défaut par défaut que sur l'encaissement : rien de reconnu ne vaut
      // pas succès.
      if (!donnees) {
        setErreur("Réponse inattendue du serveur. Rechargez la page.");
        return;
      }

      if (!donnees.ok) {
        onTermine();
        toast.error(donnees.message, { duration: 8_000 });
        router.refresh();
        return;
      }

      onTermine();
      toast.success("Intervention clôturée sans encaissement");
      router.refresh();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <HandCoins aria-hidden="true" className="size-5 text-destructive" />
          Clôturer sans encaissement
        </DialogTitle>
        <DialogDescription>
          Aucun paiement ne sera enregistré et l&apos;intervention passera en «
          Annulée ». Le motif que vous saisissez est visible par le client.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        {/* Obligatoire (`US-PAIEMENT-ENREGISTRER` §Fallback, « un motif
            obligatoire est saisi »). Pas de `required` HTML : la validation qui
            fait foi est celle du schéma, côté serveur, et un blocage natif du
            navigateur empêcherait de l'éprouver. */}
        <Label htmlFor="motif-refus">Motif du refus</Label>
        <Textarea
          id="motif-refus"
          name="motif"
          rows={3}
          maxLength={MOTIF_ANNULATION_MAX}
          value={motif}
          onChange={(evenement) => {
            setMotif(evenement.target.value);
          }}
          aria-describedby={erreur ? "erreur-refus" : undefined}
          aria-invalid={erreur ? true : undefined}
          placeholder="Client absent au moment du règlement, chèque refusé..."
        />

        {erreur ? (
          <p
            id="erreur-refus"
            role="alert"
            className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {erreur}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={enCours}
          onClick={onRetour}
        >
          Retour
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={enCours}
          onClick={confirmer}
        >
          {enCours ? "Clôture..." : "Clôturer sans encaissement"}
        </Button>
      </DialogFooter>
    </>
  );
}
