/**
 * Réclamation d'une quête au PNJ (#audit) : clôture + crédit de la récompense une fois les deux POI
 * visités (marqués serveur via la géofence d'openChest).
 */
export default {
  routes: [
    {
      method: 'POST',
      path: '/quests/:id/complete',
      handler: 'quest.complete',
      config: { policies: [], middlewares: [] },
    },
  ],
};
