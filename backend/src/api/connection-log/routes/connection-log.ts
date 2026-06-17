/**
 * connection-log router — AUCUNE API REST publique.
 *
 * Les connection-logs contiennent de la donnée sensible (IP, horodatage de connexion).
 * Ils sont écrits par l'extension users-permissions (login) et lus uniquement par le
 * service admin-dashboard (côté serveur). On n'expose donc aucun endpoint REST CRUD :
 * le routeur core par défaut (find/findOne/create/update/delete) est remplacé par un
 * routeur vide. Le content-manager de l'admin reste disponible (API interne distincte).
 */
export default { routes: [] };
