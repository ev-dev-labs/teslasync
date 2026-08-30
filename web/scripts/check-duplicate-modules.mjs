/**
 * Duplicate-implementation gate.
 *
 * NOTE: no `#!` line — this module is imported by
 * `src/__tests__/qualityGates.contract.test.ts` so the mutation checks
 * exercise the real audit functions.
 *
 * ── What the first version got wrong ─────────────────────────────────────────
 * It asked "is one module path present in two chunks?". Rollup assigns a module
 * to exactly one output chunk, so that question is almost always answered "no"
 * by construction: the check could not fire, and reported OK over 3,966 modules
 * without ever having been able to fail. It also derived both `analysed` and
 * `total` from the set of `.map` files it found, so a chunk whose sourcemap was
 * missing simply vanished from the denominator — the gate silently stopped
 * covering it. And its vendor half was a 17-name hand-written allowlist, so any
 * package nobody had thought of was out of scope.
 *
 * ── What it checks now ───────────────────────────────────────────────────────
 * COVERAGE   Emitted app `.js` chunks are enumerated FIRST, from the build
 *            output. Every one of them must have a parseable sourcemap with a
 *            non-empty `sources` array. Only explicitly named separate
 *            compilation targets (the service worker and its Workbox runtime,
 *            produced by vite-plugin-pwa's own nested build with its own entry
 *            and tsconfig) may lack one. A missing map is a FAILURE, not an
 *            exclusion.
 *
 * RISK A     Multiple physical copies of one package reaching the bundle.
 *            `node_modules/x/node_modules/foo/` and `node_modules/foo/` are two
 *            different implementations of `foo` shipped to the browser: two
 *            module registries, two sets of module-level state, twice the
 *            bytes. Derived from the real sourcemap paths — no allowlist — so
 *            it covers every package, lucide-react included.
 *
 * RISK B     Byte-identical substantial implementations at different paths.
 *            A utility or chart helper copy-pasted to a second location, or a
 *            package shipping the same file through two entry points, is real
 *            duplication that path-based checks cannot see. Content is hashed
 *            from `sourcesContent`; trivial and mechanically-templated files
 *            are excluded (see `IGNORED_SOURCE`) so barrels, fixtures, icon
 *            stubs and type-only modules cannot produce noise.
 *
 * RISK C     Dependency duplication in the lockfile, compared PER PACKAGE
 *            against a committed baseline. Aggregate ceilings were fungible: a
 *            newly duplicated package could replace a removed one and the
 *            totals would not move. Every newly duplicated package, and every
 *            new version of an already-duplicated package, now fails on its
 *            own regardless of totals.
 *
 * Usage:
 *   VITE_SOURCEMAP_MODE=private npx vite build
 *   node scripts/check-duplicate-modules.mjs [--dist dist]
 *   node scripts/check-duplicate-modules.mjs --update-baseline
 *   node scripts/check-duplicate-modules.mjs --update-baseline --accept-new-duplicates
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(SCRIPT_DIR, '..')
const LOCKFILE = join(WEB_ROOT, 'package-lock.json')
const BASELINE_PATH = join(WEB_ROOT, 'dependency-duplication-baseline.json')
const BUNDLE_BASELINE_PATH = join(WEB_ROOT, 'bundle-duplication-baseline.json')

/**
 * Outputs produced by a DIFFERENT compilation than the app graph. These are the
 * only chunks allowed to have no sourcemap, and the only ones excluded from the
 * duplication analysis.
 *
 * `sw.js` and `workbox-*.js` come from vite-plugin-pwa's `injectManifest`
 * strategy, which runs a nested Vite build with its own entry and
 * `tsconfig.sw.json` (WebWorker lib, no DOM). A module shared by the page and
 * the worker — `src/sw/buildContract.ts`, for example — MUST exist in both
 * outputs because a worker cannot import a page chunk. `registerSW.js` is a
 * plugin-emitted registration shim that belongs to neither graph.
 */
export const SEPARATE_OUTPUT_TARGETS = [
  { pattern: /^sw\.js$/, reason: 'vite-plugin-pwa injectManifest nested build (own entry + tsconfig.sw.json)' },
  { pattern: /^workbox-[^/]*\.js$/, reason: 'Workbox runtime bundled into the service-worker output' },
  { pattern: /^registerSW\.js$/, reason: 'plugin-emitted SW registration shim, outside the app graph' },
]

/** Minimum source length before an identical-content match is worth reporting. */
export const MIN_DUPLICATE_SOURCE_CHARS = Number(
  process.env.DUPLICATE_MIN_SOURCE_CHARS ?? 1200,
)

