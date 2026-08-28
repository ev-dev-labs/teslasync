/**
 * In-app help index (HELP-06).
 *
 * A single searchable index over everything the product can explain, keyed by
 * route, feature and terms. It is built from data that already exists — the
 * generated route registry, the glossary, the empty-state guidance registry,
 * the onboarding task registry and the unavailability taxonomy — so the index
 * cannot drift from the surfaces it describes: deleting a route deletes its
 * help entry, and adding a glossary term adds one.
 *
 * Two properties are non-negotiable:
 *
 *  - **Deterministic static baseline.** No network, no AI, no clock, no
 *    randomness. The same query returns the same ordered results in the same
 *    order forever, including ties (broken by id). The RAG assistant layers
 *    *alongside* this; it never replaces it, so help still works with
 *    `ai_mode='off'`, offline, or on a locked-down install.
 *  - **Ranked, capped, explainable.** Scoring is a small ladder of exact →
 *    prefix → substring matches with fixed weights, readable in one screen.
 */

import { ROUTE_REGISTRY } from './routeRegistry'
import { GLOSSARY } from './helpGlossary'
import { EMPTY_STATE_GUIDANCE } from './emptyStateGuidance'
import { ONBOARDING_TASKS } from './onboardingTasks'
import { UNAVAILABILITY_REASONS, explainUnavailability } from './dataUnavailability'

export type HelpEntryKind = 'page' | 'glossary' | 'task' | 'troubleshooting'

export interface HelpIndexEntry {
  /** Stable id, namespaced by kind: `page:/battery`, `glossary:soc`, … */
  id: string
  kind: HelpEntryKind
  titleKey: string
  titleFallback: string
  summaryKey: string
  summaryFallback: string
  /** Canonical route this entry is about, when it has one. */
  route?: string
  /** Feature bucket for grouping and route-aware lookup. */
  feature: string
  /** Lower-case search terms. Always includes the title words. */
  terms: readonly string[]
}

/** Maximum results returned by {@link searchHelpIndex}. */
export const HELP_SEARCH_LIMIT = 12

/**
 * Feature bucket for a route. Derived from the first path segment so a new
 * route joins the right bucket without a second registry to maintain.
 */
export function featureForRoute(route: string): string {
  const first = route.split('/').filter(Boolean)[0]
  return first ?? 'dashboard'
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1)
}

function buildPageEntries(): HelpIndexEntry[] {
  return ROUTE_REGISTRY.filter((route) => !route.hidden).map((route) => ({
    id: `page:${route.path}`,
    kind: 'page' as const,
    titleKey: route.i18nKey,
    titleFallback: route.label,
    summaryKey: `helpIndex.page.${route.name}.summary`,
    summaryFallback: `Open the ${route.label} page.`,
    route: route.path,
    feature: featureForRoute(route.path),
    terms: Array.from(new Set([...words(route.label), ...words(route.path)])),
  }))
}

function buildGlossaryEntries(): HelpIndexEntry[] {
  return GLOSSARY.map((term) => ({
    id: `glossary:${term.id}`,
    kind: 'glossary' as const,
    titleKey: term.termKey,
    titleFallback: term.termFallback,
    summaryKey: term.definitionKey,
    summaryFallback: term.definitionFallback,
    route: term.learnMoreTo,
    feature: 'glossary',
    terms: Array.from(
      new Set([
        term.id,
        ...term.aliases.map((alias) => alias.toLowerCase()),
        ...words(term.termFallback),
      ]),
    ),
  }))
}

function buildTaskEntries(): HelpIndexEntry[] {
  return ONBOARDING_TASKS.map((task) => ({
    id: `task:${task.id}`,
    kind: 'task' as const,
    titleKey: task.titleKey,
    titleFallback: task.titleFallback,
    summaryKey: task.bodyKey,
    summaryFallback: task.bodyFallback,
    route: task.action.to,
    feature: 'setup',
    terms: Array.from(
      new Set([task.id.replace(/-/g, ' '), ...words(task.titleFallback), 'setup', 'getting started']),
    ),
  }))
}

function buildEmptyStateEntries(): HelpIndexEntry[] {
  return EMPTY_STATE_GUIDANCE.map((guidance) => ({
    id: `troubleshooting:empty:${guidance.id}`,
    kind: 'troubleshooting' as const,
    titleKey: guidance.meaningKey,
    titleFallback: guidance.meaningFallback,
    summaryKey: guidance.likelyCauseKey,
    summaryFallback: guidance.likelyCauseFallback,
    route: guidance.action.to,
    feature: guidance.feature,
    terms: Array.from(
      new Set([
        'empty',
        'no data',
        'missing',
        guidance.feature,
        ...words(guidance.id.replace(/[.]/g, ' ')),
      ]),
    ),
  }))
}

