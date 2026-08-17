"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  rechercherSuggestions,
  type SuggestionAdresse,
  type SuggestionBan,
} from "@/lib/geo/ban";
import { cn } from "@/lib/utils";

/// Saisie d'adresse assistée par la BAN.
///
/// L'appel part **du navigateur** : c'est le seul moyen de suggérer à la frappe
/// sans faire transiter chaque caractère par un aller-retour serveur. Le point
/// retenu n'engage rien pour autant — la Server Action re-géocode le libellé
/// choisi avant de décider quoi que ce soit.
///
/// La carte de la maquette C3 **n'est pas portée** : ADR-015 v2 l'a retirée du
/// parcours client, et son retrait sort toute clé Google du tunnel.
///
/// **Deux natures d'entrées dans la liste**. Une
/// adresse précise se retient. Une rue, une place ou une commune ne se retient
/// pas - elle **relance la recherche** sur son libellé, sans quoi « place
/// Bellecour » ne rendrait aucune suggestion, ce qu'un visiteur lit comme une
/// panne. Le filtre `housenumber` n'est pas relâché, il se déplace de
/// l'affichage vers la sélection, et le serveur le rejoue au géocodage.
///
/// Le motif ARIA est celui du combobox 1.2 (`aria-expanded`,
/// `aria-activedescendant`, `role="listbox"`). Il est écrit à la main parce que
/// Radix n'expose pas de combobox et que le `Combobox` de shadcn est bâti sur
/// `cmdk`, pensé pour filtrer une liste locale — pas pour des suggestions
/// distantes asynchrones. Aucun paquet n'entre pour ce composant.

/// La BAN ne répond rien d'utile en deçà de trois caractères, et interroger dès
/// la première frappe ferait trois requêtes jetées sur quatre.
const LONGUEUR_MINIMALE = 3;

/// Assez long pour qu'une frappe fluide ne déclenche qu'un appel, assez court
/// pour que la liste paraisse suivre la saisie.
const DELAI_DEBOUNCE_MS = 300;

type EtatRecherche = "inactif" | "chargement" | "resultats" | "vide" | "erreur";

/// Le résultat porte **la requête à laquelle il répond**. La comparer à la
/// saisie courante suffit à savoir si l'affichage est à jour ou en retard d'une
/// frappe — ce qui évite de recopier dans un état ce que le rendu sait déduire,
/// et donc d'appeler `setState` depuis le corps d'un effet.
type ResultatRecherche = {
  requete: string;
  etat: EtatRecherche;
  suggestions: SuggestionBan[];
};

type AddressAutocompleteProps = {
  /// Libellé du champ. Explicite et non un `placeholder` : un placeholder
  /// disparaît à la saisie et n'est pas un nom accessible (RGAA 11.1).
  label?: string;
  /// Valeur initiale du champ — une adresse déjà choisie qu'on revient éditer.
  defaultValue?: string;
  /// Remonte la suggestion choisie. Le parent décide quoi en faire : vérifier
  /// la couverture (tunnel) ou l'enregistrer au profil (fiche client).
  onSelectionner: (suggestion: SuggestionAdresse) => void;
  /// Appelé dès que l'utilisateur reprend sa saisie — un refus affiché sous un
  /// champ qu'on est en train de corriger devient faux avant d'être lu.
  onReinitialiser?: () => void;
};

