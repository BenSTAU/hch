"use client";

import { Bike, Pencil, Plus, X } from "lucide-react";
import { parseAsInteger, useQueryState } from "nuqs";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ComponentProps,
} from "react";
import { toast } from "sonner";

import { ajouterCycle } from "@/lib/actions/cycles/ajouter-cycle";
import { modifierCycle } from "@/lib/actions/cycles/modifier-cycle";
import type { CycleClient } from "@/lib/db/queries/cycles";
import { TYPES_CYCLE, type TypeCycle } from "@/lib/validations/cycles";
import {
  BadgeTypeCycle,
  ICONES_TYPE_CYCLE,
  LIBELLES_TYPE_CYCLE,
  estTypeCycle,
} from "@/components/features/cycles/badge-type-cycle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

/// Liste et formulaire - écran **C11**, `US-CYCLES-LISTER` + `US-CYCLE-AJOUTER`
/// + `US-CYCLE-MODIFIER`.
///
/// ── Un seul formulaire pour l'ajout et la modification
///
/// Les deux US décrivent les mêmes quatre champs et les mêmes trois refus. Deux
/// composants auraient laissé les bornes de saisie diverger, et c'est déjà le
/// motif du panneau unique de `interventions-vue.tsx`. Ce qui change est la
/// Server Action appelée et le libellé du bouton.
///
/// ── La sélection d'édition vit dans l'URL
///
/// `?cycle=<id>` via `nuqs`, comme `?intervention=<id>` de l'espace client.
/// L'ouverture du formulaire **vierge**, elle, reste locale : ce n'est pas un
/// état à partager, c'est un geste en cours.
///
/// ⚠️ Un identifiant inconnu **ne produit aucune erreur** : le panneau reste
/// fermé. `cycles.id` est un `SERIAL`, donc énumérable, et un message « cycle
/// introuvable » distinct du cas nominal confirmerait l'existence du vélo d'un
/// tiers à qui incrémente. Même régime que le panneau de détail des
/// interventions et que les trois Server Actions du domaine.
export function CyclesVue({ cycles }: { cycles: readonly CycleClient[] }) {
  const [selection, setSelection] = useQueryState("cycle", parseAsInteger);
  const [creation, setCreation] = useState(false);

  const enEdition = cycles.find((cycle) => cycle.id === selection) ?? null;
  const ouvert = enEdition !== null || creation;

  function fermer() {
    setCreation(false);
    void setSelection(null);
  }

  function ouvrirCreation() {
    void setSelection(null);
    setCreation(true);
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-heading text-lg font-bold">
            {/* Le compte est la seule des trois tuiles de KPI de la maquette
                qui repose sur une donnée existante. Il vit dans le titre plutôt
                que dans une dalle dédiée : une barre à une seule valeur n'est
                plus une barre. */}
            {cycles.length === 0
              ? "Aucun vélo enregistré"
              : `${String(cycles.length)} vélo${cycles.length > 1 ? "s" : ""} enregistré${cycles.length > 1 ? "s" : ""}`}
          </h2>

          {cycles.length > 0 ? (
            <Button type="button" onClick={ouvrirCreation}>
              <Plus aria-hidden="true" />
              Ajouter un vélo
            </Button>
          ) : null}
        </div>

        {cycles.length === 0 ? (
          <section className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
            {/* Libellé de `US-CYCLES-LISTER` §Cas nominal. Le CTA ouvre le
                formulaire au lieu de naviguer : l'ajout n'a pas de route à lui,
                il vit sur cet écran (`US-CYCLE-AJOUTER` §Cas nominal, « sur
                `US-CYCLES-LISTER` → Ajouter un cycle »). */}
            <p className="text-sm text-muted-foreground">
              Vous n&apos;avez pas encore ajouté de cycle
            </p>
            <Button type="button" onClick={ouvrirCreation}>
              <Plus aria-hidden="true" />
              Ajouter un cycle
            </Button>
          </section>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {cycles.map((cycle) => (
              <li key={cycle.id}>
                <CarteCycle
                  cycle={cycle}
                  courant={cycle.id === enEdition?.id}
                  onModifier={() => {
                    setCreation(false);
                    void setSelection(cycle.id);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {ouvert ? (
        <FormulaireCycle
          // Le remontage au changement de cible est ce qui réinitialise les
          // champs non contrôlés et le type retenu. Sans lui, ouvrir un second
          // vélo garderait la saisie du premier.
          key={enEdition ? `edition-${String(enEdition.id)}` : "creation"}
          cycle={enEdition}
          onTermine={fermer}
        />
      ) : null}
    </div>
  );
}

function CarteCycle({
  cycle,
  courant,
  onModifier,
}: {
  cycle: CycleClient;
  courant: boolean;
  onModifier: () => void;
}) {
  const Icone = estTypeCycle(cycle.type) ? ICONES_TYPE_CYCLE[cycle.type] : Bike;

  return (
    <article
      className={cn(
        "flex h-full flex-col gap-4 rounded-2xl border bg-card p-5 transition-colors",
        courant ? "border-primary" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-12 items-center justify-center rounded-xl bg-secondary text-primary">
          <Icone aria-hidden="true" className="size-6" />
        </span>
        <BadgeTypeCycle type={cycle.type} />
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="font-heading text-lg font-bold tracking-tighter">
          {cycle.brand}
          {cycle.model ? ` ${cycle.model}` : ""}
        </h3>
        {/* L'absence d'année se dit, elle ne se masque pas : le champ est
            facultatif, et une carte sans ligne laisserait croire à une donnée
            perdue. */}
        <p className="text-sm text-muted-foreground">
          {cycle.year === null
            ? "Année d'achat non renseignée"
            : `Année d'achat : ${String(cycle.year)}`}
        </p>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-auto self-start"
        // Le nom accessible porte le vélo : dans une grille, six boutons
        // « Modifier » ne se distinguent pas à la tabulation.
        aria-label={`Modifier ${cycle.brand}${cycle.model ? ` ${cycle.model}` : ""}`}
        onClick={onModifier}
      >
        <Pencil aria-hidden="true" />
        Modifier
      </Button>
    </article>
  );
}

/// Premier message de refus Zod pour un champ, puis pour la racine.
///
/// Le narrowing se fait à l'exécution sur `unknown` : les deux actions n'ont pas
/// la même forme de `validationErrors` (`modifierCycle` porte `cycleId` en
/// plus), et un accès direct obligerait à dupliquer la lecture par branche. Le
/// contrat est celui de `zod` : chaque nœud porte un `_errors: string[]`. Même
/// helper que `modale-cloture.tsx`.
function premierRefus(erreurs: unknown, champ: string): string | null {
  const message = (noeud: unknown): string | null => {
    if (typeof noeud !== "object" || noeud === null) return null;

    const liste = (noeud as { _errors?: unknown })._errors;
    return Array.isArray(liste) && typeof liste[0] === "string"
      ? liste[0]
      : null;
  };

  if (typeof erreurs !== "object" || erreurs === null) return null;

  return message((erreurs as Record<string, unknown>)[champ]);
}

function messageRacine(erreurs: unknown): string | null {
  if (typeof erreurs !== "object" || erreurs === null) return null;

  const liste = (erreurs as { _errors?: unknown })._errors;
  return Array.isArray(liste) && typeof liste[0] === "string" ? liste[0] : null;
}

const CHAMPS_SUIVIS = ["brand", "model", "type", "year"] as const;

type ChampSuivi = (typeof CHAMPS_SUIVIS)[number];

function FormulaireCycle({
  cycle,
  onTermine,
}: {
  cycle: CycleClient | null;
  onTermine: () => void;
}) {
  const [enCours, demarrer] = useTransition();
  const [type, setType] = useState<TypeCycle>(
    cycle !== null && estTypeCycle(cycle.type) ? cycle.type : "CLASSIC",
  );
  const [refus, setRefus] = useState<Partial<Record<ChampSuivi, string>>>({});
  const [refusGlobal, setRefusGlobal] = useState<string | null>(null);
  const alerteRef = useRef<HTMLParagraphElement>(null);

  // Le focus rejoint le message de refus, comme le font déjà le formulaire de
  // connexion et celui des paramètres. Sans ça, une soumission refusée ne bouge
  // rien sous le curseur de qui navigue au clavier.
  useEffect(() => {
    if (refusGlobal) alerteRef.current?.focus();
  }, [refusGlobal]);

  const edition = cycle !== null;
  const titre = edition ? "Modifier le vélo" : "Nouveau vélo";

  function soumettre(donnees: FormData) {
    setRefus({});
    setRefusGlobal(null);

    const brand = String(donnees.get("brand") ?? "");
    const model = String(donnees.get("model") ?? "");
    const anneeSaisie = String(donnees.get("year") ?? "").trim();

    const charge = {
      brand,
      model,
      type,
      // Champ facultatif : vide devient `null`, pas `0`. `Number("")` vaut zéro,
      // ce qui aurait fait refuser une saisie légitimement absente au motif
      // qu'elle est antérieure à 1900.
      year: anneeSaisie === "" ? null : Number(anneeSaisie),
    };

    demarrer(async () => {
      const resultat = edition
        ? await modifierCycle({ ...charge, cycleId: cycle.id })
        : await ajouterCycle(charge);

      const erreursZod = resultat?.validationErrors;
      if (erreursZod) {
        const parChamp: Partial<Record<ChampSuivi, string>> = {};
        for (const champ of CHAMPS_SUIVIS) {
          const message = premierRefus(erreursZod, champ);
          if (message) parChamp[champ] = message;
        }

        setRefus(parChamp);
        // Un refus de champ est annoncé par le champ lui-même ; l'alerte de tête
        // ne redit pas les quatre messages, elle dit qu'il y en a.
        setRefusGlobal(
          messageRacine(erreursZod) ??
            "Vérifiez les champs signalés du formulaire.",
        );
        return;
      }

      if (resultat?.serverError) {
        setRefusGlobal(resultat.serverError);
        return;
      }

      const retour = resultat?.data;
      if (retour && !retour.ok) {
        // Refus métier : le vélo n'est plus atteignable (inconnu, ou plus au
        // client). Le toast plutôt qu'une alerte locale, parce que la liste
        // vient d'être revalidée et que ce panneau se referme.
        onTermine();
        toast.error(retour.message);
        return;
      }

      if (retour?.ok) {
        onTermine();
        toast.success(
          edition
            ? "Cycle mis à jour"
            : // Libellé de `US-CYCLE-AJOUTER` §Cas nominal, « Cycle <marque>
              // [<modèle>] ajouté ». Le modèle est facultatif, donc absent du
              // message quand il l'est.
              `Cycle ${retour.cycle.brand}${retour.cycle.model ? ` ${retour.cycle.model}` : ""} ajouté`,
        );
      }
    });
  }

  return (
    <section
      aria-labelledby="formulaire-cycle"
      className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-6"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="formulaire-cycle" className="font-heading text-lg font-bold">
          {titre}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Fermer le formulaire"
          onClick={onTermine}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>

      {/* `onSubmit` et non `action={fn}` : React 19 **réinitialise** un
          formulaire non contrôlé quand son action est une fonction, et un refus
          de validation effacerait alors la saisie qu'il demande de corriger.
          Même construction que `settings-form.tsx`. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          soumettre(new FormData(event.currentTarget));
        }}
        className="flex flex-col gap-5"
      >
        {/* La région reste DANS LE FLUX même vide : une région live révélée en
            même temps que son contenu n'est pas annoncée de façon fiable par
            tous les couples lecteur/navigateur. Leçon T-J0-05. */}
        <p
          ref={alerteRef}
          role="alert"
          tabIndex={-1}
          className="text-sm text-destructive"
        >
          {refusGlobal}
        </p>

        <Champ
          nom="brand"
          libelle="Marque"
          obligatoire
          defaut={cycle?.brand ?? ""}
          refus={refus.brand}
          autoComplete="off"
          maxLength={100}
        />

        <Champ
          nom="model"
          libelle="Modèle"
          defaut={cycle?.model ?? ""}
          refus={refus.model}
          autoComplete="off"
          maxLength={100}
          placeholder="Ex : Elops 900"
        />

        <fieldset className="flex flex-col gap-2">
          <legend id="type-cycle-legende" className="mb-2 text-sm font-medium">
            Type de vélo
            <span aria-hidden="true"> *</span>
          </legend>

          {/* Trois tuiles côte à côte sont sémantiquement un groupe de boutons
              radio, pas une liste déroulante : la navigation par flèches et
              l'annonce « 2 sur 3 » viennent sans code (RGAA 7.1). Même motif
              que les dalles de forfait du tunnel, `etape-forfait.tsx`.

              🐛 **`aria-labelledby` sur le groupe, en plus de la `<legend>`.**
              Le groupe était anonyme : mesuré par l'agent testeur, son nom
              accessible rendait la chaîne vide. Le `<fieldset>` groupe bien, et
              axe ne signale rien, mais le conteneur le plus proche des boutons
              radio est le `role="radiogroup"` - c'est lui qu'un lecteur d'écran
              annonce en y entrant. Les deux autres groupes du dépôt le posent,
              dont celui du bloc de rattachement de cette PR. */}
          <RadioGroup
            aria-labelledby="type-cycle-legende"
            value={type}
            onValueChange={(valeur) => {
              if (estTypeCycle(valeur)) setType(valeur);
            }}
            className="grid grid-cols-3 gap-2"
          >
            {TYPES_CYCLE.map((valeur) => {
              const id = `type-${valeur}`;
              const Icone = ICONES_TYPE_CYCLE[valeur];

              return (
                <Label
                  key={valeur}
                  htmlFor={id}
                  className={cn(
                    "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-transparent bg-secondary/60 p-3 text-center transition-colors",
                    "hover:bg-secondary",
                    "has-[[aria-checked=true]]:border-primary has-[[aria-checked=true]]:bg-primary-fixed/30 has-[[aria-checked=true]]:text-primary",
                    "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                  )}
                >
                  {/* `aria-labelledby` et non le seul `<label for>` : Chrome ne
                      calcule aucun nom accessible pour un `<button role="radio">`
                      étiqueté par un `<label for>`, constaté au navigateur sur
                      C2. */}
                  <RadioGroupItem
                    id={id}
                    value={valeur}
                    aria-labelledby={`${id}-libelle`}
                    className="sr-only"
                  />
                  <Icone aria-hidden="true" className="size-5" />
                  <span id={`${id}-libelle`} className="text-xs font-bold">
                    {LIBELLES_TYPE_CYCLE[valeur]}
                  </span>
                </Label>
              );
            })}
          </RadioGroup>

          {refus.type ? (
            <p className="text-sm text-destructive">{refus.type}</p>
          ) : null}
        </fieldset>

        <Champ
          nom="year"
          libelle="Année d'achat"
          defaut={
            cycle?.year === null || cycle === null ? "" : String(cycle.year)
          }
          refus={refus.year}
          type="number"
          inputMode="numeric"
          placeholder="2023"
        />

        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={enCours}
            onClick={onTermine}
          >
            Annuler
          </Button>
          <Button type="submit" disabled={enCours}>
            {edition ? "Enregistrer" : "Ajouter"}
          </Button>
        </div>
      </form>
    </section>
  );
}

/// Un champ texte et son refus, liés par `aria-describedby`.
///
/// `aria-invalid` porte l'état, pas la couleur : sans lui, un lecteur d'écran
/// n'annonce pas que le champ est en erreur au moment où le focus y revient.
function Champ({
  nom,
  libelle,
  obligatoire = false,
  defaut,
  refus,
  ...props
}: {
  nom: string;
  libelle: string;
  obligatoire?: boolean;
  defaut: string;
  refus: string | undefined;
} & ComponentProps<typeof Input>) {
  const idRefus = `${nom}-refus`;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={nom}>
        {libelle}
        {obligatoire ? <span aria-hidden="true"> *</span> : null}
      </Label>
      <Input
        id={nom}
        name={nom}
        defaultValue={defaut}
        // `required` est un confort de saisie, pas une garde : la validation qui
        // compte est celle de Zod, côté serveur. Un attribut HTML se contourne.
        required={obligatoire}
        aria-invalid={refus ? true : undefined}
        aria-describedby={refus ? idRefus : undefined}
        {...props}
      />
      {refus ? (
        <p id={idRefus} className="text-sm text-destructive">
          {refus}
        </p>
      ) : null}
    </div>
  );
}
