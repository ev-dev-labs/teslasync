#!/usr/bin/env node
/**
 * Changelog generator.
 *
 * Parses the repo-root CHANGELOG.md (single source of truth) and emits
 * web/src/generated/changelog.ts as a typed, immutable list. The generated
 * file is consumed by:
 * - features/system/pages/ChangelogPage.tsx (full timeline view)
 * - components/feedback/ReleaseNotes.tsx (collapsible cards)
 * - components/feedback/ChangelogModal.tsx ("what's new since X")
 * - hooks/useChangelog.ts (unseen-version tracking)
 *
 * The generated file is committed (mirroring web/src/lib/routeRegistry.ts) so
 * PR diffs surface changelog drift. `prebuild` / `predev` verify freshness with
 * `--check` (CLEAN-05: a build must not silently rewrite the source tree);
 * regenerate explicitly with `npm run generate:changelog` and commit the diff
 * alongside the CHANGELOG.md edit.
 *
 * Source format:
 * ## [<version>] - <date> top-level version header
 * ### <section> canonical sub-section (Added/Changed/...)
 * - <bullet> change item (markdown-as-text)
 *
 * The parser is lenient by design — TeslaSync's CHANGELOG.md uses emoji-
 * decorated section headers (e.g. "### 🚀 New Features", "### 🐛 Bug Fixes")
 * that are normalized to Keep-a-Changelog 1.1.0 canonical types. `[Unreleased]`
 * blocks are skipped (no date → not a release). `#### Sub-headers` are
 * preserved as bullet entries so the UI doesn't lose grouping context.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..')
const SRC_PATH = resolve(REPO_ROOT, 'CHANGELOG.md')
const OUT_PATH = resolve(__dirname, '..', 'src', 'generated', 'changelog.ts')

// ── Section-header normalization ─────────────────────────────────────────────
// Maps the lowercased, emoji-stripped section title to a Keep-a-Changelog
// canonical type. The default for unknown labels is 'changed'.
const SECTION_SYNONYMS = {
  // Added
  added: 'added',
  add: 'added',
  features: 'added',
  feature: 'added',
  'new features': 'added',
  // Changed
  changed: 'changed',
  changes: 'changed',
  change: 'changed',
  improvements: 'changed',
  improved: 'changed',
  configuration: 'changed',
  config: 'changed',
  infrastructure: 'changed',
  architecture: 'changed',
  'developer tools': 'changed',
  'fleet telemetry': 'changed',
  'fleet telemetry fixes': 'changed',
  'api call log enhancement': 'changed',
  documentation: 'changed',
  docs: 'changed',
  notifications: 'changed',
  observability: 'changed',
  frontend: 'changed',
  'ci/cd': 'changed',
  ci: 'changed',
  'database migrations': 'changed',
  'grafana dashboards': 'changed',
  helm: 'changed',
  // Fixed
  fixed: 'fixed',
  fixes: 'fixed',
  fix: 'fixed',
  'bug fixes': 'fixed',
  bugfixes: 'fixed',
  // Removed
  removed: 'removed',
  remove: 'removed',
  // Deprecated
  deprecated: 'deprecated',
  deprecate: 'deprecated',
  // Security
  security: 'security',
}

const VALID_TYPES = ['added', 'changed', 'fixed', 'removed', 'deprecated', 'security']

// Strip leading emojis, dingbats, punctuation and whitespace from a header
// label so "🚀 New Features" → "new features".
function normalizeSectionLabel(raw) {
  // Remove anything that isn't an ASCII letter, digit, slash, or whitespace.
  // Keeps "/" so "CI/CD" survives, drops emojis/parens/colons/etc.
  const cleaned = raw
    .replace(/[^\p{Letter}\p{Number}\s/]/gu, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  return cleaned
}

function canonicalSection(label) {
  const norm = normalizeSectionLabel(label)
  if (!norm) return 'changed'
  if (SECTION_SYNONYMS[norm]) return SECTION_SYNONYMS[norm]
  // Token-level fallback: if any token maps, prefer the more-specific match
  // ("Bug Fixes" → "fixed" via "fixes"; "Security Hardening" → "security").
  const tokens = norm.split(' ')
  for (const tok of tokens) {
    if (SECTION_SYNONYMS[tok]) return SECTION_SYNONYMS[tok]
  }
  return 'changed'
}

// ── Version-header parsing ───────────────────────────────────────────────────
// Matches `## [X.Y.Z] - YYYY-MM-DD` (and en-dash / em-dash variants).
// Group 1: version string, Group 2: date string.
const VERSION_RE = /^##\s+\[([^\]]+)\]\s*[-—–]\s*(\d{4}-\d{2}-\d{2})\s*$/
const UNRELEASED_RE = /^##\s+\[unreleased\]/i
const SECTION_RE = /^###\s+(.+?)\s*$/
const SUBHEADER_RE = /^####\s+(.+?)\s*$/
const BULLET_RE = /^[\s]*[-*]\s+(.+?)\s*$/

function parseChangelog(src) {
  const lines = src.split(/\r?\n/)
  const entries = []
  let current = null
  let currentSection = null
  let pendingSubHeader = null
  let inUnreleased = false

  for (const line of lines) {
    if (UNRELEASED_RE.test(line)) {
      // Flush whatever we were working on, enter unreleased-skip mode.
      current = null
      currentSection = null
      pendingSubHeader = null
      inUnreleased = true
      continue
    }
    const versionMatch = line.match(VERSION_RE)
    if (versionMatch) {
      current = {
        version: versionMatch[1].trim(),
        date: versionMatch[2].trim(),
        sections: { added: [], changed: [], fixed: [], removed: [], deprecated: [], security: [] },
      }
      entries.push(current)
      currentSection = null
      pendingSubHeader = null
      inUnreleased = false
      continue
    }
    if (inUnreleased || !current) continue

    const sectionMatch = line.match(SECTION_RE)
    if (sectionMatch) {
      currentSection = canonicalSection(sectionMatch[1])
      pendingSubHeader = null
      continue
    }
    const subHeaderMatch = line.match(SUBHEADER_RE)
    if (subHeaderMatch) {
      // Hold the sub-header label and prepend it to the next bullet so the
      // UI keeps the grouping context without a separate render path.
      pendingSubHeader = subHeaderMatch[1].trim()
      continue
    }
    const bulletMatch = line.match(BULLET_RE)
    if (bulletMatch && currentSection) {
      let text = bulletMatch[1]
      if (pendingSubHeader) {
        text = `${pendingSubHeader}: ${text}`
        pendingSubHeader = null
      }
      // Strip surrounding markdown bold/italics markers from the wrapping
      // emphasis only (keep inline ones — they render fine as plain text).
      current.sections[currentSection].push(text)
    }
  }

  // Convert to the public ChangelogEntry shape: a flat `changes` array with
  // typed entries. Sections render in canonical order; empty sections drop.
  return entries
    .map((e) => {
      const changes = []
      for (const type of VALID_TYPES) {
        for (const text of e.sections[type]) {
          changes.push({ type, text })
        }
      }
      return { version: e.version, date: e.date, changes }
    })
    .filter((e) => e.changes.length > 0)
}

function badgeFor(version, isFirst) {
  const lower = version.toLowerCase()
  if (lower.includes('-beta') || lower.includes('-rc') || lower.includes('-alpha')) {
    return 'beta'
  }
  if (isFirst) return 'latest'
  return 'stable'
}

function escapeForTs(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function emit(entries) {
  const lines = []
  lines.push('// AUTOGENERATED by web/scripts/buildChangelog.mjs — DO NOT EDIT BY HAND.')
  lines.push('// Regenerate after editing CHANGELOG.md:')
  lines.push('//   cd web && node scripts/buildChangelog.mjs')
  lines.push('//')
  lines.push('// Source of truth: <repo-root>/CHANGELOG.md')
  lines.push('// Generated count: ' + entries.length + ' release(s).')
  lines.push('')
  lines.push("export type ChangelogChangeType = 'added' | 'changed' | 'fixed' | 'removed' | 'deprecated' | 'security'")
  lines.push('')
  lines.push('export interface ChangelogChange {')
  lines.push('  type: ChangelogChangeType')
  lines.push('  text: string')
  lines.push('}')
  lines.push('')
  lines.push("export type ChangelogBadge = 'latest' | 'stable' | 'beta'")
  lines.push('')
  lines.push('export interface ChangelogEntry {')
  lines.push('  /** Semver string, e.g. "0.7.0" or "1.0.0-beta.1". */')
  lines.push('  version: string')
  lines.push('  /** ISO date (YYYY-MM-DD) the version was released. */')
  lines.push('  date: string')
  lines.push("  /** UI badge classification: 'latest' for the topmost entry, 'beta' for pre-releases, 'stable' otherwise. */")
  lines.push('  badge: ChangelogBadge')
  lines.push('  /** Flat list of changes typed by Keep-a-Changelog category. */')
  lines.push('  changes: ChangelogChange[]')
  lines.push('}')
  lines.push('')
  lines.push('export const CHANGELOG: readonly ChangelogEntry[] = [')
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const badge = badgeFor(e.version, i === 0)
    lines.push('  {')
    lines.push(`    version: '${escapeForTs(e.version)}',`)
    lines.push(`    date: '${escapeForTs(e.date)}',`)
    lines.push(`    badge: '${badge}',`)
    lines.push('    changes: [')
    for (const c of e.changes) {
      lines.push(`      { type: '${c.type}', text: '${escapeForTs(c.text)}' },`)
    }
    lines.push('    ],')
    lines.push('  },')
  }
  lines.push(']')
  lines.push('')
  const latest = entries[0]?.version ?? '0.0.0'
  lines.push(`export const LATEST_VERSION: string = '${escapeForTs(latest)}'`)
  lines.push('')
  return lines.join('\n')
}

