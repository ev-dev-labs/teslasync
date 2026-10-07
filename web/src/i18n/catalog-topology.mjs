/**
 * Pure topology helpers shared by `scripts/split-i18n-catalog.mjs` and its
 * regression tests.
 *
 * Everything here operates on plain JSON — no filesystem access, no
 * TypeScript compiler — so the invariants that decide what ships in the
 * startup chunk can be unit-tested directly instead of only through the
 * generator CLI.
 */

export const SHELL_GROUP = 'shell'
export const SHARED_GROUP = 'shared'
export const UNREFERENCED_GROUP = 'unreferenced'

/** i18next appends these to a base key when resolving counts and contexts. */
const PLURAL_SUFFIX = /^(?<base>.+?)(?:_(?:[A-Za-z0-9]+))?(?:_ordinal)?_(?:zero|one|two|few|many|other)$/

export function serialized(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function leafKeys(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key))
}

export function getNested(object, key) {
  return key.split('.').reduce((value, segment) =>
    value && typeof value === 'object' ? value[segment] : undefined, object)
}

/**
 * Writes `value` at the dotted `key`.
 *
 * Returns false when the catalog shadows itself — a scalar already occupying
 * an interior path, or an object about to be replaced by a scalar. Callers
 * report those keys instead of silently dropping a subtree.
 */
export function setNested(object, key, value) {
  const segments = key.split('.')
  const last = segments.pop()
  if (!last) return true
  let target = object
  for (const segment of segments) {
    const existing = target[segment]
    if (existing !== undefined && (typeof existing !== 'object' || existing === null)) return false
    target = target[segment] ??= {}
  }
  const existing = target[last]
  if (
    existing !== undefined && typeof existing === 'object' && existing !== null
    && (typeof value !== 'object' || value === null)
  ) {
    return false
  }
  target[last] = value
  return true
}

/**
 * Every catalog key i18next may resolve for `key`.
 *
 * Covers both directions: a source using the singular base
 * (`date.range.summaryDays`) needs `_one` / `_other`, and a source using a
 * suffixed form directly needs its base plus every peer suffix. Context
 * variants (`key_female_other`) and ordinals (`key_ordinal_one`) share a base.
 */
export function siblingKeys(catalog, key) {
  const segments = key.split('.')
  const leaf = segments.pop()
  const parent = getNested(catalog, segments.join('.'))
  if (!leaf || !parent || typeof parent !== 'object' || Array.isArray(parent)) return [key]
  const base = PLURAL_SUFFIX.exec(leaf)?.groups?.base ?? leaf
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pluralPeer = new RegExp(`^${escaped}(?:_[A-Za-z0-9]+)?(?:_ordinal)?_(?:zero|one|two|few|many|other)$`)
  const siblings = Object.keys(parent)
    .filter((candidate) =>
      candidate === leaf
      || candidate === base
      || candidate.startsWith(`${leaf}_`)
      || pluralPeer.test(candidate))
    .map((candidate) => [...segments, candidate].join('.'))
  return siblings.length > 0 ? siblings : [key]
}

/** Catalog keys a computed key such as t(`palette.scope.${x}`) can resolve to. */
export function keysUnderPrefix(prefix, catalogLeaves) {
  const exact = prefix.replace(/\.$/, '')
  const keys = []
  for (const leaf of catalogLeaves) {
    if (leaf === exact || leaf.startsWith(prefix)) keys.push(leaf)
  }
  return keys
}

/**
 * True when i18next can resolve `key` from the catalog by any route.
 *
 * A plural base (`x.count`) is resolvable when only `x.count_one` /
 * `x.count_other` exist, so sibling forms count.
 */
export function resolvableInCatalog(catalog, key) {
  return siblingKeys(catalog, key).some(
    (candidate) => getNested(catalog, candidate) !== undefined,
  )
}

/**
 * Keys the source references that the catalog provably cannot answer.
 *
 * Without this list the missing-key handler treats "key absent from en.json"
 * exactly like "key lives in a chunk we have not downloaded yet" and fetches a
 * locale chunk that cannot contain it. Those requests are pure waste and they
 * consume the per-route deferred-locale budget.
 *
 * Scope is deliberately the cold shell's own critical keys, each of which is
 * backed by a per-namespace `locale-detail-*` chunk. Those are the requests
 * that are pure waste: a grouped feature catalog is downloaded by its own
 * route regardless, so suppressing its misses would cost startup bytes without
 * removing a request. Namespaces already declared `complete` are excluded —
 * the runtime short-circuits those by namespace, not by key.
 */
export function selectKnownMissingKeys(catalog, referencedKeys, options = {}) {
  const {
    shellCriticalKeys = [],
    detailNamespaces = [],
    completeShellNamespaces = [],
  } = options
  const critical = new Set(shellCriticalKeys)
  const detail = new Set(detailNamespaces)
  const complete = new Set(completeShellNamespaces)

  return [...new Set(referencedKeys)]
    .filter((key) => {
      const namespace = key.split('.')[0]
      // An unknown namespace is already ignored by the runtime, and a complete
      // namespace is already short-circuited by `runtime.complete`.
      if (!(namespace in catalog) || complete.has(namespace)) return false
      if (resolvableInCatalog(catalog, key)) return false
      return critical.has(key) && detail.has(namespace)
    })
    .sort()
}

