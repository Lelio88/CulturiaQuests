/**
 * Routes serveur-autoritatives d'économie des objets (#audit HIGH#1) : recyclage & amélioration.
 * Remplacent les anciens PUT /items/:id + PUT /guilds/:id pilotés par le client (trichables :
 * le client envoyait le nouveau gold/scrap/level). Le scrap/coût est désormais calculé serveur.
 */
export default {
  routes: [
    {
      method: 'POST',
      path: '/items/recycle',
      handler: 'item.recycle',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'POST',
      path: '/items/upgrade',
      handler: 'item.upgrade',
      config: { policies: [], middlewares: [] },
    },
  ],
};
