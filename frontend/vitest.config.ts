import { defineConfig } from 'vitest/config'

/**
 * Tests unitaires du BFF (Vitest) : fonctions pures de `server/utils` (limitation des tentatives,
 * lecture de l'expiration des jetons). Rangés sous `tests/unit/` et non à côté du code : Nitro
 * importe tout fichier de `server/utils`, un test y serait embarqué dans le serveur.
 * Les parcours complets (connexion, inscription) relèvent de Playwright (`tests/e2e`).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
})
