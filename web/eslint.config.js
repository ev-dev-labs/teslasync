// ESLint flat-config — Phase-45 / Prompt 13 (accessibility audit).
//
// Why this file exists
// --------------------
// ESLint v8.57.1 auto-detects the presence of an `eslint.config.js` file
// and switches to the flat-config code path even when the
// `ESLINT_USE_FLAT_CONFIG` environment variable is unset. As a result, the
// moment this file lives next to `package.json` we MUST provide a
// fully-functional configuration; an empty stub would silently disable
// every rule and break the project's `--max-warnings 0` invariant.
//
// What it does
// ------------
// The legacy `.eslintrc.cjs` remains the canonical source of truth for
// the existing TypeScript / React-Hooks / `i18next` / `no-restricted-syntax`
// rules — keeping it intact avoids churning every other phase's wiring.
// This flat-config file:
//
//   1. Loads `.eslintrc.cjs` through the `@eslint/eslintrc` `FlatCompat`
//      shim so the existing behaviour is preserved bit-for-bit.
//   2. Adds the `jsx-a11y/recommended` ruleset on top, registers the
//      shared component → underlying-element mapping, and pins the
//      Phase-45 / Prompt 13 rule levels (errors for `anchor-is-valid` /
//      `label-has-associated-control`; off for the high-noise rules with
//      a documented Phase-46 follow-up plan).
//
// File-pattern coverage
// ---------------------
// The historical npm script used `eslint . --ext ts,tsx`. Flat config
// drops the `--ext` flag and instead controls coverage via the `files`
// field on each block. The `package.json` lint script has been updated
// accordingly. We apply the linter to every `.ts` / `.tsx` file in the
// project (including `vite.config.ts`) so the `@typescript-eslint/parser`
// pulled in by `.eslintrc.cjs` can handle TypeScript syntax everywhere.

import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import aiComponentMustBeWrapped from './eslint-rules/ai-component-must-be-wrapped.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  resolvePluginsRelativeTo: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

// Phase-50 / 0001 — F0 AI-Off Contract.
//
// Local plugin namespace `teslasync` for in-tree custom rules. The
// `ai-component-must-be-wrapped` rule statically enforces ADR-015's
// invariant that every AI surface in the SPA goes through
// `withAiFeature(...)`. See web/eslint-rules/ai-component-must-be-wrapped.js
// for the heuristic and rationale.
const teslasyncPlugin = {
  rules: {
    'ai-component-must-be-wrapped': aiComponentMustBeWrapped,
  },
};

