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
 *   5. **the drift check can see every lazy() call** — a route written with a
 *      specifier form the regex misses would pass the set comparison and fail
 *      only the count, with a message that names neither the route nor the
 *      cause,
 *   6. **names match App.tsx bindings** — a mirrored-but-misnamed entry sends
 *      whoever reads a smoke failure to the wrong route,
 *   7. a real, callable loader that resolves to a module with a default export.
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
// Same, but capturing the binding name so the manifest's `name` can be checked
// against what App.tsx actually calls the route.
const APP_LAZY_NAMED_RE =
  /const\s+(\w+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*['"](\.\/[^'"]+)['"]\s*\)\s*\)/g
// Every lazy() call site, regardless of specifier form. Used to prove the two
// regexes above see ALL of them.
const APP_LAZY_ANY_RE = /lazy\(\s*\(\)/g

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

/** `features/x/pages/YPage` → the `const Y` App.tsx binds it to. */
const appNamesByKey = new Map<string, string>()
for (const m of appSource.matchAll(APP_LAZY_NAMED_RE)) {
  appNamesByKey.set(toKey(m[2]), m[1])
}

/** `features/x/pages/YPage` → the `name` the manifest gives it. */
const listNamesByKey = new Map<string, string>()
for (const entry of LAZY_ROUTE_IMPORTS) {
  const spec = listSpecifiers[LAZY_ROUTE_IMPORTS.indexOf(entry)]
  if (spec) listNamesByKey.set(toKey(spec), entry.name)
}

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

  it('sees EVERY lazy() call in App.tsx — no specifier form escapes the drift check', () => {
    // The drift check above compares *parsed specifier sets*, while the count
    // check compares *totals*. If a route is added with a specifier form the
    // specifier regex cannot see — an alias (`@/features/…`), a template
    // literal, a multi-line import — the set comparison silently passes and
    // only the count fails, with a message that says nothing about which
    // route or why.
    //
    // Pinning "the specifier regex captures all N call sites" turns that into
    // an explicit failure at the point of the mistake, and documents that
    // `const X = lazy(() => import('./…'))` is the required form.
    const totalLazyCalls = (appSource.match(APP_LAZY_ANY_RE) ?? []).length
    expect(appSpecifiers).toHaveLength(totalLazyCalls)
    expect(appNamesByKey.size).toBe(totalLazyCalls)
  })

  it('names every entry exactly as App.tsx binds it', () => {
    // The manifest's `name` is what the smoke test prints when a chunk throws.
    // A mirrored-but-misnamed entry still satisfies the drift check while
    // sending whoever reads the failure to the wrong route.
    const mismatched: string[] = []
    for (const [key, appName] of appNamesByKey) {
      const listName = listNamesByKey.get(key)
      if (listName !== undefined && listName !== appName) {
        mismatched.push(`${key}: App.tsx=${appName} manifest=${listName}`)
      }
    }
    expect(mismatched).toEqual([])
  })

  it('includes the /help route (drift regression guard)', () => {
    // `/help` hosts the help index, glossary, release notes, support bundle
    // and dashboard presets. It was lazy-loaded from App.tsx without a
    // manifest entry, which broke both lazy-route suites and left the chunk
    // un-exercised — precisely the class of miss this manifest exists to stop.
    expect(listSpecifiers).toContain('../features/system/pages/HelpPage')
    expect(LAZY_ROUTE_IMPORTS.some((r) => r.name === 'Help')).toBe(true)
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
