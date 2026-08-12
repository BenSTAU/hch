// La carte de la tournee - colonne droite de l'ecran **T1**.
//
// ⚠️ **Ajout de l'agent testeur, 2026-08-12. Ce module n'avait AUCUN test**, et
// il n'a jamais ete execute : aucune cle `HCH_MAPS_API_KEY` n'existe sur le
// poste ni sur les deux piles, donc `montrable` est faux partout et le composant
// rend `null`. Le seul oracle existant (`tournee-vue.test.tsx`, « ne monte pas la
// carte sans cle Maps ») eprouve exactement le chemin ou ce fichier ne fait rien.
//
// Ce que ces tests couvrent, et qui n'avait aucune surface :
//
//   · **la garde de pin** de la DoD case 11 - une adresse sans point ne produit
//     pas de marqueur, et son intervention reste dans la liste ;
//   · **le chargement unique** du script, propriete que le module s'attribue en
//     toutes lettres ;
//   · **la stabilite au rafraichissement** de 30 s, motif de la `signature` ;
//   · **le demontage** pendant le chargement ;
//   · **la reprise apres un echec de script**, que le commentaire du module
//     declare « rejouable » ;
//   · **RGAA A** sur la region de la carte.
//
// ── Le double de `google.maps`, et ce qu'il modelise
//
// L'API n'est pas installable en test : elle arrive par un `<script>` distant
// que jsdom ne charge pas. Le double ci-dessous ne simule pas Google Maps, il en
// reproduit les trois faits observables dont le composant depend - l'API n'est
// utilisable QU'APRES avoir appele le rappel nomme dans l'URL,
// `new google.maps.Map` prend le noeud et des options, et l'API **injecte ses
// propres commandes focusables dans le conteneur** (zoom, plein ecran, logo).
// Ce dernier point n'est pas une hypothese de confort : c'est le comportement
// par defaut documente de l'API.
//
// ⚠️ Le double **injecte sa commande sans lire les options**, et c'est
// delibere : un double qui obeirait a `zoomControl` ne prouverait plus rien de
// ce que le composant fait des commandes qu'il ne controle pas.
//
// ── Trois constats corriges depuis l'ecriture de ce fichier
//
// B1 (reprise apres echec de script) et B2 (`aria-hidden-focus`) etaient rouges
// a l'ecriture, verts depuis le correctif de T-V2-01. Puis le 2026-08-12, cle
// renseignee, la premiere execution reelle a donne `google.maps.Map is not a
// constructor` : le harnais lui-meme tenait `load` pour le signal de
// disponibilite de l'API, donc il modelisait la premisse du bug. Corrige dans
// `declencher()`, qui porte la justification. **Dix-sept tests verts contre un
// double faux** - c'est la lecon du fichier.
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InterventionTournee } from "@/lib/db/queries/interventions";

const ID_SCRIPT = "google-maps-js";
const CLE = "cle-de-test";

type Position = { lat: number; lng: number };

const cartes: { noeud: HTMLElement; options: Record<string, unknown> }[] = [];
const marqueurs: { position: Position; label: string; title: string }[] = [];
const etendus: Position[] = [];
const fitBoundsSpy = vi.fn();
const setZoomSpy = vi.fn();
const ecouteursIdle: (() => void)[] = [];

/// Quand il est vrai, la fausse carte injecte une commande focusable dans le
/// conteneur, comme le fait l'API reelle avec ses boutons de zoom.
let injecteSesCommandes = false;

function installerGoogle() {
  class FausseCarte {
    constructor(noeud: HTMLElement, options: Record<string, unknown>) {
      cartes.push({ noeud, options });
      if (injecteSesCommandes) {
        const zoom = document.createElement("button");
        zoom.type = "button";
        zoom.setAttribute("aria-label", "Zoom avant");
        noeud.append(zoom);
      }
    }
    fitBounds = fitBoundsSpy;
    setZoom = setZoomSpy;
  }

  class FaussesBornes {
    extend(position: Position) {
      etendus.push(position);
    }
  }

  class FauxMarqueur {
    constructor(options: { position: Position; label: string; title: string }) {
      marqueurs.push({
        position: options.position,
        label: options.label,
        title: options.title,
      });
    }
  }

  Object.defineProperty(globalThis, "google", {
    configurable: true,
    writable: true,
    value: {
      maps: {
        Map: FausseCarte,
        LatLngBounds: FaussesBornes,
        Marker: FauxMarqueur,
        event: {
          addListenerOnce: (
            _carte: unknown,
            _nom: string,
            rappel: () => void,
          ) => ecouteursIdle.push(rappel),
        },
      },
    },
  });
}

