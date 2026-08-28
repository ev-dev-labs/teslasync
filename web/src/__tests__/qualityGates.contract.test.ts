import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  compareWorktreeState,
  listRecursive,
  pathMarker,
  registeredPaths,
  snapshotRegisteredPaths,
} from '../../../scripts/check-generated-freshness.mjs'
import {
  auditAcknowledgementReasons,
  auditDependencyDuplication,
  auditIdenticalImplementations,
  auditMapCoverage,
  auditPackageCopies,
  classifyChunks,
  classifyDependencyDrift,
  implementationKey,
  lockfileDuplicates,
  nextBaseline,
  normalizeSource,
  packageCopyKey,
  packageCopyOf,
  parseReasonOverrides,
  PLACEHOLDER_IMPLEMENTATION_REASON,
  PLACEHOLDER_PACKAGE_REASON,
  reasonProblem,
} from '../../scripts/check-duplicate-modules.mjs'
import {
  chainRootIndex,
  classifyLongListSource,
  containsJsxInExpressionPosition,
  enclosingBraceIndex,
  isBoundedLiteralCollection,
  isJsxExpressionContainer,
  localDefinitionBody,
  mapCallbackReturnsJsx,
  reconcileLongListBacklog,
  rendersMappedList,
} from '../../scripts/audit-virtualization.mjs'
import { auditArchivedEntries } from '../../scripts/check-audit-registry.mjs'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Mutation coverage for the quality gates themselves.
 *
 * Every gate below shipped in a shape that could not fail. Each block here
 * mutates exactly one thing and asserts the gate rejects it, so "OK" from these
 * scripts means something.
 */

