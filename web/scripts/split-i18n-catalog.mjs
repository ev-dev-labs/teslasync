#!/usr/bin/env node
/**
 * Splits the canonical English catalog into independently loadable namespaces.
 *
 * `src/i18n/en.json` remains the only hand-edited English source. Generated
 * files are checked, never rewritten by Vite, so a production build cannot
 * leave the worktree dirty.
 *
 * Three properties are enforced here rather than discovered in production:
 *
 * 1. Determinism — every key the cold shell can render is derived from the
 *    static source closure of `main.tsx` / `App.tsx` / `NotFoundPage.tsx`.
 *    Keys reached through indirection (`labelKey: 'nav.compactDrives'`) or a
 *    template literal (t(`palette.scope.${scope}`)) are discovered by AST
 *    analysis, not by a hand-curated list.
 * 2. Reachability — every leaf key in the catalog is emitted into exactly one
 *    artifact the runtime can load, so no translated string is orphaned.
 * 3. Fallback locality — namespaces reachable from the shell or from generic
 *    shared components get a per-namespace `locale-detail-<ns>.json`. A toast
 *    string may never drag an unrelated battery or charging namespace along.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { staticClosure, translationKeys, translationNamespaces } from './i18n-source-graph.mjs'
import {
  SHARED_GROUP,
  SHELL_GROUP,
  UNREFERENCED_GROUP,
  completeNamespacesIn,
  getNested,
  keysUnderPrefix,
  leafKeys,
  reconcileKnownMissing,
  runtimeManifestOf,
  selectKnownMissingKeys,
  serialized,
  setNested,
  siblingKeys,
  validateManifest,
} from '../src/i18n/catalog-topology.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const I18N_ROOT = resolve(__dirname, '..', 'src', 'i18n')
const SOURCE_PATH = join(I18N_ROOT, 'en.json')
const OUTPUT_DIR = join(I18N_ROOT, 'en')
const CHECK_ONLY = process.argv.includes('--check')
const ACCEPT_MISSING = process.argv.includes('--accept-missing')
const SOURCE_ROOT = join(__dirname, '..', 'src')
const SHELL_RUNTIME_KEYS_PATH = join(I18N_ROOT, 'shell-runtime-keys.json')
const KNOWN_MISSING_PATH = join(I18N_ROOT, 'known-missing-keys.json')
const COMPLETE_SHELL_NAMESPACES = new Set(['nav'])
/**
 * A per-namespace fallback chunk this small costs less to inline than the
 * request that fetches it costs in headers and round trips. Inlining also
 * makes the namespace `complete`, which lets the runtime answer keys composed
 * at render time (`emptyState.<scope>.<view>.hint`) without a dead fetch —
 * static analysis can never enumerate those keys.
 */
const TINY_NAMESPACE_BYTES = 256
/** Property/variable names whose string value is an i18n key by convention. */
const KEY_IDENTIFIER = /(?:^|[a-z0-9])[Kk]eys?$/

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
  // `import x from './en/shell.json'` resolves to a real file, so the raw
  // closure contains JSON assets. Parsing generated catalogs as TypeScript
  // would feed the generator its own output.
  return new Set([...staticClosure(SOURCE_ROOT, roots)].filter((file) => /\.(?:ts|tsx)$/.test(file)))
}