function desinstallerGoogle() {
  Reflect.deleteProperty(globalThis, "google");
}

/// Recharge le module a chaque test : `chargement` est une promesse de PORTEE
/// MODULE, partagee entre les montages. Sans reinitialisation, le second test du
/// fichier hériterait de la promesse deja resolue du premier.
async function chargerComposant() {
  vi.resetModules();
  // `module` comme nom de variable est interdit par `@next/next/
  // no-assign-module-variable`.
  const frais = await import("./carte-tournee");
  return frais.CarteTournee;
}

function balise(): HTMLScriptElement | null {
  return document.getElementById(ID_SCRIPT) as HTMLScriptElement | null;
}

/// Nom du rappel que le module passe en parametre d'URL, lu DEPUIS l'URL.
///
/// Lu et non code en dur : c'est ce qui fait echouer le test si le module
/// cessait de passer `callback=`, ou s'il changeait de nom sans changer le
/// global qu'il installe.
function nomDuRappel(): string {
  const source = balise()?.src ?? "";
  const nom = new URL(source, "https://exemple.test").searchParams.get(
    "callback",
  );
  expect(nom).toBeTruthy();
  return nom ?? "";
}

/// Rejoue ce que fait l'API distante que jsdom ne charge jamais.
///
/// 🐛 **Ce harnais modelisait la premisse du bug, et c'est LUI qui l'a laisse
/// passer.** Il installait le global `google` puis emettait l'evenement `load`
/// du `<script>`, donc il tenait `load` pour le signal de disponibilite de
/// l'API - exactement l'hypothese fausse du module. Les dix-sept tests etaient
/// verts contre un double qui reproduisait l'erreur, et la premiere execution
/// reelle a donne `google.maps.Map is not a constructor` (2026-08-12, des la
/// cle renseignee).
///
/// La sequence reelle est celle-ci : l'API monte ses classes, PUIS appelle le
/// rappel nomme dans l'URL. `load` peut se produire entre les deux et ne dit
/// rien. Le double l'emet donc toujours - pour rester fidele - mais ce n'est
/// plus lui qui rend la main.
///
/// Regle du test rouge, cas « test lui-meme fautif » : l'oracle dependait d'un
/// contrat que l'API ne tient pas.
async function declencher(evenement: "load" | "error") {
  const script = balise();
  expect(script).not.toBeNull();

  if (evenement === "load") {
    const nom = nomDuRappel();
    // L'API installe ses classes AVANT de notifier. Inverser rendrait vert un
    // composant qui lirait `google` trop tot - ce qui est precisement le
    // defaut qu'on vient de payer.
    installerGoogle();
    // `load` d'abord, rappel ensuite : dans cet ordre, un module qui se
    // fierait a l'evenement construirait sa carte trop tot et le test
    // suivant le verrait.
    script?.dispatchEvent(new Event("load"));
    const rappel = (globalThis as unknown as Record<string, unknown>)[nom];
    expect(typeof rappel).toBe("function");
    (rappel as () => void)();
  } else {
    script?.dispatchEvent(new Event("error"));
  }

  // Une micro-tache pour laisser la promesse de chargement se resoudre et le
  // `.then` construire la carte.
  await waitFor(() => {
    expect(true).toBe(true);
  });
}

