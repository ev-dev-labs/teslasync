import { describe, expect, it } from 'vitest'
// @ts-expect-error - shared topology helpers authored as ESM JavaScript
import {
  keysUnderPrefix,
  leafKeys,
  reconcileKnownMissing,
  resolvableInCatalog,
  selectKnownMissingKeys,
  siblingKeys,
  validateManifest,
} from './catalog-topology.mjs'
import catalog from './en.json'
import knownMissingBaseline from './known-missing-keys.json'
import runtimeManifest from './en/runtime-manifest.json'
import shell from './en/shell.json'
import usageManifest from './en/usage-manifest.json'

type Json = Record<string, unknown>

const generated = import.meta.glob<{ default: Json }>('./en/locale-*.json', { eager: true })
const emitted = new Map<string, Json>(
  Object.entries(generated).map(([path, module]) => [
    path.slice('./en/locale-'.length, -'.json'.length),
    module.default,
  ]),
)

function nested(object: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (value, segment) =>
      value && typeof value === 'object' ? (value as Json)[segment] : undefined,
    object,
  )
}

describe('catalog splitter helpers', () => {
  it('expands plural siblings in both directions', () => {
    const fixture = {
      date: {
        range: {
          summaryDays_one: '{{count}} day',
          summaryDays_other: '{{count}} days',
          label: 'Range',
        },
      },
    }
    expect(siblingKeys(fixture, 'date.range.summaryDays').sort()).toEqual([
      'date.range.summaryDays_one',
      'date.range.summaryDays_other',
    ])
    // A source that writes the suffixed form directly still needs every peer.
    expect(siblingKeys(fixture, 'date.range.summaryDays_one').sort()).toEqual([
      'date.range.summaryDays_one',
      'date.range.summaryDays_other',
    ])
    expect(siblingKeys(fixture, 'date.range.label')).toEqual(['date.range.label'])
  })

  it('resolves ordinal and context plural peers without dragging in neighbours', () => {
    const fixture = {
      race: {
        place_ordinal_one: '{{count}}st place',
        place_ordinal_other: '{{count}}th place',
        placement: 'Placement',
      },
      person: {
        friend_female_one: 'girlfriend',
        friend_female_other: 'girlfriends',
        friend_male_one: 'boyfriend',
        friend_male_other: 'boyfriends',
      },
    }
    expect(siblingKeys(fixture, 'race.place_ordinal_one').sort()).toEqual([
      'race.place_ordinal_one',
      'race.place_ordinal_other',
    ])
    expect(siblingKeys(fixture, 'person.friend_female_one').sort()).toEqual([
      'person.friend_female_one',
      'person.friend_female_other',
      'person.friend_male_one',
      'person.friend_male_other',
    ])
  })

  it('collects every catalog key under a computed key prefix', () => {
    const leaves = new Set(['palette.scope.all', 'palette.scope.pages', 'palette.scopeHint', 'nav.home'])
    expect(keysUnderPrefix('palette.scope.', leaves).sort()).toEqual([
      'palette.scope.all',
      'palette.scope.pages',
    ])
    expect(leafKeys({ a: { b: 'x', c: { d: 'y' } } }).sort()).toEqual(['a.b', 'a.c.d'])
  })
})