export default [
  // Mirror the legacy `ignorePatterns`: skip the build output and the
  // ESLint config files themselves (the latter avoids parser noise on
  // CommonJS / flat-config syntax).
  {
    ignores: [
      'dist/**',
      // Vite-PWA workbox dev server output (generated; not source).
      // Gitignored via .gitignore:85 (`web/dev-dist/`); also exempt
      // from lint to prevent generated workbox-*.js from flagging
      // 14 false-positive "rule not found" + "unused-disable" errors.
      'dev-dist/**',
      '.eslintrc.cjs',
      'eslint.config.js',
      // The custom rule itself + its tests are CommonJS files that
      // intentionally use Node globals (require/module.exports) and
      // should not be linted as TypeScript browser modules.
      'eslint-rules/**',
    ],
  },
  // Pull in every plugin / rule defined in `.eslintrc.cjs` via the
  // back-compat shim. Apply each block to all `.ts` / `.tsx` files in
  // the project so `vite.config.ts` is parsed by `@typescript-eslint`.
  ...compat.extends('./.eslintrc.cjs').map((block) => ({
    ...block,
    files: block.files ?? ['**/*.{ts,tsx}'],
  })),
  // Phase-45 / Prompt 13 — wire `eslint-plugin-jsx-a11y`.
  //
  // The plugin is installed as a devDependency. Pulling its
  // `recommended` configuration in here (rather than via the legacy
  // `extends` array in `.eslintrc.cjs`) keeps the eslintrc untouched
  // and isolates the accessibility rules to a single, traceable block.
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'jsx-a11y': jsxA11y },
    settings: {
      'jsx-a11y': {
        // Map shared <Button>/<Input>/etc. wrappers back to their
        // underlying HTML element so jsx-a11y rules
        // (e.g. `label-has-associated-control`) do not silently skip
        // them.
        polymorphicPropName: 'as',
        components: {
          Button: 'button',
          Input: 'input',
          Textarea: 'textarea',
          Select: 'select',
        },
      },
    },
    rules: {
      // `recommended` ruleset — pulls in the bulk of the a11y checks.
      ...jsxA11y.configs.recommended.rules,
      // Pin the Phase-45 / Prompt 13 spec rules at error level.
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/label-has-associated-control': 'error',
      // Disabled — pervasive on cards / menu items that *do* have a
      // keyboard equivalent via a parent <Modal>/<CommandPalette> Esc
      // handler the linter cannot statically observe. Phase-45 / Prompt
      // 13 audited 14 sites; tracked for Phase-46 conversion to
      // <button> wrappers or explicit role="button" + onKeyDown
      // handlers.
      'jsx-a11y/click-events-have-key-events': 'off',
      // Disabled — same root cause as `click-events-have-key-events`
      // (15 sites). The two rules nearly always fire together.
      'jsx-a11y/no-static-element-interactions': 'off',
      // Disabled — `autoFocus` is intentional in our modal / popover
      // openers (search inputs, confirmation dialogs, command palette)
      // where keyboard users expect focus to land on the primary
      // control when the surface mounts. WCAG 2.4.3 (Focus Order) is
      // satisfied.
      'jsx-a11y/no-autofocus': 'off',
    },
  },
  // Phase-50 / 0001 — register `teslasync/ai-component-must-be-wrapped`
  // for every AI surface in the SPA. The rule is path-and-name aware
  // (see eslint-rules/ai-component-must-be-wrapped.js for heuristic).
  {
    files: ['src/**/*.tsx'],
    plugins: { teslasync: teslasyncPlugin },
    rules: {
      'teslasync/ai-component-must-be-wrapped': 'error',
    },
  },
  // chore/repo-reorganization A2.6 — eslint-plugin-boundaries.
  //
  // Why this block exists today
  // ---------------------------
  // Phase B1 of the v3 reorg plan (docs/architecture/repo-
  // reorganization-plan.md §4) mechanizes Feature-Sliced Design
  // layer rules over the current dir mapping
  // (src/features/, src/components/, src/hooks/, src/lib/, etc.).
  // The plugin is installed here so B1's diff is the RULES delta
  // alone, not the install + RULES.
  //
  // Today: warn-mode, every element type allowed everywhere
  // (`default: 'allow'`). This is a true no-op — no `boundaries/*`
  // warning is possible. The presence of the block proves the
  // plugin is wired and ready for B1.
  //
  // B1 will replace this block with:
  //   - settings.'boundaries/elements' mapping current dirs to
  //     FSD layers (app / pages / widgets / features / entities /
  //     shared / generated).
  //   - rules['boundaries/element-types'] with the FSD DAG
  //     (features can only import entities + shared; etc.).
  //   - rules['boundaries/no-private'] at error.
  //
  // Until then the plugin is registered solely so config errors
  // (wrong export shape, missing plugin) surface NOW rather than
  // mid-B1.
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      // Single catch-all element so the plugin doesn't emit
      // 'Please provide element descriptors' on every lint run.
      // B1 replaces this with the real FSD layer mapping
      // (app / pages / widgets / features / entities / shared /
      // generated) — see docs/architecture/fsd.md (created in A4).
      'boundaries/elements': [
        { type: 'src', pattern: 'src/**/*' },
      ],
      'boundaries/include': ['src/**/*'],
    },
    rules: {
      // Permissive defaults. B1 flips to disallow + explicit allow.
      'boundaries/element-types': [
        'warn',
        {
          default: 'allow',
          rules: [],
        },
      ],
    },
  },
];
