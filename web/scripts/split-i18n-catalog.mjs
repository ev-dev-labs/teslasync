#!/usr/bin/env node
/**
 * Splits the canonical English catalog into independently loadable namespaces.
 *
 * `src/i18n/en.json` remains the only hand-edited English source. Generated
 * files are checked, never rewritten by Vite, so a production build cannot
 * leave the worktree dirty.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { staticClosure, translationKeys, translationNamespaces } from './i18n-source-graph.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const I18N_ROOT = resolve(__dirname, '..', 'src', 'i18n')
const SOURCE_PATH = join(I18N_ROOT, 'en.json')
const OUTPUT_DIR = join(I18N_ROOT, 'en')
const CHECK_ONLY = process.argv.includes('--check')
const SOURCE_ROOT = join(__dirname, '..', 'src')
const SHELL_RUNTIME_KEYS_PATH = join(I18N_ROOT, 'shell-runtime-keys.json')
const COMPLETE_SHELL_NAMESPACES = new Set(['nav'])

function serialized(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function leafKeys(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key))
}

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

function shellSourceClosure() {
  const roots = [
    join(SOURCE_ROOT, 'main.tsx'),
    join(SOURCE_ROOT, 'App.tsx'),
    // The wildcard route is intentionally part of the cold shell contract.
    join(SOURCE_ROOT, 'features', 'system', 'pages', 'NotFoundPage.tsx'),
  ]
  return staticClosure(SOURCE_ROOT, roots)
}

function sourceGroup(file, shellFiles) {
  const relative = file.slice(SOURCE_ROOT.length + 1).replaceAll('\\', '/')
  const feature = relative.match(/^features\/([^/]+)\//)?.[1]
  if (shellFiles.has(file)) return 'shell'
  if (feature) return feature
  return 'shared'
}

function isGenericSharedSource(file) {
  const relative = file.slice(SOURCE_ROOT.length + 1).replaceAll('\\', '/')
  // AI renderers are imported by individual domain routes. Their translated
  // namespaces retain domain ownership unless a real generic primitive uses
  // them across feature boundaries.
  return !relative.startsWith('components/ai/')
}

function usageManifest(catalog) {
  const usage = new Map()
  const shellFiles = shellSourceClosure()
  const sourceFiles = walk(SOURCE_ROOT)
  const shellKeys = new Set()
  const sharedNamespaces = new Set()

  for (const file of sourceFiles) {
    const group = sourceGroup(file, shellFiles)
    for (const namespace of translationNamespaces(file)) {
      if (!(namespace in catalog)) continue
      if (group === 'shared' && isGenericSharedSource(file)) sharedNamespaces.add(namespace)
      const counts = usage.get(namespace) ?? new Map()
      counts.set(group, (counts.get(group) ?? 0) + 1)
      usage.set(namespace, counts)
    }
  }
  for (const file of shellFiles) {
    for (const key of translationKeys(file)) {
      const namespace = key.split('.')[0]
      if (namespace in catalog) shellKeys.add(key)
    }
    for (const key of JSON.parse(readFileSync(SHELL_RUNTIME_KEYS_PATH, 'utf8'))) {
      if (key.split('.')[0] in catalog) shellKeys.add(key)
    }
  }

  const namespaceToBundle = {}
  const bundles = {}
  for (const namespace of Object.keys(catalog)) {
    const counts = usage.get(namespace)
    const group = [...shellKeys].some((key) => key.startsWith(`${namespace}.`))
      ? 'shell'
      : sharedNamespaces.has(namespace)
      ? 'shared'
      : counts
      ? [...counts].sort(([a, aCount], [b, bCount]) => bCount - aCount || a.localeCompare(b))[0][0]
      : 'shared'
    namespaceToBundle[namespace] = group
    ;(bundles[group] ??= []).push(namespace)
  }
  bundles.shell ??= []
  const namespaceFallbackBundles = Object.fromEntries(
    bundles.shell.map((namespace) => [namespace, `detail-${namespace}`]),
  )
  const keyFallbackBundles = Object.fromEntries(
    bundles.shell.flatMap((namespace) =>
      leafKeys(catalog[namespace], namespace).map((key) => [key, `detail-${namespace}`])),
  )
  return {
    namespaceToBundle,
    bundles,
    shellRequiredNamespaces: [...new Set([...shellKeys].map((key) => key.split('.')[0]))].sort(),
    shellRequiredKeys: [...shellKeys].sort(),
    namespaceFallbackBundles,
    keyFallbackBundles,
  }
}

function getNested(object, key) {
  return key.split('.').reduce((value, segment) =>
    value && typeof value === 'object' ? value[segment] : undefined, object)
}

function setNested(object, key, value) {
  const segments = key.split('.')
  const last = segments.pop()
  if (!last) return
  let target = object
  for (const segment of segments) target = target[segment] ??= {}
  target[last] = value
}

function siblingKeys(catalog, key) {
  const segments = key.split('.')
  const leaf = segments.pop()
  const parent = getNested(catalog, segments.join('.'))
  if (!leaf || !parent || typeof parent !== 'object') return [key]
  const siblings = Object.keys(parent)
    .filter((candidate) => candidate === leaf || candidate.startsWith(`${leaf}_`))
    .map((candidate) => [...segments, candidate].join('.'))
  return siblings.length > 0 ? siblings : [key]
}

function expectedFiles(catalog) {
  const files = new Map()
  const manifest = usageManifest(catalog)
  const shellCriticalKeys = [...new Set(
    manifest.shellRequiredKeys.flatMap((key) => siblingKeys(catalog, key)),
  )].sort()
  manifest.shellCriticalKeys = shellCriticalKeys

  for (const [bundle, namespaces] of Object.entries(manifest.bundles)) {
    const resource = {}
    if (bundle === 'shell') {
      for (const namespace of manifest.shellRequiredNamespaces) {
        resource[namespace] ??= {}
      }
      for (const namespace of COMPLETE_SHELL_NAMESPACES) {
        if (namespace in catalog) resource[namespace] = catalog[namespace]
      }
      if (manifest.bundles.shell.length > 0) {
        for (const namespace of manifest.bundles.shell) {
          files.set(`locale-detail-${namespace}.json`, serialized({ [namespace]: catalog[namespace] }))
        }
      }
      for (const key of shellCriticalKeys) {
        const value = getNested(catalog, key)
        if (value !== undefined) setNested(resource, key, value)
      }
    } else {
      for (const namespace of namespaces) resource[namespace] = catalog[namespace]
    }
    files.set(`${bundle === 'shell' ? 'shell' : `locale-${bundle}`}.json`, serialized(resource))
  }
  files.set('usage-manifest.json', serialized(manifest))
  return { files, manifest }
}

function findDifferences(files) {
  const current = existsSync(OUTPUT_DIR)
    ? new Set(readdirSync(OUTPUT_DIR).filter((name) => name.endsWith('.json')))
    : new Set()
  const differences = []

  for (const [name, contents] of files) {
    const path = join(OUTPUT_DIR, name)
    if (!existsSync(path) || readFileSync(path, 'utf8') !== contents) {
      differences.push(name)
    }
    current.delete(name)
  }

  for (const stale of current) differences.push(`stale:${stale}`)
  return differences
}

function writeFiles(files) {
  rmSync(OUTPUT_DIR, { recursive: true, force: true })
  mkdirSync(OUTPUT_DIR, { recursive: true })
  for (const [name, contents] of files) {
    writeFileSync(join(OUTPUT_DIR, name), contents)
  }
}

function validateShellManifest(files, manifest) {
  const shell = JSON.parse(files.get('shell.json'))
  const runtimeKeys = JSON.parse(readFileSync(SHELL_RUNTIME_KEYS_PATH, 'utf8'))
  const missing = manifest.shellRequiredNamespaces.filter((namespace) => !(namespace in shell))
  const misplaced = manifest.shellRequiredNamespaces.filter(
    (namespace) => manifest.namespaceToBundle[namespace] !== 'shell',
  )
  const unreachable = Object.keys(manifest.namespaceToBundle).filter((namespace) => {
    const bundle = manifest.namespaceToBundle[namespace]
    return bundle === 'shell'
      ? !manifest.namespaceFallbackBundles[namespace]
      : !manifest.bundles[bundle]
  })
  return [
    ...missing.map((namespace) => `shell missing required namespace ${namespace}`),
    ...misplaced.map((namespace) => `shell namespace assigned to ${manifest.namespaceToBundle[namespace]}`),
    ...manifest.shellRequiredNamespaces
      .filter((namespace) => !manifest.namespaceFallbackBundles[namespace])
      .map((namespace) => `shell namespace has no fallback bundle ${namespace}`),
    ...unreachable.map((namespace) => `unreachable catalog namespace ${namespace}`),
    ...runtimeKeys
      .filter((key) => getNested(shell, key) === undefined)
      .map((key) => `shell runtime key missing ${key}`),
  ]
}

function main() {
  const catalog = JSON.parse(readFileSync(SOURCE_PATH, 'utf8'))
  const { files, manifest } = expectedFiles(catalog)
  const differences = findDifferences(files)
  const shellErrors = validateShellManifest(files, manifest)

  if (CHECK_ONLY) {
    if (differences.length > 0 || shellErrors.length > 0) {
      console.error(
        `[i18n-split] generated locale files are invalid (${[...differences, ...shellErrors].join(', ')}). Run node scripts/split-i18n-catalog.mjs.`,
      )
      process.exit(1)
    }
    console.log(`[i18n-split] OK — ${Object.keys(manifest.bundles).length - 1} usage-local locale bundles and one shell resource are current`)
    return
  }

  writeFiles(files)
  console.log(`[i18n-split] wrote ${Object.keys(manifest.bundles).length - 1} usage-local locale bundles and one shell resource`)
}

main()