describe('catalog splitter validation', () => {
  const fixtureCatalog = {
    nav: { home: 'Home' },
    toast: { done: 'Done' },
    battery: { title: 'Battery' },
  }
  const fixtureManifest = () => ({
    namespaceToBundle: { nav: 'shell', toast: 'shell', battery: 'battery' },
    bundles: { shell: ['nav', 'toast'], shared: [], battery: ['battery'], unreferenced: [] },
    detailNamespaces: ['nav', 'toast'],
    shellRequiredNamespaces: ['nav', 'toast'],
    shellRequiredKeys: ['nav.home'],
    shellCriticalKeys: ['nav.home', 'toast.absent'],
    shellDeferredKeys: ['toast.done'],
    shellDynamicPrefixes: [],
    declaredRuntimeKeys: [],
    autoDiscoveredRuntimeKeys: [],
    knownMissingKeys: ['toast.absent'],
    namespaceFallbackBundles: { nav: 'detail-nav', toast: 'detail-toast', battery: 'battery' },
  })
  const fixtureRuntime = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      complete: ['nav'],
      missing: ['toast.absent'],
      detail: ['toast'],
      grouped: { battery: ['battery'] },
      ...overrides,
    })
  const fixtureFiles = () =>
    new Map<string, string>([
      ['shell.json', JSON.stringify({ nav: { home: 'Home' }, toast: {} })],
      ['locale-detail-toast.json', JSON.stringify({ toast: { done: 'Done' } })],
      ['locale-battery.json', JSON.stringify({ battery: { title: 'Battery' } })],
      ['runtime-manifest.json', fixtureRuntime()],
    ])

  it('accepts a consistent artifact set', () => {
    expect(validateManifest(fixtureCatalog, fixtureFiles(), fixtureManifest())).toEqual([])
  })

  it('rejects a deferred shell key that would pull a foreign feature bundle', () => {
    const manifest = fixtureManifest()
    manifest.namespaceFallbackBundles.toast = 'battery'
    manifest.detailNamespaces = ['nav']
    const files = fixtureFiles()
    files.delete('locale-detail-toast.json')
    files.set('locale-battery.json', JSON.stringify({ battery: { title: 'Battery' }, toast: { done: 'Done' } }))
    files.set('runtime-manifest.json', fixtureRuntime({ detail: ['nav'], missing: [], grouped: { battery: ['battery', 'toast'] } }))

    const errors = validateManifest(fixtureCatalog, files, manifest)
    expect(errors).toContain('deferred shell key toast.done would download bundle battery')
    expect(errors).toContain('shell namespace lacks a per-namespace fallback bundle: toast')
  })

  it('rejects an unreachable catalog key', () => {
    const files = fixtureFiles()
    files.set('locale-battery.json', JSON.stringify({ battery: {} }))
    expect(validateManifest(fixtureCatalog, files, fixtureManifest())).toContain(
      'unreachable catalog key battery.title',
    )
  })

  it('rejects a redundant hand-declared shell runtime key', () => {
    const manifest = fixtureManifest()
    manifest.declaredRuntimeKeys = ['nav.home']
    manifest.autoDiscoveredRuntimeKeys = ['nav.home']
    expect(validateManifest(fixtureCatalog, fixtureFiles(), manifest)).toContain(
      'shell-runtime-keys.json entry is already auto-discovered, delete it: nav.home',
    )
  })

  it('rejects a runtime manifest that disagrees with the full manifest', () => {
    const files = fixtureFiles()
    files.set('runtime-manifest.json', fixtureRuntime({ detail: ['nav'] }))
    expect(validateManifest(fixtureCatalog, files, fixtureManifest())).toContain(
      'runtime manifest resolves toast to nothing, expected detail-toast',
    )
  })

  it('rejects a runtime manifest that over-claims a fully inlined namespace', () => {
    const files = fixtureFiles()
    files.set('runtime-manifest.json', fixtureRuntime({ complete: ['nav', 'toast'] }))
    expect(validateManifest(fixtureCatalog, files, fixtureManifest())).toContain(
      'runtime manifest claims toast is fully inlined but the shell omits keys',
    )
  })

  it('rejects a runtime manifest that forgets a fully inlined namespace', () => {
    const files = fixtureFiles()
    files.set('runtime-manifest.json', fixtureRuntime({ complete: [] }))
    expect(validateManifest(fixtureCatalog, files, fixtureManifest())).toContain(
      'shell fully inlines nav but the runtime manifest does not declare it',
    )
  })

  it('rejects suppression of a key the catalog can now answer', () => {
    const grownCatalog = { ...fixtureCatalog, toast: { done: 'Done', absent: 'Absent' } }
    const files = fixtureFiles()
    files.set('locale-detail-toast.json', JSON.stringify({ toast: { done: 'Done', absent: 'Absent' } }))

    expect(validateManifest(grownCatalog, files, fixtureManifest())).toContain(
      'known-missing key toast.absent now exists in the catalog and must be re-enabled',
    )
  })

  it('rejects a runtime known-missing list that disagrees with the generated manifest', () => {
    const files = fixtureFiles()
    files.set('runtime-manifest.json', fixtureRuntime({ missing: [] }))
    expect(validateManifest(fixtureCatalog, files, fixtureManifest())).toContain(
      'runtime manifest known-missing keys disagree with the generated manifest',
    )
  })

  it('rejects an unsorted or duplicated known-missing list', () => {
    const manifest = fixtureManifest()
    manifest.knownMissingKeys = ['toast.zeta', 'toast.absent']
    const files = fixtureFiles()
    files.set('runtime-manifest.json', fixtureRuntime({ missing: ['toast.zeta', 'toast.absent'] }))
    expect(validateManifest(fixtureCatalog, files, manifest)).toContain(
      'known-missing keys must be sorted and unique for a deterministic build',
    )
  })

  it('rejects a known-missing key that actually ships in a bundle', () => {
    const files = fixtureFiles()
    // The bundle carries the key while the catalog does not — an impossible
    // artifact set, and exactly the state that would make suppression unsafe.
    files.set('locale-detail-toast.json', JSON.stringify({ toast: { done: 'Done', absent: 'Absent' } }))
    expect(validateManifest(fixtureCatalog, files, fixtureManifest())).toContain(
      'known-missing key toast.absent ships in bundle detail-toast',
    )
  })
})