function buildUnavailabilityEntries(): HelpIndexEntry[] {
  return UNAVAILABILITY_REASONS.map((reason) => {
    const explanation = explainUnavailability(reason)
    return {
      id: `troubleshooting:unavailable:${reason}`,
      kind: 'troubleshooting' as const,
      titleKey: explanation.titleKey,
      titleFallback: explanation.titleFallback,
      summaryKey: explanation.whatToDoKey,
      summaryFallback: explanation.whatToDoFallback,
      route: explanation.actionTo,
      feature: 'diagnostics',
      terms: Array.from(
        new Set([
          reason.replace(/_/g, ' '),
          'unavailable',
          'no data',
          ...words(explanation.titleFallback),
        ]),
      ),
    }
  })
}

let cachedIndex: HelpIndexEntry[] | null = null

/**
 * The full index, built once and memoised. Sorted by id so iteration order is
 * stable regardless of how the source registries are ordered.
 */
export function buildHelpIndex(): HelpIndexEntry[] {
  if (cachedIndex) return cachedIndex
  cachedIndex = [
    ...buildGlossaryEntries(),
    ...buildTaskEntries(),
    ...buildEmptyStateEntries(),
    ...buildUnavailabilityEntries(),
    ...buildPageEntries(),
  ].sort((a, b) => a.id.localeCompare(b.id))
  return cachedIndex
}

/** Test seam — drops the memoised index. */
export function __resetHelpIndexForTests(): void {
  cachedIndex = null
}

/** Fixed scoring ladder. Higher is a better match. */
const SCORE = {
  exactTerm: 100,
  titleExact: 90,
  titlePrefix: 60,
  termPrefix: 40,
  titleSubstring: 30,
  summarySubstring: 10,
  routeSubstring: 8,
} as const

/**
 * Kind weighting. A definition beats a page link for the same word because a
 * user typing "degradation" wants to know what it means far more often than
 * they want to be dropped on a chart of it.
 */
const KIND_BONUS: Record<HelpEntryKind, number> = {
  glossary: 6,
  troubleshooting: 4,
  task: 2,
  page: 0,
}

export function scoreHelpEntry(entry: HelpIndexEntry, needle: string): number {
  if (needle === '') return 0
  const title = entry.titleFallback.toLowerCase()
  const summary = entry.summaryFallback.toLowerCase()
  const route = (entry.route ?? '').toLowerCase()

  let score = 0
  if (entry.terms.some((term) => term === needle)) score += SCORE.exactTerm
  if (title === needle) score += SCORE.titleExact
  else if (title.startsWith(needle)) score += SCORE.titlePrefix
  else if (title.includes(needle)) score += SCORE.titleSubstring
  if (entry.terms.some((term) => term !== needle && term.startsWith(needle))) {
    score += SCORE.termPrefix
  }
  if (summary.includes(needle)) score += SCORE.summarySubstring
  if (route !== '' && route.includes(needle)) score += SCORE.routeSubstring

  return score > 0 ? score + KIND_BONUS[entry.kind] : 0
}

export interface HelpSearchOptions {
  limit?: number
  /** Restrict to a single kind. */
  kind?: HelpEntryKind
  index?: readonly HelpIndexEntry[]
}

/**
 * Deterministic ranked search.
 *
 * Ties are broken by id ascending — never by array order — so the result of a
 * query never depends on how the index happened to be assembled.
 */
export function searchHelpIndex(
  query: string,
  options: HelpSearchOptions = {},
): HelpIndexEntry[] {
  const { limit = HELP_SEARCH_LIMIT, kind, index = buildHelpIndex() } = options
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (needle === '') return []

  const scored: Array<{ entry: HelpIndexEntry; score: number }> = []
  for (const entry of index) {
    if (kind && entry.kind !== kind) continue
    const score = scoreHelpEntry(entry, needle)
    if (score > 0) scored.push({ entry, score })
  }

  scored.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
  return scored.slice(0, Math.max(0, limit)).map((item) => item.entry)
}

/**
 * Entries relevant to the current route.
 *
 * Matches the exact route first, then the feature bucket, so `/battery/health`
 * surfaces battery glossary terms and battery empty-state guidance even though
 * no entry declares that exact path. The page entry for the current route is
 * excluded — the user is already there.
 */
export function helpEntriesForRoute(
  pathname: string,
  options: { limit?: number; index?: readonly HelpIndexEntry[] } = {},
): HelpIndexEntry[] {
  const { limit = HELP_SEARCH_LIMIT, index = buildHelpIndex() } = options
  if (typeof pathname !== 'string' || pathname === '') return []
  const feature = featureForRoute(pathname)

  const scored: Array<{ entry: HelpIndexEntry; score: number }> = []
  for (const entry of index) {
    if (entry.kind === 'page' && entry.route === pathname) continue
    let score = 0
    if (entry.route === pathname) score += 50
    if (entry.feature === feature) score += 20
    if (entry.route && pathname.startsWith(`${entry.route}/`)) score += 10
    if (score > 0) scored.push({ entry, score: score + KIND_BONUS[entry.kind] })
  }

  scored.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
  return scored.slice(0, Math.max(0, limit)).map((item) => item.entry)
}
