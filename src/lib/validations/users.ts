import { z } from "zod";

/// Schémas du domaine `users`.

/// Le mot de passe courant, seule charge utile de la suppression de compte.
///
/// Aucune règle de complexité, même motif qu'à la connexion : la contrôler ici
/// révélerait la politique appliquée aux comptes existants. Le plafond, lui,
/// n'est pas décoratif - bcrypt ne lit que les 72 premiers octets, mais il
/// hache tout ce qu'on lui donne, et un mot de passe d'un mégaoctet est un
/// appel coûteux offert à un appelant anonyme sur un endpoint POST public.
/// 200 est la valeur déjà retenue par la borne des libellés du dépôt.
export const supprimerCompteSchema = z.object({
  motDePasse: z
    .string()
    .min(1, "Renseignez votre mot de passe pour confirmer")
    .max(200, "Mot de passe trop long"),
});

export type SupprimerCompteInput = z.infer<typeof supprimerCompteSchema>;