describe('known-missing key selection and ratchet', () => {
  const smallCatalog = {
    emptyState: { label: { known: 'Known' } },
    battery: { title: 'Battery' },
    counts: { items_one: '{{count}} item', items_other: '{{count}} items' },
  }

  it('treats a plural base as resolvable when only suffixed forms exist', () => {
    expect(resolvableInCatalog(smallCatalog, 'counts.items')).toBe(true)
    expect(resolvableInCatalog(smallCatalog, 'counts.missing')).toBe(false)
  })

  it('selects only shell-critical keys backed by a per-namespace fallback', () => {
    const selected = selectKnownMissingKeys(
      smallCatalog,
      ['emptyState.generic', 'emptyState.label.known', 'battery.absent', 'counts.items', 'unknownNs.key'],
      {
        shellCriticalKeys: ['emptyState.generic', 'battery.absent', 'counts.items'],
        detailNamespaces: ['emptyState', 'counts'],
        completeShellNamespaces: [],
      },
    )
    // `battery.absent` is critical but grouped-bundle backed, `counts.items`
    // resolves through plurals, `unknownNs` is not a catalog namespace.
    expect(selected).toEqual(['emptyState.generic'])
  })

  it('never suppresses a key inside an already-complete namespace', () => {
    const selected = selectKnownMissingKeys(smallCatalog, ['emptyState.generic'], {
      shellCriticalKeys: ['emptyState.generic'],
      detailNamespaces: ['emptyState'],
      completeShellNamespaces: ['emptyState'],
    })
    expect(selected).toEqual([])
  })

  it('is deterministic and order-independent', () => {
    const options = {
      shellCriticalKeys: ['emptyState.generic', 'emptyState.other'],
      detailNamespaces: ['emptyState'],
      completeShellNamespaces: [],
    }
    const forward = selectKnownMissingKeys(smallCatalog, ['emptyState.generic', 'emptyState.other'], options)
    const reversed = selectKnownMissingKeys(smallCatalog, ['emptyState.other', 'emptyState.generic'], options)
    const duplicated = selectKnownMissingKeys(
      smallCatalog,
      ['emptyState.other', 'emptyState.generic', 'emptyState.other'],
      options,
    )
    expect(forward).toEqual(['emptyState.generic', 'emptyState.other'])
    expect(reversed).toEqual(forward)
    expect(duplicated).toEqual(forward)
  })

  it('stops selecting a key as soon as the catalog gains it', () => {
    const options = {
      shellCriticalKeys: ['emptyState.generic'],
      detailNamespaces: ['emptyState'],
      completeShellNamespaces: [],
    }
    expect(selectKnownMissingKeys(smallCatalog, ['emptyState.generic'], options)).toEqual([
      'emptyState.generic',
    ])
    const grown = { ...smallCatalog, emptyState: { ...smallCatalog.emptyState, generic: 'No data' } }
    expect(selectKnownMissingKeys(grown, ['emptyState.generic'], options)).toEqual([])
  })

  it('flags a newly missing key and prunes one the catalog now answers', () => {
    const drift = reconcileKnownMissing(['a.new', 'a.stillMissing'], ['a.stillMissing', 'a.nowPresent'])
    expect(drift.newlyMissing).toEqual(['a.new'])
    expect(drift.resolved).toEqual(['a.nowPresent'])
    // A plain regeneration keeps only what is still missing; accepting the
    // drift is what adds the new key.
    expect(drift.pruned).toEqual(['a.stillMissing'])
    expect(drift.accepted).toEqual(['a.new', 'a.stillMissing'])
  })

  it('reports no drift once the baseline matches', () => {
    const drift = reconcileKnownMissing(['a.b'], ['a.b'])
    expect(drift.newlyMissing).toEqual([])
    expect(drift.resolved).toEqual([])
    expect(drift.pruned).toEqual(['a.b'])
  })
})

