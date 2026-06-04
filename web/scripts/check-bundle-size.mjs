#!/usr/bin/env node
/**
 * Bundle-size guard.
 *
 * Walks dist/assets/, computes gzipped size of each JS chunk, prints a
 * report, and (with `--strict`) fails the build when the entry chunk
 * exceeds ENTRY_LIMIT_KB or any vendor/route chunk exceeds CHUNK_LIMIT_KB.
 *
 * Wired in two places:
 * - `npm run build` runs `postbuild` → this script in **report-only** mode,
 * so local builds always print sizes but never fail.
 * - CI calls `npm run perf:check` (= `--strict`) so regressions fail PRs.
 *
 * Limits intentionally start generous (entry 350 KB / chunk 600 KB gzip)
 * so the gate ships without flapping; tighten via env vars
 * (BUNDLE_ENTRY_LIMIT_KB / BUNDLE_CHUNK_LIMIT_KB) once measured baselines
 * are in `web/perf-baseline.json`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(__dirname, '..')
const ASSETS_DIR = join(WEB_ROOT, 'dist', 'assets')

const STRICT = process.argv.includes('--strict') || process.env.STRICT_BUNDLE_CHECK === '1'
const ENTRY_LIMIT_KB = Number(process.env.BUNDLE_ENTRY_LIMIT_KB ?? 350)
const CHUNK_LIMIT_KB = Number(process.env.BUNDLE_CHUNK_LIMIT_KB ?? 600)

function fmtKB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`
}

function classify(name) {
  if (name.startsWith('index-')) return 'entry'
  if (name.startsWith('vendor-')) return 'vendor'
  return 'route'
}

function main() {
  if (!existsSync(ASSETS_DIR) || !statSync(ASSETS_DIR).isDirectory()) {
    console.warn('[bundle-size] dist/assets/ not found — skipping (run `npm run build` first)')
    return
  }

  const files = readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.js'))
  const rows = files.map((name) => {
    const raw = readFileSync(join(ASSETS_DIR, name))
    const gz = gzipSync(raw).length
    return { name, kind: classify(name), raw: raw.length, gz }
  }).sort((a, b) => b.gz - a.gz)

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
  console.log('  kind     gzip       raw        name')
  console.log('  -------  ---------  ---------  ----------------------------------------')
  for (const r of rows) {
    console.log(
      `  ${r.kind.padEnd(7)}  ${fmtKB(r.gz).padStart(9)}  ${fmtKB(r.raw).padStart(9)}  ${r.name}`,
    )
  }
  console.log('  -------  ---------  ---------  ----------------------------------------')
  console.log(`  TOTAL              ${fmtKB(totals.gz).padStart(9)}  ${fmtKB(totals.raw).padStart(9)}  ${rows.length} chunks`)
  for (const [kind, gz] of Object.entries(totals.byKind)) {
    console.log(`  ${kind.padEnd(7).padStart(9)}${''.padStart(2)}${fmtKB(gz).padStart(9)}`)
  }

  // Check budgets
  const failures = []
  for (const r of rows) {
    const kb = r.gz / 1024
    if (r.kind === 'entry' && kb > ENTRY_LIMIT_KB) {
      failures.push(`entry chunk ${r.name} = ${fmtKB(r.gz)} exceeds budget ${ENTRY_LIMIT_KB} KB`)
    } else if (r.kind !== 'entry' && kb > CHUNK_LIMIT_KB) {
      failures.push(`${r.kind} chunk ${r.name} = ${fmtKB(r.gz)} exceeds budget ${CHUNK_LIMIT_KB} KB`)
    }
  }

  if (failures.length === 0) {
    console.log(`\n[bundle-size] OK (entry ≤ ${ENTRY_LIMIT_KB} KB, others ≤ ${CHUNK_LIMIT_KB} KB)\n`)
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
