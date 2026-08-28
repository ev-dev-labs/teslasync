// ESLint flat-config for the accessibility audit.
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
// rules — keeping it intact avoids unrelated config churn.
// This flat-config file:
//
// 1. Loads `.eslintrc.cjs` through the `@eslint/eslintrc` `FlatCompat`
// shim so the existing behaviour is preserved bit-for-bit.
// 2. Adds the `jsx-a11y/recommended` ruleset on top, registers the
// shared component → underlying-element mapping, and pins the
// project-required rule levels (errors for `anchor-is-valid` /
// `label-has-associated-control`; off for high-noise rules that
// still need targeted remediation).
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

// AI-off contract enforcement.
//
// Local plugin namespace `teslasync` for in-tree custom rules. The
// `ai-component-must-be-wrapped` rule statically enforces that
// every AI surface in the SPA goes through
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
  // Wire `eslint-plugin-jsx-a11y`.
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
      // Pin the project-required a11y rules at error level.
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/label-has-associated-control': 'error',
      // Disabled — pervasive on cards / menu items that *do* have a
      // keyboard equivalent via a parent <Modal>/<CommandPalette> Esc
      // handler the linter cannot statically observe. These sites are
      // tracked for conversion to <button> wrappers or explicit
      // role="button" + onKeyDown handlers.
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
  // Register `teslasync/ai-component-must-be-wrapped` for every AI
  // surface in the SPA. The rule is path-and-name aware
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
  // This block mechanizes the Feature-Sliced Design layer rules described
  // in docs/architecture/repo-reorganization-plan.md over the current
  // directory mapping. The plugin is installed here so the eventual rules
  // change is just configuration, not install plus configuration.
  //
  // Today: warn-mode, permissive rules (`default: 'allow'`). This is
  // a true no-op — no `boundaries/*` warning is possible at error or
  // warn level under these settings.
  //
  // REPORT-MODE descriptors
  // ---------------------------------------
  // The `boundaries/elements` array below declares the bounded-
  // context subdir patterns planned by the architecture plan (see
  // docs/architecture/adr/011-bounded-context-subpackages.md).
  // Today these patterns classify any file ALREADY in a planned
  // subdir under the corresponding `type` (with a `capture` group
  // exposing the bounded-context name); files still at the flat
  // parent fall through to the existing `features` / `components`
  // / `hooks` / `lib` / `api` types. Rules stay permissive so the
  // descriptors are INERT — they SHOW the intended shape in lint
  // reports without ever failing the gate.
  //
  // Pattern roots — IMPORTANT: ESLint runs with cwd=web/, so
  // descriptors are rooted at `src/...` (NOT `web/src/...`).
  // Rooting at `web/src/...` here would classify NOTHING and
  // mask R0.5 / R8-R12 progress signals.
  //
  // A future ruleset will replace `default: 'allow'` with `default:
  // 'disallow'` + explicit FSD DAG (features→entities+shared,
  // shared can't reach up, etc.) and add `boundaries/no-private`
  // at error for the `components/*` categories. The barrel-only rule
  // does NOT apply to `lib`/`hooks`; those allow direct imports like
  // `@/lib/format/date` for tree-shaking).
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        // ── Planned bounded-context subdirs (report mode) ──
        // Ordered most-specific-first so the planned-subdir types win
        // over the existing flat-layer types when a file has already
        // moved into a subdir.
        { type: 'dashboard-widget',       pattern: 'src/features/dashboard/widgets/*/**', capture: ['domain'] },
        { type: 'lib-purpose',            pattern: 'src/lib/*/**',                        capture: ['purpose'] },
        { type: 'api-hook-domain',        pattern: 'src/api/hooks/*/**',                  capture: ['domain'] },
        { type: 'app-hook-purpose',       pattern: 'src/hooks/*/**',                      capture: ['purpose'] },
        { type: 'component-ai',           pattern: 'src/components/ai/*/**',              capture: ['feature'] },
        { type: 'component-feedback',     pattern: 'src/components/feedback/*/**',        capture: ['kind'] },
        { type: 'component-data-display', pattern: 'src/components/data-display/*/**',    capture: ['kind'] },

        // ── Existing flat layers (today's reality) ──
        // These match files NOT YET migrated into a planned subdir.
        { type: 'pages',      pattern: 'src/features/*/pages/**', capture: ['feature'] },
        { type: 'features',   pattern: 'src/features/**',         capture: ['feature'] },
        { type: 'entities',   pattern: 'src/entities/**',         capture: ['entity'] },
        { type: 'components', pattern: 'src/components/**' },
        { type: 'hooks',      pattern: 'src/hooks/**' },
        { type: 'lib',        pattern: 'src/lib/**' },
        { type: 'api',        pattern: 'src/api/**' },
        { type: 'app',        pattern: 'src/{App,main}.{ts,tsx}' },
        { type: 'generated',  pattern: 'src/generated/**' },

        // Catch-all (types/, i18n/, store/, sw/, test-utils/,...).
        // Must stay LAST so the more specific patterns above can win.
        { type: 'src',        pattern: 'src/**/*' },
      ],
      'boundaries/include': ['src/**/*'],
    },
    rules: {
      // Permissive defaults. R13 flips to disallow + explicit allow.
      'boundaries/dependencies': [
        'warn',
        {
          default: 'allow',
          rules: [],
        },
      ],
    },
  },
];
