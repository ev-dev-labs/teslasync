module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  // `i18next` plugin is installed so the rule is available in editor
  // tooling and per-directory overrides; the default rule below is `off`
  // because flipping it to `warn` would generate hundreds of pre-existing
  // warnings and break `npm run lint --max-warnings 0`. See
  // docs/I18N_GUIDELINES.md for the rollout plan and how to enable the
  // rule for a clean directory.
  plugins: ['react-refresh', 'i18next'],
  rules: {
    'react-refresh/only-export-components': ['off'],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'react-hooks/exhaustive-deps': 'off',
    'prefer-const': 'warn',
    'i18next/no-literal-string': 'off',
  },
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/test-setup.ts', 'src/lib/gpx.ts', 'src/lib/report.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
}
