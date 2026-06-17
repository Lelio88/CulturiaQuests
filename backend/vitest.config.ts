import { defineConfig } from 'vitest/config';

/**
 * Tests unitaires backend (Vitest).
 * Cible les fichiers de test sous src/ (motif "src" + glob + ".test.ts") — fonctions
 * pures/utilitaires uniquement. Les couches Strapi (controllers/services) dépendent du
 * global `strapi` et relèvent de tests d'intégration (hors scope ici).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
