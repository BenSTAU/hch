# Surface programmatique

Ce que HomeCycl'Home expose, et sous quelle garde. Deux surfaces distinctes :
trois Route Handlers HTTP, et vingt-six Server Actions.

Constat à `dce9520`, arbre `src/app/**/route.ts` et `src/lib/actions/**`
parcourus au moment de la rédaction.

## Le critère d'admission d'un Route Handler

La règle du dépôt ne range pas les deux surfaces par confort d'écriture. Elle
pose un critère, et c'est lui qui décide :

> Server Actions pour **toutes** les mutations. Route Handler autorisé seulement
> quand le canal HTTP est **nécessaire en soi** : flux binaire entrant ou
> sortant (une Server Action sérialise sa charge utile et sa réponse),
> redirection OAuth, webhook tiers, sonde d'infrastructure. Partout ailleurs,
> Server Action.
>
> - `CLAUDE.md` §Server Actions + Forms

La conséquence pratique : un Route Handler qui ne relève d'aucun de ces cas
n'est pas une préférence de style, c'est une divergence à signaler en revue. Le
dépôt en compte trois, et chacun se justifie contre ce critère :

| Route                            | Cas invoqué              | Tenue du critère                                                                                                                                                                                                      |
| -------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/health`                    | sonde d'infrastructure   | oui, littéralement. Interrogée par le healthcheck du conteneur et par la boucle post-déploiement du pipeline                                                                                                          |
| `/api/upload-intervention-photo` | flux binaire **entrant** | oui. Faire transiter cinq images de cinq mégaoctets par la sérialisation d'une Server Action serait un détournement de mécanisme                                                                                      |
| `/api/intervention-photos/[id]`  | flux binaire **sortant** | **quatrième cas, assumé et signalé** dans le code lui-même ([route.ts:24-29](../src/app/api/intervention-photos/%5Bid%5D/route.ts)). Une Server Action sérialise sa réponse, elle ne peut pas rendre un flux d'octets |

Le troisième mérite qu'on s'y arrête, parce qu'il n'était pas prévu par le
critère. `uploads/` vit hors de `public/` : Next n'en sert rien, délibérément.
Une photo prise au domicile d'un client ne doit pas être joignable par qui
connaît son URL, et servir le dossier statiquement aurait fait reposer toute la
confidentialité sur le caractère non devinable d'un UUID, ce qui ne tient pas
face aux journaux nginx, aux en-têtes `Referer` et à l'historique du navigateur.
L'écart a été arbitré le 2026-08-11 et tracé en PR.

## 1. Routes HTTP

Trois fichiers `route.ts` à `dce9520`, aucun autre. Le tableau de sortie de
`pnpm build` les confirme, listés en `ƒ` (rendus à la demande).

| Méthode | Chemin                           | Authentification                               | Entrée                               | Réponse                                                                                                | Codes                                                                                                                                     |
| ------- | -------------------------------- | ---------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/api/health`                    | **aucune**, publique en production             | aucune                               | `{"status":"ok","db":true}` · `{"status":"degraded","env":false}` · `{"status":"degraded","db":false}` | `200` · `503` env incomplet · `503` base injoignable · `405` sur tout autre verbe                                                         |
| `POST`  | `/api/upload-intervention-photo` | **session requise**, aucun rôle                | `multipart/form-data`, champ `photo` | `{"ok":true,"url":"..."}` · `{"ok":false,"message":"..."}`                                             | `200` · `400` aucun fichier · `401` anonyme · `413` trop lourde · `415` type refusé · `422` autre refus · `429` quota, avec `Retry-After` |
| `GET`   | `/api/intervention-photos/[id]`  | **session requise** + titulaire du rendez-vous | segment `id`, entier positif         | flux `image/webp`, ou corps vide                                                                       | `200` · `404`                                                                                                                             |

### Ce que les codes ne disent pas

**`/api/health` ne renvoie jamais le détail de l'erreur.** Un message Prisma
porte l'hôte, le port et l'utilisateur de la base, et la route est publique en
production. Le détail part dans les journaux du conteneur, la réponse se limite
au couple statut / drapeau. C'est une divergence assumée vis-à-vis de PLAN S3
§5, qui écrivait `error: err.message`.

