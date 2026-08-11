/// Chemins d'application partagés entre le serveur et le navigateur.
///
/// **Module pur** : aucun import, aucun `server-only`, aucune dépendance. C'est
/// sa raison d'être. `src/lib/auth/after-login.ts`, où vivaient ces constantes,
/// tire `permissions.ts` qui est marqué `server-only` : un composant client qui
/// l'importerait ferait échouer le build. Or ces chemins sont exactement ce que
/// les deux côtés doivent partager - la destination post-connexion, la cible du
/// `revalidatePath` des Server Actions, le lien du menu utilisateur et celui de
/// l'écran de confirmation du tunnel.
///
/// L'alternative était de recopier le littéral dans chaque composant client.
/// Une route recopiée est une route qui diverge : le tunnel visait
/// `/client/interventions`, chemin qui n'a jamais existé, et personne ne l'a vu
/// avant une passe manuelle.
///
/// ⚠️ Ne rien mettre ici qui ne soit **qu'**une chaîne. Ce module est importé
/// par du code client : tout ce qu'il exporte part dans le paquet envoyé au
/// navigateur.

/// Espace client — `US-INTERVENTIONS-LISTER-CLIENT-A-VENIR`, écran C8. C'est
/// aussi la destination post-connexion du client ([[module-1-utilisateurs]]
/// §287).
export const CHEMIN_ESPACE_CLIENT = "/mes-interventions/a-venir";

/// Historique — `US-INTERVENTIONS-LISTER-CLIENT-PASSEES`, écran C10.
export const CHEMIN_ESPACE_CLIENT_PASSEES = "/mes-interventions/passees";
