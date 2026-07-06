import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { LAZY_ROUTE_IMPORTS } from './lazyRoutes.list'

/**
 * `lazyRoutes.list.ts` is a hand-maintained manifest that MUST mirror every
 * `lazy(() => import('./…'))` in `App.tsx`. It is a pure data module — there is
 * no component or hook to render — so this suite verifies the *invariants* that
 * make the manifest trustworthy rather than doing a DOM smoke render:
 *
 *   1. structural integrity of every entry,
 *   2. name + specifier uniqueness (a copy/paste dup silently shadows a route
 *      in the smoke report),
 *   3. every referenced module actually exists on disk (catches path typos
 *      without paying the smoke test's 30s-per-chunk import cost),
 *   4. **zero drift vs App.tsx** — the contract the file exists to uphold, and
 *      the exact bug this elevation fixed (13 admin/settings/explore routes had
 *      been added to App.tsx but never mirrored here, leaving the parity smoke
 *      test red and 13 chunks un-exercised),
 *   5. a real, callable loader that resolves to a module with a default export.
 *
 * Paths/specifiers are parsed from source text (via fs) rather than from
 * `load.toString()` because Vite's SSR/test transform rewrites dynamic
 * `import()` specifiers, which would mangle the function body.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const listSource = fs.readFileSync(path.join(here, 'lazyRoutes.list.ts'), 'utf8')
const appSource = fs.readFileSync(path.join(here, '..', 'App.tsx'), 'utf8')

// `{ name: 'X', load: () => import('../features/…') }`
const LIST_IMPORT_RE = /load:\s*\(\)\s*=>\s*import\(\s*['"](\.\.\/[^'"]+)['"]\s*\)/g
// `const X = lazy(() => import('./features/…'))`
const APP_LAZY_RE = /lazy\(\s*\(\)\s*=>\s*import\(\s*['"](\.\/[^'"]+)['"]\s*\)\s*\)/g

const specifiersFrom = (source: string, re: RegExp): string[] => {
  const out: string[] = []
  for (const m of source.matchAll(re)) out.push(m[1])
  return out
}

// Normalize `./features/x` and `../features/x` to a comparable `features/x` key.
const toKey = (spec: string): string => spec.replace(/^\.\.?\//, '')

const MODULE_EXTS = ['.tsx', '.ts', '/index.tsx', '/index.ts']
const resolvesOnDisk = (spec: string): boolean => {
  const base = path.resolve(here, spec) // spec is `../features/…`, relative to __tests__/
  return MODULE_EXTS.some((ext) => fs.existsSync(base + ext))
}

const listSpecifiers = specifiersFrom(listSource, LIST_IMPORT_RE)
const appSpecifiers = specifiersFrom(appSource, APP_LAZY_RE)

describe('LAZY_ROUTE_IMPORTS manifest', () => {
  it('exports a non-empty array of well-formed { name, load } entries', () => {
    expect(Array.isArray(LAZY_ROUTE_IMPORTS)).toBe(true)
    expect(LAZY_ROUTE_IMPORTS.length).toBeGreaterThan(100)

    const malformed = LAZY_ROUTE_IMPORTS.filter(
      (r) =>
        typeof r?.name !== 'string' ||
        r.name.trim().length === 0 ||
        typeof r?.load !== 'function' ||
        r.load.length !== 0, // dynamic-import thunks take no arguments
    )
    expect(malformed).toEqual([])
  })

  it('has no duplicate route names', () => {
    const seen = new Set<string>()
    const duplicates: string[] = []
    for (const { name } of LAZY_ROUTE_IMPORTS) {
      if (seen.has(name)) duplicates.push(name)
      seen.add(name)
    }
    expect(duplicates).toEqual([])
    // Every entry contributes a distinct name.
    expect(seen.size).toBe(LAZY_ROUTE_IMPORTS.length)
  })

  it('parses one ../features/* specifier per entry with no duplicates', () => {
    // The source regex must capture exactly as many specifiers as there are
    // runtime entries — proof the parse below is complete, not partial.
    expect(listSpecifiers).toHaveLength(LAZY_ROUTE_IMPORTS.length)
    for (const spec of listSpecifiers) expect(spec).toMatch(/^\.\.\/features\//)

    const seen = new Set<string>()
    const duplicates: string[] = []
    for (const spec of listSpecifiers) {
      if (seen.has(spec)) duplicates.push(spec)
      seen.add(spec)
    }
    expect(duplicates).toEqual([])
  })

  it('references only page modules that exist on disk', () => {
    const missing = listSpecifiers.filter((spec) => !resolvesOnDisk(spec))
    expect(missing).toEqual([])
  })

  it('mirrors every lazy(() => import()) in App.tsx with no drift', () => {
    const appKeys = new Set(appSpecifiers.map(toKey))
    const listKeys = new Set(listSpecifiers.map(toKey))

    const notMirrored = [...appKeys].filter((k) => !listKeys.has(k))
    const stale = [...listKeys].filter((k) => !appKeys.has(k))
    expect(notMirrored).toEqual([]) // App route missing from the list
    expect(stale).toEqual([]) // list entry pointing at a removed App route

    // Guard the same textual contract the smoke test enforces, so drift is
    // caught here too (App.tsx counts `lazy(()` occurrences).
    const appLazyCount = (appSource.match(/lazy\(\s*\(\)/g) ?? []).length
    expect(LAZY_ROUTE_IMPORTS.length).toBe(appLazyCount)
  })

  it('includes the phase-45/phase-50 admin, settings & explore routes (drift regression guard)', () => {
    const required = [
      '../features/admin/pages/DLQInspectorPage',
      '../features/admin/pages/FeatureFlagsPage',
      '../features/admin/pages/IngestXRayPage',
      '../features/admin/pages/LiveSignalInspectorPage',
      '../features/admin/pages/SchemaDriftPage',
      '../features/admin/pages/SlowQueriesPage',
      '../features/admin/pages/VehicleCostPage',
      '../features/admin/pages/DiskForecastPage',
      '../features/admin/pages/SecretRotationPage',
      '../features/admin/pages/AuditLogPage',
      '../features/admin/pages/GDPRExportPage',
      '../features/settings/pages/HelixPage',
      '../features/explore/pages/ExplorePage',
    ]
    const present = new Set(listSpecifiers)
    const stillMissing = required.filter((spec) => !present.has(spec))
    expect(stillMissing).toEqual([])
  })

  it('exposes callable loaders that resolve to a module with a default export', async () => {
    // LegacyAlertsRedirect only imports react-router-dom at module scope, so
    // its chunk evaluates cheaply and deterministically — no network, no heavy
    // chart/leaflet transform — while still exercising the real load() path.
    const entry = LAZY_ROUTE_IMPORTS.find((r) => r.name === 'LegacyAlertsRedirect')
    expect(entry).toBeDefined()
    if (!entry) throw new Error('LegacyAlertsRedirect entry is missing from the manifest')

    const pending = entry.load()
    expect(typeof (pending as Promise<unknown>).then).toBe('function')

    const mod = (await pending) as { default?: unknown }
    expect(mod).toHaveProperty('default')
    expect(typeof mod.default).toBe('function')
  })
})