L'ordre des deux contrôles compte : la garde d'environnement passe **avant** la
base, et son message nomme les variables manquantes. Confondre « variable
absente » et « Postgres injoignable » ferait chercher la panne au mauvais
endroit, les deux se réparant ailleurs.

**`/api/intervention-photos/[id]` répond `404` pour quatre causes distinctes** :
appelant anonyme, identifiant malformé, photo appartenant à un tiers, fichier
absent du disque. Les distinguer renseignerait sur l'existence de ce qu'on
protège. La garde de propriété vit dans la clause `where` de la requête, pas
dans un `if` que l'on peut oublier.

Vérifié en session, appelant anonyme, serveur de développement :

| Appel                                 | Code obtenu                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /api/health`                     | `200`, corps `{"status":"ok","db":true}`                                        |
| `POST /api/health`                    | `405`                                                                           |
| `GET /api/intervention-photos/1`      | `404`                                                                           |
| `GET /api/intervention-photos/abc`    | `404`                                                                           |
| `POST /api/upload-intervention-photo` | `401`, corps `{"ok":false,"message":"Connectez-vous pour joindre des photos."}` |

Le quota d'upload est décompté **avant** la lecture du corps de la requête :
accepter cinq mégaoctets pour les refuser ensuite ne protégerait rien. Il borne
le disque, pas le dossier ; le plafond de cinq photos par intervention se
vérifie ailleurs, à la validation de la réservation, seule surface qui connaisse
le dossier complet.

## 2. Server Actions

**Chaque Server Action exportée est un endpoint POST public.** Next lui attribue
un identifiant et l'expose ; elle est joignable depuis n'importe quelle route, y
compris une route publique, indépendamment de la page qui l'a fait naître. La
page qui protège ne protège pas l'action.

Cela a une conséquence directe sur la lecture du tableau ci-dessous : la colonne
« Rôle exigé » n'est pas la description d'un écran, c'est la seule garde qui
existe. `src/proxy.ts` laisse délibérément passer les requêtes portant l'en-tête
`Next-Action`, parce que rediriger un POST d'action casse le client.

Les gardes vivent en **middleware** de `next-safe-action`, pas dans le corps de
l'action. La bibliothèque exécute les middlewares, puis la validation Zod, puis
le corps : une garde placée dans le corps laisserait un appelant anonyme
déclencher le parsing et lire la forme du schéma dans le message d'erreur
([safe-action.ts:19-55](../src/lib/safe-action.ts)).

Quatre clients, quatre niveaux :

| Client              | Garde          | Comportement de refus                         |
| ------------------- | -------------- | --------------------------------------------- |
| `actionClient`      | aucune         | l'action s'exécute                            |
| `authActionClient`  | session valide | `getCurrentUser()` redirige vers `/connexion` |
| `techActionClient`  | `ROLE_TECH`    | `requireTech()`                               |
| `adminActionClient` | `ROLE_ADMIN`   | `requireAdmin()`                              |

Vingt-six exports répartis sur vingt-deux modules et huit domaines. Deux
domaines existent en dossier mais sont vides à `dce9520` : `forfaits/` et
`zones/` ne portent qu'un `.gitkeep`.

Cinq de ces exports ne sont pas des actions `next-safe-action` mais des
**adaptateurs `FormData`** de signature `(prevState, formData)`, destinés à
`useActionState`. Ils existent parce que `next-safe-action` 8.6 ne se branche pas
sur un `FormData`, quand React en passe précisément un : la conversion se fait
côté serveur, avant l'appel à l'action typée. Ils n'ajoutent aucune garde, ils
délèguent.

### Domaine `adresses`

| Fichier                | Export             | Entrée (schéma Zod)                                                                       | Rôle exigé                             | Effet                                                                              | Revalidation             |
| ---------------------- | ------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------ |
| `verifier-adresse.ts`  | `verifierAdresse`  | `verifierAdresseSchema` : `label`, `street`, `postcode`, `city`, `citycode`, `lon`, `lat` | **aucun**, ouverte au visiteur anonyme | géocode par la BAN, puis `ST_Covers` pour trouver la zone couvrante. Lecture seule | aucune                   |
| `ajouter-adresse.ts`   | `ajouterAdresse`   | `ajouterAdresseSchema` : le précédent + `memo`                                            | session                                | résout la commune, géocode, crée l'adresse                                         | aucune, la page la porte |
| `supprimer-adresse.ts` | `supprimerAdresse` | `supprimerAdresseSchema` : `adresseId`                                                    | session                                | désactive l'adresse, sans suppression physique                                     | aucune                   |

`verifierAdresse` est publique et c'est un choix : le tunnel de réservation
s'explore sans compte (Constitution §3.2), une garde de session ici le fermerait
au visiteur. Elle ne porte aucun quota, PLAN S4 §11.1 ne comptant que par email
ou par utilisateur, jamais par IP. Le risque de relais vers la BAN reste ouvert
et assumé. C'est aussi le lieu où « les `lon`/`lat` venus du client ne font
jamais foi » devient exécutable.

### Domaine `auth`

| Fichier       | Export                       | Entrée (schéma Zod)                                                                           | Rôle exigé | Effet                                                      | Revalidation                                              |
| ------------- | ---------------------------- | --------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| `signup.ts`   | `signup`                     | `signupSchema` : `firstname`, `lastname`, `email`, `password`, `passwordConfirmation`, `next` | aucun      | crée le compte, émet un jeton d'activation, envoie l'email | `redirect` vers la confirmation                           |
| `signup.ts`   | `signupFormAction`           | adaptateur `FormData`                                                                         | aucun      | délègue à `signup`                                         | idem                                                      |
| `login.ts`    | `login`                      | `loginSchema` : `email`, `password`, `next`                                                   | aucun      | ouvre la session, écrit l'audit                            | `redirect` vers `next` assaini, ou la destination du rôle |
| `login.ts`    | `loginFormAction`            | adaptateur `FormData`                                                                         | aucun      | délègue à `login`                                          | idem                                                      |
| `logout.ts`   | `logout`                     | **aucune entrée**                                                                             | aucun      | détruit la session, écrit l'audit                          | `redirect` vers `/?deconnecte=1`                          |
| `activate.ts` | `activateAccount`            | `activationSchema` : `token`, `next`                                                          | aucun      | active le compte                                           | `redirect`                                                |
| `activate.ts` | `activateFormAction`         | adaptateur `FormData`                                                                         | aucun      | délègue                                                    | idem                                                      |
| `activate.ts` | `resendActivation`           | `resendActivationSchema` : `email`                                                            | aucun      | réémet le lien d'activation                                | aucune                                                    |
| `activate.ts` | `resendActivationFormAction` | adaptateur `FormData`                                                                         | aucun      | délègue                                                    | idem                                                      |

`logout` est la seule action sans `next-safe-action`, et c'est délibéré : la
règle du dépôt vise les actions **avec input**, et celle-ci n'en a aucun. Lui
donner un schéma reviendrait à faire valider par Zod le `FormData` vide que React
transmet, pour un canal d'erreur jamais emprunté.

Sa destruction de session n'est conditionnée à rien. La subordonner à un jeton
valide empêcherait d'effacer un cookie expiré ou signé avec un secret depuis
remplacé, c'est-à-dire exactement celui dont on veut se débarrasser. L'ordre est
lire, détruire, tracer : il n'y a plus d'acteur à nommer après la destruction, et
un échec d'écriture du journal ne doit pas laisser une session debout.

`login` et `signup` répondent de manière **identique** que l'email existe ou non
(Constitution §4.2, SPEC §6.1). Deux suites de tests dédiées mesurent le temps
constant : `login.test.ts` et `signup.timing.test.ts`.

### Domaine `cycles`

| Fichier              | Export           | Entrée (schéma Zod)                                             | Rôle exigé | Effet                                       | Revalidation                                          |
| -------------------- | ---------------- | --------------------------------------------------------------- | ---------- | ------------------------------------------- | ----------------------------------------------------- |
| `ajouter-cycle.ts`   | `ajouterCycle`   | `ajouterCycleSchema` : `brand`, `model`, `type`                 | session    | crée le vélo du client                      | `/mon-compte/cycles`, `/mes-interventions/a-venir`    |
| `modifier-cycle.ts`  | `modifierCycle`  | `modifierCycleSchema` : les champs ci-dessus + identifiant      | session    | modifie le vélo, propriété vérifiée en base | `/mon-compte/cycles` et les deux vues d'interventions |
| `rattacher-cycle.ts` | `rattacherCycle` | `rattacherCycleSchema` : `interventionId`, identifiant de cycle | session    | rattache un vélo à une intervention         | `/mes-interventions/a-venir`                          |

### Domaine `interventions`

| Fichier                    | Export                 | Entrée (schéma Zod)                                                    | Rôle exigé      | Effet                                                        | Revalidation                         |
| -------------------------- | ---------------------- | ---------------------------------------------------------------------- | --------------- | ------------------------------------------------------------ | ------------------------------------ |
| `lister-creneaux.ts`       | `listerCreneaux`       | `listerCreneauxSchema` : `serviceId`, `zoneId`                         | **aucun**       | dérive les créneaux disponibles à la volée. Lecture seule    | aucune                               |
| `reserver.ts`              | `reserver`             | `reserverSchema` : `serviceId`, `adresse`, `debut`, `photos`, `panier` | session         | crée l'intervention planifiée, fige les prix, envoie l'email | aucune, `redirect`                   |
| `ajouter-photo.ts`         | `ajouterPhoto`         | `ajouterPhotoSchema` : `interventionId`, `url`                         | session         | attache la photo, plafond `MAX_PHOTOS`                       | `/mes-interventions/a-venir`         |
| `annuler-intervention.ts`  | `annulerIntervention`  | `annulerInterventionSchema` : `interventionId`, `motif`                | session         | passe en `CANCELLED`, envoie l'email                         | les deux vues client                 |
| `demarrer-intervention.ts` | `demarrerIntervention` | `demarrerInterventionSchema` : `interventionId`                        | **`ROLE_TECH`** | passe en `IN_PROGRESS`                                       | la fiche et `/interventions/du-jour` |
| `lister-tournee.ts`        | `listerTournee`        | **aucune entrée**                                                      | **`ROLE_TECH`** | rend la tournée du jour. Lecture seule                       | aucune                               |

`listerCreneaux` est publique parce que le catalogue et ses disponibilités le
sont (Constitution §5.1). Aucun créneau n'est stocké : le pool se dérive de
`planning(technicien de la zone) x durée(forfait) - créneaux occupés`, à chaque
appel.

`listerTournee` n'a **aucune entrée**, et c'est le cloisonnement lui-même : le
technicien concerné est celui de la session, jamais un identifiant transmis par
l'appelant. C'est aussi la `queryFn` d'un composant client qui repolle toutes les
30 secondes, l'une des trois vues où TanStack Query est autorisé. Sans sa garde
de rôle, un client authentifié qui posterait dessus recevrait le nom, le
téléphone et l'adresse des clients d'un technicien.

`reserver` porte sa garde d'authentification **dans l'action** et non dans
`src/proxy.ts` : `/reserver` reste publique, le tunnel s'explore sans compte, et
c'est la validation seule qui exige un compte créé, activé et connecté. Mettre la
garde dans le proxy fermerait tout le tunnel ; la mettre dans l'écran ne
protégerait rien.

### Domaine `paiements`

| Fichier                    | Export                 | Entrée (schéma Zod)                                                                                                                                                | Rôle exigé      | Effet                                                         | Revalidation                                             |
| -------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| `cloturer-intervention.ts` | `cloturerIntervention` | `cloturerInterventionSchema`, **union discriminée sur `issue`** : `encaisse` avec `interventionId`, `montant`, `methode` · `refuse` avec `interventionId`, `motif` | **`ROLE_TECH`** | clôt l'intervention et enregistre l'encaissement, sous verrou | la fiche, les deux vues technicien, les deux vues client |

Une seule action pour les deux branches. Deux actions distinctes auraient
dupliqué la garde de rôle, la garde de propriété, le verrou et la relecture sous
verrou, pour deux issues que la SPEC déclare indissociables, et auraient doublé
la surface d'endpoint POST public à garder.

Le paiement est **déclaratif et encaissé sur le terrain** (Constitution §2.3).
Aucune intégration de paiement en ligne n'existe, ni n'est prévue en v1.

### Domaine `parametres`

| Fichier              | Export           | Entrée (schéma Zod)                                                                     | Rôle exigé       | Effet                        | Revalidation        |
| -------------------- | ---------------- | --------------------------------------------------------------------------------------- | ---------------- | ---------------------------- | ------------------- |
| `update-settings.ts` | `updateSettings` | `updateSettingsSchema` : `settings`, tableau non vide de `{ key, value }`, clés uniques | **`ROLE_ADMIN`** | écrit les paramètres société | `/admin/parametres` |

### Domaine `produits`

| Fichier              | Export           | Entrée (schéma Zod)                                                | Rôle exigé | Effet                                           | Revalidation                 |
| -------------------- | ---------------- | ------------------------------------------------------------------ | ---------- | ----------------------------------------------- | ---------------------------- |
| `ajouter-produit.ts` | `ajouterProduit` | `ajouterProduitSchema` : `interventionId`, `productId`, `quantity` | session    | ajoute la ligne au panier, sous verrou de stock | `/mes-interventions/a-venir` |
| `retirer-produit.ts` | `retirerProduit` | `retirerProduitSchema` : `interventionId`, `productId`             | session    | retire la ligne et rend le stock                | `/mes-interventions/a-venir` |

Service et vente forment un acte unique (Constitution §2.6) : même panier, même
paiement, même facture. Il n'y a pas de boutique séparée, donc pas d'action de
commande autonome.

### Domaine `users`

| Fichier               | Export            | Entrée (schéma Zod)                    | Rôle exigé | Effet                                                                       | Revalidation                          |
| --------------------- | ----------------- | -------------------------------------- | ---------- | --------------------------------------------------------------------------- | ------------------------------------- |
| `supprimer-compte.ts` | `supprimerCompte` | `supprimerCompteSchema` : `motDePasse` | session    | droit à l'oubli : pseudonymisation in-place, jamais de suppression physique | `/` en mode `layout`, puis `redirect` |

Trois gardes vivent dans le helper métier et non dans l'action : mot de passe,
dernier administrateur, état du compte. Elles décident d'une écriture, elles
appartiennent donc à la transaction qui l'exécute. L'action orchestre la
validation, le contexte, l'invalidation, la fin de session et la redirection.

Un utilisateur porteur d'interventions n'est jamais supprimé physiquement
(Constitution §4.1) : une clé étrangère cassée effacerait la trace comptable
d'une prestation rendue.

## Ce que cette surface ne contient pas

- **Aucun endpoint de paiement en ligne.** Le paiement est terrain, déclaratif,
  porté par la table `payments`.
- **Aucune route OAuth à `dce9520`.** Le commentaire d'en-tête de
  [upload-intervention-photo/route.ts:12-13](../src/app/api/upload-intervention-photo/route.ts)
  annonce un callback OAuth et une initiation Google parmi les trois Route
  Handlers : ces deux routes n'existent pas encore. Les variables
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` et `GOOGLE_REDIRECT_URI` figurent
  dans `.env.prod.example` par anticipation, et ne sont lues nulle part.
- **Aucune API REST publique.** Les Server Actions ne sont pas un contrat
  d'intégration : leur identifiant est calculé au build et change avec le code.
  Ce qui se documente comme contrat stable, c'est la partie 1.

## Voir aussi

- [`docs/installation.md`](./installation.md) : monter le dépôt et l'exécuter.
- [`docs/api/openapi.yaml`](./api/openapi.yaml) : les trois routes HTTP en
  OpenAPI 3.1.
- Le vault Obsidian compagnon pour les artefacts de conception, décrits dans
  [`CLAUDE.md`](../CLAUDE.md).
