// Policy is-admin appliquée à TOUTES les routes admin-dashboard (lectures PII incluses) :
// défense en profondeur 403 si un non-admin atteint l'endpoint, même si la permission
// bootstrap était élargie par erreur. #8
const route = (method: string, path: string, handler: string) => ({
  method,
  path: `/admin-dashboard${path}`,
  handler: `admin-dashboard.${handler}`,
  config: { policies: ['api::admin-dashboard.is-admin'], middlewares: [] },
});

export default {
  routes: [
    route('GET', '/check', 'check'),
    route('GET', '/overview', 'getOverview'),
    route('GET', '/players', 'getPlayers'),
    route('GET', '/players/:id', 'getPlayerDetail'),
    route('PUT', '/players/:id/toggle-block', 'toggleBlockPlayer'),
    route('PUT', '/players/:id/role', 'changePlayerRole'),
    route('GET', '/map', 'getMapData'),
    route('GET', '/economy', 'getEconomy'),
    route('GET', '/expeditions', 'getExpeditions'),
    route('GET', '/quiz', 'getQuizAnalytics'),
    route('GET', '/social', 'getSocialStats'),
    route('GET', '/connections', 'getConnectionAnalytics'),
    route('GET', '/gdpr-requests', 'getGdprRequests'),
    route('PUT', '/gdpr-requests/:id/process', 'markGdprProcessed'),
  ],
};
