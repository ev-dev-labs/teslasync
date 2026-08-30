/**
 * CLEAN-08 — audit registry coverage gate.
 *
 * NOTE: no `#!` line — this module is imported by
 * `src/__tests__/qualityGates.contract.test.ts` so the archived-audit mutation
 * checks exercise the real audit function.
 *
 * TeslaSync accumulated 37 static audit scripts. Several were defined in
 * package.json but unreachable from any command CI runs, one had no npm script
 * at all, and one printed a WARN backlog that could never fail. An audit nobody
 * can fail is documentation with a shebang.
 *
 * This gate makes the audit suite self-describing and self-enforcing. It reads
 * `scripts/audit-registry.json` and proves, executably:
 *
 *   1. COVERAGE    every `scripts/audit*.mjs` is registered exactly once, and
 *                  every `audit:*` npm script points at a registered file — so
 *                  a new audit cannot land unregistered, and an alias cannot
 *                  dangle after a script is renamed.
 *   2. EXECUTABLE  every active audit has a non-zero exit path. A script that
 *                  only prints is not a gate.
 *   3. THRESHOLDED every active audit declares how it fails: 'zero-violations'
 *                  or 'threshold' + the env var that pins the ceiling/floor,
 *                  so a tolerated backlog is a number in the repository rather
 *                  than a paragraph in a console log.
 *   4. WIRED       every active audit is reachable from a root command CI
 *                  actually runs, expanded transitively through `npm run`.
 *   5. ARCHIVED    an archived audit is really gone from scripts/ and from
 *                  package.json, and names the executable gate that replaced
 *                  it plus the doc that records the decision.
 *
 * Usage: node scripts/check-audit-registry.mjs   (npm run audit:registry)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(SCRIPT_DIR, '..')
const REPO_ROOT = resolve(WEB_ROOT, '..')
const REGISTRY_PATH = join(SCRIPT_DIR, 'audit-registry.json')

/**
 * Pure audit of the `archived` section. Exported so the contract test can prove
 * restoration at the ORIGINAL repository-root path is rejected — the old check
 * looked under `web/scripts/`, which `icon-audit.ps1` never occupied, so it
 * asserted the absence of a file that had never existed there and would have
 * passed while the real script sat restored at `scripts/icon-audit.ps1`.
 *
 * @param {Object} input
 * @param {object[]} input.entries registry.archived
 * @param {string} input.packageJsonRaw raw web/package.json text
 * @param {(repoRelativePath: string) => boolean} input.repoExists
 * @param {(webScriptsRelativeName: string) => boolean} input.webScriptExists
 */
export function auditArchivedEntries({ entries, packageJsonRaw, repoExists, webScriptExists }) {
  const failures = []
  for (const entry of entries ?? []) {
    if (!entry.originalPath) {
      failures.push(
        `archived audit ${entry.script} must record \`originalPath\` (repository-root relative) — `
        + 'without it the "is it really gone?" check has nothing to look at',
      )
    } else if (repoExists(entry.originalPath)) {
      failures.push(
        `${entry.originalPath} exists again but ${entry.script} is marked archived — either `
        + 'un-archive it in scripts/audit-registry.json (and wire it into a CI root), or remove '
        + 'the restored copy. An archived audit that quietly comes back is unowned and ungated.',
      )
    }
    if (webScriptExists(entry.script)) {
      failures.push(`web/scripts/${entry.script} is marked archived but present in web/scripts/`)
    }
    if (packageJsonRaw.includes(entry.script)) {
      failures.push(`package.json still references archived audit ${entry.script}`)
    }
    if (!entry.archivedTo || !repoExists(entry.archivedTo)) {
      failures.push(
        `archived audit ${entry.script} is not at its recorded location ${entry.archivedTo}`,
      )
    }
    if (entry.originalPath && entry.archivedTo === entry.originalPath) {
      failures.push(
        `archived audit ${entry.script} records the same path as original and archived location`,
      )
    }
    for (const report of entry.reports ?? []) {
      if (!repoExists(report)) failures.push(`archived report ${report} is missing`)
    }
    if (!Array.isArray(entry.supersededBy) || entry.supersededBy.length === 0) {
      failures.push(
        `archived audit ${entry.script} must name the executable gate(s) that superseded it — `
        + 'quality may never be reduced by archiving',
      )
    }
    if (!entry.documentedIn || !repoExists(entry.documentedIn)) {
      failures.push(`archived audit ${entry.script} must point at an existing decision record`)
    }
  }
  return failures
}