export function AddressAutocomplete({
  label = "Adresse d'intervention",
  defaultValue = "",
  onSelectionner,
  onReinitialiser,
}: AddressAutocompleteProps) {
  const [saisie, setSaisie] = useState(defaultValue);
  /// Ce que l'utilisateur a validé. Tant que la saisie en diverge, aucune
  /// adresse n'est choisie — c'est ce qui empêche de soumettre un texte tapé à
  /// la main qui ressemblerait à une adresse sans en être une.
  const [libelleChoisi, setLibelleChoisi] = useState(defaultValue);
  const [ferme, setFerme] = useState(false);
  const [indexActif, setIndexActif] = useState(-1);
  /// Voie retenue comme piste de raffinement. Sert à deux choses et à rien
  /// d'autre : replacer le curseur devant la voie, et dire quoi taper.
  const [piste, setPiste] = useState<string | null>(null);
  const [resultat, setResultat] = useState<ResultatRecherche>({
    requete: "",
    etat: "inactif",
    suggestions: [],
  });

  const champRef = useRef<HTMLInputElement>(null);
  const idChamp = useId();
  const idListe = useId();
  const idStatut = useId();

  const requete = saisie.trim();

  // Le libellé validé n'est pas réinterrogé : rouvrir la liste sur ce qu'on
  // vient de choisir proposerait de sélectionner à nouveau la même adresse.
  const recherchable =
    requete.length >= LONGUEUR_MINIMALE && requete !== libelleChoisi;

  const aJour = resultat.requete === requete;

  // Tout ce qui suit se déduit du rendu. Le stocker doublerait la source de
  // vérité et ferait réapparaître le `setState` dans l'effet.
  const etat: EtatRecherche = !recherchable
    ? "inactif"
    : aJour
      ? resultat.etat
      : "chargement";
  const suggestions = recherchable && aJour ? resultat.suggestions : [];
  const ouvert = !ferme && etat === "resultats" && suggestions.length > 0;

  // Synchronisation avec un système extérieur — la BAN — déclenchée par la
  // frappe, pas un chargement initial. C'est l'usage légitime de `useEffect`,
  // à ne pas confondre avec le fetch de rendu que les conventions proscrivent.
  useEffect(() => {
    if (!recherchable) return;

    const abandon = new AbortController();

    const minuterie = setTimeout(() => {
      void rechercherSuggestions(requete, { signal: abandon.signal }).then(
        (reponse) => {
          if (abandon.signal.aborted) return;

          setResultat(
            reponse.ok
              ? {
                  requete,
                  etat: reponse.data.length === 0 ? "vide" : "resultats",
                  suggestions: reponse.data,
                }
              : { requete, etat: "erreur", suggestions: [] },
          );
          setIndexActif(-1);
        },
      );
    }, DELAI_DEBOUNCE_MS);

    // Une frappe rend obsolète la requête précédente. Sans cet abandon, deux
    // réponses peuvent revenir dans le désordre et la liste afficherait les
    // suggestions d'une saisie antérieure. Couvre aussi le démontage.
    return () => {
      clearTimeout(minuterie);
      abandon.abort();
    };
  }, [requete, recherchable]);

  function choisir(suggestion: SuggestionBan) {
    if (!suggestion.precise) {
      // Piste de raffinement : on repart en recherche sur ce libellé au lieu de
      // retenir quoi que ce soit.
      //
      // Le numéro s'écrit DEVANT la voie, et c'est ce qui décide de la suite :
      // vérifié au navigateur contre la vraie BAN, interroger « Place Bellecour
      // 69002 Lyon » ne rend que la voie, quand « 12 Place Bellecour… » rend
      // l'adresse. Le curseur est donc replacé au début, et l'aide dit quoi
      // taper - sans ça la piste est un cul-de-sac élégant.
      setSaisie(suggestion.label);
      setLibelleChoisi("");
      setFerme(false);
      setIndexActif(-1);
      setPiste(suggestion.label);
      onReinitialiser?.();
      return;
    }

    setPiste(null);

    setSaisie(suggestion.adresse.label);
    setLibelleChoisi(suggestion.adresse.label);
    setFerme(true);
    setIndexActif(-1);
    onSelectionner(suggestion.adresse);
  }

  // Action impérative sur le DOM, pas une synchronisation d'état : on remet le
  // curseur là où l'utilisateur doit écrire. Aucun `setState` ici, donc aucun
  // rendu en cascade.
  useEffect(() => {
    if (piste === null) return;
    const champ = champRef.current;
    if (!champ) return;
    champ.focus();
    champ.setSelectionRange(0, 0);
  }, [piste]);

  function auClavier(evenement: React.KeyboardEvent<HTMLInputElement>) {
    if (evenement.key === "Escape") {
      setFerme(true);
      setIndexActif(-1);
      return;
    }

    if (!ouvert) return;

    if (evenement.key === "ArrowDown" || evenement.key === "ArrowUp") {
      // `preventDefault` sinon la flèche déplace le curseur dans le champ en
      // même temps qu'elle change d'option.
      evenement.preventDefault();
      const pas = evenement.key === "ArrowDown" ? 1 : -1;
      const total = suggestions.length;
      setIndexActif((precedent) => (precedent + pas + total) % total);
      return;
    }

    if (evenement.key === "Enter") {
      const suggestion = suggestions[indexActif];
      if (!suggestion) return;
      // Empêche la soumission du formulaire englobant : la touche sert ici à
      // choisir une option, pas à valider l'étape.
      evenement.preventDefault();
      choisir(suggestion);
    }
  }

  const idOptionActive =
    indexActif >= 0 && indexActif < suggestions.length
      ? `${idListe}-option-${String(indexActif)}`
      : undefined;

  return (
    <div className="relative flex flex-col gap-2">
      <Label htmlFor={idChamp}>{label}</Label>

      <Input
        ref={champRef}
        id={idChamp}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={ouvert}
        aria-controls={idListe}
        aria-autocomplete="list"
        aria-describedby={idStatut}
        {...(idOptionActive ? { "aria-activedescendant": idOptionActive } : {})}
        value={saisie}
        onChange={(evenement) => {
          setSaisie(evenement.target.value);
          setFerme(false);
          setIndexActif(-1);
          // Reprendre la saisie invalide le choix précédent : sans ça, un
          // libellé modifié à la main resterait associé au point d'avant.
          if (libelleChoisi !== "") setLibelleChoisi("");
          // L'aide au numéro disparaît dès que la saisie reprend : elle a servi.
          if (piste !== null) setPiste(null);
          onReinitialiser?.();
        }}
        onKeyDown={auClavier}
        onBlur={() => {
          setFerme(true);
        }}
      />

      {/* Zone d'état annoncée par les lecteurs d'écran. `polite` : elle ne doit
          pas interrompre la frappe. */}
      <p
        id={idStatut}
        role="status"
        aria-live="polite"
        className={cn(
          "text-sm",
          etat === "erreur" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {etat === "chargement" && "Recherche d'adresses…"}
        {etat === "resultats" &&
          piste !== null &&
          `Ajoutez le numéro devant la voie, par exemple « 1 ${piste} ».`}
        {etat === "resultats" &&
          piste === null &&
          `${String(suggestions.length)} proposition${suggestions.length > 1 ? "s" : ""}. Seule une adresse numérotée peut être retenue.`}
        {etat === "vide" &&
          "Aucune adresse trouvée, précisez le numéro et la voie."}
        {etat === "erreur" &&
          "Service de géolocalisation temporairement indisponible, réessayez."}
      </p>

      {/* Le conteneur reste dans le DOM même fermé : `aria-controls` doit
          pointer sur un élément existant. Ses OPTIONS, elles, ne sont rendues
          que liste ouverte — les masquer par une classe les laisserait dans
          l'arbre d'accessibilité dès que la feuille de style manque, et un
          lecteur d'écran annoncerait des choix inatteignables. */}
      <ul
        id={idListe}
        role="listbox"
        aria-label="Suggestions d'adresses"
        className={cn(
          "absolute top-full right-0 left-0 z-10 mt-1 overflow-hidden rounded-xl border bg-background shadow-lg",
          ouvert ? "block" : "hidden",
        )}
      >
        {(ouvert ? suggestions : []).map((suggestion, index) => {
          const libelle = suggestion.precise
            ? suggestion.adresse.label
            : suggestion.label;

          return (
            <li
              key={
                suggestion.precise
                  ? `${libelle}-${String(suggestion.adresse.lon)}-${String(suggestion.adresse.lat)}`
                  : `voie-${libelle}`
              }
              id={`${idListe}-option-${String(index)}`}
              role="option"
              aria-selected={index === indexActif}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm",
                index === indexActif && "bg-accent text-accent-foreground",
              )}
              // `onMouseDown` et non `onClick` : le `blur` du champ précède le
              // clic et refermerait la liste avant que l'option soit choisie.
              onMouseDown={(evenement) => {
                evenement.preventDefault();
                choisir(suggestion);
              }}
              onMouseEnter={() => {
                setIndexActif(index);
              }}
            >
              <span
                className={cn(!suggestion.precise && "text-muted-foreground")}
              >
                {libelle}
              </span>
              {/* Dans le libellé de l'option, et non à côté : c'est ce que le
                  lecteur d'écran annonce, et c'est là que se joue la
                  différence entre une adresse et une piste. */}
              {suggestion.precise ? null : (
                <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold tracking-[0.05em] text-muted-foreground">
                  Préciser le numéro
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
