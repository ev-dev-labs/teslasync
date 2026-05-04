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
    // Phase-45 / Prompt 04 — flag hand-rolled `fixed inset-0 z-[…]` overlays
    // that bypass the shared <Modal>'s viewport-bounds. New interactive
    // dialogs MUST use <Modal> from @/components/ui. System overlays (tour
    // spotlight, kiosk wallpaper, auth wall, sidebar drawer scrim, command
    // palette) are exempt; opt them out with an inline
    // `// eslint-disable-next-line no-restricted-syntax` and a Phase-45
    // rationale comment so reviewers understand the exception.
    'no-restricted-syntax': [
      'warn',
      {
        selector: 'JSXAttribute[name.name="className"][value.value=/fixed inset-0[^"\\\']*z-\\[/]',
        message:
          'Hand-rolled `fixed inset-0 z-[…]` overlays bypass <Modal>\'s viewport-bounds. ' +
          'Use <Modal> from @/components/ui for dialogs. ' +
          'If this is a system overlay (tour, kiosk, auth wall), add an inline ' +
          '`// Phase-45 / Prompt 04: NOT migrated to <Modal>.` comment with rationale ' +
          'and `// eslint-disable-next-line no-restricted-syntax` to opt out.',
      },
    ],
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