function main() {
const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))
const pkg = JSON.parse(readFileSync(join(WEB_ROOT, 'package.json'), 'utf8'))
const npmScripts = pkg.scripts ?? {}

const failures = []

// ── 1. Coverage ─────────────────────────────────────────────────────────────
const onDisk = readdirSync(SCRIPT_DIR)
  .filter((f) => /^audit.*\.mjs$/i.test(f))
  .sort()

const registered = new Map()
for (const entry of registry.audits) {
  if (registered.has(entry.script)) {
    failures.push(`audit-registry.json registers ${entry.script} more than once`)
  }
  registered.set(entry.script, entry)
}

for (const file of onDisk) {
  if (!registered.has(file)) {
    failures.push(
      `scripts/${file} exists but is not in scripts/audit-registry.json — `
      + 'register it with `enforcement`, an `npmScript` (or `wiredBy`), and what it asserts',
    )
  }
}
for (const entry of registry.audits) {
  if (!existsSync(join(SCRIPT_DIR, entry.script))) {
    failures.push(`audit-registry.json registers scripts/${entry.script}, which does not exist`)
  }
}

// Every `audit:*` npm alias must resolve to a registered script.
const registeredNpm = new Set(
  [...registry.audits, ...registry.reports].map((e) => e.npmScript).filter(Boolean),
)
for (const [name, command] of Object.entries(npmScripts)) {
  if (!name.startsWith('audit:')) continue
  // Aggregates (`audit:a11y-static`) only chain other `npm run` calls.
  if (/^(?:npm run [\w:.-]+(?:\s*&&\s*)?)+$/.test(command.trim())) continue
  // `scripts/check-*.mjs` are gates about the suite (this file included), not
  // audits of application source; they are not registry entries.
  if (/scripts\/check-[\w.-]+\.mjs/.test(command)) continue
  if (!registeredNpm.has(name)) {
    failures.push(
      `package.json script "${name}" runs an audit that is not registered in `
      + 'scripts/audit-registry.json',
    )
  }
}

// ── 2/3. Executable + thresholded ───────────────────────────────────────────
const NONZERO_EXIT_RE = /process\.exit\(\s*(?!0\s*\))|process\.exitCode\s*=\s*[1-9]/
for (const entry of registry.audits) {
  if (entry.status !== 'active') continue
  const path = join(SCRIPT_DIR, entry.script)
  if (!existsSync(path)) continue
  const source = readFileSync(path, 'utf8')
  if (!NONZERO_EXIT_RE.test(source)) {
    failures.push(
      `scripts/${entry.script} is registered active but has no non-zero exit path — `
      + 'a report-only script is not a gate; either fail on a threshold or move it to `reports`',
    )
  }
  if (entry.enforcement !== 'zero-violations' && entry.enforcement !== 'threshold') {
    failures.push(
      `scripts/${entry.script} must declare enforcement: "zero-violations" or "threshold"`,
    )
  }
  if (entry.enforcement === 'threshold' && !entry.thresholdEnv) {
    failures.push(
      `scripts/${entry.script} declares enforcement "threshold" but no \`thresholdEnv\` — `
      + 'a tolerated backlog must be a pinned, greppable number',
    )
  }
  if (!entry.asserts) {
    failures.push(`scripts/${entry.script} must declare what it asserts`)
  }
}

