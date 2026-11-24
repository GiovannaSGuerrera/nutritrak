import js from '@eslint/js';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'docs/**',
      '**/.runtime-*/**',
      '.tmp-*/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  { files: ['apps/web/e2e/*.cjs'], languageOptions: { globals: globals.browser } },
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }] },
  },
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tsParser, globals: globals.node },
    rules: { 'no-undef': 'off', 'no-unused-vars': 'off' },
  },
  {
    files: ['apps/web/public/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        api: 'readonly',
        toast: 'readonly',
        openModal: 'readonly',
        field: 'readonly',
        showLabeledModal: 'readonly',
        portalEsc: 'readonly',
        createPatientInvitation: 'readonly',
        createPatientPasswordReset: 'readonly',
        accountSecurityPage: 'readonly',
      },
    },
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }] },
  },
  {
    files: ['apps/web/public/app.js'],
    languageOptions: {
      globals: {
        api: 'off',
        toast: 'off',
        openModal: 'off',
        field: 'off',
        showLabeledModal: 'off',
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^(api|showLabeledModal)$' },
      ],
    },
  },
  {
    files: ['apps/web/public/account.js'],
    languageOptions: { globals: { accountSecurityPage: 'off' } },
  },
  {
    files: ['apps/web/public/portal.js'],
    languageOptions: {
      globals: {
        portalEsc: 'off',
        createPatientInvitation: 'off',
        createPatientPasswordReset: 'off',
      },
    },
  },
];