function intervention(
  surcharge: Partial<InterventionTournee> = {},
): InterventionTournee {
  return {
    id: 1,
    status: "PLANNED",
    appointmentAt: "2026-08-13T08:00:00.000Z",
    durationSnapshot: 60,
    forfait: "Révision complète",
    client: { nom: "Sophie Dumas", telephone: "+33612345678" },
    adresse: {
      street: "12 rue de la République",
      zipCode: "69002",
      city: "Lyon",
    },
    point: { lon: 4.8357, lat: 45.764 },
    produits: [],
    ...surcharge,
  };
}

beforeEach(() => {
  cartes.length = 0;
  marqueurs.length = 0;
  etendus.length = 0;
  ecouteursIdle.length = 0;
  injecteSesCommandes = false;
  fitBoundsSpy.mockClear();
  setZoomSpy.mockClear();
  desinstallerGoogle();
  oublierRappel();
  balise()?.remove();
});

afterEach(() => {
  desinstallerGoogle();
  oublierRappel();
  balise()?.remove();
});

/// Le module pose son rappel sur `window` et l'y retire lui-meme. Un reliquat
/// resoudrait la promesse du test SUIVANT sans qu'aucun script n'ait charge.
function oublierRappel() {
  Reflect.deleteProperty(globalThis, "__hchMapsPret");
}