/**
 * Sources excluded from the identical-content check. Each entry is a real
 * false-positive class, not a convenience:
 *  - barrels/re-export files are *supposed* to look alike;
 *  - declaration files emit no runtime implementation;
 *  - tests/fixtures/mocks are duplicated on purpose;
 *  - generated locale bundles and icon stubs are mechanically templated.
 */
export const IGNORED_SOURCE = [
  /(^|\/)index\.(m?[jt]sx?)$/,
  /\.d\.ts$/,
  /(^|\/)(__tests__|__mocks__|__fixtures__|tests?|testdata|fixtures)\//,
  /\.(test|spec|stories)\.[jt]sx?$/,
  /(^|\/)locale-[^/]*\.json$/,
  /node_modules\/lucide-react\/dist\/esm\/icons\//,
]

/**
 * An acknowledgement is only meaningful if somebody wrote down WHY. A
 * regenerated `TODO:` placeholder is an unreviewed acceptance wearing the
 * costume of a reviewed one, so it is rejected in both the gate and the
 * acceptance path.
 */
export const MIN_REASON_CHARS = Number(process.env.DUPLICATE_MIN_REASON_CHARS ?? 40)

const PLACEHOLDER_REASON = /^\s*(?:todo\b|tbd\b|fixme\b|xxx\b|n\/a\b|none\b|-+\s*$)/i

/** Stubs `--update-baseline` writes for a brand-new finding. Both are rejected. */
export const PLACEHOLDER_PACKAGE_REASON =
  'TODO: record why this duplication is tolerated, or deduplicate it.'
export const PLACEHOLDER_IMPLEMENTATION_REASON =
  'TODO: record why this duplication is tolerated, or extract a shared module.'

/**
 * Stable, FULL key for one acknowledgement. Messages print this verbatim so an
 * operator can copy it straight into `--reason` or search the baseline for it.
 * The 12-char prefix used in prose is unusable for that: matching is by the
 * complete 64-character digest.
 */
export function packageCopyKey(name) {
  return `packageCopy:${name}`
}
export function implementationKey(sha256) {
  return `identicalImplementation:${sha256}`
}

/**
 * Parse repeatable `--reason <key>=<text>` arguments.
 *
 * `<key>` is either a full key from {@link packageCopyKey} /
 * {@link implementationKey}, a bare package name, or a bare 64-char sha256.
 *
 * @param {string[]} argv
 * @returns {{reasons: Map<string, string>, problems: string[]}}
 */
export function parseReasonOverrides(argv) {
  const reasons = new Map()
  const problems = []
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--reason') continue
    const raw = argv[i + 1]
    if (typeof raw !== 'string') {
      problems.push('`--reason` requires a `<key>=<text>` argument')
      continue
    }
    const eq = raw.indexOf('=')
    if (eq === -1) {
      problems.push(`\`--reason ${raw}\` is not in \`<key>=<text>\` form`)
      continue
    }
    const key = raw.slice(0, eq).trim()
    const text = raw.slice(eq + 1)
    if (key === '') {
      problems.push('`--reason` was given an empty key')
      continue
    }
    const problem = reasonProblem(text)
    if (problem) {
      problems.push(`\`--reason ${key}\` ${problem}`)
      continue
    }
    // Accept a full key or the bare identifier half of one.
    reasons.set(key.replace(/^(?:packageCopy|identicalImplementation):/, ''), text.trim())
  }
  return { reasons, problems }
}

/** @returns {string|null} why the reason is unusable, or null when it is fine. */
export function reasonProblem(reason) {
  if (typeof reason !== 'string' || reason.trim() === '') {
    return 'has no `reason` — an acceptance without a written justification is not a review'
  }
  const text = reason.trim()
  if (PLACEHOLDER_REASON.test(text)) {
    return `has a placeholder \`reason\` ("${text.slice(0, 48)}…") — `
      + '`--update-baseline` writes that stub; replace it with the real justification'
  }
  if (text.length < MIN_REASON_CHARS) {
    return `has a \`reason\` of only ${text.length} characters ("${text}") — `
      + `at least ${MIN_REASON_CHARS} are required to describe why the duplication is tolerated`
  }
  return null
}

