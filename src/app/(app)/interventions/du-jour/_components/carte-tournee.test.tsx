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
//   · **RGAA A** sur le conteneur `aria-hidden`.
//
// ── Le double de `google.maps`, et ce qu'il modelise
//
// L'API n'est pas installable en test : elle arrive par un `<script>` distant
// que jsdom ne charge pas. Le double ci-dessous ne simule pas Google Maps, il en
// reproduit les trois faits observables dont le composant depend - le global
// `google` n'existe QU'APRES l'evenement `load`, `new google.maps.Map` prend le
// noeud et des options, et l'API **injecte ses propres commandes focusables dans
// le conteneur** (zoom, plein ecran, logo, « Raccourcis clavier »). Ce dernier
// point n'est pas une hypothese de confort : c'est le comportement par defaut
// documente de l'API.
//
// ⚠️ Le double **continue d'injecter sa commande meme apres le correctif**, et
// c'est deliberé : il ne lit pas `disableDefaultUI`. Un double qui obeirait aux
// options ne prouverait plus rien de `inert`, qui est precisement la garantie
// posee pour le cas ou l'API ajoute quelque chose qu'aucune option ne coupe.
//
// ── Deux constats ont ete corriges depuis l'ecriture de ce fichier
//
// B1 (reprise apres echec de script) et B2 (`aria-hidden-focus`) etaient rouges
// a l'ecriture ; ils sont verts depuis le correctif, et deux oracles ont ete
// elargis en consequence — chacun porte sa justification sur place.
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

/// Rejoue l'evenement du `<script>` distant que jsdom ne charge jamais.
///
/// `load` installe le global `google` AVANT de notifier, dans cet ordre : c'est
/// l'ordre reel, et l'inverser rendrait vert un composant qui lirait `google`
/// trop tot.
async function declencher(evenement: "load" | "error") {
  const script = balise();
  expect(script).not.toBeNull();
  if (evenement === "load") installerGoogle();
  script?.dispatchEvent(new Event(evenement));
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
  balise()?.remove();
});

afterEach(() => {
  desinstallerGoogle();
  balise()?.remove();
});

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

  it("ne laisse AUCUN element focusable sous le conteneur `aria-hidden`", async () => {
    // ⚠️ **Test ROUGE a l'ecriture.** Le conteneur porte `aria-hidden="true"`,
    // et l'API Maps injecte dedans ses propres commandes FOCUSABLES : boutons de
    // zoom et de plein ecran, lien du logo Google, « Raccourcis clavier ». Le
    // composant ne pose ni `disableDefaultUI`, ni `zoomControl: false`, ni
    // `keyboardShortcuts: false` - seuls `streetViewControl` et `mapTypeControl`
    // sont coupes.
    //
    // C'est `aria-hidden-focus` (axe, **wcag2a**, SC 4.1.2) : un element
    // focusable sous un ancetre `aria-hidden` est atteignable au clavier mais
    // invisible pour le lecteur d'ecran - un arret sans annonce dans l'ordre de
    // tabulation. Le raisonnement du module (« un canevas de tuiles n'est pas
    // restituable, la liste porte l'information ») vaut pour le CANEVAS ; il ne
    // couvre pas les commandes que l'API ajoute autour.
    //
    // ⚠️ **L'oracle est une requete DOM et non `axe()`, deliberement.** `axe()`
    // rend vert sur ce cas precis sous jsdom - toutes les boites y mesurent zero,
    // et ses verifications de focus s'appuient sur la geometrie. Le mesurer avec
    // un outil qui ne peut pas le voir aurait produit une fausse assurance ; la
    // requete ci-dessous constate la meme propriete sans dependre du rendu.
    //
    // La barriere E2E ne peut pas l'attraper non plus : sans `HCH_MAPS_API_KEY`
    // sur le poste, `AxeBuilder` analyse une page ou la carte n'est jamais
    // montee.
    // ⚠️ **Oracle elargi apres correctif — regle du test rouge, cas 3.**
    //
    // Ecrit par l'agent testeur, il exigeait qu'AUCUN element focusable
    // n'existe sous `[aria-hidden="true"]`. La propriete visee est juste ; la
    // requete, elle, etait un PROXY, et un proxy trop etroit : elle ne pouvait
    // etre satisfaite qu'en esperant que l'API n'injecte jamais rien.
    //
    // Le correctif tient en deux moities, et la seconde est celle qui garantit :
    //   · `disableDefaultUI` + `keyboardShortcuts: false` retirent les commandes
    //     que l'API connait — mais une liste d'options n'est pas une garantie ;
    //   · **`inert` sur le conteneur** rend le sous-arbre entier inatteignable
    //     au clavier ET absent de l'arbre d'accessibilite, quoi que l'API y
    //     ajoute. Un sous-arbre `inert` ne contient par definition aucun element
    //     focusable, ce qui satisfait `aria-hidden-focus` a la racine.
    //
    // L'oracle mesure donc l'ACCESSIBILITE REELLE et non la seule presence dans
    // le DOM : il exige `inert`, puis verifie qu'aucun focusable ne subsiste
    // hors d'un sous-arbre inerte. Le double de test injecte toujours son bouton
    // — c'est ce qui rend la verification interessante.
    const CarteTournee = await chargerComposant();
    injecteSesCommandes = true;

    const vue = render(
      <CarteTournee interventions={[intervention()]} mapsApiKey={CLE} />,
    );
    await declencher("load");

    const conteneur = vue.container.querySelector('[aria-hidden="true"]');
    expect(conteneur).not.toBeNull();
    expect(conteneur).toHaveAttribute("inert");

    // Les commandes de l'API sont bien la, et bien sous le conteneur inerte :
    // sans cette assertion le test passerait aussi sur un rendu vide.
    expect(conteneur?.querySelector("button")).not.toBeNull();

    const atteignables = vue.container.querySelectorAll(
      '[aria-hidden="true"]:not([inert]) a[href], [aria-hidden="true"]:not([inert]) button, [aria-hidden="true"]:not([inert]) [tabindex]:not([tabindex="-1"])',
    );

    expect(Array.from(atteignables, (noeud) => noeud.outerHTML)).toEqual([]);

    // Et les commandes que l'API sait retirer le sont : la premiere moitie du
    // correctif se verifie sur les options passees a `new google.maps.Map`.
    expect(cartes[0]?.options).toMatchObject({
      disableDefaultUI: true,
      keyboardShortcuts: false,
    });
  });
});
