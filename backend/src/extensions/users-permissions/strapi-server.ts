/**
 * Extension of the users-permissions plugin.
 * - Wraps the auth callback to log each successful login as a connection-log entry.
 * - Wraps auth register to validate date_of_birth (minimum age: 15).
 */
export default (plugin) => {
  // --- Login logging ---
  const originalCallback = plugin.controllers.auth.callback;

  plugin.controllers.auth.callback = async (ctx) => {
    await originalCallback(ctx);

    // After a successful login, ctx.body contains { jwt, user }
    if (ctx.body && ctx.body.jwt && ctx.body.user) {
      try {
        await strapi.db.query('api::connection-log.connection-log').create({
          data: {
            user: ctx.body.user.id,
            connected_at: new Date(),
          },
        });
      } catch (err) {
        strapi.log.warn('Failed to log connection event:', err.message);
      }
    }
  };

  // --- Register validation: date_of_birth (min 15 years old) ---
  const originalRegister = plugin.controllers.auth.register;

  plugin.controllers.auth.register = async (ctx) => {
    const { date_of_birth } = ctx.request.body;

    if (!date_of_birth) {
      return ctx.badRequest('La date de naissance est obligatoire.');
    }

    const birthDate = new Date(date_of_birth);
    if (isNaN(birthDate.getTime())) {
      return ctx.badRequest('La date de naissance est invalide.');
    }

    // Calculate age
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    if (age < 15) {
      return ctx.badRequest('Vous devez avoir au moins 15 ans pour vous inscrire.');
    }

    await originalRegister(ctx);

    // Persister la date de naissance sur l'utilisateur créé : le register natif
    // users-permissions ne sauvegarde que username/email/password, les champs
    // additionnels (date_of_birth) sont sinon validés puis perdus.
    // Garde : ne persister que si le register a réussi (sinon ctx.body.user peut
    // refléter une réponse d'erreur émise sans throw).
    if (ctx.status < 400 && ctx.body && ctx.body.user && ctx.body.user.id) {
      try {
        await strapi.db.query('plugin::users-permissions.user').update({
          where: { id: ctx.body.user.id },
          data: { date_of_birth },
        });
      } catch (err) {
        strapi.log.warn('Failed to persist date_of_birth:', err.message);
      }
    }
  };

  // --- meWithRole : /users/me-with-role qui PEUPLE le rôle ---
  // Le /users/me natif retire ?populate=role au sanitizeQuery → user.role.type revient
  // undefined, ce qui casse les checks admin côté front (useAdmin, desktop guard).
  // On requête l'utilisateur avec son rôle puis on sanitize MANUELLEMENT (destructuring)
  // pour CONSERVER role tout en retirant les champs sensibles.
  plugin.controllers.user.meWithRole = async (ctx) => {
    if (!ctx.state.user) {
      return ctx.unauthorized();
    }

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: ctx.state.user.id },
      populate: { role: { select: ['id', 'name', 'type'] } },
    });

    if (!user) {
      return ctx.notFound();
    }

    const { password, resetPasswordToken, confirmationToken, ...safe } = user;
    ctx.body = safe;
  };

  plugin.routes['content-api'].routes.unshift({
    method: 'GET',
    path: '/users/me-with-role',
    handler: 'user.meWithRole',
    config: {
      prefix: '',
      policies: [],
    },
  });

  return plugin;
};
