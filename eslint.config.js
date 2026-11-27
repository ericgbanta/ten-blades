import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    // Core logic, the pure save modules and the pure main character modules stay pure: no DOM, no storage, no
    // clock, no unseeded randomness. Time and seeds come in from the UI.
    files: [
      'src/core/**/*.ts',
      'src/save/format.ts',
      'src/save/shape.ts',
      'src/save/validate.ts',
      'src/save/migrate.ts',
      'src/save/load.ts',
      'src/save/campaign.ts',
      'src/save/queue.ts',
      'src/art/mc/look.ts',
      'src/art/mc/recolor.ts',
      'src/ui/menus/newGameDraft.ts',
      'src/story/**/*.ts',
      'src/camp/**/*.ts',
    ],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'localStorage',
        'sessionStorage',
        'indexedDB',
        'navigator',
        { name: 'Date', message: 'Pass the time in from the UI.' },
      ],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use the seeded RNG in src/core/rng.ts.' }],
    },
  },
  {
    // The service worker template: worker globals, and the two constants the build puts in front of it.
    files: ['tools/pwa/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker, VERSION: 'readonly', PRECACHE: 'readonly' } },
  },
  {
    // An underscore marks a parameter kept for a hook's signature.
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
);