function sourceGroup(file, shellFiles) {
  const relative = file.slice(SOURCE_ROOT.length + 1).replaceAll('\\', '/')
  const feature = relative.match(/^features\/([^/]+)\//)?.[1]
  if (shellFiles.has(file)) return SHELL_GROUP
  if (feature) return feature
  return SHARED_GROUP
}

function isGenericSharedSource(file) {
  const relative = file.slice(SOURCE_ROOT.length + 1).replaceAll('\\', '/')
  // AI renderers are imported by individual domain routes. Their translated
  // namespaces retain domain ownership unless a real generic primitive uses
  // them across feature boundaries.
  return !relative.startsWith('components/ai/')
}

function stringLiteralText(node) {
  if (!node) return null
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null
}

/**
 * Discovers translation keys a file reaches without writing them inline in a
 * `t()` call.
 *
 * - `indirect`: a string literal bound to a `*Key` / `*Keys` identifier that
 *   resolves to a real catalog leaf. This is how the sidebar, command
 *   registry, onboarding tour, and checklist declare their labels.
 * - `deferred`: the first argument of a non-`t()` call that already supplies
 *   an inline English fallback (`success('toast.x.done', 'Done')`). These
 *   render on user action, never on first paint, so they are declared and
 *   given a per-namespace fallback bundle instead of being inlined.
 * - `prefixes`: the static head of a computed key
 *   (t(`palette.scope.${scope}`) → `palette.scope.`). Every catalog key below
 *   the prefix must ship with the shell because the suffix is only known at
 *   runtime.
 */
function indirectTranslationKeys(file, catalogLeaves) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const indirect = new Set()
  const deferred = new Set()
  const prefixes = new Set()

  const addIfCatalogLeaf = (target, node) => {
    const text = stringLiteralText(node)
    // Dotless labels resolve source-locally and never map to a namespace.
    if (text && text.includes('.') && catalogLeaves.has(text)) target.add(text)
  }
  const addKeyBinding = (name, initializer) => {
    if (!name || !KEY_IDENTIFIER.test(name)) return
    addIfCatalogLeaf(indirect, initializer)
    if (initializer && ts.isArrayLiteralExpression(initializer)) {
      for (const element of initializer.elements) addIfCatalogLeaf(indirect, element)
    }
  }
  const visit = (node) => {
    if (
      (ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node))
      && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
    ) {
      addKeyBinding(node.name.text, node.initializer)
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      addKeyBinding(node.name.text, node.initializer)
    }
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
      const initializer = node.initializer && ts.isJsxExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer
      addKeyBinding(node.name.text, initializer)
    }
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ''
      const first = node.arguments[0]
      if (callee === 't' && first) {
        if (ts.isTemplateExpression(first) && first.head.text.includes('.')) {
          prefixes.add(first.head.text)
        } else if (
          ts.isBinaryExpression(first)
          && first.operatorToken.kind === ts.SyntaxKind.PlusToken
          && stringLiteralText(first.left)?.includes('.')
        ) {
          prefixes.add(stringLiteralText(first.left))
        }
      } else if (callee !== 't' && node.arguments.length >= 2) {
        const second = node.arguments[1]
        // A second literal/options argument is the inline English fallback,
        // which is what separates a translation call from an unrelated dotted
        // string such as a BroadcastChannel message type.
        if (stringLiteralText(second) !== null || ts.isObjectLiteralExpression(second)) {
          addIfCatalogLeaf(deferred, first)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { indirect, deferred, prefixes }
}

function usageManifest(catalog) {
  const catalogLeaves = new Set(leafKeys(catalog))
  const shellFiles = shellSourceClosure()
  const sourceFiles = walk(SOURCE_ROOT)
  const usage = new Map()
  const sharedNamespaces = new Set()
  const referencedKeys = new Set()
  const shellInlineKeys = new Set()
  const shellDeferredKeys = new Set()
  const shellDynamicPrefixes = new Set()

  for (const file of sourceFiles) {
    const group = sourceGroup(file, shellFiles)
    for (const key of translationKeys(file)) referencedKeys.add(key)
    for (const namespace of translationNamespaces(file)) {
      if (!(namespace in catalog)) continue
      if (group === SHARED_GROUP && isGenericSharedSource(file)) sharedNamespaces.add(namespace)
      const counts = usage.get(namespace) ?? new Map()
      counts.set(group, (counts.get(group) ?? 0) + 1)
      usage.set(namespace, counts)
    }
  }
  for (const file of shellFiles) {
    for (const key of translationKeys(file)) {
      if (key.split('.')[0] in catalog) shellInlineKeys.add(key)
    }
    const { indirect, deferred, prefixes } = indirectTranslationKeys(file, catalogLeaves)
    for (const key of indirect) shellInlineKeys.add(key)
    for (const key of deferred) shellDeferredKeys.add(key)
    for (const prefix of prefixes) {
      if (!(prefix.split('.')[0] in catalog)) continue
      shellDynamicPrefixes.add(prefix)
      for (const key of keysUnderPrefix(prefix, catalogLeaves)) shellInlineKeys.add(key)
    }
  }
  // The escape hatch stays supported for keys no static rule can see, but the
  // generator rejects entries it can already derive so the file cannot rot.
  const declaredRuntimeKeys = JSON.parse(readFileSync(SHELL_RUNTIME_KEYS_PATH, 'utf8'))
  const autoDiscoveredRuntimeKeys = declaredRuntimeKeys.filter((key) => shellInlineKeys.has(key))
  for (const key of declaredRuntimeKeys) {
    if (key.split('.')[0] in catalog) shellInlineKeys.add(key)
  }

  const shellNamespaces = new Set(
    [...shellInlineKeys, ...shellDeferredKeys].map((key) => key.split('.')[0]),
  )
  const namespaceToBundle = {}
  const bundles = {}
  for (const namespace of Object.keys(catalog)) {
    const counts = usage.get(namespace)
    const group = shellNamespaces.has(namespace)
      ? SHELL_GROUP
      : sharedNamespaces.has(namespace)
      ? SHARED_GROUP
      : counts
      ? [...counts].sort(([a, aCount], [b, bCount]) => bCount - aCount || a.localeCompare(b))[0][0]
      : UNREFERENCED_GROUP
    namespaceToBundle[namespace] = group
    ;(bundles[group] ??= []).push(namespace)
  }
  bundles[SHELL_GROUP] ??= []
  bundles[SHARED_GROUP] ??= []
  bundles[UNREFERENCED_GROUP] ??= []
  for (const namespaces of Object.values(bundles)) namespaces.sort()

  // Shell- and shared-owned namespaces each get their own fallback chunk.
  // Feature bundles stay grouped: a route legitimately needs the namespaces
  // its own feature owns, and one request beats a dozen.
  const detailNamespaces = [...new Set([...bundles[SHELL_GROUP], ...bundles[SHARED_GROUP]])].sort()
  const detailSet = new Set(detailNamespaces)
  const namespaceFallbackBundles = {}
  for (const namespace of Object.keys(namespaceToBundle)) {
    namespaceFallbackBundles[namespace] = detailSet.has(namespace)
      ? `detail-${namespace}`
      : namespaceToBundle[namespace]
  }
  return {
    manifest: {
      namespaceToBundle,
      bundles,
      detailNamespaces,
      shellRequiredNamespaces: [...shellNamespaces].sort(),
      shellRequiredKeys: [...shellInlineKeys].sort(),
      shellDeferredKeys: [...shellDeferredKeys].sort(),
      shellDynamicPrefixes: [...shellDynamicPrefixes].sort(),
      declaredRuntimeKeys: [...declaredRuntimeKeys].sort(),
      autoDiscoveredRuntimeKeys: [...autoDiscoveredRuntimeKeys].sort(),
      unreferencedNamespaces: bundles[UNREFERENCED_GROUP],
      namespaceFallbackBundles,
    },
    // Kept out of the serialized manifest: this is every literal `t()` key in
    // the tree and only feeds known-missing detection.
    referencedKeys: [...referencedKeys].sort(),
  }
}

function expectedFiles(catalog) {
  const files = new Map()
  const { manifest, referencedKeys } = usageManifest(catalog)
  const shadowedKeys = []
  const shellCriticalKeys = [...new Set(
    manifest.shellRequiredKeys.flatMap((key) => siblingKeys(catalog, key)),
  )].sort()
  manifest.shellCriticalKeys = shellCriticalKeys

  const shellResource = {}
  for (const namespace of manifest.shellRequiredNamespaces) {
    // A scalar namespace (a bare top-level label) has no subtree to stub.
    const value = catalog[namespace]
    if (value !== null && typeof value === 'object') shellResource[namespace] ??= {}
    else if (value !== undefined) shellResource[namespace] = value
  }
  for (const namespace of COMPLETE_SHELL_NAMESPACES) {
    if (namespace in catalog) shellResource[namespace] = catalog[namespace]
  }
  for (const key of shellCriticalKeys) {
    const value = getNested(catalog, key)
    if (value === undefined) continue
    if (!setNested(shellResource, key, value)) shadowedKeys.push(key)
  }
  for (const namespace of manifest.detailNamespaces) {
    const value = catalog[namespace]
    if (value === undefined) continue
    if (JSON.stringify(value).length <= TINY_NAMESPACE_BYTES) shellResource[namespace] = value
  }
  files.set('shell.json', serialized(shellResource))
  manifest.completeShellNamespaces = completeNamespacesIn(catalog, shellResource)
  manifest.knownMissingKeys = selectKnownMissingKeys(catalog, referencedKeys, {
    shellCriticalKeys,
    detailNamespaces: manifest.detailNamespaces,
    completeShellNamespaces: manifest.completeShellNamespaces,
  })

  for (const namespace of manifest.detailNamespaces) {
    // A namespace the shell carries in full is already resolvable offline, so
    // its fallback chunk can never be requested. Emitting one would only add a
    // dead entry to the startup chunk's dynamic-import map.
    if (manifest.completeShellNamespaces.includes(namespace)) continue
    files.set(`locale-detail-${namespace}.json`, serialized({ [namespace]: catalog[namespace] }))
  }
  for (const [bundle, namespaces] of Object.entries(manifest.bundles)) {
    if (bundle === SHELL_GROUP || bundle === SHARED_GROUP) continue
    const resource = {}
    for (const namespace of namespaces) resource[namespace] = catalog[namespace]
    if (Object.keys(resource).length > 0) files.set(`locale-${bundle}.json`, serialized(resource))
  }
  files.set('runtime-manifest.json', serialized(runtimeManifestOf(manifest)))
  files.set('usage-manifest.json', serialized(manifest))
  return { files, manifest, shadowedKeys }
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

export function buildCatalogArtifacts(catalog) {
  return expectedFiles(catalog)
}

/**
 * Ratchets the known-missing key list.
 *
 * The list the runtime consumes is always derived from the catalog, never from
 * this baseline — a key that lands in en.json disappears from suppression on
 * the next regeneration whether or not anybody prunes the file. The baseline
 * exists only to make drift explicit: a key that becomes unresolvable has to
 * be accepted on purpose (`--accept-missing`), and one that becomes resolvable
 * is pruned automatically so the file cannot accumulate stale suppressions.
 */
function readKnownMissingBaseline() {
  if (!existsSync(KNOWN_MISSING_PATH)) return []
  return JSON.parse(readFileSync(KNOWN_MISSING_PATH, 'utf8'))
}

function main() {
  const catalog = JSON.parse(readFileSync(SOURCE_PATH, 'utf8'))
  const { files, manifest, shadowedKeys } = expectedFiles(catalog)
  const differences = findDifferences(files)
  const errors = validateManifest(catalog, files, manifest, shadowedKeys)
  const baseline = readKnownMissingBaseline()
  const drift = reconcileKnownMissing(manifest.knownMissingKeys, baseline)
  const nextBaseline = ACCEPT_MISSING ? drift.accepted : drift.pruned
  const baselineContents = serialized(nextBaseline)
  const baselineStale = !existsSync(KNOWN_MISSING_PATH)
    || readFileSync(KNOWN_MISSING_PATH, 'utf8') !== baselineContents
  const featureBundles = Object.keys(manifest.bundles)
    .filter((bundle) => bundle !== SHELL_GROUP && bundle !== SHARED_GROUP).length
  const summary = `${featureBundles} grouped locale bundles, ${manifest.detailNamespaces.length} per-namespace fallbacks, ${manifest.shellCriticalKeys.length} inlined shell keys, ${manifest.knownMissingKeys.length} known-missing keys (${drift.newlyMissing.length} new, ${drift.resolved.length} resolved)`

  if (drift.resolved.length > 0) {
    console.log(
      `[i18n-split] known-missing keys no longer suppressed (the catalog or the inlined shell now answers them): ${drift.resolved.slice(0, 10).join(', ')}${drift.resolved.length > 10 ? `, … (+${drift.resolved.length - 10})` : ''}`,
    )
  }
  if (drift.newlyMissing.length > 0 && !ACCEPT_MISSING) {
    console.error(
      `[i18n-split] ${drift.newlyMissing.length} translation key(s) are referenced but absent from en.json:\n  - ${drift.newlyMissing.join('\n  - ')}\n`
      + '  Add them to src/i18n/en.json, or accept the gap with '
      + 'node scripts/split-i18n-catalog.mjs --accept-missing',
    )
    process.exit(1)
  }

  if (CHECK_ONLY) {
    const staleBaseline = baselineStale ? ['stale:known-missing-keys.json'] : []
    if (differences.length > 0 || errors.length > 0 || staleBaseline.length > 0) {
      console.error(
        `[i18n-split] generated locale files are invalid (${[...differences, ...errors, ...staleBaseline].join(', ')}). Run node scripts/split-i18n-catalog.mjs.`,
      )
      process.exit(1)
    }
    console.log(`[i18n-split] OK — ${summary}`)
    return
  }

  if (errors.length > 0) {
    console.error(`[i18n-split] refusing to write invalid output:\n  - ${errors.join('\n  - ')}`)
    process.exit(1)
  }
  writeFiles(files)
  writeFileSync(KNOWN_MISSING_PATH, baselineContents)
  console.log(`[i18n-split] wrote ${summary}`)
}

// Guarded so the pure helpers above can be imported by regression tests
// without regenerating the catalog as a side effect.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