/**
 * Ratchets the known-missing key list.
 *
 * The list the runtime consumes is always derived from the catalog, never from
 * the baseline — a key that lands in en.json disappears from suppression on the
 * next regeneration whether or not anybody prunes the file. The baseline exists
 * only to make drift explicit: a key that becomes unresolvable has to be
 * accepted on purpose, and one that becomes resolvable is pruned automatically
 * so the file cannot accumulate stale suppressions.
 */
export function reconcileKnownMissing(computed, baseline) {
  const computedSet = new Set(computed)
  const baselineSet = new Set(baseline)
  return {
    newlyMissing: computed.filter((key) => !baselineSet.has(key)),
    resolved: baseline.filter((key) => !computedSet.has(key)),
    pruned: baseline.filter((key) => computedSet.has(key)).sort(),
    accepted: [...computedSet].sort(),
  }
}

/** Slim projection of the full manifest that ships inside the startup chunk. */
export function runtimeManifestOf(manifest) {
  const complete = manifest.completeShellNamespaces ?? []
  const completeSet = new Set(complete)
  // A complete namespace resolves from the shell, so it needs neither a
  // fallback chunk nor a lookup entry — only membership in `complete`.
  const detail = manifest.detailNamespaces.filter((namespace) => !completeSet.has(namespace))
  const detailSet = new Set(detail)
  const grouped = {}
  for (const [bundle, namespaces] of Object.entries(manifest.bundles)) {
    if (bundle === SHELL_GROUP || bundle === SHARED_GROUP) continue
    // Namespaces the source graph never resolves statically still have to be
    // loadable: feature files bind keys through `key:` properties that only
    // the shell-closure pass inspects, so "unreferenced" is a grouping hint,
    // never a licence to drop the lookup entry.
    const remaining = namespaces.filter(
      (namespace) => !detailSet.has(namespace) && !completeSet.has(namespace),
    )
    if (remaining.length > 0) grouped[bundle] = remaining
  }
  return {
    complete,
    missing: manifest.knownMissingKeys ?? [],
    detail,
    grouped,
  }
}

/**
 * Namespaces the shell resource carries in full.
 *
 * A missing key inside one of these is a source typo, never a deferred
 * catalog, so the runtime must not spend a request trying to resolve it.
 */
export function completeNamespacesIn(catalog, shell) {
  return Object.keys(shell)
    .filter((namespace) => {
      const expected = new Set(leafKeys(catalog[namespace], namespace))
      const actual = new Set(leafKeys(shell[namespace], namespace))
      return expected.size === actual.size && [...expected].every((key) => actual.has(key))
    })
    .sort()
}

function loadableNamespaces(files) {
  const loadable = new Map()
  for (const [name, contents] of files) {
    if (!name.startsWith('locale-')) continue
    const bundle = name.slice('locale-'.length, -'.json'.length)
    for (const [namespace, value] of Object.entries(JSON.parse(contents))) {
      loadable.set(namespace, { bundle, value })
    }
  }
  return loadable
}

/**
 * Proves the generated artifact set satisfies the startup contract.
 *
 * `files` is a Map of output file name to serialized JSON, exactly what the
 * generator is about to write, so the same checks run in `--check` mode, in
 * write mode, and in tests against synthetic fixtures.
 */
