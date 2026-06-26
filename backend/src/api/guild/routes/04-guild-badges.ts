/**
 * Routes custom « badges serveur-autoritatifs » (#54).
 *
 * - GET  /guilds/:documentId/badge-summary : résumé PUBLIC des badges d'une guilde (lecture
 *   cross-joueur, pour afficher les badges d'un ami). N'expose QUE des données de badges.
 * - PUT  /guilds/badges/equip : met à jour la sélection équipée (max 4) de SA propre guilde,
 *   validée contre les zones réellement complétées (anti-triche).
 *
 * NB : chemins choisis pour ne pas entrer en collision avec les routes cœur `GET/PUT /guilds/:id`
 * (segment littéral supplémentaire).
 */
export default {
  routes: [
    {
      method: 'GET',
      path: '/guilds/:documentId/badge-summary',
      handler: 'guild.badgeSummary',
    },
    {
      method: 'PUT',
      path: '/guilds/badges/equip',
      handler: 'guild.equipBadges',
    },
  ],
};
