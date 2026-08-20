import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `api/index.js` ist erzeugt (pnpm build:function) und enthält fremden Code.
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/dev-dist/**', 'api/index.js'] },
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