describe("CarteTournee - les trois raisons de ne rien monter", () => {
  it("ne rend rien, et n'injecte aucun script, sans cle Maps", async () => {
    const CarteTournee = await chargerComposant();

    const { container } = render(
      <CarteTournee interventions={[intervention()]} mapsApiKey={null} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(balise()).toBeNull();
  });

  it("ne rend rien quand AUCUNE intervention n'a de point", async () => {
    // Garde de pin, DoD case 11. `addresses.location` est NULLable depuis la
    // migration 015 et la pseudonymisation le remet a NULL : une tournee entiere
    // de clients effaces ne doit pas ouvrir une carte vide centree au large du
    // golfe de Guinee.
    const CarteTournee = await chargerComposant();

    const { container } = render(
      <CarteTournee
        interventions={[
          intervention({ id: 1, point: null }),
          intervention({ id: 2, point: null }),
        ]}
        mapsApiKey={CLE}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(balise()).toBeNull();
  });

  it("n'injecte le script qu'UNE FOIS pour deux montages successifs", async () => {
    // Le module s'attribue la propriete : « Deux injections donneraient
    // l'avertissement "You have included the Google Maps JavaScript API multiple
    // times" ». Deux `<script>` de meme `id` seraient aussi un document invalide.
    const CarteTournee = await chargerComposant();

    const premier = render(
      <CarteTournee interventions={[intervention()]} mapsApiKey={CLE} />,
    );
    await declencher("load");
    premier.unmount();

    render(<CarteTournee interventions={[intervention()]} mapsApiKey={CLE} />);

    expect(document.querySelectorAll(`#${ID_SCRIPT}`)).toHaveLength(1);
  });

  it("passe la cle ENCODEE dans l'URL du script", async () => {
    const CarteTournee = await chargerComposant();

    render(
      <CarteTournee
        interventions={[intervention()]}
        mapsApiKey="cle avec espace&x=1"
      />,
    );

    expect(balise()?.src).toContain(
      `key=${encodeURIComponent("cle avec espace&x=1")}`,
    );
  });
});

describe("CarteTournee - les pins", () => {
  it("ne pose de marqueur QUE sur les interventions qui portent un point", async () => {
    // ⚠️ La garde de pin de la DoD case 11, au niveau du marqueur cette fois. Une
    // intervention sans point ne disparait pas de la tournee - elle reste dans la
    // liste avec son adresse ecrite - mais elle ne produit pas de pin a (0, 0).
    const CarteTournee = await chargerComposant();

    render(
      <CarteTournee
        interventions={[
          intervention({ id: 1, point: { lon: 4.83, lat: 45.76 } }),
          intervention({ id: 2, point: null }),
          intervention({ id: 3, point: { lon: 4.85, lat: 45.75 } }),
        ]}
        mapsApiKey={CLE}
      />,
    );
    await declencher("load");

    expect(marqueurs).toHaveLength(2);
    expect(marqueurs.map((m) => m.position)).toEqual([
      { lat: 45.76, lng: 4.83 },
      { lat: 45.75, lng: 4.85 },
    ]);
  });

  it("numerote les pins dans l'ordre CHRONOLOGIQUE de la tournee", async () => {
    // [[maquettage]] §Notes portage releve « pins carte sans numeros » comme la
    // divergence a corriger. La numerotation suit l'ordre de la liste, qui est
    // l'ordre `appointment_at ASC` - pas l'ordre des identifiants.
    const CarteTournee = await chargerComposant();

    render(
      <CarteTournee
        interventions={[
          intervention({ id: 9, point: { lon: 4.83, lat: 45.76 } }),
          intervention({ id: 2, point: { lon: 4.85, lat: 45.75 } }),
        ]}
        mapsApiKey={CLE}
      />,
    );
    await declencher("load");

    expect(marqueurs.map((m) => m.label)).toEqual(["1", "2"]);
  });

  it("laisse un TROU quand un point manque, plutot que de decaler la serie", async () => {
    // ⚠️ **Oracle inverse apres correctif — regle du test rouge, cas 3.**
    //
    // L'agent testeur l'avait pose sur le comportement CONSTATE (`["1", "2"]`)
    // en remontant le decalage comme defaut B3, et il avait raison de le
    // remonter : `points` etait filtre AVANT `entries()`, donc une intervention
    // sans point — client pseudonymise — etait sautee sans laisser de trou, et
    // le pin « 2 » designait le TROISIEME rendez-vous de la journee. Un numero
    // qui ment est pire qu'aucun numero.
    //
    // Le correctif numerote sur la tournee ENTIERE (`interventions.indexOf`) :
    // le rang d'un pin est desormais son rang dans la journee, et l'absence du
    // deuxieme point se voit comme un trou dans la serie. C'est le comportement
    // que la maquette suppose en numerotant ses pins.
    const CarteTournee = await chargerComposant();

    render(
      <CarteTournee
        interventions={[
          intervention({ id: 1, point: { lon: 4.83, lat: 45.76 } }),
          intervention({ id: 2, point: null }),
          intervention({ id: 3, point: { lon: 4.85, lat: 45.75 } }),
        ]}
        mapsApiKey={CLE}
      />,
    );
    await declencher("load");

    expect(marqueurs.map((m) => m.label)).toEqual(["1", "3"]);
  });

  it("titre chaque pin par son HEURE, seul repere que la liste affiche aussi", async () => {
    // La liste ne porte aucun ordinal et la maquette n'en met pas : l'heure est
    // donc le seul moyen de relier un pin a une ligne. Elle vient en tete du
    // `title`, pas en queue.
    const CarteTournee = await chargerComposant();

    render(<CarteTournee interventions={[intervention()]} mapsApiKey={CLE} />);
    await declencher("load");

    // 08 h 00 UTC un 13 aout = 10 h 00 a Paris.
    expect(marqueurs[0]?.title).toMatch(/^10:00 —/);
    expect(marqueurs[0]?.title).toContain("Révision complète");
  });

  it("cadre sur l'ensemble des pins", async () => {
    const CarteTournee = await chargerComposant();

    render(
      <CarteTournee
        interventions={[
          intervention({ id: 1, point: { lon: 4.83, lat: 45.76 } }),
          intervention({ id: 2, point: { lon: 4.85, lat: 45.75 } }),
        ]}
        mapsApiKey={CLE}
      />,
    );
    await declencher("load");

    expect(etendus).toHaveLength(2);
    expect(fitBoundsSpy).toHaveBeenCalledOnce();
    // Plusieurs points : `fitBounds` suffit, on ne force aucun zoom.
    expect(ecouteursIdle).toHaveLength(0);
  });

  it("retablit un zoom lisible quand la tournee n'a qu'un seul point", async () => {
    // `fitBounds` sur une boite de surface nulle zoome au maximum, et la carte
    // devient illisible. Le rattrapage passe par un `idle` unique.
    const CarteTournee = await chargerComposant();

    render(<CarteTournee interventions={[intervention()]} mapsApiKey={CLE} />);
    await declencher("load");

    expect(ecouteursIdle).toHaveLength(1);
    ecouteursIdle[0]?.();
    expect(setZoomSpy).toHaveBeenCalledWith(14);
  });

  it("retablit ce zoom quand PLUSIEURS rendez-vous partagent une adresse", async () => {
    // 🐛 **Constate en recette le 2026-08-12**, sur la premiere execution avec
    // une cle : six rendez-vous a la meme adresse - un immeuble, une
    // entreprise, ou simplement les reservations laissees par `gp-02` -
    // donnent six points CONFONDUS. La boite est de surface nulle comme avec un
    // point unique, `fitBounds` zoome au maximum, mais la condition portait sur
    // `points.length === 1` et ne se declenchait pas. Carte inutilisable.
    const CarteTournee = await chargerComposant();

    render(
      <CarteTournee
        interventions={[
          intervention(),
          intervention({ id: 2 }),
          intervention({ id: 3 }),
        ]}
        mapsApiKey={CLE}
      />,
    );
    await declencher("load");

    // Trois marqueurs sont bien poses - le defaut n'est pas de les perdre.
    expect(marqueurs).toHaveLength(3);

    expect(ecouteursIdle).toHaveLength(1);
    ecouteursIdle[0]?.();
    expect(setZoomSpy).toHaveBeenCalledWith(14);
  });

  it("laisse `fitBounds` decider des que deux adresses different", async () => {
    // La contrepartie : sur une vraie tournee etalee, le cadrage automatique
    // est ce qu'on veut, et forcer un zoom fixe couperait des rendez-vous.
    const CarteTournee = await chargerComposant();

    render(
      <CarteTournee
        interventions={[
          intervention(),
          intervention({ id: 2, point: { lon: 4.85, lat: 45.75 } }),
        ]}
        mapsApiKey={CLE}
      />,
    );
    await declencher("load");

    expect(fitBoundsSpy).toHaveBeenCalledOnce();
    expect(ecouteursIdle).toHaveLength(0);
  });
});

describe("CarteTournee - le rafraichissement de 30 secondes", () => {
  it("ne RECONSTRUIT PAS la carte quand le polling rend les memes points", async () => {
    // Le motif de la `signature`. Sans elle, `points` est un tableau neuf a
    // chaque rendu, l'effet se rejouerait toutes les 30 secondes et le
    // technicien perdrait son zoom et son deplacement a chaque fois.
    const CarteTournee = await chargerComposant();

    const vue = render(
      <CarteTournee interventions={[intervention()]} mapsApiKey={CLE} />,
    );
    await declencher("load");
    expect(cartes).toHaveLength(1);

    // Un objet NEUF, aux memes coordonnees : exactement ce que rend le refetch.
    vue.rerender(
      <CarteTournee interventions={[intervention()]} mapsApiKey={CLE} />,
    );

    expect(cartes).toHaveLength(1);
  });

  it("renumerote les pins quand un rendez-vous SANS point s'insere avant eux", async () => {
    // 🔴 **ROUGE a l'ecriture - constat n°2 de l'agent testeur, 2026-08-12.**
    //
    // C'est le defaut B3 qui revient par la porte de derriere. Le label d'un pin
    // est son rang dans la tournee ENTIERE (`interventions.indexOf`), la
    // correction meme de B3 - mais la cle de memoisation de l'effet,
    // `signature`, n'est construite qu'a partir de `points`, donc **des seules
    // interventions qui portent un point**.
    //
    // Consequence : un rendez-vous SANS point qui s'insere avant un pin - client
    // pseudonymise par T-V3-12, `addresses.location` NULLable depuis la
    // migration 015 - decale la numerotation attendue **sans faire bouger la
    // signature**. L'effet ne rejoue pas, la carte n'est pas reconstruite, et le
    // pin « 1 » designe desormais le DEUXIEME rendez-vous de la journee. Un
    // numero qui ment, exactement ce que B3 avait fait corriger.
    //
    // Le chemin est celui du polling de 30 s, pas une manipulation : c'est
    // l'administrateur qui ajoute une intervention en cours de journee, cas que
    // la DoD de T-V2-01 donne comme motif du polling.
    //
    // ⚠️ Le rendre vert n'est pas l'affaire de l'agent testeur : la cle de
    // l'effet vit dans du code de production.
    const CarteTournee = await chargerComposant();

    const vue = render(
      <CarteTournee
        interventions={[
          intervention({ id: 1, point: { lon: 4.83, lat: 45.76 } }),
        ]}
        mapsApiKey={CLE}
      />,
    );
    await declencher("load");

    expect(marqueurs.map((m) => m.label)).toEqual(["1"]);

    // Le refetch ramene une intervention plus matinale, chez un client efface :
    // aucune coordonnee, donc aucun pin - mais elle occupe bien le rang 1.
    vue.rerender(
      <CarteTournee
        interventions={[
          intervention({ id: 2, point: null }),
          intervention({ id: 1, point: { lon: 4.83, lat: 45.76 } }),
        ]}
        mapsApiKey={CLE}
      />,
    );

    await waitFor(() => {
      expect(marqueurs.at(-1)?.label).toBe("2");
    });
  });

  it("reconstruit quand l'administrateur ajoute un rendez-vous", async () => {
    // Le pendant du test ci-dessus : une tournee qui change doit se recadrer.
    // ⚠️ Le cout est reel et assume - le zoom et le deplacement du technicien
    // sont perdus a ce moment-la. Constate, pas prescrit.
    const CarteTournee = await chargerComposant();

    const vue = render(
      <CarteTournee interventions={[intervention()]} mapsApiKey={CLE} />,
    );
    await declencher("load");

    vue.rerender(
      <CarteTournee
        interventions={[
          intervention(),
          intervention({ id: 2, point: { lon: 4.85, lat: 45.75 } }),
        ]}
        mapsApiKey={CLE}
      />,
    );
    await waitFor(() => {
      expect(cartes).toHaveLength(2);
    });
  });
});

describe("CarteTournee - le demontage et les pannes", () => {
  it("ne construit aucune carte si le composant est demonte avant le chargement", async () => {
    // Le drapeau `annule` du nettoyage. Sans lui, `new google.maps.Map` recevrait
    // un noeud detache du document.
    const CarteTournee = await chargerComposant();

    const vue = render(
      <CarteTournee interventions={[intervention()]} mapsApiKey={CLE} />,
    );
    vue.unmount();

    await declencher("load");

    expect(cartes).toHaveLength(0);
  });

  it("laisse le message de chargement tant que la carte n'est pas prete", async () => {
    const CarteTournee = await chargerComposant();

    render(<CarteTournee interventions={[intervention()]} mapsApiKey={CLE} />);

    expect(screen.getByText(/Chargement de la carte/)).toBeInTheDocument();
  });

  it("RETIRE la region quand le script echoue, au lieu de promettre un chargement", async () => {
    // 🔴 **Oracle du constat n°5 de l'agent testeur, correctif du 2026-08-12.**
    //
    // Le `catch` journalisait et rien d'autre : `pret` restait faux, donc
    // « Chargement de la carte… » s'affichait indefiniment. La liste servait
    // bien de repli - la DoD etait tenue sur le fond - mais l'ecran mentait sur
    // ce qui allait se passer.
    //
    // La propriete visee est que l'echec rende le MEME resultat qu'une cle
    // absente : rien. Un seul chemin de repli, pas un second, et c'est ce que
    // le module revendique en toutes lettres depuis son en-tete (« les trois
    // raisons de ne rien monter », desormais quatre).
    const CarteTournee = await chargerComposant();

    const { container } = render(
      <CarteTournee interventions={[intervention()]} mapsApiKey={CLE} />,
    );
    expect(screen.getByText(/Chargement de la carte/)).toBeInTheDocument();

    await declencher("error");

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
    expect(
      screen.queryByRole("region", { name: "Carte de la tournée" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Chargement de la carte/),
    ).not.toBeInTheDocument();
  });

  it("n'insiste pas tant que la tournee ne bouge pas", async () => {
    // 🔴 **L'autre moitie du correctif : l'echec COLLE tant que la tournee ne
    // change pas.**
    //
    // Le rafraichissement de 30 s rend le plus souvent exactement la meme
    // tournee. Sans cette propriete, chaque tour relancerait un chargement dont
    // on vient d'apprendre qu'il echoue : carte qui se remonte et retombe toutes
    // les 30 secondes, script Maps reinjecte a chaque tour, quota consomme sur
    // la ressource meme qui refuse.
    //
    // ⚠️ Ce test ne discrimine PAS la signature memorisee d'un simple booleen -
    // les deux passent ici, l'effet ne rejouant pas a deps inchangees. Ce qui
    // les separe est la REPRISE, et c'est le test suivant qui la tient. Les deux
    // sont donc necessaires : celui-ci interdit d'insister, celui-la interdit
    // d'abandonner.
    const CarteTournee = await chargerComposant();

    const vue = render(
      <CarteTournee interventions={[intervention()]} mapsApiKey={CLE} />,
    );
    await declencher("error");
    expect(balise()).toBeNull();

    // Le polling rend un tableau NEUF, aux memes identifiants et aux memes
    // coordonnees : exactement ce que produit un refetch sans changement.
    vue.rerender(
      <CarteTournee interventions={[intervention()]} mapsApiKey={CLE} />,
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(
      screen.queryByRole("region", { name: "Carte de la tournée" }),
    ).not.toBeInTheDocument();
    // Aucun script reinjecte, donc aucune nouvelle tentative.
    expect(balise()).toBeNull();
    expect(cartes).toHaveLength(0);
  });

  it("REPREND apres un echec de chargement du script", async () => {
    // ⚠️ **Test ROUGE a l'ecriture, et le module affirme le contraire** :
    // « Rejouable : on oublie la promesse echouee, sinon un incident reseau
    // ponctuel condamnerait la carte pour toute la duree de l'onglet. »
    //
    // Ce qui se produit : `chargement = undefined` est bien remis, mais la
    // balise `<script>` en echec **reste dans le `<head>`**. La tentative
    // suivante retrouve cet `id`, resout IMMEDIATEMENT sans rien recharger, et
    // `new google.maps.Map` s'execute alors que le global `google` n'existe
    // toujours pas. L'onglet reste sur « Chargement de la carte… » jusqu'au F5 -
    // exactement l'etat que le commentaire dit avoir evite.
    //
    // Scenario, sans rien d'artificiel : le premier chargement echoue (quota
    // Maps, referer refuse, coupure Wi-Fi du technicien en tournee), puis le
    // polling de 30 s fait bouger la signature et rejoue l'effet.
    const CarteTournee = await chargerComposant();

    const vue = render(
      <CarteTournee interventions={[intervention()]} mapsApiKey={CLE} />,
    );
    await declencher("error");
    expect(cartes).toHaveLength(0);

    // Le rendez-vous suivant tombe : la signature change, l'effet se rejoue.
    vue.rerender(
      <CarteTournee
        interventions={[
          intervention(),
          intervention({ id: 2, point: { lon: 4.85, lat: 45.75 } }),
        ]}
        mapsApiKey={CLE}
      />,
    );

    // ⚠️ **Vider les micro-taches AVANT de rendre le reseau**, sinon le test
    // ment. Sans cette ligne, `installerGoogle()` s'executait avant que la
    // promesse resolue d'emblee par la balise perimee n'atteigne son `.then`, et
    // la carte se construisait - un vert obtenu par l'ordonnancement du harnais,
    // pas par le composant. Dans la vraie vie l'effet se rejoue tout de suite et
    // le reseau revient des secondes plus tard.
    await Promise.resolve();
    await Promise.resolve();

    // Le reseau est revenu : le script charge cette fois.
    await declencher("load");

    await waitFor(() => {
      expect(cartes).toHaveLength(1);
    });
    expect(
      screen.queryByText(/Chargement de la carte/),
    ).not.toBeInTheDocument();
  });
});

describe("CarteTournee - RGAA A", () => {
  it("ne presente aucune violation axe tant que la carte n'est pas construite", async () => {
    const CarteTournee = await chargerComposant();

    const vue = render(
      <CarteTournee interventions={[intervention()]} mapsApiKey={CLE} />,
    );

    await expect(axe(vue.container)).resolves.toHaveNoViolations();
  });

  it("expose la carte comme une region NOMMEE, et non plus masquee", async () => {
    // ⚠️ **Oracle RENVERSE le 2026-08-12, et c'est une decision de produit, pas
    // un test fautif.** Il exigeait qu'aucun element focusable n'existe sous
    // `[aria-hidden="true"]`, ce qui etait la bonne propriete d'une carte
    // DECORATIVE : l'API injecte ses commandes de zoom dans le conteneur, et
    // masquees elles produisent `aria-hidden-focus` (axe, wcag2a, SC 4.1.2).
    // C'etait le constat B2 de l'agent testeur, corrige par `disableDefaultUI`
    // plus `inert`.
    //
    // Benjamin a tranche en recette que la carte doit se deplacer et se zoomer.
    // Elle cesse d'etre une illustration, donc la masquer deviendrait la faute
    // inverse : un outil qu'on manipule doit etre expose, nomme, et atteignable
    // au clavier. Ce que la nouvelle propriete garantit contre le retour de B2
    // n'est plus `inert`, c'est qu'il n'y a **plus rien de masque** a survoler.
    const CarteTournee = await chargerComposant();
    injecteSesCommandes = true;

    const vue = render(
      <CarteTournee interventions={[intervention()]} mapsApiKey={CLE} />,
    );
    await declencher("load");

    // La region porte un nom : sans lui, un lecteur d'ecran annonce une region
    // anonyme au milieu de la tournee.
    const region = screen.getByRole("region", { name: "Carte de la tournée" });

    // Les commandes de l'API sont bien la - sans cette assertion, le test
    // passerait aussi sur un rendu vide.
    expect(region.querySelector("button")).not.toBeNull();

    // 🔴 Et AUCUNE d'elles n'est masquee. C'est la garde anti-retour de B2 :
    // reposer `aria-hidden` ou `inert` sur ce conteneur ramenerait exactement
    // la violation, puisque les commandes, elles, sont desormais rendues.
    expect(vue.container.querySelector("[aria-hidden]")).toBeNull();
    expect(vue.container.querySelector("[inert]")).toBeNull();
  });

  it("rend une carte manipulable, sans capturer le defilement de la page", async () => {
    const CarteTournee = await chargerComposant();

    render(<CarteTournee interventions={[intervention()]} mapsApiKey={CLE} />);
    await declencher("load");

    expect(cartes[0]?.options).toMatchObject({
      zoomControl: true,
      // `cooperative` : la molette fait defiler la PAGE, et zoome avec Ctrl.
      // Une carte de 384 px au milieu d'une liste de rendez-vous qui capture le
      // defilement piege le lecteur.
      gestureHandling: "cooperative",
    });

    // Ni Street View ni selecteur de type de carte : aucun des deux ne sert une
    // tournee, et chacun ajoute un arret de tabulation.
    expect(cartes[0]?.options).toMatchObject({
      streetViewControl: false,
      mapTypeControl: false,
    });
  });

  it("demande a l'API ses libelles en FRANCAIS", async () => {
    // Sans `language`, les commandes s'appellent « Zoom in » et « Toggle
    // fullscreen » : des noms accessibles anglais dans une application
    // entierement en francais (RGAA A). Meme defaut que le « Close » du
    // registry shadcn, traduit dans `ui/sheet.tsx`. Il ne devient visible que
    // depuis que les commandes sont rendues.
    const CarteTournee = await chargerComposant();

    render(<CarteTournee interventions={[intervention()]} mapsApiKey={CLE} />);

    const url = new URL(balise()?.src ?? "", "https://exemple.test");

    expect(url.searchParams.get("language")).toBe("fr");
    expect(url.searchParams.get("region")).toBe("FR");
  });
});
