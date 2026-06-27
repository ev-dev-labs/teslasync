// Native parity port of web/src/vite-env.d.ts.
//
// SOURCE (web): a Vite ambient type-declaration file. Its only job in the web
// build is compile-time typing. Source line 1's
// `/// <reference types="vite/client" />` pulls in Vite's client ambient types
// (import.meta.env, import.meta.hot HMR, the *.svg/*.css asset-module
// declarations, DEV/PROD/MODE/BASE_URL/SSR), and the two global
// `interface ImportMetaEnv` / `interface ImportMeta` blocks globally augment
// `import.meta.env` so `import.meta.env.VITE_APP_VERSION` / `VITE_GIT_SHA` /
// `VITE_PWA_DEV` type-check across the web app (VersionSegment.tsx, rum.ts,
// FeedbackModal.tsx, main.tsx).
//
// WHY THIS IS A NATIVE-SAFE ADAPTATION (contract rules 4 & 7):
//   * Vite's `import.meta.env` is a build-tool / browser-ESM feature. React
//     Native bundles with Metro/Hermes, where `import.meta.env` does NOT exist
//     at runtime — reading it would be `undefined` (or throw). So the web file's
//     real behaviour (a globally-available, build-time-injected env object) is
//     genuinely UNAVAILABLE on native and must not be faked.
//   * Source line 1's `/// <reference types="vite/client" />` is therefore
//     intentionally NOT reproduced: it is a DOM / build-tool-only ambient module
//     surface (asset imports, import.meta.hot, etc.) that rule 4 forbids pulling
//     into native output.
//   * To keep the explicit "unavailable" state (rule 7), the two interfaces are
//     ported as MODULE-SCOPED exports (the `export` keyword makes this file a
//     module, not a global script). This preserves the env-var type CONTRACT
//     1:1 — every field name, the `readonly` modifier, and the optional `?` on
//     VITE_PWA_DEV are reproduced exactly — WITHOUT globally augmenting
//     `import.meta` the way the web file does. The result: native code that
//     reaches for `import.meta.env.*` gets a compile-time error instead of a
//     silently-undefined value, surfacing the unavailability at build time.
//
// NATIVE EQUIVALENT: the same three values are sourced on native from the
// platform build configuration (e.g. process.env / a generated app-config
// module), not from Vite. These interfaces document the canonical shape of that
// contract so the cross-platform env contract stays in lockstep. No runtime code
// lives here — a `.d.ts` cannot contain executable statements.

/**
 * Build-time environment contract mirrored from the web Vite app
 * (`ImportMetaEnv`). On web these keys are injected by Vite into
 * `import.meta.env`; on native the same keys come from the platform build
 * configuration. Field names, `readonly` modifiers, and optionality are kept
 * identical so the cross-platform env contract stays in lockstep.
 */
export interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
  readonly VITE_GIT_SHA: string;
  readonly VITE_PWA_DEV?: string;
}

/**
 * Mirror of the web `ImportMeta` augmentation. Exported (module-scoped) rather
 * than declared globally, so `import.meta.env` is NOT advertised as available on
 * the Metro/Hermes runtime where it does not exist.
 */
export interface ImportMeta {
  readonly env: ImportMetaEnv;
}
