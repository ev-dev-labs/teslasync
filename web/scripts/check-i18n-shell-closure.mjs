#!/usr/bin/env node
/**
 * Independently proves that every translated namespace in the actual static
 * entry chunk closure is shell-owned. It reads Rollup sourcemaps rather than
 * trusting the generator's source-group assignments.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { findEntryAssetNames } from './bundle-assets.mjs'
import { runtimeModuleSpecifiers, translationNamespaces } from './i18n-source-graph.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(__dirname, '..')
const DIST_ROOT = join(WEB_ROOT, 'dist')
const ASSETS_DIR = join(DIST_ROOT, 'assets')
const I18N_DIR = join(WEB_ROOT, 'src', 'i18n', 'en')
const MIN_STATIC_NAMESPACES = Number(process.env.I18N_MIN_STATIC_NAMESPACES ?? 40)

function staticDependencies(contents) {
  const dependencies = new Set()
  for (const match of contents.matchAll(/(?:\bfrom\s*|\bimport\s*)["']\.\/([^"']+\.js)["']/g)) {
    dependencies.add(match[1])
  }
  return dependencies
}

export function sourcePath(mapSource) {
  const value = decodeURIComponent(mapSource.replace(/^file:\/\//i, '')).replaceAll('\\', '/')
  const segments = value.split('/').filter(Boolean)
  const sourceIndex = segments.lastIndexOf('src')
  return sourceIndex === -1 ? null : join(WEB_ROOT, ...segments.slice(sourceIndex))
}

function verifySourcePathFixtures() {
  const expected = join(WEB_ROOT, 'src', 'components', 'ui', 'Button.tsx')
  for (const fixture of [
    '../../src/components/ui/Button.tsx',
    'file:///workspace/TeslaSync/web/src/components/ui/Button.tsx',
    'F:\\github\\TeslaSync\\web\\src\\components\\ui\\Button.tsx',
  ]) {
    if (sourcePath(fixture) !== expected) {
      throw new Error(`source path fixture failed for ${fixture}`)
    }
  }
}

function verifyTypeDependencyFixtures() {
  const fixtures = [
    ['import type { Model } from "./types"', []],
    ['export type { Model } from "./types"', []],
    ['import { type Model, render } from "./mixed"', ['./mixed']],
    ['export { type Model, render } from "./mixed"', ['./mixed']],
  ]
  for (const [source, expected] of fixtures) {
    const actual = [...runtimeModuleSpecifiers(source)].sort()
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`type dependency fixture failed for ${source}: ${actual.join(',')}`)
    }
  }
}

function main() {
  verifySourcePathFixtures()
  verifyTypeDependencyFixtures()
  if (!existsSync(ASSETS_DIR)) {
    console.error('[i18n-shell-closure] dist/assets missing; run build first')
    process.exit(1)
  }
  const entries = findEntryAssetNames(DIST_ROOT)
  const files = new Set(readdirSync(ASSETS_DIR).filter((name) => name.endsWith('.js')))
  const closure = new Set(entries)
  const pending = [...entries]
  while (pending.length > 0) {
    const name = pending.pop()
    if (!name) continue
    for (const dependency of staticDependencies(readFileSync(join(ASSETS_DIR, name), 'utf8'))) {
      if (files.has(dependency) && !closure.has(dependency)) {
        closure.add(dependency)
        pending.push(dependency)
      }
    }
  }

  const catalog = JSON.parse(readFileSync(join(WEB_ROOT, 'src', 'i18n', 'en.json'), 'utf8'))
  const manifest = JSON.parse(readFileSync(join(I18N_DIR, 'usage-manifest.json'), 'utf8'))
  const shell = JSON.parse(readFileSync(join(I18N_DIR, 'shell.json'), 'utf8'))
  const namespaces = new Set()
  let mappedSources = 0
  const missingMaps = []

  for (const asset of closure) {
    const mapPath = join(ASSETS_DIR, `${asset}.map`)
    if (!existsSync(mapPath)) {
      missingMaps.push(asset)
      continue
    }
    const map = JSON.parse(readFileSync(mapPath, 'utf8'))
    for (const source of map.sources ?? []) {
      const file = sourcePath(source)
      if (!file || !existsSync(file) || !/\.(?:ts|tsx)$/.test(file)) continue
      mappedSources += 1
      for (const namespace of translationNamespaces(file)) {
        if (namespace in catalog) namespaces.add(namespace)
      }
    }
  }

  const failures = [...namespaces].filter(
    (namespace) => manifest.namespaceToBundle[namespace] !== 'shell' || !(namespace in shell),
  )
  const shellGzip = gzipSync(readFileSync(join(I18N_DIR, 'shell.json'))).length
  console.log(
    `[i18n-shell-closure] ${closure.size} static assets, ${mappedSources} mapped sources, ${namespaces.size} translated namespaces, ${(shellGzip / 1024).toFixed(1)} KB shell gzip`,
  )
  if (missingMaps.length > 0 || mappedSources === 0 || namespaces.size < MIN_STATIC_NAMESPACES) {
    console.error(
      `[i18n-shell-closure] invalid evidence: missing maps=${missingMaps.join(',') || 'none'}, mapped sources=${mappedSources}, namespaces=${namespaces.size}, minimum=${MIN_STATIC_NAMESPACES}`,
    )
    process.exit(1)
  }
  if (failures.length > 0) {
    console.error(`[i18n-shell-closure] non-shell static namespaces: ${failures.join(', ')}`)
    process.exit(1)
  }
}

main()
