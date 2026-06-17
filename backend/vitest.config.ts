import { defineConfig } from 'vitest/config';

/**
 * Tests unitaires backend (Vitest).
 * Cible les fonctions pures/utilitaires (`src/**/*.test.ts`) — pas les couches
 * Strapi (controllers/services) qui dépendent du global `strapi` et relèvent de
 * tests d'intégration.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