function main() {
  const check = process.argv.includes('--check')
  const src = readFileSync(SRC_PATH, 'utf8')
  const entries = parseChangelog(src)
  if (entries.length === 0) {
    console.error('[buildChangelog] No release entries found in CHANGELOG.md — refusing to emit empty module.')
    process.exit(1)
  }
  const out = emit(entries)

  // CLEAN-05: `--check` is the non-mutating form wired into `prebuild` /
  // `predev` and into `scripts/check-generated-freshness.mjs`. A build must
  // never silently rewrite a committed source file — a stale artefact has to
  // fail loudly so the regenerated diff lands in the PR next to CHANGELOG.md.
  if (check) {
    const existing = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, 'utf8') : null
    if (existing === out) {
      console.log(
        `[buildChangelog] OK — ${OUT_PATH.replace(REPO_ROOT, '.')} is current (${entries.length} release(s), latest: ${entries[0].version}).`,
      )
      return
    }
    console.error(
      `[buildChangelog] --check: ${OUT_PATH.replace(REPO_ROOT, '.')} is ${existing === null ? 'missing' : 'stale'}.\n`
      + '  CHANGELOG.md changed without regenerating the committed module.\n'
      + '  Run:  cd web && npm run generate:changelog\n'
      + '  then commit the regenerated file alongside the CHANGELOG.md edit.',
    )
    process.exit(1)
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, out, 'utf8')
  console.log(
    `[buildChangelog] Wrote ${entries.length} release(s) (latest: ${entries[0].version}) → ${OUT_PATH.replace(REPO_ROOT, '.')}`,
  )
}

main()
