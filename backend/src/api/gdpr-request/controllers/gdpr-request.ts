/**
 * gdpr-request controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::gdpr-request.gdpr-request', ({ strapi }) => ({
  async requestData(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const existing = await strapi.db.query('api::gdpr-request.gdpr-request').findOne({
      where: { user: { id: user.id }, status: 'pending' },
    });

    if (existing) {
      return ctx.send({ message: 'Une demande est déjà en cours.' });
    }

    // Pas d'adresse IP : elle n'apporte rien au traitement de la demande (minimisation). Le
    // champ `ip_address` reste dans le schéma pour les demandes anciennes, sans être rempli.
    await strapi.db.query('api::gdpr-request.gdpr-request').create({
      data: { user: user.id, status: 'pending' },
    });

    return ctx.send({ message: 'Demande enregistrée. Vous serez contacté par email.' });
  },
}));
