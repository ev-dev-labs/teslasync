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

const STRICT = process.argv.includes('--strict') || process.env.STRICT_BUNDLE_CHECK === '1'
const TRANSITIVE_INITIAL_LIMIT_KB = Number(process.env.BUNDLE_TRANSITIVE_INITIAL_LIMIT_KB ?? 410)
const VENDOR_LIMIT_KB = Number(process.env.BUNDLE_VENDOR_LIMIT_KB ?? 140)
const ROUTE_LIMIT_KB = Number(process.env.BUNDLE_ROUTE_LIMIT_KB ?? 100)
const LOCALE_LIMIT_KB = Number(process.env.BUNDLE_LOCALE_LIMIT_KB ?? 67)

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
  const bundle = Object.keys(manifest.bundles ?? {})
    .sort((left, right) => right.length - left.length)
    .find((candidate) => name.startsWith(`locale-${candidate}-`))
  const namespaces = bundle ? manifest.bundles[bundle] ?? [] : []
  return { bundle: bundle ?? 'unknown', namespaces }
}

function verifyLocaleBundleNameFixtures() {
  const manifest = {
    bundles: {
      'action-center': ['actionCenter'],
      'vehicle-systems': ['vehicleSystems'],
      vehicles: ['vehicles'],
    },
  }
  const fixtures = [
    ['locale-action-center-abc12345.js', 'action-center'],
    ['locale-vehicle-systems-abc12345.js', 'vehicle-systems'],
  ]
  for (const [fileName, expected] of fixtures) {
    const { bundle } = localeBundleDetails(fileName, manifest)
    if (bundle !== expected) {
      throw new Error(`locale bundle fixture ${fileName} resolved ${bundle}, expected ${expected}`)
    }
  }
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

  // Check budgets
  const failures = []
  const initialKB = transitiveInitialGzip / 1024
  if (initialKB > TRANSITIVE_INITIAL_LIMIT_KB) {
    failures.push(
      `startup JS = ${fmtKB(transitiveInitialGzip)} exceeds budget ${TRANSITIVE_INITIAL_LIMIT_KB} KB`,
    )
  }
  for (const r of rows) {
    const kb = r.gz / 1024
    if (r.kind === 'vendor' && kb > VENDOR_LIMIT_KB) {
      failures.push(`vendor chunk ${r.name} = ${fmtKB(r.gz)} exceeds budget ${VENDOR_LIMIT_KB} KB`)
    } else if (r.kind === 'route' && kb > ROUTE_LIMIT_KB) {
      failures.push(`route chunk ${r.name} = ${fmtKB(r.gz)} exceeds budget ${ROUTE_LIMIT_KB} KB`)
    } else if (r.kind === 'locale' && kb > LOCALE_LIMIT_KB) {
      const { bundle, namespaces } = localeBundleDetails(r.name, localeManifest)
      const namespaceSummary = namespaces.length > 12
        ? `${namespaces.slice(0, 12).join(', ')}, … (+${namespaces.length - 12})`
        : namespaces.join(', ')
      failures.push(
        `locale bundle ${bundle} (${namespaceSummary || 'unknown namespaces'}) = ${fmtKB(r.gz)} exceeds budget ${LOCALE_LIMIT_KB} KB`,
      )
    }
  }

  if (failures.length === 0) {
    console.log(
      `\n[bundle-size] OK (transitive startup ≤ ${TRANSITIVE_INITIAL_LIMIT_KB} KB, vendor ≤ ${VENDOR_LIMIT_KB} KB, route ≤ ${ROUTE_LIMIT_KB} KB, locale ≤ ${LOCALE_LIMIT_KB} KB)\n`,
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