// ─────────────────────────────────────────────────────────────────────────────
describe('generated-artifact freshness: dirty-worktree mutation detection', () => {
  // Written under node_modules so a leaked fixture can never appear in
  // `git status` (which is precisely the signal under test here).
  let fixtureRoot: string

  beforeEach(() => {
    const base = join(webRoot, 'node_modules', '.tmp-quality-gates')
    mkdirSync(base, { recursive: true })
    fixtureRoot = mkdtempSync(join(base, 'freshness-'))
  })

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('detects a byte mutation of an ALREADY-DIRTY file whose git status never changes', () => {
    // The regression: the gate compared `git status --porcelain` only. A file
    // that is already ` M` stays ` M` no matter how many times a "check"
    // rewrites it, so the mutation this gate exists to catch was invisible.
    mkdirSync(join(fixtureRoot, 'generated'), { recursive: true })
    const artifact = join(fixtureRoot, 'generated', 'changelog.ts')
    writeFileSync(artifact, 'export const A = 1\n', 'utf8')

    const paths = ['generated/changelog.ts']
    const dirtyStatus = ' M generated/changelog.ts\n'

    const before = { porcelain: dirtyStatus, digests: snapshotRegisteredPaths(fixtureRoot, paths) }

    // A "check" secretly rewrites it. Status text is IDENTICAL.
    writeFileSync(artifact, 'export const A = 2\n', 'utf8')

    const after = { porcelain: dirtyStatus, digests: snapshotRegisteredPaths(fixtureRoot, paths) }

    expect(after.porcelain).toBe(before.porcelain)
    const changes = compareWorktreeState(before, after)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toContain('generated/changelog.ts')
    expect(changes[0]).toContain('content changed')
  })

  it('detects a byte mutation inside a claimed DIRECTORY, recursively', () => {
    mkdirSync(join(fixtureRoot, 'i18n', 'en', 'nested'), { recursive: true })
    writeFileSync(join(fixtureRoot, 'i18n', 'en', 'a.json'), '{"a":1}', 'utf8')
    writeFileSync(join(fixtureRoot, 'i18n', 'en', 'nested', 'b.json'), '{"b":1}', 'utf8')

    const paths = ['i18n/en/']
    const status = ' M i18n/en/nested/b.json\n'
    const before = { porcelain: status, digests: snapshotRegisteredPaths(fixtureRoot, paths) }

    writeFileSync(join(fixtureRoot, 'i18n', 'en', 'nested', 'b.json'), '{"b":2}', 'utf8')

    const after = { porcelain: status, digests: snapshotRegisteredPaths(fixtureRoot, paths) }
    const changes = compareWorktreeState(before, after)
    expect(changes.join('\n')).toContain('i18n/en/nested/b.json')
  })

  it('detects creation, deletion and a type change of a registered path', () => {
    mkdirSync(join(fixtureRoot, 'd'), { recursive: true })
    writeFileSync(join(fixtureRoot, 'd', 'x.ts'), 'x', 'utf8')
    const paths = ['d/', 'gone.ts']

    const before = { porcelain: '', digests: snapshotRegisteredPaths(fixtureRoot, paths) }
    expect(before.digests['gone.ts']).toBe('missing')

    writeFileSync(join(fixtureRoot, 'gone.ts'), 'now here', 'utf8')
    writeFileSync(join(fixtureRoot, 'd', 'y.ts'), 'y', 'utf8')
    rmSync(join(fixtureRoot, 'd', 'x.ts'))

    const after = { porcelain: '', digests: snapshotRegisteredPaths(fixtureRoot, paths) }
    const changes = compareWorktreeState(before, after).join('\n')
    expect(changes).toContain('gone.ts')
    expect(changes).toContain('d/y.ts: created')
    expect(changes).toContain('d/x.ts')
  })

  it('still reports a brand-new UNDECLARED path via porcelain', () => {
    const before = { porcelain: '', digests: {} }
    const after = { porcelain: '?? scripts/surprise.mjs\n', digests: {} }
    expect(compareWorktreeState(before, after).join('\n'))
      .toContain('undeclared worktree entry appeared: ?? scripts/surprise.mjs')
  })

  it('digests registry SOURCES, not only outputs', () => {
    // The i18n split can rewrite its own inputs (`known-missing-keys.json`),
    // and those inputs are routinely already dirty on a feature branch — so an
    // output-only digest plus a status-code comparison saw nothing at all.
    const registry = {
      artifacts: [
        {
          paths: ['web/src/i18n/en/'],
          sources: ['web/src/i18n/en.json', 'web/src/i18n/known-missing-keys.json'],
        },
        { paths: ['web/src/generated/changelog.ts'], sources: ['CHANGELOG.md'] },
      ],
    }
    expect(registeredPaths(registry).sort()).toEqual([
      'CHANGELOG.md',
      'web/src/generated/changelog.ts',
      'web/src/i18n/en.json',
      'web/src/i18n/known-missing-keys.json',
      'web/src/i18n/en/',
    ].sort())
  })

  it('detects a check repairing an ALREADY-DIRTY declared SOURCE in place', () => {
    mkdirSync(join(fixtureRoot, 'i18n'), { recursive: true })
    const input = join(fixtureRoot, 'i18n', 'known-missing-keys.json')
    writeFileSync(input, '{"a":1}\n', 'utf8')

    const registry = {
      artifacts: [{ paths: ['i18n/en/'], sources: ['i18n/known-missing-keys.json'] }],
    }
    const paths = registeredPaths(registry)
    expect(paths).toContain('i18n/known-missing-keys.json')

    // Already dirty AND untracked-adjacent: the status text never moves.
    const status = ' M i18n/known-missing-keys.json\n'
    const before = { porcelain: status, digests: snapshotRegisteredPaths(fixtureRoot, paths) }

    writeFileSync(input, '{"a":1,"b":2}\n', 'utf8')

    const after = { porcelain: status, digests: snapshotRegisteredPaths(fixtureRoot, paths) }
    const changes = compareWorktreeState(before, after)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toContain('i18n/known-missing-keys.json')
    expect(changes[0]).toContain('content changed')
  })

  it('the shipped registry declares the i18n inputs its check can rewrite', () => {
    const registry = JSON.parse(
      readFileSync(join(webRoot, '..', 'scripts', 'generated-artifacts.json'), 'utf8'),
    ) as { artifacts: { id: string; sources?: string[] }[] }
    const split = registry.artifacts.find((a) => a.id === 'i18n-split-catalog')
    expect(split?.sources).toContain('web/src/i18n/known-missing-keys.json')
    expect(split?.sources).toContain('web/src/i18n/shell-runtime-keys.json')
    expect(split?.sources).toContain('web/src/i18n/namespace-audit-baseline.json')
    // …and every declared source is digested.
    const all = registeredPaths(registry as never)
    for (const source of split!.sources!) expect(all).toContain(source)
  })

  it('reports no change when nothing moved', () => {
    writeFileSync(join(fixtureRoot, 'a.ts'), 'stable', 'utf8')
    const digests = snapshotRegisteredPaths(fixtureRoot, ['a.ts'])
    expect(compareWorktreeState({ porcelain: ' M a.ts\n', digests }, { porcelain: ' M a.ts\n', digests: { ...digests } }))
      .toEqual([])
  })

  it('walks directories in deterministic order', () => {
    mkdirSync(join(fixtureRoot, 'z'), { recursive: true })
    for (const name of ['c.ts', 'a.ts', 'b.ts']) writeFileSync(join(fixtureRoot, 'z', name), name, 'utf8')
    expect(listRecursive(join(fixtureRoot, 'z'))).toEqual(['a.ts', 'b.ts', 'c.ts'])
    expect(pathMarker(join(fixtureRoot, 'z'))).toBe('d')
    expect(pathMarker(join(fixtureRoot, 'nope'))).toBe('missing')
    expect(pathMarker(join(fixtureRoot, 'z', 'a.ts'))).toMatch(/^f:[0-9a-f]{64}$/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('bundle duplication: chunk enumeration and sourcemap coverage', () => {
  it('fails when an app chunk has no sourcemap', () => {
    const { problems } = auditMapCoverage([
      { name: 'assets/route-a.js', map: { sources: ['../../src/a.ts'], mappings: 'AAAA' } },
      { name: 'assets/route-b.js', map: null },
    ])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('assets/route-b.js has no sourcemap')
  })

  it('fails when a sourcemap is unparseable or maps code to nothing', () => {
    const { problems } = auditMapCoverage([
      { name: 'assets/broken.js', map: new Error('Unexpected token }') },
      { name: 'assets/mapless.js', map: { sources: [], mappings: 'AAAA' } },
    ])
    expect(problems.join('\n')).toContain('not parseable JSON')
    expect(problems.join('\n')).toContain('has mappings but no `sources`')
  })

  it('classifies a JSON-derived data chunk without dropping it from the count', () => {
    const { problems, analysable, dataOnly } = auditMapCoverage([
      { name: 'assets/locale-x.js', map: { sources: [], mappings: '' }, code: 'const t={a:"b"};export{t as default};' },
      { name: 'assets/route.js', map: { sources: ['../../src/a.ts'], mappings: 'AAAA' } },
    ])
    expect(problems).toEqual([])
    expect(dataOnly.map((c) => c.name)).toEqual(['assets/locale-x.js'])
    expect(analysable.map((c) => c.name)).toEqual(['assets/route.js'])
  })

  it('refuses a "data-only" chunk that actually imports another module', () => {
    const { problems } = auditMapCoverage([
      {
        name: 'assets/sneaky.js',
        map: { sources: [], mappings: '' },
        code: 'import{a}from"./other.js";export{a};',
      },
    ])
    expect(problems.join('\n')).toContain('participates in the app graph')
  })

  it('excludes only the named separate compilation targets', () => {
    const { appChunks, separate } = classifyChunks([
      'sw.js',
      'workbox-abc123.js',
      'registerSW.js',
      'assets/index-a.js',
      'assets/route-b.js',
    ])
    expect(appChunks).toEqual(['assets/index-a.js', 'assets/route-b.js'])
    expect(separate.map((s) => s.name).sort()).toEqual(['registerSW.js', 'sw.js', 'workbox-abc123.js'])
    for (const s of separate) expect(s.reason).toBeTruthy()
  })
})

describe('bundle duplication: real risks', () => {
  it('detects a package reaching the bundle through two physical copies', () => {
    const ids = [
      'node_modules/fast-equals/dist/esm/index.mjs',
      'node_modules/react-grid-layout/node_modules/fast-equals/dist/esm/index.mjs',
      'node_modules/react/index.js',
    ]
    const { problems, observed } = auditPackageCopies(ids)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('fast-equals')
    expect(problems[0]).toContain('2 physical copies')
    expect(observed).toEqual([
      {
        name: 'fast-equals',
        copyRoots: [
          'node_modules/fast-equals/',
          'node_modules/react-grid-layout/node_modules/fast-equals/',
        ],
      },
    ])
  })

  it('accepts a baselined copy but still fails on a NEW copy of the same package', () => {
    const accepted = [{ name: 'fast-equals', copyRoots: ['node_modules/fast-equals/', 'node_modules/a/node_modules/fast-equals/'] }]
    const ok = auditPackageCopies(
      ['node_modules/fast-equals/x.js', 'node_modules/a/node_modules/fast-equals/x.js'],
      accepted,
    )
    expect(ok.problems).toEqual([])

    const grown = auditPackageCopies(
      [
        'node_modules/fast-equals/x.js',
        'node_modules/a/node_modules/fast-equals/x.js',
        'node_modules/b/node_modules/fast-equals/x.js',
      ],
      accepted,
    )
    expect(grown.problems.join('\n')).toContain('gained 1 new physical copy')
    expect(grown.problems.join('\n')).toContain('node_modules/b/node_modules/fast-equals/')
  })

  it('preserves node_modules nesting when normalising (the old collapse hid copies)', () => {
    expect(normalizeSource('../../node_modules/a/node_modules/foo/dist/x.js'))
      .toBe('node_modules/a/node_modules/foo/dist/x.js')
    expect(packageCopyOf('node_modules/a/node_modules/@scope/foo/x.js')).toEqual({
      name: '@scope/foo',
      copyRoot: 'node_modules/a/node_modules/@scope/foo/',
    })
    expect(normalizeSource('\u0000virtual:thing')).toBeNull()
  })

  it('detects a duplicated utility/chart implementation at two paths', () => {
    const body = `${'export function formatSeries(rows){return rows.map(r=>r.value)}\n'.repeat(30)}`
    const { problems } = auditIdenticalImplementations([
      { id: 'src/lib/chartSeries.ts', content: body },
      { id: 'src/features/analytics/lib/chartSeries.ts', content: body },
      { id: 'src/lib/other.ts', content: 'export const x = 1' },
    ])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('byte-identical implementations')
    expect(problems[0]).toContain('src/lib/chartSeries.ts')
    expect(problems[0]).toContain('src/features/analytics/lib/chartSeries.ts')
  })

  it('does not fire on trivial, barrel, test or icon sources', () => {
    const body = `${'export const noise = 1\n'.repeat(80)}`
    const { problems } = auditIdenticalImplementations([
      { id: 'src/components/ui/index.ts', content: body },
      { id: 'src/components/charts/index.ts', content: body },
      { id: 'src/features/a/__tests__/helper.ts', content: body },
      { id: 'node_modules/lucide-react/dist/esm/icons/a.js', content: body },
      { id: 'node_modules/lucide-react/dist/esm/icons/b.js', content: body },
      { id: 'src/a.ts', content: 'short' },
      { id: 'src/b.ts', content: 'short' },
    ])
    expect(problems).toEqual([])
  })

  it('fails when an accepted identical-implementation group spreads to a new path', () => {
    const body = `${'export function shared(){return 1}\n'.repeat(60)}`
    const first = auditIdenticalImplementations([
      { id: 'src/lib/a.ts', content: body },
      { id: 'src/lib/b.ts', content: body },
    ])
    const accepted = first.observed
    expect(auditIdenticalImplementations(
      [{ id: 'src/lib/a.ts', content: body }, { id: 'src/lib/b.ts', content: body }],
      accepted,
    ).problems).toEqual([])

    const spread = auditIdenticalImplementations(
      [
        { id: 'src/lib/a.ts', content: body },
        { id: 'src/lib/b.ts', content: body },
        { id: 'src/lib/c.ts', content: body },
      ],
      accepted,
    )
    expect(spread.problems.join('\n')).toContain('spread to new path(s): src/lib/c.ts')
    expect(spread.raising).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('duplicate baselines must ratchet DOWN', () => {
  it('fails when an accepted package copy no longer exists (stale authorisation)', () => {
    // Exactly the fast-equals case: the override removed the nested copy, and
    // without this the acceptance would silently re-authorise reintroducing it.
    const accepted = [{
      name: 'fast-equals',
      copyRoots: ['node_modules/fast-equals/', 'node_modules/react-grid-layout/node_modules/fast-equals/'],
    }]
    const result = auditPackageCopies(['node_modules/fast-equals/x.js'], accepted)
    expect(result.observed).toEqual([])
    expect(result.pruning.join('\n')).toContain('no longer duplicated in the bundle')
    expect(result.raising).toEqual([])
    expect(result.problems).toHaveLength(1)
  })

  it('fails when only SOME accepted copy roots are gone', () => {
    const accepted = [{
      name: 'foo',
      copyRoots: ['node_modules/foo/', 'node_modules/a/node_modules/foo/', 'node_modules/b/node_modules/foo/'],
    }]
    const result = auditPackageCopies(
      ['node_modules/foo/x.js', 'node_modules/a/node_modules/foo/x.js'],
      accepted,
    )
    expect(result.pruning.join('\n')).toContain('node_modules/b/node_modules/foo/')
    expect(result.pruning.join('\n')).toContain('prune')
  })

  it('fails when an accepted identical-implementation group is gone entirely', () => {
    const accepted = [{ sha256: 'deadbeef'.repeat(8), paths: ['src/lib/a.ts', 'src/lib/b.ts'] }]
    const result = auditIdenticalImplementations([], accepted)
    expect(result.pruning.join('\n')).toContain('no longer present in the bundle')
    expect(result.raising).toEqual([])
  })

  it('fails when an accepted group lost one of its paths', () => {
    const body = `${'export function shared(){return 1}\n'.repeat(60)}`
    const full = auditIdenticalImplementations([
      { id: 'src/lib/a.ts', content: body },
      { id: 'src/lib/b.ts', content: body },
      { id: 'src/lib/c.ts', content: body },
    ])
    const shrunk = auditIdenticalImplementations(
      [{ id: 'src/lib/a.ts', content: body }, { id: 'src/lib/b.ts', content: body }],
      full.observed,
    )
    expect(shrunk.pruning.join('\n')).toContain('no longer exists at src/lib/c.ts')
  })

  it('fails when a baselined dependency is no longer duplicated', () => {
    const baseline = { observed: [{ name: 'fast-equals', versions: ['4.0.3', '5.4.0'] }] }
    const problems = auditDependencyDuplication({ current: [], baseline })
    expect(problems.join('\n')).toContain('no longer resolves to multiple versions')
  })

  it('fails when a baselined dependency lost one of its versions', () => {
    const baseline = { observed: [{ name: 'react-is', versions: ['16.13.1', '17.0.2', '18.3.1'] }] }
    const problems = auditDependencyDuplication({
      current: [{ name: 'react-is', versions: ['17.0.2', '18.3.1'] }],
      baseline,
    })
    expect(problems.join('\n')).toContain('no longer resolves to version(s) 16.13.1')
  })

  it('classifies pruning separately from raising so --update-baseline can prune', () => {
    const baseline = { observed: [{ name: 'gone', versions: ['1.0.0', '2.0.0'] }] }
    const drift = classifyDependencyDrift({ current: [], baseline })
    expect(drift.raising).toEqual([])
    expect(drift.pruning).toHaveLength(1)

    // Pruning alone must NOT require --accept-new-duplicates.
    const { baseline: next, refused } = nextBaseline({ current: [], baseline, acceptNew: false })
    expect(refused).toEqual([])
    expect(next!.observed).toEqual([])
  })

  it('the shipped baselines contain no stale fast-equals acceptance', () => {
    const dependency = JSON.parse(
      readFileSync(join(webRoot, 'dependency-duplication-baseline.json'), 'utf8'),
    ) as { observed: { name: string }[] }
    const bundle = JSON.parse(
      readFileSync(join(webRoot, 'bundle-duplication-baseline.json'), 'utf8'),
    ) as { packageCopies: { name: string }[] }
    expect(dependency.observed.some((e) => e.name === 'fast-equals')).toBe(false)
    expect(bundle.packageCopies.some((e) => e.name === 'fast-equals')).toBe(false)
  })

  it('the narrow override that removed the duplication is still declared', () => {
    const pkg = JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8')) as {
      overrides?: Record<string, Record<string, string>>
    }
    expect(pkg.overrides?.['react-grid-layout']?.['fast-equals']).toBe('^5.4.0')

    const lock = JSON.parse(readFileSync(join(webRoot, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { version?: string }>
    }
    expect(lock.packages['node_modules/react-grid-layout/node_modules/fast-equals']).toBeUndefined()
    expect(lockfileDuplicates(lock).some((e) => e.name === 'fast-equals')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('baseline regeneration cannot erase reviewed acknowledgements', () => {
  // `--update-baseline` only checked that `dist/` EXISTED. A public (mapless)
  // build has plenty of chunks and zero module attribution, so it observes no
  // duplication at all — regenerating from that state would silently delete
  // every reviewed acceptance and, on the next private run, re-add it with a
  // fresh `TODO:` stub.
  it('a mapless dist produces zero analysable chunks and a coverage failure for every one', () => {
    const chunks = [
      { name: 'assets/a.js', map: null, code: 'export const a=1' },
      { name: 'assets/b.js', map: null, code: 'export const b=1' },
    ]
    const { problems, analysable, dataOnly } = auditMapCoverage(chunks)
    expect(analysable).toEqual([])
    expect(dataOnly).toEqual([])
    expect(problems).toHaveLength(2)
    // This is the exact condition the CLI blocks regeneration on.
    expect(problems.length > 0 || analysable.length === 0).toBe(true)
  })

  it('zero analysable chunks would observe nothing, which is why it must block', () => {
    // Demonstrates the erasure that the block prevents: with no modules, both
    // audits observe an empty world and would regenerate empty baselines.
    const copies = auditPackageCopies([], [
      { name: 'fast-equals', copyRoots: ['node_modules/fast-equals/'] },
    ])
    const identical = auditIdenticalImplementations([], [
      { sha256: 'a'.repeat(64), paths: ['x.js', 'y.js'] },
    ])
    expect(copies.observed).toEqual([])
    expect(identical.observed).toEqual([])
    // …and every reviewed acknowledgement would be reported as prunable.
    expect(copies.pruning).toHaveLength(1)
    expect(identical.pruning).toHaveLength(1)
  })

  it('rejects placeholder, empty and too-short acknowledgement reasons', () => {
    expect(reasonProblem(PLACEHOLDER_PACKAGE_REASON)).toContain('placeholder')
    expect(reasonProblem(PLACEHOLDER_IMPLEMENTATION_REASON)).toContain('placeholder')
    expect(reasonProblem('TBD')).toContain('placeholder')
    expect(reasonProblem('FIXME later')).toContain('placeholder')
    expect(reasonProblem('')).toContain('no `reason`')
    expect(reasonProblem(undefined)).toContain('no `reason`')
    expect(reasonProblem('   ')).toContain('no `reason`')
    expect(reasonProblem('vendor dupe')).toContain('only 11 characters')
    expect(
      reasonProblem(
        'Upstream ships an identical generated file in two instrumentation packages; not '
        + 'fixable from this repository.',
      ),
    ).toBeNull()
  })

  it('fails the gate when an acknowledgement carries a stub reason', () => {
    const problems = auditAcknowledgementReasons({
      packageCopies: [{ name: 'foo', copyRoots: ['node_modules/foo/'], reason: PLACEHOLDER_PACKAGE_REASON }],
      identicalImplementations: [{ sha256: 'b'.repeat(64), paths: ['x', 'y'] }],
    })
    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain(packageCopyKey('foo'))
    expect(problems[0]).toContain('placeholder')
    // Full 64-char digest, not a 12-char prefix — that is the key the baseline
    // is matched on, so it must be copyable from the message.
    expect(problems[1]).toContain(implementationKey('b'.repeat(64)))
    expect(problems[1]).toContain('no `reason`')
  })

  it('the shipped bundle baseline carries real, reviewed reasons', () => {
    const bundle = JSON.parse(readFileSync(join(webRoot, 'bundle-duplication-baseline.json'), 'utf8'))
    expect(auditAcknowledgementReasons(bundle)).toEqual([])
  })

  it('the CLI blocks regeneration before writing when coverage is unusable', () => {
    // The ordering is the contract: the coverage guard must sit ABOVE both
    // writeFileSync calls, otherwise a partial write leaves the two halves
    // describing different worlds.
    const cli = readFileSync(join(webRoot, 'scripts', 'check-duplicate-modules.mjs'), 'utf8')
    const guard = cli.indexOf('--update-baseline REFUSED (the build cannot be analysed)')
    const firstWrite = cli.indexOf('writeFileSync(BASELINE_PATH')
    const secondWrite = cli.indexOf('writeFileSync(BUNDLE_BASELINE_PATH')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(firstWrite)
    expect(guard).toBeLessThan(secondWrite)
    expect(cli).toMatch(/coverage\.length > 0 \|\| analysable\.length === 0/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('accepting a NEW duplication finding is possible, actionable and auditable', () => {
  // `--accept-new-duplicates` used to be a dead end: it wrote a placeholder
  // reason and then blocked on that very placeholder, so a genuinely
  // unavoidable finding could never be recorded. And every message truncated
  // the sha256 to 12 characters, which is not the key the baseline matches on.
  const body = `${'export function formatSeries(rows){return rows.map(r=>r.value)}\n'.repeat(30)}`
  const sources = [
    { id: 'src/lib/chartSeriesAlpha.ts', content: body },
    { id: 'src/features/analytics/lib/chartSeriesBeta.ts', content: body },
  ]

  it('reports the FULL finding key, not a 12-character prefix', () => {
    const { raising, observed } = auditIdenticalImplementations(sources)
    expect(observed).toHaveLength(1)
    const fullSha = observed[0].sha256
    expect(fullSha).toMatch(/^[0-9a-f]{64}$/)
    expect(raising[0]).toContain(implementationKey(fullSha))
    // The full digest must be present verbatim so it can be copied into --reason.
    expect(raising[0]).toContain(fullSha)
  })

  it('keys are stable and prefixed by kind', () => {
    expect(packageCopyKey('fast-equals')).toBe('packageCopy:fast-equals')
    expect(implementationKey('a'.repeat(64))).toBe(`identicalImplementation:${'a'.repeat(64)}`)
  })

  it('accepts an inline reason by full key, bare sha, or package name', () => {
    const sha = 'c'.repeat(64)
    const good = 'Upstream ships this generated file in two packages; not fixable from here.'
    expect(good.length).toBeGreaterThanOrEqual(40)

    const byFullKey = parseReasonOverrides(['--reason', `${implementationKey(sha)}=${good}`])
    expect(byFullKey.problems).toEqual([])
    expect(byFullKey.reasons.get(sha)).toBe(good)

    const byBareSha = parseReasonOverrides(['--reason', `${sha}=${good}`])
    expect(byBareSha.reasons.get(sha)).toBe(good)

    const byPackage = parseReasonOverrides(['--reason', `packageCopy:fast-equals=${good}`])
    expect(byPackage.reasons.get('fast-equals')).toBe(good)
  })

  it('rejects a malformed or unjustified --reason instead of silently ignoring it', () => {
    expect(parseReasonOverrides(['--reason']).problems[0]).toContain('requires a `<key>=<text>`')
    expect(parseReasonOverrides(['--reason', 'no-equals-sign']).problems[0])
      .toContain('not in `<key>=<text>` form')
    expect(parseReasonOverrides(['--reason', '=text']).problems[0]).toContain('empty key')
    const short = parseReasonOverrides(['--reason', 'pkg=too short'])
    expect(short.problems[0]).toContain('only 9 characters')
    expect(short.reasons.size).toBe(0)
    const stub = parseReasonOverrides(['--reason', `pkg=${PLACEHOLDER_PACKAGE_REASON}`])
    expect(stub.problems[0]).toContain('placeholder')
    expect(stub.reasons.size).toBe(0)
  })

  it('a stub-reason acceptance is written but can never be a green state', () => {
    // Step 2 of the flow: the entry exists (so it is editable and auditable),
    // the acknowledgement reason is still a stub, and the NORMAL gate is red.
    const written = {
      packageCopies: [],
      identicalImplementations: [
        { sha256: 'd'.repeat(64), paths: sources.map((s) => s.id), reason: PLACEHOLDER_IMPLEMENTATION_REASON },
      ],
    }
    const problems = auditAcknowledgementReasons(written)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(implementationKey('d'.repeat(64)))
    expect(problems[0]).toContain('placeholder')

    // …and once a real reason lands, the same acknowledgement is accepted.
    written.identicalImplementations[0].reason =
      'Upstream OpenTelemetry emits an identical generated semconv module in each package.'
    expect(auditAcknowledgementReasons(written)).toEqual([])
  })

  it('the CLI implements the two-step flow: write, then exit non-zero until justified', () => {
    const cli = readFileSync(join(webRoot, 'scripts', 'check-duplicate-modules.mjs'), 'utf8')
    // Reason problems must NOT be part of the pre-write raise block any more…
    expect(cli).not.toMatch(/raisingBlocked = \[[^\]]*auditAcknowledgementReasons/)
    // …they gate the exit code after the write instead.
    const write = cli.indexOf('writeFileSync(BUNDLE_BASELINE_PATH')
    const actionRequired = cli.indexOf('ACCEPTED — ACTION REQUIRED')
    expect(actionRequired).toBeGreaterThan(write)
    expect(cli).toMatch(/if \(reasonProblems\.length > 0\) \{[\s\S]*?process\.exit\(1\)/)
    // Without the accept flag, an unjustified acknowledgement still refuses to write.
    expect(cli).toContain('--update-baseline REFUSED (unjustified acknowledgement)')
    // Inline reasons take precedence over the stub.
    expect(cli).toMatch(/reasonOverrides\.get\(entry\.name\)/)
    expect(cli).toMatch(/reasonOverrides\.get\(entry\.sha256\)/)
  })

  it('package-copy acceptance cannot bypass justification either', () => {
    const problems = auditAcknowledgementReasons({
      packageCopies: [{ name: 'foo', copyRoots: ['node_modules/foo/'], reason: PLACEHOLDER_PACKAGE_REASON }],
      identicalImplementations: [],
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(packageCopyKey('foo'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('dependency duplication: per package, not fungible totals', () => {
  const baseline = {
    observed: [
      { name: 'lru-cache', versions: ['5.1.1', '11.2.7'] },
      { name: 'react-is', versions: ['16.13.1', '17.0.2', '18.3.1'] },
    ],
  }

  it('fails a SWAP that leaves the totals identical', () => {
    // 2 duplicated packages before and after, 3 extra copies before and after —
    // the aggregate ceiling could not see this.
    const current = [
      { name: 'minimatch', versions: ['3.1.5', '5.1.9'] },
      { name: 'react-is', versions: ['16.13.1', '17.0.2', '18.3.1'] },
    ]
    const problems = auditDependencyDuplication({ current, baseline })
    expect(problems.join('\n')).toContain('minimatch is newly duplicated')
  })

  it('fails a new VERSION of an already-duplicated package', () => {
    const current = [
      { name: 'lru-cache', versions: ['5.1.1', '11.2.7', '12.0.0'] },
      { name: 'react-is', versions: ['16.13.1', '17.0.2', '18.3.1'] },
    ]
    expect(auditDependencyDuplication({ current, baseline }).join('\n'))
      .toContain('lru-cache gained version(s) 12.0.0')
  })

  it('reports pruning when duplication shrinks, so the baseline cannot go stale', () => {
    // Shrinking is good news — but the acceptance must be pruned in the same
    // change, otherwise re-introducing exactly that duplication is silently
    // pre-authorised. The gate reports it; `--update-baseline` prunes it
    // without needing the accept flag.
    const current = [{ name: 'react-is', versions: ['17.0.2', '18.3.1'] }]
    const problems = auditDependencyDuplication({ current, baseline })
    expect(problems.join('\n')).toContain('lru-cache is in the baseline but no longer resolves')
    expect(problems.join('\n')).toContain('react-is no longer resolves to version(s) 16.13.1')

    const drift = classifyDependencyDrift({ current, baseline })
    expect(drift.raising).toEqual([])
    expect(drift.pruning).toHaveLength(2)
  })

  it('passes only when the baseline matches reality exactly', () => {
    const current = [
      { name: 'lru-cache', versions: ['5.1.1', '11.2.7'] },
      { name: 'react-is', versions: ['16.13.1', '17.0.2', '18.3.1'] },
    ]
    expect(auditDependencyDuplication({ current, baseline })).toEqual([])
  })

  it('--update-baseline REFUSES any increase without the explicit accept flag', () => {
    const current = [
      { name: 'lru-cache', versions: ['5.1.1', '11.2.7'] },
      { name: 'react-is', versions: ['16.13.1', '17.0.2', '18.3.1'] },
      { name: 'brand-new', versions: ['1.0.0', '2.0.0'] },
    ]
    const refusedResult = nextBaseline({ current, baseline, acceptNew: false })
    expect(refusedResult.baseline).toBeNull()
    expect(refusedResult.refused.join('\n')).toContain('brand-new is newly duplicated')

    const accepted = nextBaseline({ current, baseline, acceptNew: true })
    expect(accepted.baseline).not.toBeNull()
    expect(accepted.baseline!.observed.map((e: { name: string }) => e.name)).toContain('brand-new')
  })

  it('--update-baseline in normal mode only lowers/prunes', () => {
    const current = [{ name: 'react-is', versions: ['17.0.2', '18.3.1'] }]
    const { baseline: next, refused } = nextBaseline({ current, baseline, acceptNew: false })
    expect(refused).toEqual([])
    expect(next!.observed).toEqual([{ name: 'react-is', versions: ['17.0.2', '18.3.1'] }])
    expect(next!.totalDuplicatedPackages).toBe(1)
    expect(next!.totalExtraCopies).toBe(1)
  })

  it('reads multi-version packages out of a lockfile, including nested copies', () => {
    const lock = {
      packages: {
        '': { name: 'root' },
        'node_modules/foo': { version: '1.0.0' },
        'node_modules/bar/node_modules/foo': { version: '2.0.0' },
        'node_modules/solo': { version: '9.9.9' },
        'node_modules/linked': { link: true, resolved: '../x' },
      },
    }
    expect(lockfileDuplicates(lock)).toEqual([{ name: 'foo', versions: ['1.0.0', '2.0.0'] }])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('virtualization backlog: derived from a source scan', () => {
  const LONG_LIST_PAGE = `
    import { Pagination } from '@/components/ui'
    export default function NewThingListPage() {
      const rows = useThings()
      return (<div>{rows.map((r) => (<div key={r.id}>{r.name}</div>))}<Pagination /></div>)
    }
  `

  it('discovers a brand-new unvirtualized long-list page from its source alone', () => {
    const verdict = classifyLongListSource(LONG_LIST_PAGE)
    expect(verdict.isLongListSurface).toBe(true)
    expect(verdict.reasons).toContain('pagination')
  })

  it('fails reconciliation when that new page is not acknowledged', () => {
    const problems = reconcileLongListBacklog({
      discovered: [
        { file: 'features/trips/pages/TripListPage.tsx', reasons: ['pagination'] },
        { file: 'features/things/pages/NewThingListPage.tsx', reasons: ['pagination'] },
      ],
      acknowledged: ['features/trips/pages/TripListPage.tsx'],
    })
    expect(problems).toHaveLength(1)
    expect(problems[0].file).toBe('features/things/pages/NewThingListPage.tsx')
    expect(problems[0].reason).toContain('not acknowledged')
  })

  it('fails reconciliation when an acknowledged entry has migrated (backlog must ratchet down)', () => {
    const problems = reconcileLongListBacklog({
      discovered: [],
      acknowledged: ['features/trips/pages/TripListPage.tsx'],
    })
    expect(problems).toHaveLength(1)
    expect(problems[0].reason).toContain('Prune the entry')
  })

  it('does not flag a page that uses DataTable, a virtualizer, or a waiver', () => {
    expect(classifyLongListSource(`${LONG_LIST_PAGE}\n<DataTable virtualized />`).excludedBy)
      .toBe('datatable')
    expect(classifyLongListSource(`import { useVirtualizer } from 'x'\n${LONG_LIST_PAGE}`).excludedBy)
      .toBe('virtualizer')
    expect(classifyLongListSource(`// virtualize-audit:skip bounded to 20 rows\n${LONG_LIST_PAGE}`).excludedBy)
      .toBe('waiver')
  })

  it('does not flag a short list with no long-list admission', () => {
    const verdict = classifyLongListSource(`
      export function Tabs() {
        return <div>{TABS.map((t) => (<span key={t}>{t}</span>))}</div>
      }
    `)
    expect(verdict.isLongListSurface).toBe(false)
    expect(verdict.excludedBy).toBe('no-long-list-admission')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('virtualization discovery: chained collection idioms', () => {
  // Every one of these slipped past the original `{ident.map(` regex.
  const CHAINS: Array<[string, string]> = [
    ['filter before map', '<div>{rows.filter((r) => r.active).map((r) => (<Row key={r.id} />))}</div>'],
    ['slice before map', '<div>{items.slice(0, pageSize).map((i) => (<li key={i.id} />))}</div>'],
    ['sort before map', '<div>{entries.sort((a, b) => a.t - b.t).map((e) => (<li key={e.id} />))}</div>'],
    ['filter + slice + map', '<div>{rows.filter(Boolean).slice(0, 50).map((r) => (<li key={r.id} />))}</div>'],
    ['spread + sort + map', '<div>{[...pinned].sort().map((p) => (<li key={p} />))}</div>'],
    ['nullish default group', '<div>{(data ?? []).map((d) => (<li key={d.id} />))}</div>'],
    ['optional chain member', '<div>{data?.results.map((d) => (<li key={d.id} />))}</div>'],
    ['Array.from(collection)', '<div>{Array.from(set).sort().map((s) => (<li key={s} />))}</div>'],
    ['flatMap chain', '<div>{groups.flatMap((g) => g.rows).map((r) => (<li key={r.id} />))}</div>'],
    ['conditional render', '<div>{ready && rows.filter(Boolean).map((r) => (<li key={r.id} />))}</div>'],
    ['nested arrow arguments', '<div>{rows.filter((r) => tags.some((t) => r.tags.includes(t))).map((r) => (<li key={r.id} />))}</div>'],
    ['member root', '<div>{state.list.filter(Boolean).map((r) => (<li key={r.id} />))}</div>'],
  ]

  for (const [label, jsx] of CHAINS) {
    it(`detects a mapped collection via ${label}`, () => {
      expect(rendersMappedList(jsx)).toBe(true)
    })
  }

  it('a new paginated page using a chained map fails discovery reconciliation', () => {
    // A realistic new page: paginated, exportable, bulk-selectable, and
    // rendering through `filter(...).slice(...).map(...)`.
    const NEW_PAGE = `
      import { Pagination } from '@/components/ui'
      import { BulkActionsToolbar } from '@/components/data-display'
      import { ListExportMenu } from '@/components/forms'

      export default function ServiceVisitsListPage() {
        const { data } = useServiceVisits()
        const visits = data ?? []
        return (
          <PageContainer>
            <BulkActionsToolbar selected={selected} />
            <ListExportMenu rows={visits} />
            <ul>
              {visits
                .filter((v) => v.status !== 'cancelled')
                .slice(page * 50, page * 50 + 50)
                .map((v) => (<li key={v.id}>{v.summary}</li>))}
            </ul>
            <Pagination page={page} onChange={setPage} />
          </PageContainer>
        )
      }
    `
    const verdict = classifyLongListSource(NEW_PAGE)
    expect(verdict.isLongListSurface).toBe(true)
    expect(verdict.reasons.sort()).toEqual(['bulk-actions', 'list-export', 'pagination'])

    const problems = reconcileLongListBacklog({
      discovered: [
        { file: 'features/trips/pages/TripListPage.tsx', reasons: ['pagination'] },
        { file: 'features/service/pages/ServiceVisitsListPage.tsx', reasons: verdict.reasons },
      ],
      acknowledged: ['features/trips/pages/TripListPage.tsx'],
    })
    expect(problems).toHaveLength(1)
    expect(problems[0].file).toBe('features/service/pages/ServiceVisitsListPage.tsx')
    expect(problems[0].reason).toContain('not acknowledged')
  })

  it('a bulk-selectable page rendering through Array.from(...).sort().map is discovered', () => {
    const page = `
      import { BulkActionsToolbar } from '@/components/data-display'
      export default function PinnedSignalsPage() {
        return (<div><BulkActionsToolbar />
          <ul>{Array.from(pinnedSignals).sort().map((s) => (<li key={s}>{s}</li>))}</ul>
        </div>)
      }
    `
    expect(classifyLongListSource(page).isLongListSurface).toBe(true)
  })

  it('excludes fixed-size skeleton loops, which are not long lists', () => {
    expect(isBoundedLiteralCollection('[1, 2, 3, 4, 5]')).toBe(true)
    expect(isBoundedLiteralCollection("['a', 'b']")).toBe(true)
    expect(isBoundedLiteralCollection('Array.from({ length: 6 })')).toBe(true)
    expect(isBoundedLiteralCollection('new Array(4)')).toBe(true)
    expect(isBoundedLiteralCollection('Array.from(pinnedSignals)')).toBe(false)
    expect(isBoundedLiteralCollection('rows.filter(Boolean)')).toBe(false)

    const skeletonOnly = `
      import { Pagination } from '@/components/ui'
      export function Skeleton() {
        return (<div>{Array.from({ length: 6 }).map((_, i) => (<Row key={i} />))}<Pagination /></div>)
      }
    `
    expect(classifyLongListSource(skeletonOnly).isLongListSurface).toBe(false)
  })

  it('does not treat a non-collection map as a list render', () => {
    // `.map(` on a string literal / inside a non-JSX position must not match.
    expect(rendersMappedList('const x = rows.map((r) => r.id)')).toBe(false)
    expect(chainRootIndex('".map("', 1)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('virtualization discovery: JSX context must be genuine', () => {
  // The scan used to accept `{ & ? :` immediately left of the chain root as
  // proof of a JSX expression container. Those are also the ternary operator,
  // an object-property separator and `&&` in ordinary logic, which is how a
  // pure data transform in ChargingListPage.tsx became a load-bearing
  // acknowledgement while the real list lived in SessionListSection.tsx.
  const NEGATIVE: Array<[string, string]> = [
    ['TS ternary data shaping', 'const evidence = hasAnomalies ? anomalies.map((a) => a.session) : sessions;'],
    ['TS object-property shaping', 'const payload = { rows: sessions.slice(0, 5).map((s) => ({ id: s.id })) };'],
    ['TS logical shaping', 'const ids = enabled && sessions.filter(Boolean).map((s) => s.id);'],
    ['arrow object body', 'const build = () => { return { items: rows.map((r) => r.id) }; };'],
    ['function block body', 'function toRows(rows) { return rows.filter(Boolean).map((r) => r.id); }'],
    ['array of objects', 'const cfg = [{ rows: list.map((l) => l.id) }];'],
    ['call argument', 'setState(rows.slice(0, 5).map((r) => r.id));'],
    [
      'the real ChargingListPage narrativeEvidence transform',
      `const narrativeEvidence: OperationalNarrative['evidence'] = (
         anomalies.length > 0 ? anomalies.map((anomaly) => anomaly.session) : dateFilteredSessions
       )
         .slice(0, 5)
         .map((session) => {
           const anomaly = anomalyById.get(session.id);
           return { id: \`charging-session-\${session.id}\`, summary: anomaly?.message ?? '' };
         });`,
    ],
  ]

  for (const [label, source] of NEGATIVE) {
    it(`does NOT treat ${label} as a rendered list`, () => {
      expect(rendersMappedList(source)).toBe(false)
    })
  }

  const POSITIVE: Array<[string, string]> = [
    ['JSX child container', '<ul>{sessions.map((s) => (<li key={s.id}>{s.id}</li>))}</ul>'],
    ['JSX logical render', '<ul>{ready && sessions.map((s) => (<li key={s.id} />))}</ul>'],
    ['JSX ternary render', '<ul>{ready ? sessions.map((s) => (<li key={s.id} />)) : null}</ul>'],
    ['JSX sibling container', '<ul>{header}{sessions.map((s) => (<li key={s.id} />))}</ul>'],
    ['JSX attribute container', '<List rows={sessions.filter(Boolean).map((s) => (<Row key={s.id} />))} />'],
    ['chained inside JSX', '<ul>{sessions.filter(Boolean).slice(0, 50).map((s) => (<li key={s.id} />))}</ul>'],
    ['block-bodied callback returning JSX', '<ul>{rows.map((r) => { return <li key={r.id} />; })}</ul>'],
  ]

  for (const [label, source] of POSITIVE) {
    it(`detects ${label}`, () => {
      expect(rendersMappedList(source)).toBe(true)
    })
  }

  it('rejects an in-JSX map whose callback returns data rather than elements', () => {
    expect(rendersMappedList('<Chart series={rows.map((r) => ({ x: r.t, y: r.v }))} />')).toBe(false)
  })

  it('distinguishes JSX containers from every other brace', () => {
    const jsxChild = '<div>{rows.map(r => <li/>)}</div>'
    expect(isJsxExpressionContainer(jsxChild, jsxChild.indexOf('{'))).toBe(true)

    const arrowBody = 'const f = () => { return 1 }'
    expect(isJsxExpressionContainer(arrowBody, arrowBody.indexOf('{'))).toBe(false)

    const objectLiteral = 'const o = { a: 1 }'
    expect(isJsxExpressionContainer(objectLiteral, objectLiteral.indexOf('{'))).toBe(false)

    const attribute = '<Foo bar={x} />'
    expect(isJsxExpressionContainer(attribute, attribute.indexOf('{'))).toBe(true)

    const comparison = 'const b = a >= { }'
    expect(isJsxExpressionContainer(comparison, comparison.indexOf('{'))).toBe(false)
  })

  it('balances brackets when finding the enclosing brace', () => {
    const src = '<div>{fn({ a: 1 }, [2]).map(r => <li/>)}</div>'
    const rootIdx = src.indexOf('fn')
    expect(enclosingBraceIndex(src, rootIdx)).toBe(src.indexOf('{'))
    expect(enclosingBraceIndex('rows.map(r => r)', 0)).toBeNull()
  })

  it('detects JSX-returning callbacks without matching comparisons', () => {
    const jsx = '.map((r) => (<li key={r.id} />))'
    expect(mapCallbackReturnsJsx(jsx, jsx.indexOf('('))).toBe(true)
    const compare = '.map((r) => r.a < r.b)'
    expect(mapCallbackReturnsJsx(compare, compare.indexOf('('))).toBe(false)
    const obj = '.map((r) => ({ id: r.id }))'
    expect(mapCallbackReturnsJsx(obj, obj.indexOf('('))).toBe(false)
  })

  it('the shipped backlog no longer acknowledges the non-rendering ChargingListPage', () => {
    const audit = readFileSync(join(webRoot, 'scripts', 'audit-virtualization.mjs'), 'utf8')
    const list = /ACKNOWLEDGED_LONG_LIST_SURFACES = \[([\s\S]*?)\n\];/.exec(audit)?.[1] ?? ''
    expect(list).not.toBe('')
    expect(list).not.toContain("'features/charging/pages/ChargingListPage.tsx'")
    // …while the component that really renders those rows is still tracked.
    expect(list).toContain("'features/charging/components/charging-list/SessionListSection.tsx'")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('virtualization discovery: callback forms that really occur', () => {
  // The previous comment claimed no by-reference renderer existed. Seven call
  // sites across five files do: WidgetPicker.tsx (×3),
  // ConsumablesLifecyclePage.tsx, WarrantyCommandPage.tsx,
  // CommandDomainBrowser.tsx and CommandWorkspace.tsx.
  const BY_REFERENCE_ARROW = `
    const renderWidgetCard = (widget: WidgetMeta) => (
      <button key={widget.id} type="button">{widget.title}</button>
    );
    export function WidgetPicker() {
      return <div>{filteredWidgets.map(renderWidgetCard)}</div>;
    }
  `
  const BY_REFERENCE_FUNCTION = `
    function renderLifecycle(item: Lifecycle) {
      return <li key={item.id}>{item.name}</li>;
    }
    export function ConsumablesLifecyclePage() {
      return <div className="space-y-4">{lifecycles.map(renderLifecycle)}</div>;
    }
  `

  const POSITIVE: Array<[string, string]> = [
    ['by-reference arrow renderer (WidgetPicker form)', BY_REFERENCE_ARROW],
    ['by-reference function renderer (ConsumablesLifecycle form)', BY_REFERENCE_FUNCTION],
    ['ternary JSX / null callback', '<ul>{rows.map((r) => (r.ok ? <Row key={r.id} /> : null))}</ul>'],
    ['ternary null / JSX callback', '<ul>{rows.map((r) => (r.ok ? null : <Row key={r.id} />))}</ul>'],
    ['line comment between arrow and JSX', '<ul>{rows.map((r) => (\n  // keep in sync with Row\n  <Row key={r.id} />\n))}</ul>'],
    ['block comment between return and JSX', '<ul>{rows.map((r) => {\n  /* see ADR-004 */\n  return <Row key={r.id} />;\n})}</ul>'],
    ['fragment shorthand', '<ul>{rows.map((r) => <>{r.a}{r.b}</>)}</ul>'],
    ['namespaced element', '<ul>{rows.map((r) => <ui.Row key={r.id} />)}</ul>'],
  ]

  for (const [label, source] of POSITIVE) {
    it(`detects ${label}`, () => {
      expect(rendersMappedList(source)).toBe(true)
    })
  }

  const NEGATIVE: Array<[string, string]> = [
    ['comparison inside the callback', 'const t = rows.map((r) => r.a < r.b);'],
    ['comparison plus ternary', 'const t = rows.map((r) => (r.a < r.b ? 1 : 2));'],
    ['generic type argument', 'const t = rows.map((r) => new Set<string>(r.tags));'],
    ['generic call expression', 'const t = rows.map((r) => pick<Row>(r));'],
    ['object-returning by-reference callback', 'const toRow = (r) => ({ id: r.id });\nconst t = rows.map(toRow);'],
    ['by-reference callback defined in another module', '<ul>{rows.map(renderFromElsewhere)}</ul>'],
  ]

  for (const [label, source] of NEGATIVE) {
    it(`does NOT detect ${label}`, () => {
      expect(rendersMappedList(source)).toBe(false)
    })
  }

  it('resolves a local definition body for both declaration shapes', () => {
    expect(localDefinitionBody(BY_REFERENCE_ARROW, 'renderWidgetCard')).toContain('<button')
    expect(localDefinitionBody(BY_REFERENCE_FUNCTION, 'renderLifecycle')).toContain('<li')
    expect(localDefinitionBody('const other = 1;', 'renderRow')).toBeNull()
  })

  it('recognises JSX only in expression position', () => {
    expect(containsJsxInExpressionPosition('=> <Row />')).toBe(true)
    expect(containsJsxInExpressionPosition('? <Row /> : null')).toBe(true)
    expect(containsJsxInExpressionPosition('return (<Row />)')).toBe(true)
    expect(containsJsxInExpressionPosition('=> <>{x}</>')).toBe(true)
    expect(containsJsxInExpressionPosition('a < b')).toBe(false)
    expect(containsJsxInExpressionPosition('a < b.c ? 1 : 2')).toBe(false)
    expect(containsJsxInExpressionPosition('new Map<string, number>()')).toBe(false)
  })

  it('the by-reference render sites are detected but correctly excluded from the backlog', () => {
    // Detection now sees them; the long-list ADMISSION rule is what keeps them
    // out of the backlog, and two of them use <DataTable/> instead.
    for (const rel of [
      'features/dashboard/components/WidgetPicker.tsx',
      'features/system/components/command-center/CommandDomainBrowser.tsx',
    ]) {
      const src = readFileSync(join(webRoot, 'src', rel), 'utf8')
      expect(rendersMappedList(src)).toBe(true)
      expect(classifyLongListSource(src).excludedBy).toBe('no-long-list-admission')
    }
    for (const rel of [
      'features/ownership/pages/ConsumablesLifecyclePage.tsx',
      'features/ownership/pages/WarrantyCommandPage.tsx',
    ]) {
      const src = readFileSync(join(webRoot, 'src', rel), 'utf8')
      expect(rendersMappedList(src)).toBe(true)
      expect(classifyLongListSource(src).excludedBy).toBe('datatable')
    }
  })

  it('documents the residual limitation truthfully', () => {
    const audit = readFileSync(join(webRoot, 'scripts', 'audit-virtualization.mjs'), 'utf8')
    expect(audit).toContain('RESIDUAL LIMITATION')
    expect(audit).toContain('imported from')
    // The false claim must not come back.
    expect(audit).not.toContain('no surface in this repository uses that form')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('archived audits: restoration at the ORIGINAL path is rejected', () => {
  const entry = {
    script: 'icon-audit.ps1',
    originalPath: 'scripts/icon-audit.ps1',
    archivedTo: 'scripts/archive/icon-audit.ps1',
    reports: ['docs/audits/archive/icon-audit.md'],
    supersededBy: ['npm run perf:check'],
    documentedIn: 'docs/audits/archive/README.md',
  }
  const present = new Set([
    'scripts/archive/icon-audit.ps1',
    'docs/audits/archive/icon-audit.md',
    'docs/audits/archive/README.md',
  ])
  const base = {
    entries: [entry],
    packageJsonRaw: '{"scripts":{}}',
    repoExists: (p: string) => present.has(p),
    webScriptExists: () => false,
  }

  it('passes while the script stays archived', () => {
    expect(auditArchivedEntries(base)).toEqual([])
  })

  it('fails when the script is restored at its repository-root original path', () => {
    // The old check resolved `entry.script` under `web/scripts/`, where
    // `icon-audit.ps1` had never lived — so it asserted the absence of a file
    // that could not exist and passed while the real one was back.
    const restored = new Set([...present, 'scripts/icon-audit.ps1'])
    const problems = auditArchivedEntries({ ...base, repoExists: (p: string) => restored.has(p) })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('scripts/icon-audit.ps1 exists again')
  })

  it('fails when no originalPath is recorded at all', () => {
    const { originalPath, ...withoutOriginal } = entry
    expect(originalPath).toBeTruthy()
    expect(auditArchivedEntries({ ...base, entries: [withoutOriginal] }).join('\n'))
      .toContain('must record `originalPath`')
  })

  it('fails when the archived copy is missing, unattributed, or undocumented', () => {
    expect(auditArchivedEntries({ ...base, repoExists: () => false }).join('\n'))
      .toContain('is not at its recorded location')
    expect(auditArchivedEntries({ ...base, entries: [{ ...entry, supersededBy: [] }] }).join('\n'))
      .toContain('must name the executable gate')
    expect(auditArchivedEntries({ ...base, entries: [{ ...entry, documentedIn: undefined }] }).join('\n'))
      .toContain('existing decision record')
  })

  it('fails when package.json still references the archived script', () => {
    expect(auditArchivedEntries({ ...base, packageJsonRaw: '{"scripts":{"a":"pwsh ../scripts/icon-audit.ps1"}}' }).join('\n'))
      .toContain('still references archived audit')
  })
})