// ── 4. Wired into something CI runs ─────────────────────────────────────────
/** Transitively expand the `npm run X` graph from the declared roots. */
function reachableNpmScripts(roots) {
  const seen = new Set()
  const pending = [...roots]
  while (pending.length > 0) {
    const name = pending.pop()
    if (!name || seen.has(name)) continue
    if (!(name in npmScripts)) continue
    seen.add(name)
    // npm runs pre<name>/post<name> automatically.
    for (const hook of [`pre${name}`, `post${name}`]) {
      if (hook in npmScripts && !seen.has(hook)) pending.push(hook)
    }
    for (const match of npmScripts[name].matchAll(/npm run ([\w:.-]+)/g)) {
      pending.push(match[1])
    }
  }
  return seen
}

const roots = Object.keys(registry.roots ?? {})
const reachable = reachableNpmScripts(roots)
for (const entry of registry.audits) {
  if (entry.status !== 'active') continue
  if (entry.npmScript) {
    if (!(entry.npmScript in npmScripts)) {
      failures.push(
        `audit-registry.json says scripts/${entry.script} is run by "${entry.npmScript}", `
        + 'which does not exist in package.json',
      )
      continue
    }
    if (!npmScripts[entry.npmScript].includes(entry.script)) {
      failures.push(
        `package.json "${entry.npmScript}" does not invoke scripts/${entry.script}`,
      )
    }
    if (!reachable.has(entry.npmScript)) {
      failures.push(
        `scripts/${entry.script} is active but "${entry.npmScript}" is unreachable from any CI `
        + `root (${roots.join(', ')}) — an audit CI never runs cannot fail, so it is not a gate`,
      )
    }
    continue
  }
  if (entry.wiredBy) {
    const wiring = join(REPO_ROOT, 'web', entry.wiredBy.replace(/^web\//, ''))
    if (!existsSync(wiring)) {
      failures.push(`scripts/${entry.script} declares wiredBy ${entry.wiredBy}, which does not exist`)
    } else if (!readFileSync(wiring, 'utf8').includes(entry.script)) {
      failures.push(`${entry.wiredBy} does not reference scripts/${entry.script}`)
    }
    continue
  }
  failures.push(
    `scripts/${entry.script} is active but declares neither \`npmScript\` nor \`wiredBy\``,
  )
}

// ── 5. Archived entries are really archived ─────────────────────────────────
const pkgJsonRaw = readFileSync(join(WEB_ROOT, 'package.json'), 'utf8')
failures.push(
  ...auditArchivedEntries({
    entries: registry.archived,
    packageJsonRaw: pkgJsonRaw,
    repoExists: (rel) => existsSync(join(REPO_ROOT, rel)),
    webScriptExists: (name) => existsSync(join(SCRIPT_DIR, name)),
  }),
)

// Report-only entries must be honest about not being gates.
for (const entry of registry.reports ?? []) {
  if (entry.kind !== 'report' || entry.status !== 'manual') {
    failures.push(`report entry ${entry.script} must be kind:"report" status:"manual"`)
  }
  if (!Array.isArray(entry.supersededBy) || entry.supersededBy.length === 0) {
    failures.push(
      `report entry ${entry.script} must name the executable gates that enforce the same policy`,
    )
  }
  if (entry.npmScript && !(entry.npmScript in npmScripts)) {
    failures.push(`report entry ${entry.script} declares npmScript "${entry.npmScript}", which does not exist`)
  }
}

const active = registry.audits.filter((a) => a.status === 'active')
const thresholded = active.filter((a) => a.enforcement === 'threshold')
console.log(
  `[audit-registry] ${onDisk.length} audit script(s) on disk, ${active.length} active `
  + `(${thresholded.length} thresholded), ${(registry.reports ?? []).length} manual report(s), `
  + `${(registry.archived ?? []).length} archived`,
)

if (failures.length > 0) {
  console.error('\n[audit-registry] VIOLATIONS:')
  for (const f of failures) console.error(`  - ${f}`)
  console.error('')
  process.exit(1)
}

console.log('[audit-registry] OK — every audit is registered, executable, thresholded and wired\n')
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
}
