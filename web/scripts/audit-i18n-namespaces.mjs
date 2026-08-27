#!/usr/bin/env node
/**
 * Guards literal dotted i18n keys against accidental new top-level namespaces.
 *
 * Existing untranslated namespaces are tracked in a reviewed baseline so the
 * report remains actionable: new misses fail the build rather than producing
 * endless runtime missing-key requests.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(__dirname, '..')
const SOURCE_ROOT = join(WEB_ROOT, 'src')
const CATALOG_PATH = join(SOURCE_ROOT, 'i18n', 'en.json')
const BASELINE_PATH = join(SOURCE_ROOT, 'i18n', 'namespace-audit-baseline.json')
const WRITE_BASELINE = process.argv.includes('--write-baseline')
const STRICT = process.argv.includes('--strict')
const DOTTED_KEY_PATTERN = /\bt\(\s*['"`]([A-Za-z][A-Za-z0-9_-]*)\.[^'"`$]*['"`]/g
const DOTLESS_KEY_PATTERN = /\bt\(\s*['"`]([A-Za-z][A-Za-z0-9_-]*)['"`]/g

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'i18n' && entry.name !== 'node_modules') walk(path, files)
    } else if (/\.(?:ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.')) {
      files.push(path)
    }
  }
  return files
}

function inventoryKeys() {
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'))
  const known = new Set(Object.keys(catalog))
  const unknown = new Map()
  const dotless = new Map()

  for (const file of walk(SOURCE_ROOT)) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(DOTTED_KEY_PATTERN)) {
      const namespace = match[1]
      if (known.has(namespace)) continue
      const locations = unknown.get(namespace) ?? []
      if (locations.length < 3) locations.push(file.slice(WEB_ROOT.length + 1))
      unknown.set(namespace, locations)
    }
    for (const match of source.matchAll(DOTLESS_KEY_PATTERN)) {
      const key = match[1]
      const locations = dotless.get(key) ?? []
      if (locations.length < 3) locations.push(file.slice(WEB_ROOT.length + 1))
      dotless.set(key, locations)
    }
  }
  return {
    dotted: Object.fromEntries([...unknown].sort(([a], [b]) => a.localeCompare(b))),
    dotless: Object.fromEntries([...dotless].sort(([a], [b]) => a.localeCompare(b))),
  }
}

function main() {
  const inventory = inventoryKeys()
  const unknown = inventory.dotted
  if (WRITE_BASELINE) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(inventory, null, 2)}\n`)
    console.log(`[i18n-namespace-audit] wrote ${Object.keys(unknown).length} known dotted misses and ${Object.keys(inventory.dotless).length} dotless labels`)
    return
  }

  if (!existsSync(BASELINE_PATH)) {
    console.error('[i18n-namespace-audit] baseline missing; run with --write-baseline')
    process.exit(1)
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  const baselineDotted = baseline.dotted ?? baseline
  const baselineDotless = baseline.dotless ?? {}
  const newMisses = Object.keys(unknown).filter((namespace) => !(namespace in baselineDotted))
  const resolved = Object.keys(baselineDotted).filter((namespace) => !(namespace in unknown))
  const newDotless = Object.keys(inventory.dotless).filter((key) => !(key in baselineDotless))

  console.log(
    `[i18n-namespace-audit] ${Object.keys(unknown).length} known dotted misses, ${Object.keys(inventory.dotless).length} dotless labels, ${newMisses.length} new dotted, ${newDotless.length} new dotless`,
  )
  if (newMisses.length > 0) {
    console.error('[i18n-namespace-audit] new unresolved namespaces:')
    for (const namespace of newMisses) {
      console.error(`  - ${namespace}: ${unknown[namespace].join(', ')}`)
    }
    if (STRICT) process.exit(1)
  }
  if (newDotless.length > 0) {
    console.log(`[i18n-namespace-audit] new dotless labels stay source-local: ${newDotless.join(', ')}`)
  }
}

main()
