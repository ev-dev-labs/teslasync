#!/usr/bin/env node
/**
 * Bundle-size guard.
 *
 * Walks dist/assets/, computes gzipped size of each JS chunk, prints a
 * report, and (with `--strict`) fails the build when measurable startup,
 * vendor, route, or locale budgets are exceeded.
 *
 * Wired in two places:
 * - `npm run build` runs `postbuild` → this script in **report-only** mode,
 * so local builds always print sizes but never fail.
 * - CI calls `npm run perf:check` (= `--strict`) so regressions fail PRs.
 *
 * The limits are gzip budgets, not content hashes, so ordinary content changes
 * remain valid while regressions are actionable. Override them with
 * BUNDLE_TRANSITIVE_INITIAL_LIMIT_KB, BUNDLE_VENDOR_LIMIT_KB, BUNDLE_ROUTE_LIMIT_KB,
 * and BUNDLE_LOCALE_LIMIT_KB when profiling a release candidate.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import {
  findEntryAssetNames,
  findModulePreloadAssetNames,
} from './bundle-assets.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(__dirname, '..')
const ASSETS_DIR = join(WEB_ROOT, 'dist', 'assets')
const LOCALE_MANIFEST_PATH = join(WEB_ROOT, 'src', 'i18n', 'en', 'usage-manifest.json')
const SHELL_RESOURCE_PATH = join(WEB_ROOT, 'src', 'i18n', 'en', 'shell.json')
const RUNTIME_MANIFEST_PATH = join(WEB_ROOT, 'src', 'i18n', 'en', 'runtime-manifest.json')

const STRICT = process.argv.includes('--strict') || process.env.STRICT_BUNDLE_CHECK === '1'
const TRANSITIVE_INITIAL_LIMIT_KB = Number(process.env.BUNDLE_TRANSITIVE_INITIAL_LIMIT_KB ?? 400)
const VENDOR_LIMIT_KB = Number(process.env.BUNDLE_VENDOR_LIMIT_KB ?? 140)
const ROUTE_LIMIT_KB = Number(process.env.BUNDLE_ROUTE_LIMIT_KB ?? 100)
const LOCALE_LIMIT_KB = Number(process.env.BUNDLE_LOCALE_LIMIT_KB ?? 67)
// A per-namespace fallback exists so one missing string cannot drag an
// unrelated feature catalog along. Anything large here is a monolith in
// disguise.
const LOCALE_FALLBACK_LIMIT_KB = Number(process.env.BUNDLE_LOCALE_FALLBACK_LIMIT_KB ?? 20)
// The cold shell renders a large but bounded icon set. If nearly every icon in
// the build reaches the startup closure, the icon package has been hoisted into
// a statically imported vendor chunk again.
const STARTUP_ICON_SHARE_LIMIT = Number(process.env.BUNDLE_STARTUP_ICON_SHARE_LIMIT ?? 0.7)
// CLEAN-06: `src/features/**` is route-scoped by construction. A feature module
// in the cold-start closure means an app-root provider/listener statically
// imported a domain component. The current ceiling is the onboarding host,
// which genuinely has to decide before any route renders.
const STARTUP_FEATURE_MODULE_LIMIT = Number(process.env.BUNDLE_STARTUP_FEATURE_MODULE_LIMIT ?? 16)

function fmtKB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`
}

function classify(name, entryNames) {
  if (entryNames.has(name)) return 'entry'
  if (name.startsWith('locale-')) return 'locale'
  if (name.startsWith('vendor-')) return 'vendor'
  return 'route'
}

function staticDependencies(contents) {
  const dependencies = new Set()
  const pattern = /(?:\bfrom\s*|\bimport\s*)["']\.\/([^"']+\.js)["']/g
  for (const match of contents.matchAll(pattern)) dependencies.add(match[1])
  return dependencies
}

function localeBundleDetails(name, manifest) {
  const grouped = Object.keys(manifest.bundles ?? {})
  const detail = (manifest.detailNamespaces ?? []).map((namespace) => `detail-${namespace}`)
  const bundle = [...grouped, ...detail]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => name.startsWith(`locale-${candidate}-`))
  if (!bundle) return { bundle: 'unknown', namespaces: [], perNamespace: false }
  if (bundle.startsWith('detail-')) {
    return { bundle, namespaces: [bundle.slice('detail-'.length)], perNamespace: true }
  }
  return { bundle, namespaces: manifest.bundles[bundle] ?? [], perNamespace: false }
}

function verifyLocaleBundleNameFixtures() {
  const manifest = {
    bundles: {
      'action-center': ['actionCenter'],
      'vehicle-systems': ['vehicleSystems'],
      vehicles: ['vehicles'],
    },
    detailNamespaces: ['vehicles', 'toast'],
  }
  const fixtures = [
    ['locale-action-center-abc12345.js', 'action-center'],
    ['locale-vehicle-systems-abc12345.js', 'vehicle-systems'],
    ['locale-vehicles-abc12345.js', 'vehicles'],
    // The longest-name rule must not let `vehicles` shadow `detail-vehicles`.
    ['locale-detail-vehicles-abc12345.js', 'detail-vehicles'],
    ['locale-detail-toast-abc12345.js', 'detail-toast'],
  ]
  for (const [fileName, expected] of fixtures) {
    const { bundle } = localeBundleDetails(fileName, manifest)
    if (bundle !== expected) {
      throw new Error(`locale bundle fixture ${fileName} resolved ${bundle}, expected ${expected}`)
    }
  }
}

/**
 * Icon locality for the cold-start closure.
 *
 * Naming `lucide-react` in Vite's `manualChunks` hoists every icon the whole
 * app imports into one chunk the entry statically imports, so icons only a
 * lazy route ever renders get downloaded during cold start. Comparing icon
 * modules inside the startup closure against icon modules across the whole
 * build detects that regression without needing lucide's alias table
 * (`AlertCircle` → `circle-alert`), which would otherwise make a name-based
 * comparison quietly wrong.
 */