describe('checked-in locale artifacts', () => {
  it('emits every catalog leaf key into exactly one loadable artifact', () => {
    const owners = new Map<string, string[]>()
    for (const [bundle, resource] of emitted) {
      for (const key of leafKeys(resource) as string[]) {
        owners.set(key, [...(owners.get(key) ?? []), bundle])
      }
    }
    // A namespace the shell carries in full has no chunk of its own; the
    // startup resource is its loadable artifact.
    for (const namespace of runtimeManifest.complete) {
      for (const key of leafKeys((shell as Json)[namespace], namespace) as string[]) {
        owners.set(key, [...(owners.get(key) ?? []), 'shell'])
      }
    }
    const missing: string[] = []
    const duplicated: string[] = []
    for (const key of leafKeys(catalog) as string[]) {
      const bundles = owners.get(key)
      if (!bundles) missing.push(key)
      else if (bundles.length > 1) duplicated.push(`${key} -> ${bundles.join(', ')}`)
    }
    expect(missing).toEqual([])
    expect(duplicated).toEqual([])
  })

  it('gives every shell and shared namespace a per-namespace fallback chunk', () => {
    const complete = new Set<string>(runtimeManifest.complete)
    for (const namespace of usageManifest.detailNamespaces) {
      expect(usageManifest.namespaceFallbackBundles).toHaveProperty(namespace, `detail-${namespace}`)
      // Complete namespaces resolve from the shell, so shipping a chunk for
      // them would only add a dead dynamic-import entry to the startup chunk.
      expect(emitted.has(`detail-${namespace}`)).toBe(!complete.has(namespace))
    }
    for (const namespace of usageManifest.shellRequiredNamespaces) {
      expect(usageManifest.detailNamespaces).toContain(namespace)
    }
  })

  it('keeps no runtime lookup entry for a namespace the shell already answers', () => {
    const grouped = new Set(Object.values(runtimeManifest.grouped).flat())
    for (const namespace of runtimeManifest.complete) {
      expect(runtimeManifest.detail).not.toContain(namespace)
      expect(grouped.has(namespace)).toBe(false)
    }
  })

  it('keeps deferred shell keys off feature bundles', () => {
    for (const key of usageManifest.shellDeferredKeys) {
      const namespace = key.split('.')[0]
      expect(usageManifest.namespaceFallbackBundles[namespace as keyof typeof usageManifest.namespaceFallbackBundles])
        .toBe(`detail-${namespace}`)
    }
  })

  it('ships no monolithic shell-details fallback', () => {
    for (const [bundle, resource] of emitted) {
      if (!bundle.startsWith('detail-')) continue
      expect(Object.keys(resource)).toEqual([bundle.slice('detail-'.length)])
    }
  })

  it('inlines every key a computed shell key can resolve to', () => {
    const leaves = new Set(leafKeys(catalog) as string[])
    for (const prefix of usageManifest.shellDynamicPrefixes) {
      for (const key of keysUnderPrefix(prefix, leaves) as string[]) {
        expect(nested(shell, key)).toBeDefined()
      }
    }
  })

  it('resolves every namespace identically through the slim runtime manifest', () => {
    const complete = new Set<string>(runtimeManifest.complete)
    const detail = new Set(runtimeManifest.detail)
    const grouped = new Map<string, string>()
    for (const [bundle, namespaces] of Object.entries(runtimeManifest.grouped)) {
      for (const namespace of namespaces) grouped.set(namespace, bundle)
    }
    for (const [namespace, bundle] of Object.entries(usageManifest.namespaceFallbackBundles)) {
      // Complete namespaces are answered by the shell and intentionally carry
      // no lookup entry at all.
      if (complete.has(namespace)) {
        expect(detail.has(namespace) || grouped.has(namespace)).toBe(false)
        continue
      }
      const resolved = detail.has(namespace) ? `detail-${namespace}` : grouped.get(namespace)
      expect(resolved).toBe(bundle)
    }
  })

  it('keeps the hand-maintained runtime key escape hatch free of derivable entries', () => {
    expect(usageManifest.autoDiscoveredRuntimeKeys).toEqual([])
  })

  it('declares every fully inlined namespace so a typo cannot cost a request', () => {
    expect(runtimeManifest.complete).toContain('nav')
    for (const namespace of runtimeManifest.complete) {
      const shellLeaves = new Set(leafKeys((shell as Json)[namespace], namespace) as string[])
      for (const key of leafKeys((catalog as Json)[namespace], namespace) as string[]) {
        expect(shellLeaves.has(key)).toBe(true)
      }
    }
  })

  it('suppresses only keys that no artifact can answer', () => {
    expect(runtimeManifest.missing.length).toBeGreaterThan(0)
    for (const key of runtimeManifest.missing) {
      expect(resolvableInCatalog(catalog, key), key).toBe(false)
      expect(nested(shell, key), key).toBeUndefined()
      const [namespace, ...rest] = key.split('.')
      const bundle = usageManifest.namespaceFallbackBundles[
        namespace as keyof typeof usageManifest.namespaceFallbackBundles
      ]
      const resource = emitted.get(bundle)
      // The chunk the runtime would otherwise fetch provably lacks the key.
      if (resource) expect(nested(resource[namespace], rest.join('.')), key).toBeUndefined()
    }
  })

  it('keeps the suppression list deterministic and reachable', () => {
    expect(runtimeManifest.missing).toEqual([...new Set(runtimeManifest.missing)].sort())
    for (const key of runtimeManifest.missing) {
      const namespace = key.split('.')[0]
      // A suppressed key must belong to a namespace the runtime otherwise
      // knows, or the short-circuit would be unreachable dead weight.
      expect(usageManifest.namespaceFallbackBundles).toHaveProperty(namespace)
      expect(runtimeManifest.complete).not.toContain(namespace)
    }
  })

  it('inlines a fallback chunk that is cheaper to ship than to request', () => {
    // `emptyState` keys are composed at render time
    // (`emptyState.<scope>.<view>.hint`), so no static list can enumerate
    // them. Shipping the whole 144-byte namespace removes that entire class
    // of dead fetches.
    expect(runtimeManifest.complete).toContain('emptyState')
    for (const namespace of runtimeManifest.complete) {
      expect(runtimeManifest.missing.some((key: string) => key.startsWith(`${namespace}.`))).toBe(false)
    }
  })

  it('keeps the known-missing ratchet baseline in sync with the generated list', () => {
    expect(knownMissingBaseline).toEqual(runtimeManifest.missing)
    expect(usageManifest.knownMissingKeys).toEqual(runtimeManifest.missing)
  })

  it('keeps the startup locale payload materially smaller than the full manifest', () => {
    const runtimeBytes = JSON.stringify(runtimeManifest).length
    const fullBytes = JSON.stringify(usageManifest).length
    expect(runtimeBytes).toBeLessThan(fullBytes / 10)
  })
})
