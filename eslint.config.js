import js from '@eslint/js';

export default [
  { ignores: ['dist/**', 'node_modules/**', '.pair-programming/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: { eqeqeq: 'error', 'no-var': 'error', 'prefer-const': 'error' },
  },
  {
    files: ['scripts/**/*.js', 'test/**/*.js'],
    languageOptions: { globals: { Buffer: 'readonly', process: 'readonly', console: 'readonly', URL: 'readonly', fetch: 'readonly', structuredClone: 'readonly' } },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: { document: 'readonly', window: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', AbortSignal: 'readonly', Uint8Array: 'readonly' } },
  },
];