/** An ES module import of another module specifier (not a `import:` object key). */
export const MODULE_IMPORT_RE =
  /(?:^|[;}\n])\s*import\s*(?:[\w*{][^;]*?\bfrom\s*)?["'][^"']+["']|\bimport\s*\(\s*["']/

// ── Chunk + sourcemap coverage ──────────────────────────────────────────────

export function isSeparateTarget(assetName) {
  return SEPARATE_OUTPUT_TARGETS.find((t) => t.pattern.test(assetName)) ?? null
}

/**
 * Split emitted `.js` files into the app graph and the explicitly separate
 * compilation targets.
 *
 * @param {string[]} jsFiles emitted `.js` file names (relative to dist)
 */
export function classifyChunks(jsFiles) {
  const appChunks = []
  const separate = []
  for (const name of [...jsFiles].sort()) {
    const target = isSeparateTarget(name)
    if (target) separate.push({ name, reason: target.reason })
    else appChunks.push(name)
  }
  return { appChunks, separate }
}

/**
 * Classify every app chunk by whether module attribution is available.
 *
 * Three outcomes:
 *  - ANALYSABLE  the map lists sources; the chunk feeds the duplication checks.
 *  - DATA-ONLY   the map has no sources AND no mappings. Rollup emits that only
 *                when a chunk contains no original-source code at all — the
 *                locale bundles, which are compiled straight from JSON. There
 *                is no implementation in them that could be duplicated. Counted
 *                and reported, never silently dropped, and a data-only chunk
 *                that imports another emitted chunk is rejected because that
 *                would mean it does participate in the app graph.
 *  - FAILURE     no map, an unparseable map, or a map with mappings but no
 *                sources. Any of those makes a chunk invisible to this gate.
 *
 * @param {{name: string, map: unknown, code?: string}[]} chunks
 */
export function auditMapCoverage(chunks) {
  const problems = []
  const analysable = []
  const dataOnly = []

  for (const chunk of chunks) {
    const { name, map, code } = chunk
    if (map === null || map === undefined) {
      problems.push(
        `${name} has no sourcemap — this gate cannot see inside it, so duplication in `
        + 'that chunk would pass unnoticed. Build with VITE_SOURCEMAP_MODE=private, or add '
        + 'the file to SEPARATE_OUTPUT_TARGETS with a written reason if it is a different '
        + 'compilation target.',
      )
      continue
    }
    if (map instanceof Error) {
      problems.push(`${name}.map is not parseable JSON: ${map.message}`)
      continue
    }
    const sources = Array.isArray(map.sources) ? map.sources : []
    if (sources.length > 0) {
      analysable.push(chunk)
      continue
    }
    if ((map.mappings ?? '') !== '') {
      problems.push(
        `${name}.map has mappings but no \`sources\` — module attribution is broken for a `
        + 'chunk that does contain original-source code',
      )
      continue
    }
    if (typeof code === 'string' && MODULE_IMPORT_RE.test(code)) {
      problems.push(
        `${name} has no original sources yet imports another module — it participates in the `
        + 'app graph and must carry a real sourcemap',
      )
      continue
    }
    dataOnly.push(chunk)
  }

  return { problems, analysable, dataOnly }
}

// ── Module path normalisation ───────────────────────────────────────────────

/**
 * Normalise a sourcemap `sources` entry to a stable module id, PRESERVING
 * node_modules nesting (the previous version collapsed it, which is what made
 * a second physical copy of a package invisible).
 *
 * Returns null for entries that are not real modules.
 */
export function normalizeSource(source) {
  const s = String(source).replaceAll('\\', '/')
  if (s.includes('\u0000')) return null
  if (s.includes('vite/preload-helper')) return null
  if (s.includes('/commonjsHelpers.js') || s.includes('commonjs-dynamic-modules')) return null
  if (s.startsWith('vite/') || s.includes('/@vite/')) return null

  const nm = s.indexOf('node_modules/')
  if (nm !== -1) return s.slice(nm)

  const src = s.lastIndexOf('/src/')
  if (src !== -1) return s.slice(src + 1)
  if (s.startsWith('src/')) return s
  if (s.startsWith('../src/')) return s.slice(3)
  return null
}

/**
 * The physical copy a node_modules module belongs to, e.g.
 * `node_modules/a/node_modules/foo/` for a nested install of `foo`.
 * Returns null for app sources.
 */
export function packageCopyOf(moduleId) {
  if (!moduleId.startsWith('node_modules/')) return null
  const marker = 'node_modules/'
  const last = moduleId.lastIndexOf(marker)
  const rest = moduleId.slice(last + marker.length)
  const parts = rest.split('/')
  const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
  return { name, copyRoot: `${moduleId.slice(0, last + marker.length)}${name}/` }
}

/**
 * RISK A — a package present in the bundle through more than one physical copy.
 *
 * @param {string[]} moduleIds normalised module ids across all app chunks
 * @param {{name: string, copyRoots: string[]}[]} accepted acknowledged findings
 */
export function auditPackageCopies(moduleIds, accepted = []) {
  /** @type {Map<string, Map<string, number>>} name -> copyRoot -> module count */
  const byPackage = new Map()
  for (const id of moduleIds) {
    const copy = packageCopyOf(id)
    if (!copy) continue
    if (!byPackage.has(copy.name)) byPackage.set(copy.name, new Map())
    const roots = byPackage.get(copy.name)
    roots.set(copy.copyRoot, (roots.get(copy.copyRoot) ?? 0) + 1)
  }

  const acceptedByName = new Map(accepted.map((e) => [e.name, new Set(e.copyRoots)]))
  const raising = []
  const pruning = []
  const observed = []
  const observedNames = new Set()
  for (const [name, roots] of [...byPackage].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (roots.size < 2) continue
    const copyRoots = [...roots.keys()].sort()
    observed.push({ name, copyRoots })
    observedNames.add(name)
    const detail = [...roots]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([root, count]) => `${root} (${count} modules)`)
      .join(', ')

    const allowed = acceptedByName.get(name)
    if (!allowed) {
      raising.push(
        `package ${name} [${packageCopyKey(name)}] reaches the bundle through ${roots.size} `
        + `physical copies: ${detail} — each copy ships its own bytes and its own module-level `
        + 'state. Deduplicate with `npm dedupe`, an `overrides` entry, or by aligning the '
        + 'requesting ranges.',
      )
      continue
    }
    // Acknowledgement is per copy root, never a count: a NEW copy of an
    // already-acknowledged package still fails.
    const added = copyRoots.filter((root) => !allowed.has(root))
    if (added.length > 0) {
      raising.push(
        `package ${name} gained ${added.length} new physical copy/copies beyond the accepted `
        + `set: ${added.join(', ')}`,
      )
    }
    // …and a copy root that is gone must be pruned in the same change,
    // otherwise re-introducing exactly that copy stays pre-authorised.
    const stale = [...allowed].filter((root) => !copyRoots.includes(root)).sort()
    if (stale.length > 0) {
      pruning.push(
        `package ${name} no longer has the accepted copy/copies ${stale.join(', ')} — prune them `
        + 'from bundle-duplication-baseline.json so the acceptance cannot silently re-authorise '
        + 'the same duplication later.',
      )
    }
  }

  // An entire acceptance that no longer corresponds to any observed duplication
  // is dead authorisation. Ratchet: it must be removed in the change that fixed it.
  for (const entry of accepted) {
    if (observedNames.has(entry.name)) continue
    pruning.push(
      `package ${entry.name} is accepted as duplicated in bundle-duplication-baseline.json but is `
      + 'no longer duplicated in the bundle — delete the entry (run '
      + '`node scripts/check-duplicate-modules.mjs --update-baseline`) so the fix ratchets down.',
    )
  }
  return { problems: [...raising, ...pruning], raising, pruning, observed }
}

/**
 * RISK B — byte-identical substantial implementations at different paths.
 *
 * @param {{id: string, content: string}[]} sources
 * @param {{sha256: string, paths: string[]}[]} accepted acknowledged findings
 */
export function auditIdenticalImplementations(sources, accepted = []) {
  /** @type {Map<string, Set<string>>} hash -> module ids */
  const byHash = new Map()
  for (const { id, content } of sources) {
    if (typeof content !== 'string') continue
    const trimmed = content.trim()
    if (trimmed.length < MIN_DUPLICATE_SOURCE_CHARS) continue
    if (IGNORED_SOURCE.some((re) => re.test(id))) continue
    const hash = createHash('sha256').update(trimmed).digest('hex')
    if (!byHash.has(hash)) byHash.set(hash, new Set())
    byHash.get(hash).add(id)
  }

  const acceptedByHash = new Map(accepted.map((e) => [e.sha256, new Set(e.paths)]))
  const raising = []
  const pruning = []
  const observed = []
  const observedHashes = new Set()
  for (const [hash, ids] of [...byHash].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (ids.size < 2) continue
    const paths = [...ids].sort()
    observed.push({ sha256: hash, paths })
    observedHashes.add(hash)

    const allowed = acceptedByHash.get(hash)
    if (!allowed) {
      raising.push(
        `${ids.size} byte-identical implementations [${implementationKey(hash)}] at different `
        + `paths: ${paths.join(', ')} — extract one shared module instead of shipping the same `
        + 'code twice.',
      )
      continue
    }
    const added = paths.filter((p) => !allowed.has(p))
    if (added.length > 0) {
      raising.push(
        `an accepted duplicate implementation [${implementationKey(hash)}] spread to new `
        + `path(s): ${added.join(', ')}`,
      )
    }
    const stale = [...allowed].filter((p) => !paths.includes(p)).sort()
    if (stale.length > 0) {
      pruning.push(
        `an accepted duplicate implementation [${implementationKey(hash)}] no longer exists at `
        + `${stale.join(', ')} — prune the path so the acceptance cannot silently re-authorise it.`,
      )
    }
  }

  for (const entry of accepted) {
    if (observedHashes.has(entry.sha256)) continue
    pruning.push(
      `accepted duplicate implementation [${implementationKey(entry.sha256)}] is no longer `
      + 'present in the bundle — delete the entry (run '
      + '`node scripts/check-duplicate-modules.mjs --update-baseline`) so the fix ratchets down.',
    )
  }
  return { problems: [...raising, ...pruning], raising, pruning, observed }
}

/**
 * Every acknowledgement in the bundle baseline must carry a real, written
 * reason. Exported so both the gate and `--update-baseline` share one rule.
 *
 * @param {{packageCopies?: object[], identicalImplementations?: object[]}|null} baseline
 * @returns {string[]} problems
 */
export function auditAcknowledgementReasons(baseline) {
  const problems = []
  for (const entry of baseline?.packageCopies ?? []) {
    const problem = reasonProblem(entry.reason)
    if (problem) problems.push(`${packageCopyKey(entry.name)} ${problem}`)
  }
  for (const entry of baseline?.identicalImplementations ?? []) {
    const problem = reasonProblem(entry.reason)
    if (problem) problems.push(`${implementationKey(entry.sha256)} ${problem}`)
  }
  return problems
}

// ── RISK C — dependency duplication, per package ────────────────────────────

/**
 * @param {object} lock parsed package-lock.json
 * @returns {{name: string, versions: string[]}[]} sorted, duplicated only
 */
export function lockfileDuplicates(lock) {
  const versions = new Map()
  for (const [path, meta] of Object.entries(lock?.packages ?? {})) {
    if (!path.startsWith('node_modules/')) continue
    if (meta.link) continue
    if (!meta.version) continue
    const name = meta.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
    if (!versions.has(name)) versions.set(name, new Set())
    versions.get(name).add(meta.version)
  }
  return [...versions]
    .filter(([, v]) => v.size > 1)
    .map(([name, v]) => ({ name, versions: [...v].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Structured drift between the current lockfile duplication and the baseline.
 *
 * Split matters: `--update-baseline` must be free to PRUNE (a duplication that
 * was fixed) but must refuse to RAISE (a duplication that appeared). The gate
 * itself fails on both — a stale acceptance is dead authorisation that would
 * let the exact same duplication return unnoticed.
 *
 * @param {{current: {name: string, versions: string[]}[], baseline: object}} input
 * @returns {{raising: string[], pruning: string[], invalid: string[]}}
 */
export function classifyDependencyDrift({ current, baseline }) {
  const observed = Array.isArray(baseline?.observed) ? baseline.observed : null
  if (!observed) {
    return {
      raising: [],
      pruning: [],
      invalid: [
        'dependency-duplication-baseline.json has no `observed` list — regenerate it with '
        + '`node scripts/check-duplicate-modules.mjs --update-baseline`',
      ],
    }
  }
  const baselineByName = new Map(observed.map((entry) => [entry.name, new Set(entry.versions)]))
  const currentByName = new Map(current.map((entry) => [entry.name, new Set(entry.versions)]))

  const raising = []
  const pruning = []

  for (const entry of current) {
    const allowed = baselineByName.get(entry.name)
    if (!allowed) {
      raising.push(
        `${entry.name} is newly duplicated (${entry.versions.join(', ')}) — it is not in the `
        + 'baseline. Deduplicate it, or accept it deliberately with '
        + '`--update-baseline --accept-new-duplicates`.',
      )
      continue
    }
    const added = entry.versions.filter((v) => !allowed.has(v))
    if (added.length > 0) {
      raising.push(
        `${entry.name} gained version(s) ${added.join(', ')} beyond the baseline `
        + `(${[...allowed].sort().join(', ')}) — a new copy reached the tree.`,
      )
    }
    const stale = [...allowed].filter((v) => !currentByName.get(entry.name).has(v)).sort()
    if (stale.length > 0) {
      pruning.push(
        `${entry.name} no longer resolves to version(s) ${stale.join(', ')} — prune them from the `
        + 'baseline so re-introducing exactly that version is not pre-authorised.',
      )
    }
  }

  for (const entry of observed) {
    if (currentByName.has(entry.name)) continue
    pruning.push(
      `${entry.name} is in the baseline but no longer resolves to multiple versions — delete the `
      + 'entry (run `node scripts/check-duplicate-modules.mjs --update-baseline`) so the fix '
      + 'ratchets down.',
    )
  }

  return { raising, pruning, invalid: [] }
}

/**
 * Compare per package, not in aggregate.
 *
 * The aggregate form was fungible: removing one duplicated package and adding
 * another left `36/42` unchanged, so a brand-new duplicated dependency passed.
 * Every newly duplicated package — and every new version of an
 * already-duplicated one — now fails on its own, and so does every acceptance
 * that no longer corresponds to a real duplication.
 *
 * @param {{current: {name: string, versions: string[]}[], baseline: object}} input
 */
export function auditDependencyDuplication({ current, baseline }) {
  const { raising, pruning, invalid } = classifyDependencyDrift({ current, baseline })
  return [...invalid, ...raising, ...pruning]
}

/**
 * Produce the next baseline. Normal mode may only LOWER: packages that are no
 * longer duplicated are pruned and versions that disappeared are dropped, but
 * anything new is refused so `--update-baseline` cannot be used to launder a
 * regression into the repository.
 *
 * @returns {{baseline: object|null, refused: string[]}}
 */
export function nextBaseline({ current, baseline, acceptNew = false }) {
  const { raising, invalid } = classifyDependencyDrift({ current, baseline })
  // Pruning is always allowed — that is the ratchet. Only a RAISE needs the
  // explicit flag.
  const blocking = [...invalid.filter(() => !acceptNew), ...raising]
  if (blocking.length > 0 && !acceptNew) {
    return { baseline: null, refused: blocking }
  }
  const observed = current.map((entry) => ({
    name: entry.name,
    versions: [...entry.versions].sort(),
  }))
  return {
    baseline: {
      $comment: [
        'Dependency-duplication baseline (web/scripts/check-duplicate-modules.mjs).',
        'PER PACKAGE, not aggregate: a listed package may keep exactly the versions listed.',
        'A newly duplicated package, or a new version of a listed one, fails the gate even',
        'when the totals do not move.',
        '`--update-baseline` only lowers/prunes; growing it requires the explicit',
        '`--accept-new-duplicates` flag in the same command.',
      ],
      totalDuplicatedPackages: observed.length,
      totalExtraCopies: observed.reduce((sum, e) => sum + e.versions.length - 1, 0),
      observed,
    },
    refused: [],
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function readMap(distDir, name) {
  const mapPath = join(distDir, `${name}.map`)
  if (!existsSync(mapPath)) return null
  try {
    return JSON.parse(readFileSync(mapPath, 'utf8'))
  } catch (error) {
    return error
  }
}

function collectEmittedJs(distDir) {
  const out = []
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), rel)
      else if (entry.name.endsWith('.js')) out.push(rel)
    }
  }
  walk(distDir, '')
  return out.sort()
}

function main() {
  const distFlagIndex = process.argv.indexOf('--dist')
  const distDir = resolve(WEB_ROOT, distFlagIndex !== -1 ? process.argv[distFlagIndex + 1] : 'dist')
  const updateBaseline = process.argv.includes('--update-baseline')
  const acceptNew = process.argv.includes('--accept-new-duplicates')
  const { reasons: reasonOverrides, problems: reasonArgProblems } = parseReasonOverrides(process.argv)
  if (reasonArgProblems.length > 0) {
    console.error('\n[duplicate-modules] invalid --reason argument(s):')
    for (const p of reasonArgProblems) console.error(`  - ${p}`)
    console.error('')
    process.exit(1)
  }

  // ── Preconditions, BEFORE anything is written ─────────────────────────────
  //
  // Both baseline halves describe the same change, so they are produced and
  // written together or not at all. The earlier version wrote the dependency
  // baseline first and only then discovered that `dist/` was missing, leaving
  // the two halves describing different states of the world.
  if (!existsSync(LOCKFILE)) {
    console.error('[duplicate-modules] web/package-lock.json not found — cannot measure dependency duplication')
    process.exit(1)
  }
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    console.error(
      `[duplicate-modules] ${distDir} not found — run a build first:\n`
      + '  VITE_SOURCEMAP_MODE=private npx vite build',
    )
    process.exit(1)
  }

  const lock = JSON.parse(readFileSync(LOCKFILE, 'utf8'))
  const currentDependencies = lockfileDuplicates(lock)
  const dependencyBaseline = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    : null
  const bundleBaseline = existsSync(BUNDLE_BASELINE_PATH)
    ? JSON.parse(readFileSync(BUNDLE_BASELINE_PATH, 'utf8'))
    : null

  // ── Bundle analysis ───────────────────────────────────────────────────────
  const emitted = collectEmittedJs(distDir)
  const { appChunks, separate } = classifyChunks(emitted)
  const chunks = appChunks.map((name) => ({
    name,
    map: readMap(distDir, name),
    code: readFileSync(join(distDir, name), 'utf8'),
  }))

  const { problems: coverage, analysable, dataOnly } = auditMapCoverage(chunks)

  const moduleIds = []
  const sources = []
  for (const { map } of analysable) {
    map.sources.forEach((source, index) => {
      const id = normalizeSource(source)
      if (!id) return
      moduleIds.push(id)
      const content = map.sourcesContent?.[index]
      if (typeof content === 'string') sources.push({ id, content })
    })
  }

  console.log(
    `[duplicate-modules] coverage: ${appChunks.length} app chunk(s) enumerated — `
    + `${analysable.length} analysable, ${dataOnly.length} data-only (JSON-derived, no `
    + `original-source code), ${coverage.length} unusable; `
    + `${separate.length} separate compilation target(s) excluded `
    + `(${separate.map((s) => s.name).join(', ') || 'none'})`,
  )
  console.log(
    `[duplicate-modules] analysed ${new Set(moduleIds).size} distinct module(s), `
    + `${sources.length} with source content`,
  )

  const copies = auditPackageCopies(moduleIds, bundleBaseline?.packageCopies ?? [])
  const identical = auditIdenticalImplementations(
    sources,
    bundleBaseline?.identicalImplementations ?? [],
  )

  // ── --update-baseline: compute both halves, refuse or write atomically ────
  if (updateBaseline) {
    // COVERAGE FIRST. A public/mapless `dist/` yields zero analysable chunks
    // and therefore zero observed duplication — regenerating from that state
    // would silently ERASE every reviewed acknowledgement and replace it with
    // nothing. Existence of `dist/` is not evidence that it can be analysed.
    if (coverage.length > 0 || analysable.length === 0) {
      console.error('\n[duplicate-modules] --update-baseline REFUSED (the build cannot be analysed):')
      if (analysable.length === 0) {
        console.error(
          `  - ${appChunks.length} app chunk(s) but 0 with module attribution — this looks like a `
          + 'public (mapless) build. Rebuild with VITE_SOURCEMAP_MODE=private before regenerating, '
          + 'or the baselines would be rewritten from an empty observation.',
        )
      }
      for (const c of coverage) console.error(`  - ${c}`)
      console.error('\n  Neither baseline file was modified.\n')
      process.exit(1)
    }

    const { baseline: nextDependency, refused } = nextBaseline({
      current: currentDependencies,
      baseline: dependencyBaseline ?? { observed: [] },
      acceptNew,
    })

    const nextBundle = {
      $comment: [
        'Accepted bundle duplication (web/scripts/check-duplicate-modules.mjs).',
        'PER FINDING, not a count: a new duplicated package, a new physical copy of an already',
        'accepted one, a new identical-implementation group, or an accepted group spreading to a',
        'new path all fail even though the totals may not move.',
        'An acceptance that no longer matches an observed duplication ALSO fails, so a fix must',
        'prune its acceptance in the same change instead of leaving the exact duplication',
        'pre-authorised for a future reintroduction.',
        'Regenerating only prunes; recording a NEW finding requires --accept-new-duplicates.',
      ],
      packageCopies: copies.observed.map((entry) => ({
        ...entry,
        reason:
          reasonOverrides.get(entry.name)
          ?? (bundleBaseline?.packageCopies ?? []).find((e) => e.name === entry.name)?.reason
          ?? PLACEHOLDER_PACKAGE_REASON,
      })),
      identicalImplementations: identical.observed.map((entry) => ({
        ...entry,
        reason:
          reasonOverrides.get(entry.sha256)
          ?? (bundleBaseline?.identicalImplementations ?? []).find((e) => e.sha256 === entry.sha256)?.reason
          ?? PLACEHOLDER_IMPLEMENTATION_REASON,
      })),
    }

    // Only RAISES need the explicit flag; pruning is the ratchet and is always
    // allowed. Every half is validated before any file is touched.
    const raisingBlocked = [
      ...(nextDependency === null ? refused : []),
      ...(acceptNew ? [] : [...copies.raising, ...identical.raising]),
    ]
    if (raisingBlocked.length > 0) {
      console.error('\n[duplicate-modules] --update-baseline REFUSED (this would raise a baseline):')
      for (const r of raisingBlocked) console.error(`  - ${r}`)
      console.error(
        '\n  `--update-baseline` only lowers or prunes. To accept a finding deliberately, '
        + 'either supply the justification inline:\n'
        + '    node scripts/check-duplicate-modules.mjs --update-baseline --accept-new-duplicates \\\n'
        + '      --reason "<key>=<at least 40 characters explaining why this is tolerated>"\n'
        + '  or run with --accept-new-duplicates alone to have the entry written with a stub you '
        + 'then fill in.\n  Neither baseline file was modified.\n',
      )
      process.exit(1)
    }

    const reasonProblems = auditAcknowledgementReasons(nextBundle)

    // WITHOUT the accept flag a bad reason is a hard refusal: regenerating
    // cannot invent a justification, and rewriting the file would only churn it.
    if (!acceptNew && reasonProblems.length > 0) {
      console.error('\n[duplicate-modules] --update-baseline REFUSED (unjustified acknowledgement):')
      for (const r of reasonProblems) console.error(`  - ${r}`)
      console.error('\n  Neither baseline file was modified.\n')
      process.exit(1)
    }

    writeFileSync(BASELINE_PATH, `${JSON.stringify(nextDependency, null, 2)}\n`, 'utf8')
    writeFileSync(BUNDLE_BASELINE_PATH, `${JSON.stringify(nextBundle, null, 2)}\n`, 'utf8')
    console.log(
      `[duplicate-modules] dependency baseline written: ${nextDependency.totalDuplicatedPackages} `
      + `package(s), ${nextDependency.totalExtraCopies} extra cop(ies)`,
    )
    console.log(
      `[duplicate-modules] bundle baseline written: ${nextBundle.packageCopies.length} package `
      + `copy finding(s), ${nextBundle.identicalImplementations.length} identical-implementation `
      + `group(s)${acceptNew ? ' (increase explicitly accepted)' : ''}`,
    )

    // STEP 2 OF THE ACCEPTANCE FLOW. The entry now exists so the operator can
    // see and edit it, but a stub reason must NEVER be a green state: exit
    // non-zero and say exactly what to write and where. The normal gate stays
    // red until a real justification lands, so a placeholder baseline can never
    // be mistaken for a reviewed one.
    if (reasonProblems.length > 0) {
      console.error(
        `\n[duplicate-modules] ACCEPTED — ACTION REQUIRED (${reasonProblems.length} acknowledgement(s) `
        + 'still lack a justification):',
      )
      for (const r of reasonProblems) console.error(`  - ${r}`)
      console.error(
        `\n  The entries were written to ${relative(WEB_ROOT, BUNDLE_BASELINE_PATH)}. Replace each `
        + `stub \`reason\` with at least ${MIN_REASON_CHARS} characters explaining why the `
        + 'duplication is tolerated and what would remove it, or re-run with:\n'
        + '    --reason "<key>=<justification>"\n'
        + '  The gate stays RED until every acknowledgement carries a real reason.\n',
      )
      process.exit(1)
    }
    return
  }

  // ── Gate ──────────────────────────────────────────────────────────────────
  const failures = [...coverage]

  if (!dependencyBaseline) {
    failures.push(
      'web/dependency-duplication-baseline.json missing — run '
      + '`node scripts/check-duplicate-modules.mjs --update-baseline`',
    )
  } else {
    const problems = auditDependencyDuplication({
      current: currentDependencies,
      baseline: dependencyBaseline,
    })
    console.log(
      `[duplicate-modules] dependencies: ${currentDependencies.length} package(s) resolve to `
      + `multiple versions; baseline lists ${dependencyBaseline.observed?.length ?? 0} `
      + '(compared per package, both directions)',
    )
    failures.push(...problems)
    if (problems.length === 0) {
      console.log('[duplicate-modules] dependencies: OK — baseline matches reality exactly')
    }
  }

  if (!bundleBaseline) {
    failures.push(
      'web/bundle-duplication-baseline.json missing — run '
      + '`node scripts/check-duplicate-modules.mjs --update-baseline`',
    )
  } else {
    failures.push(...copies.problems, ...identical.problems)
    failures.push(...auditAcknowledgementReasons(bundleBaseline))
    console.log(
      `[duplicate-modules] package copies: ${copies.observed.length} multi-copy package(s) `
      + `observed, ${copies.raising.length} unaccepted, ${copies.pruning.length} stale acceptance(s)`,
    )
    console.log(
      `[duplicate-modules] identical implementations: ${identical.observed.length} group(s) `
      + `observed (≥${MIN_DUPLICATE_SOURCE_CHARS} chars), ${identical.raising.length} unaccepted, `
      + `${identical.pruning.length} stale acceptance(s)`,
    )
  }

  if (failures.length > 0) {
    console.error('\n[duplicate-modules] VIOLATIONS:')
    for (const f of failures) console.error(`  - ${f}`)
    console.error('')
    process.exit(1)
  }
  console.log('\n[duplicate-modules] OK\n')
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
}
