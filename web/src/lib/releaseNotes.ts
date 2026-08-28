/**
 * First-class release notes derived from the canonical changelog (HELP-07).
 *
 * `CHANGELOG.md` is the single source of truth and is already machine-read
 * into `src/generated/changelog.ts` by `scripts/buildChangelog.mjs`. Writing a
 * second, hand-maintained set of release notes would guarantee drift, so this
 * module *derives* the product-facing view instead:
 *
 *   version + date  → straight from the generated entry
 *   what changed    → the changelog lines, grouped by Keep-a-Changelog type
 *   who is affected → inferred audiences (see AUDIENCE_RULES)
 *   action needed   → inferred, and deliberately over-inclusive
 *
 * The inference is keyword-based and therefore imperfect in one direction on
 * purpose: it is tuned to over-report "action needed" rather than under-report
 * it. Telling a user to check something that turned out to be automatic costs
 * thirty seconds; missing a required migration costs an outage.
 *
 * Everything here is pure and deterministic — no clock, no locale, no network.
 */

import {
  CHANGELOG,
  type ChangelogChange,
  type ChangelogChangeType,
  type ChangelogEntry,
} from '@/generated/changelog'

export type ReleaseAudience = 'all_users' | 'fleet_operators' | 'administrators' | 'developers'

export type ReleaseImpact = 'breaking' | 'security' | 'feature' | 'fix' | 'maintenance'

export interface ReleaseNoteItem {
  type: ChangelogChangeType
  text: string
  audiences: readonly ReleaseAudience[]
  /** True when this specific line needs someone to do something. */
  actionRequired: boolean
  /** True when this line describes a schema/data migration. */
  migration: boolean
}

export interface ReleaseNote {
  version: string
  /** ISO date (YYYY-MM-DD) exactly as published in the changelog. */
  date: string
  badge: ChangelogEntry['badge']
  impact: ReleaseImpact
  /** Union of the audiences of every item, ordered canonically. */
  audiences: readonly ReleaseAudience[]
  /** True when any item needs action. */
  actionRequired: boolean
  /** True when any item describes a migration. */
  hasMigration: boolean
  items: readonly ReleaseNoteItem[]
  /** Only the items that need action — what an operator reads first. */
  actionItems: readonly ReleaseNoteItem[]
}

/** Canonical audience ordering (broadest first) for stable rendering. */
export const AUDIENCE_ORDER: readonly ReleaseAudience[] = [
  'all_users',
  'fleet_operators',
  'administrators',
  'developers',
] as const

const AUDIENCE_RULES: ReadonlyArray<{ audience: ReleaseAudience; pattern: RegExp }> = [
  {
    audience: 'administrators',
    pattern:
      /\b(migration|migrate|helm|deploy|deployment|docker|env var|environment variable|config(uration)?|rbac|permission|retention|backup|secret|rotation|operator|admin)\b/i,
  },
  {
    audience: 'fleet_operators',
    pattern: /\b(fleet|multi-?vehicle|operator|dispatch|utilisation|utilization|driver)\b/i,
  },
  {
    audience: 'developers',
    pattern: /\b(api|endpoint|schema|sdk|webhook|json|payload|openapi|type|contract)\b/i,
  },
]

const ACTION_PATTERN =
  /\b(action required|breaking|manual|must |migration|migrate|re-?auth\w*|re-?configure|re-?subscribe|restart|rotate|upgrade|removed|deprecat\w+|no longer)\b/i

const MIGRATION_PATTERN = /\b(migration|migrate|schema change|db migration|backfill)\b/i

/** Types that always require someone to read them, regardless of wording. */
const ALWAYS_ACTION_TYPES: ReadonlySet<ChangelogChangeType> = new Set([
  'removed',
  'deprecated',
  'security',
])

function audiencesFor(text: string): ReleaseAudience[] {
  const matched = AUDIENCE_RULES.filter((rule) => rule.pattern.test(text)).map(
    (rule) => rule.audience,
  )
  // A change that names no specific operator concern is a change every user
  // sees. Never return an empty audience list — "affects nobody" is not a
  // possible outcome of shipping code.
  if (matched.length === 0) return ['all_users']
  return AUDIENCE_ORDER.filter((audience) => matched.includes(audience))
}

function toItem(change: ChangelogChange): ReleaseNoteItem {
  const text = change.text ?? ''
  return {
    type: change.type,
    text,
    audiences: audiencesFor(text),
    actionRequired: ALWAYS_ACTION_TYPES.has(change.type) || ACTION_PATTERN.test(text),
    migration: MIGRATION_PATTERN.test(text),
  }
}

function impactFor(items: readonly ReleaseNoteItem[]): ReleaseImpact {
  if (items.some((item) => item.type === 'security')) return 'security'
  if (items.some((item) => item.type === 'removed' || item.migration)) return 'breaking'
  if (items.some((item) => item.type === 'added')) return 'feature'
  if (items.some((item) => item.type === 'fixed')) return 'fix'
  return 'maintenance'
}

/** Convert one generated changelog entry into a product release note. */
export function toReleaseNote(entry: ChangelogEntry): ReleaseNote {
  const items = (entry.changes ?? []).map(toItem)
  const audienceSet = new Set<ReleaseAudience>()
  for (const item of items) for (const audience of item.audiences) audienceSet.add(audience)

  return {
    version: entry.version,
    date: entry.date,
    badge: entry.badge,
    impact: impactFor(items),
    audiences: AUDIENCE_ORDER.filter((audience) => audienceSet.has(audience)),
    actionRequired: items.some((item) => item.actionRequired),
    hasMigration: items.some((item) => item.migration),
    items,
    actionItems: items.filter((item) => item.actionRequired),
  }
}

/**
 * Every release note, newest first — the generated changelog is already in
 * that order and is treated as authoritative rather than re-sorted here.
 */
export function buildReleaseNotes(
  entries: readonly ChangelogEntry[] = CHANGELOG,
): ReleaseNote[] {
  return (entries ?? []).map(toReleaseNote)
}

/** Release notes for a single version, or null when unknown. */
export function releaseNoteForVersion(
  version: string,
  entries: readonly ChangelogEntry[] = CHANGELOG,
): ReleaseNote | null {
  const entry = (entries ?? []).find((candidate) => candidate.version === version)
  return entry ? toReleaseNote(entry) : null
}

/**
 * Cap the item list for a summary card. Action items come first — an operator
 * scanning a release must not have to scroll past twenty feature bullets to
 * find the migration.
 */
export function summarizeReleaseNote(note: ReleaseNote, limit = 5): ReleaseNoteItem[] {
  const rest = note.items.filter((item) => !item.actionRequired)
  return [...note.actionItems, ...rest].slice(0, Math.max(0, limit))
}