function startupIconLocality(startupNames, assetsDir) {
  const iconsIn = (name) => {
    const mapPath = join(assetsDir, `${name}.map`)
    if (!existsSync(mapPath)) return []
    const map = JSON.parse(readFileSync(mapPath, 'utf8'))
    return map.sources
      .map((source) => source.replaceAll('\\', '/'))
      .filter((source) => /lucide-react\/dist\/esm\/icons\//.test(source))
      .map((source) => source.split('/').pop().replace(/\.(?:js|mjs)$/, ''))
  }
  const startup = new Set()
  for (const name of startupNames) for (const icon of iconsIn(name)) startup.add(icon)
  const all = new Set()
  for (const name of readdirSync(assetsDir).filter((file) => file.endsWith('.js'))) {
    for (const icon of iconsIn(name)) all.add(icon)
  }
  return {
    startup: startup.size,
    all: all.size,
    share: all.size === 0 ? 0 : startup.size / all.size,
  }
}

/**
 * Feature-domain locality for the cold-start closure (CLEAN-06).
 *
 * Everything a globally-mounted provider or listener statically imports is
 * cold-start weight, whatever route the user actually opened. `src/features/**`
 * is by definition route-scoped, so a feature module reaching the startup
 * closure means an app-root component pulled a domain component in with it —
 * which is how `AchievementUnlockListener` dragged
 * `features/analytics/components/AchievementBadge` into the entry chunk.
 *
 * This is a ceiling, not a zero: the onboarding host is legitimately global
 * (it must decide whether to show a hint before any route renders). The number
 * may only go down without a deliberate edit here.
 */
function startupFeatureModules(startupNames, assetsDir) {
  const modules = new Set()
  for (const name of startupNames) {
    const mapPath = join(assetsDir, `${name}.map`)
    if (!existsSync(mapPath)) continue
    const map = JSON.parse(readFileSync(mapPath, 'utf8'))
    for (const source of map.sources ?? []) {
      const normalized = source.replaceAll('\\', '/')
      const index = normalized.indexOf('/src/features/')
      if (index === -1) continue
      modules.add(normalized.slice(index + 1))
    }
  }
  const byDomain = new Map()
  for (const module of modules) {
    const domain = module.split('/')[2] ?? 'unknown'
    byDomain.set(domain, (byDomain.get(domain) ?? 0) + 1)
  }
  return { modules, byDomain }
}

function main() {
  verifyLocaleBundleNameFixtures()
  if (!existsSync(ASSETS_DIR) || !statSync(ASSETS_DIR).isDirectory()) {
    console.warn('[bundle-size] dist/assets/ not found — skipping (run `npm run build` first)')
    return
  }

  const entryNames = findEntryAssetNames(dirname(ASSETS_DIR))
  if (entryNames.size === 0) {
    console.error('[bundle-size] no module entry found in dist/index.html')
    if (STRICT) process.exit(1)
  }
  const preloadedNames = findModulePreloadAssetNames(dirname(ASSETS_DIR))
  const localeManifest = existsSync(LOCALE_MANIFEST_PATH)
    ? JSON.parse(readFileSync(LOCALE_MANIFEST_PATH, 'utf8'))
    : { bundles: {} }
  const files = readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.js'))
  const rows = files.map((name) => {
    const raw = readFileSync(join(ASSETS_DIR, name))
    const gz = gzipSync(raw).length
    return {
      name,
      kind: classify(name, entryNames),
      preloaded: preloadedNames.has(name),
      raw: raw.length,
      gz,
    }
  }).sort((a, b) => b.gz - a.gz)
  const rowsByName = new Map(rows.map((row) => [row.name, row]))

  const totals = rows.reduce(
    (acc, r) => {
      acc.raw += r.raw
      acc.gz += r.gz
      acc.byKind[r.kind] = (acc.byKind[r.kind] ?? 0) + r.gz
      return acc
    },
    { raw: 0, gz: 0, byKind: {} },
  )

  console.log('\n[bundle-size] per-chunk (sorted by gzipped size)')
  console.log('  kind     preload  gzip       raw        name')
  console.log('  -------  -------  ---------  ---------  ----------------------------------------')
  for (const r of rows) {
    console.log(
      `  ${r.kind.padEnd(7)}  ${(r.preloaded ? 'yes' : 'no').padEnd(7)}  ${fmtKB(r.gz).padStart(9)}  ${fmtKB(r.raw).padStart(9)}  ${r.name}`,
    )
  }
  console.log('  -------  -------  ---------  ---------  ----------------------------------------')
  console.log(`  TOTAL              ${fmtKB(totals.gz).padStart(9)}  ${fmtKB(totals.raw).padStart(9)}  ${rows.length} chunks`)
  for (const [kind, gz] of Object.entries(totals.byKind)) {
    console.log(`  ${kind.padEnd(7).padStart(9)}${''.padStart(2)}${fmtKB(gz).padStart(9)}`)
  }
  const startupNames = new Set(entryNames)
  const pending = [...entryNames]
  while (pending.length > 0) {
    const name = pending.pop()
    if (!name) continue
    const row = rowsByName.get(name)
    if (!row) continue
    for (const dependency of staticDependencies(readFileSync(join(ASSETS_DIR, name), 'utf8'))) {
      if (!startupNames.has(dependency) && rowsByName.has(dependency)) {
        startupNames.add(dependency)
        pending.push(dependency)
      }
    }
  }
  const transitiveInitialGzip = [...startupNames]
    .reduce((sum, name) => sum + (rowsByName.get(name)?.gz ?? 0), 0)
  console.log(
    `  startup JS${fmtKB(transitiveInitialGzip).padStart(11)}  (${startupNames.size} transitive static requests)`,
  )
  if (existsSync(SHELL_RESOURCE_PATH)) {
    console.log(
      `  shell locale${fmtKB(gzipSync(readFileSync(SHELL_RESOURCE_PATH)).length).padStart(10)}  (embedded in startup JS)`,
    )
  }
  if (existsSync(RUNTIME_MANIFEST_PATH)) {
    console.log(
      `  locale map${fmtKB(gzipSync(readFileSync(RUNTIME_MANIFEST_PATH)).length).padStart(12)}  (embedded in startup JS)`,
    )
  }
  const icons = startupIconLocality(startupNames, ASSETS_DIR)
  const mapCount = readdirSync(ASSETS_DIR).filter((file) => file.endsWith('.js.map')).length
  if (icons.all > 0) {
    console.log(
      `  icons     ${String(icons.startup).padStart(10)}  of ${icons.all} icon modules reach the startup closure (${(icons.share * 100).toFixed(0)}%)`,
    )
  }
  const features = startupFeatureModules(startupNames, ASSETS_DIR)
  const featureSummary = [...features.byDomain]
    .sort((left, right) => right[1] - left[1])
    .map(([domain, count]) => `${domain}:${count}`)
    .join(' ')
  if (mapCount === 0) {
    console.log(
      '  locality           n/a  (no source maps in dist/assets — icon and feature locality '
      + 'need module attribution; rebuild with VITE_SOURCEMAP_MODE=private)',
    )
  } else {
    console.log(
      `  features  ${String(features.modules.size).padStart(10)}  route-scoped module(s) reach the startup closure`
      + `${featureSummary ? ` (${featureSummary})` : ''}`,
    )
  }

  // Check budgets
  const failures = []
  if (STRICT && mapCount === 0) {
    failures.push(
      'no source maps in dist/assets — the startup icon-locality and feature-locality '
      + 'checks silently measure nothing without module attribution. Build the strict '
      + 'run with VITE_SOURCEMAP_MODE=private (hidden maps, CI-only, never published).',
    )
  }
  const initialKB = transitiveInitialGzip / 1024
  if (initialKB > TRANSITIVE_INITIAL_LIMIT_KB) {
    failures.push(
      `startup JS = ${fmtKB(transitiveInitialGzip)} exceeds budget ${TRANSITIVE_INITIAL_LIMIT_KB} KB`,
    )
  }
  if (icons.all > 0 && icons.share > STARTUP_ICON_SHARE_LIMIT) {
    failures.push(
      `startup closure carries ${icons.startup}/${icons.all} icon modules `
      + `(${(icons.share * 100).toFixed(0)}%, limit ${(STARTUP_ICON_SHARE_LIMIT * 100).toFixed(0)}%) — `
      + 'rollupOptions.output.manualChunks must not force-group lucide-react, or every '
      + "lazy route's icons are downloaded during cold start",
    )
  }
  if (features.modules.size > STARTUP_FEATURE_MODULE_LIMIT) {
    failures.push(
      `startup closure carries ${features.modules.size} route-scoped src/features/** module(s) `
      + `(limit ${STARTUP_FEATURE_MODULE_LIMIT}): `
      + `${[...features.modules].sort().slice(0, 12).join(', ')}`
      + `${features.modules.size > 12 ? ` … (+${features.modules.size - 12})` : ''} — `
      + 'a globally-mounted provider or listener is statically importing a feature component. '
      + 'Keep the subscription eager and put the UI behind React.lazy + Suspense '
      + '(see components/feedback/AchievementUnlockListener.tsx).',
    )
  }
  for (const r of rows) {
    const kb = r.gz / 1024
    if (r.kind === 'vendor' && kb > VENDOR_LIMIT_KB) {
      failures.push(`vendor chunk ${r.name} = ${fmtKB(r.gz)} exceeds budget ${VENDOR_LIMIT_KB} KB`)
    } else if (r.kind === 'route' && kb > ROUTE_LIMIT_KB) {
      failures.push(`route chunk ${r.name} = ${fmtKB(r.gz)} exceeds budget ${ROUTE_LIMIT_KB} KB`)
    } else if (r.kind === 'locale') {
      const { bundle, namespaces, perNamespace } = localeBundleDetails(r.name, localeManifest)
      const limit = perNamespace ? LOCALE_FALLBACK_LIMIT_KB : LOCALE_LIMIT_KB
      if (kb > limit) {
        const namespaceSummary = namespaces.length > 12
          ? `${namespaces.slice(0, 12).join(', ')}, … (+${namespaces.length - 12})`
          : namespaces.join(', ')
        failures.push(
          `locale bundle ${bundle} (${namespaceSummary || 'unknown namespaces'}) = ${fmtKB(r.gz)} exceeds budget ${limit} KB`,
        )
      }
    }
  }

  if (failures.length === 0) {
    console.log(
      `\n[bundle-size] OK (transitive startup ≤ ${TRANSITIVE_INITIAL_LIMIT_KB} KB, vendor ≤ ${VENDOR_LIMIT_KB} KB, route ≤ ${ROUTE_LIMIT_KB} KB, locale ≤ ${LOCALE_LIMIT_KB} KB, per-namespace locale fallback ≤ ${LOCALE_FALLBACK_LIMIT_KB} KB)\n`,
    )
    return
  }

  console.log('\n[bundle-size] BUDGET VIOLATIONS:')
  for (const f of failures) console.log(`  - ${f}`)
  if (STRICT) {
    console.error('\n[bundle-size] failing build (strict mode)')
    process.exit(1)
  } else {
    console.warn('\n[bundle-size] WARN only (rerun with --strict to fail)\n')
  }
}

main()
