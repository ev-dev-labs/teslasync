/**
 * sidebarSuggest
 * ──────────────
 * The "Suggested" engine for the default sidebar: surfaces the right
 * pages before the user looks for them, each with a one-line reason.
 *
 * Two sub-engines, NOW first:
 *
 *   NOW — live context (at most 2 rows)
 *     - unread critical/warning alerts → Action Center
 *       ("2 need attention")
 *     - vehicle charging → Charging Overview, Charging Curve
 *       ("Model 3 is charging")
 *     - vehicle driving → Live Map, Drives ("Model 3 is on the move")
 *
 *   UP NEXT — related to the current page (fills to the cap)
 *     - siblings in the current page's collection, then siblings in
 *       its section, each tagged "Related to {Current page}"
 *     - pure catalog data: no network, always available
 *
 * Guarantees
 * - Never echoes the current page, pins, or recents — those already
 *   render in their own groups, so duplicating them here is noise.
 * - Never suggests a path outside the visible catalog (visibility
 *   predicates were already applied to the input sections).
 * - Deterministic catalog order throughout; capped length.
 *
 * Everything here is pure — no React, no i18n runtime. The caller owns
 * label translation (`resolveLabel`) and reason phrasing
 * (`formatReason`) so both stay in the app's i18n system.
 */

import { Icons, type LucideIcon } from '@/lib/icons'
import { findSectionGroup, type SectionGroup } from '../sectionGroups'
import { bestMatchingNavPath } from './compactNav'
import type { SidebarSearchableItem, SidebarSearchableSection } from './sidebarSearch'

export interface SuggestSignals {
  /** Display name of the focused vehicle (reason lines read better named). */
  vehicleName?: string
  /** `deriveVehicleStatus()` output: 'charging' | 'driving' | … */
  vehicleStatus?: string
  /** Unread alerts with critical/warning severity. */
  criticalAlertCount: number
}

export type SuggestReasonKind = 'charging' | 'driving' | 'alerts' | 'related'

export interface SidebarSuggestion {
  to: string
  label: string
  labelKey: string
  icon: LucideIcon
  color?: string
  dataTour?: string
  /** One-line "why this, why now" shown under the label. */
  reason: string
  /** Live context ('now') or related to the current page ('related'). */
  kind: 'now' | 'related'
}

/** Live-context rows never crowd out related pages entirely. */
const MAX_NOW_ROWS = 2
/** Total cap so the group stays a nudge, not a second sidebar. */
const MAX_SUGGESTIONS = 4

interface SuggestionCorpusEntry {
  label: string
  labelKey: string
  icon: LucideIcon
  color?: string
  dataTour?: string
}

export function suggestSidebarPages(
  sections: readonly SidebarSearchableSection<SidebarSearchableItem>[],
  collections: readonly SectionGroup[],
  pathname: string,
  options: {
    pinnedPaths?: ReadonlySet<string>
    recentPaths?: ReadonlySet<string>
    signals?: SuggestSignals
    resolveLabel: (entry: { label: string; labelKey: string }) => string
    formatReason: (
      kind: SuggestReasonKind,
      vars: { vehicle?: string; page?: string; count?: number },
    ) => string
    max?: number
  },
): SidebarSuggestion[] {
  const {
    pinnedPaths,
    recentPaths,
    signals,
    resolveLabel,
    formatReason,
    max = MAX_SUGGESTIONS,
  } = options
  const safeSections = sections ?? []
  const safeCollections = collections ?? []

  // Corpus: every renderable destination — primaries plus nested pages.
  const corpus = new Map<string, SuggestionCorpusEntry>()
  for (const section of safeSections) {
    for (const item of section.items ?? []) {
      if (!corpus.has(item.to)) {
        corpus.set(item.to, {
          label: item.label,
          labelKey: item.labelKey,
          icon: item.icon,
          color: item.color,
          dataTour: item.dataTour,
        })
      }
    }
  }
  for (const group of safeCollections) {
    const primary = corpus.get(group.primary)
    for (const page of group.pages) {
      // Pages overwrite primaries: grouped section items carry the GROUP
      // label ("Driving Performance"), but rows and reasons must show the
      // page's own label ("Driving Dynamics"). Tour hooks stay with the
      // primary row they were authored on.
      const existing = corpus.get(page.to)
      corpus.set(page.to, {
        label: page.label,
        labelKey: page.labelKey,
        icon: page.icon ?? primary?.icon ?? existing?.icon ?? Icons.fileText,
        color: page.color ?? primary?.color ?? existing?.color,
        dataTour: existing?.dataTour,
      })
    }
  }

  const current = bestMatchingNavPath(pathname, corpus.keys())
  const seen = new Set<string>([
    ...(current ? [current] : []),
    ...(pinnedPaths ?? []),
    ...(recentPaths ?? []),
  ])
  const suggestions: SidebarSuggestion[] = []
  const push = (to: string, reason: string, kind: SidebarSuggestion['kind']) => {
    if (suggestions.length >= max || seen.has(to)) return
    const entry = corpus.get(to)
    if (!entry) return
    seen.add(to)
    suggestions.push({ to, ...entry, reason, kind })
  }

  // ── NOW: live context ──────────────────────────────────────────────
  const now: Array<{ to: string; kind: SuggestReasonKind; vars: { vehicle?: string; count?: number } }> = []
  if ((signals?.criticalAlertCount ?? 0) > 0) {
    now.push({
      to: corpus.has('/action-center') ? '/action-center' : '/notifications/inbox',
      kind: 'alerts',
      vars: { count: signals!.criticalAlertCount },
    })
  }
  if (signals?.vehicleStatus === 'charging') {
    now.push({ to: '/charging', kind: 'charging', vars: { vehicle: signals.vehicleName } })
    now.push({ to: '/charging-curve', kind: 'charging', vars: { vehicle: signals.vehicleName } })
  } else if (signals?.vehicleStatus === 'driving') {
    now.push({ to: '/live', kind: 'driving', vars: { vehicle: signals.vehicleName } })
    now.push({ to: '/drives', kind: 'driving', vars: { vehicle: signals.vehicleName } })
  }
  for (const candidate of now.slice(0, MAX_NOW_ROWS)) {
    push(candidate.to, formatReason(candidate.kind, candidate.vars), 'now')
  }

  // ── UP NEXT: related to the current page ───────────────────────────
  if (current && suggestions.length < max) {
    const currentEntry = corpus.get(current)
    const related = formatReason('related', {
      page: currentEntry ? resolveLabel(currentEntry) : current,
    })
    // Same-collection siblings first (catalog order)…
    const group = findSectionGroup(safeCollections, current)
    for (const page of group?.pages ?? []) push(page.to, related, 'related')
    // …then the rest of the flattened section.
    if (suggestions.length < max) {
      const primary = group?.primary ?? current
      const section = safeSections.find(candidate =>
        (candidate.items ?? []).some(item => item.to === primary),
      )
      for (const item of section?.items ?? []) {
        const itemGroup = safeCollections.find(candidate => candidate.primary === item.to)
        if (itemGroup) {
          for (const page of itemGroup.pages) push(page.to, related, 'related')
        } else {
          push(item.to, related, 'related')
        }
      }
    }
  }

  return suggestions
}
