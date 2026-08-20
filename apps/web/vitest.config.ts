import { defineConfig } from 'vitest/config';

/**
 * Geprüft wird, was rechnet — Achsengeometrie, Datumsformate, der Ausschnitt
 * einer Rollenansicht. Nicht geprüft wird, ob ein Kasten grau ist; dafür gibt
 * es den Styleguide, und ein Test darauf wäre eine Kopie der Vorlage.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
