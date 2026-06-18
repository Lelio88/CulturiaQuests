/**
 * Policy `is-admin` — refuse (403) tout utilisateur dont le rôle n'est pas `admin`.
 *
 * Défense en profondeur appliquée à TOUTES les routes admin-dashboard (lectures PII incluses :
 * emails, IP, demandes RGPD), en plus de la permission bootstrap. Ainsi, une mauvaise
 * attribution future via le panel admin n'exposerait pas ces endpoints. #8
 *
 * Réplique la logique de `verifyAdminRole` du controller (conservée en garde supplémentaire
 * dans les handlers mutateurs).
 */
export default async (policyContext: any, _config: any, { strapi }: any): Promise<boolean> => {
  const current = policyContext.state?.user;
  if (!current) return false;

  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: current.id },
    populate: { role: { select: ['type'] } },
  });

  return user?.role?.type === 'admin';
};
