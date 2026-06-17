/**
 * admin-action-log router — AUCUNE API REST publique.
 *
 * Ce journal d'audit (qui a bloqué/changé le rôle de qui, IP, horodatage) ne doit être
 * ni lu ni modifié via l'API REST publique — son intégrité est essentielle. Il est écrit
 * par le service admin-dashboard et consulté via celui-ci (côté serveur). On remplace donc
 * le routeur core par défaut (CRUD) par un routeur vide. Le content-manager admin reste
 * disponible via l'API interne de Strapi.
 */
export default { routes: [] };
