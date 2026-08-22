import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `api/index.js` ist erzeugt (pnpm build:function) und enthält fremden Code.
  // `prototyp/` ist ein eigenständiges Next.js-Projekt außerhalb des Workspace
  // und bringt seine eigene Lint-Einrichtung mit.
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/dev-dist/**',
      'api/index.js',
      'prototyp/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
