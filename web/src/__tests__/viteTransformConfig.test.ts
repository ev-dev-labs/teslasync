import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const viteConfig = readFileSync(join(webRoot, 'vite.config.ts'), 'utf8')
const pkg = JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8')) as {
  devDependencies: Record<string, string>
}

/**
 * CLEAN-02 — transform-plugin configuration contract.
 *
 * This repository loads ONE `vite.config.ts` into TWO different Vite majors:
 *
 *   `vite build` / `vite dev`  → the Vite in devDependencies (5.x, esbuild)
 *   `vitest run`               → Vitest 4's own nested Vite 8 (rolldown/OXC)
 *
 * `@vitejs/plugin-react@4` configures the automatic JSX runtime by setting
 * Vite's `esbuild` and `optimizeDeps.esbuildOptions` options. Under the OXC
 * pipeline those are deprecated in favour of `oxc` /
 * `optimizeDeps.rolldownOptions`, and loading the plugin there emitted:
 *
 *   [vite] warning: `esbuild` option was specified by "vite:react-babel" plugin.
 *                   This option is deprecated, please use `oxc` instead.
 *   [vite] warning: `optimizeDeps.esbuildOptions` option was specified by
 *                   "vite:react-babel" plugin. ... use `optimizeDeps.rolldownOptions`
 *   Both esbuild and oxc options were set. oxc options will be used and esbuild
 *   options will be ignored.
 *
 * Pinning `@vitejs/plugin-react` to a major that emits `oxc` is not available
 * here: those majors drop the Vite 5 peer range the production build runs on.
 * The supported configuration is therefore to keep the plugin on the
 * esbuild-era build path and let the OXC pipeline do its own JSX transform,
 * which it does correctly because tsconfig.json sets `"jsx": "react-jsx"`.
 *
 * These assertions fail fast on the config change that reintroduces the
 * warning. `scripts/check-vite-deprecations.mjs` is the runtime counterpart:
 * it actually boots Vitest and fails on a deprecation line in the output.
 */
describe('vite transform configuration (CLEAN-02)', () => {
  it('does not hand deprecated esbuild options to the OXC pipeline', () => {
    // The React plugin is the only thing that ever set `esbuild` here.
    expect(viteConfig).toMatch(/isVitest\s*\?\s*\[\]\s*:\s*\[react\(\)\]/)
  })

  it('never sets Vite-level `esbuild` / `optimizeDeps.esbuildOptions` directly', () => {
    const withoutComments = viteConfig
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n')
    expect(withoutComments).not.toMatch(/^\s*esbuild\s*:/m)
    expect(withoutComments).not.toMatch(/esbuildOptions\s*:/)
  })

  it('detects Vitest from the environment rather than a build mode', () => {
    // `mode`/`command` are identical for `vite build` and a Vitest run that
    // happens to build, so the guard has to key off VITEST.
    expect(viteConfig).toMatch(/const isVitest = process\.env\.VITEST !== undefined/)
  })

  it('keeps the React plugin on the build/dev path', () => {
    expect(viteConfig).toMatch(/^import react from '@vitejs\/plugin-react'$/m)
    expect(pkg.devDependencies['@vitejs/plugin-react']).toBeTruthy()
    expect(pkg.devDependencies.vite).toMatch(/\^5\./)
  })

  it('relies on the automatic JSX runtime being configured in tsconfig', () => {
    const tsconfig = readFileSync(join(webRoot, 'tsconfig.json'), 'utf8')
    // Without this, dropping plugin-react under Vitest would break every .tsx
    // test with "React is not defined".
    expect(tsconfig).toMatch(/"jsx"\s*:\s*"react-jsx"/)
  })
})
