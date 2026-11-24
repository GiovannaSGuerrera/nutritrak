import js from '@eslint/js';
import globals from 'globals';
export default [
  { files: ['apps/web/e2e/*.cjs'], languageOptions: { globals: globals.browser } },
  {
    ignores: [
      'node_modules/**',
      '.hardening-*/**',
      'docs/**',
      '**/.runtime-*/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['apps/**/*.js', 'apps/**/*.cjs', 'scripts/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }] },
  },
  { files: ['**/*.mjs'], languageOptions: { globals: globals.node } },
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
        showOnboardingShell: 'readonly',
        portalEsc: 'readonly',
        createPatientInvitation: 'readonly',
        createPatientPasswordReset: 'readonly',
        setPatientPortalAccess: 'readonly',
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
        showOnboardingShell: 'off',
      },
    },
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