export function validateManifest(catalog, files, manifest, shadowedKeys = []) {
  const shell = JSON.parse(files.get('shell.json'))
  const runtime = JSON.parse(files.get('runtime-manifest.json'))
  const catalogLeaves = new Set(leafKeys(catalog))
  const loadable = loadableNamespaces(files)
  const errors = []

  for (const key of shadowedKeys) {
    errors.push(`catalog key shadows an ancestor value: ${key}`)
  }
  for (const namespace of manifest.shellRequiredNamespaces) {
    if (!(namespace in shell)) errors.push(`shell missing required namespace ${namespace}`)
    if (manifest.namespaceToBundle[namespace] !== SHELL_GROUP) {
      errors.push(`shell namespace assigned to ${manifest.namespaceToBundle[namespace]}: ${namespace}`)
    }
    if (manifest.namespaceFallbackBundles[namespace] !== `detail-${namespace}`) {
      errors.push(`shell namespace lacks a per-namespace fallback bundle: ${namespace}`)
    }
  }
  // Every key the cold shell can render must already be resolvable offline.
  for (const key of manifest.shellCriticalKeys ?? []) {
    if (getNested(catalog, key) === undefined) continue
    if (getNested(shell, key) === undefined) errors.push(`shell critical key missing ${key}`)
  }
  for (const key of manifest.declaredRuntimeKeys ?? []) {
    if (getNested(catalog, key) === undefined) {
      errors.push(`declared shell runtime key is not in the catalog: ${key}`)
    }
  }
  // A declared key that static analysis already finds is drift waiting to
  // happen — the list must only carry what nothing else can derive.
  for (const key of manifest.autoDiscoveredRuntimeKeys ?? []) {
    errors.push(`shell-runtime-keys.json entry is already auto-discovered, delete it: ${key}`)
  }
  for (const prefix of manifest.shellDynamicPrefixes ?? []) {
    for (const key of keysUnderPrefix(prefix, catalogLeaves)) {
      if (getNested(shell, key) === undefined) {
        errors.push(`dynamic shell prefix "${prefix}" key missing from shell: ${key}`)
      }
    }
  }
  for (const key of manifest.shellDeferredKeys ?? []) {
    const namespace = key.split('.')[0]
    if (manifest.namespaceFallbackBundles[namespace] !== `detail-${namespace}`) {
      errors.push(`deferred shell key ${key} would download bundle ${manifest.namespaceFallbackBundles[namespace]}`)
    }
  }
  // Reachability: every namespace and every leaf key ships in exactly one
  // loadable artifact — a locale chunk, or the shell when it carries the
  // namespace in full.
  const shellOwned = new Set(completeNamespacesIn(catalog, shell))
  for (const [namespace, bundle] of Object.entries(manifest.namespaceFallbackBundles)) {
    if (shellOwned.has(namespace)) {
      if (loadable.has(namespace)) {
        errors.push(`namespace ${namespace} ships in the shell and in ${loadable.get(namespace).bundle}`)
      }
      continue
    }
    const entry = loadable.get(namespace)
    if (!entry) {
      errors.push(`unreachable catalog namespace ${namespace}`)
    } else if (entry.bundle !== bundle) {
      errors.push(`namespace ${namespace} maps to ${bundle} but ships in ${entry.bundle}`)
    }
  }
  for (const namespace of Object.keys(catalog)) {
    if (shellOwned.has(namespace)) continue
    const entry = loadable.get(namespace)
    if (!entry) continue
    const actual = new Set(leafKeys(entry.value, namespace))
    for (const key of leafKeys(catalog[namespace], namespace)) {
      if (!actual.has(key)) errors.push(`unreachable catalog key ${key}`)
    }
  }
  // The slim runtime projection must resolve exactly what the full manifest does.
  const runtimeDetail = new Set(runtime.detail)
  const runtimeComplete = new Set(runtime.complete ?? [])
  for (const [namespace, bundle] of Object.entries(manifest.namespaceFallbackBundles)) {
    if (runtimeComplete.has(namespace)) {
      if (runtimeDetail.has(namespace) || Object.values(runtime.grouped).some((list) => list.includes(namespace))) {
        errors.push(`runtime manifest keeps a redundant lookup entry for complete namespace ${namespace}`)
      }
      continue
    }
    const resolved = runtimeDetail.has(namespace)
      ? `detail-${namespace}`
      : Object.entries(runtime.grouped).find(([, list]) => list.includes(namespace))?.[0]
    if (resolved !== bundle) {
      errors.push(`runtime manifest resolves ${namespace} to ${resolved ?? 'nothing'}, expected ${bundle}`)
    }
  }
  // A namespace advertised as complete must genuinely be complete, otherwise
  // the runtime would suppress a request it actually needs.
  const genuinelyComplete = new Set(completeNamespacesIn(catalog, shell))
  for (const namespace of runtime.complete ?? []) {
    if (!genuinelyComplete.has(namespace)) {
      errors.push(`runtime manifest claims ${namespace} is fully inlined but the shell omits keys`)
    }
  }
  for (const namespace of genuinelyComplete) {
    if (!(runtime.complete ?? []).includes(namespace)) {
      errors.push(`shell fully inlines ${namespace} but the runtime manifest does not declare it`)
    }
  }
  // Known-missing suppression is only sound while the key really is absent
  // everywhere. The moment a key lands in en.json it must leave this list, or
  // the runtime would refuse to fetch a string it can actually render.
  const missing = runtime.missing ?? []
  const declaredMissing = manifest.knownMissingKeys ?? []
  if (JSON.stringify(missing) !== JSON.stringify(declaredMissing)) {
    errors.push('runtime manifest known-missing keys disagree with the generated manifest')
  }
  const sortedUnique = [...new Set(missing)].sort()
  if (JSON.stringify(missing) !== JSON.stringify(sortedUnique)) {
    errors.push('known-missing keys must be sorted and unique for a deterministic build')
  }
  for (const key of missing) {
    if (resolvableInCatalog(catalog, key)) {
      errors.push(`known-missing key ${key} now exists in the catalog and must be re-enabled`)
      continue
    }
    if (getNested(shell, key) !== undefined) {
      errors.push(`known-missing key ${key} is present in the shell resource`)
    }
    const [namespace, ...rest] = key.split('.')
    const entry = loadable.get(namespace)
    if (entry && getNested(entry.value, rest.join('.')) !== undefined) {
      errors.push(`known-missing key ${key} ships in bundle ${entry.bundle}`)
    }
  }
  return errors
}
