/**
 * sidebarSearch
 * ─────────────
 * Pure query engine for the unified sidebar's "Search pages" box.
 *
 * Why a separate module
 * ---------------------
 * The sidebar tree renders collections (nested page groups) while search
 * must surface *every* destination — including pages nested two levels
 * deep — as flat, directly-clickable rows. That flatten + match + dedupe
 * logic is pure data work, so it lives here (unit-tested, no React, no
 * i18n runtime) and the `UnifiedSidebar` component only renders hits.
 *
 * Matching rules
 * --------------
 * - The query is tokenized on whitespace; EVERY token must match (AND).
 * - A token matches an item when it appears anywhere in the item's
 *   translated label, its catalog `labelKey`, its route path, or its
 *   `navSearchKeywords` entry (so "soh" finds Battery Health).
 * - Collection pages are indexed too: a hit on a nested page surfaces
 *   that page directly, tagged with its collection label as context.
 * - When the query matches a *section title*, the whole section is
 *   returned — every item and nested page, flattened — so "driving"
 *   opens the full Driving catalog instead of a single row.
 * - Hits dedupe by route path; the first occurrence (catalog order)
 *   wins, so a page that matches both directly and via its collection
 *   never renders twice.
 */

import type { LucideIcon } from '@/lib/icons'
import { navSearchKeywords } from '../navSearchKeywords'
import type { SectionGroup } from '../sectionGroups'

/** Minimal structural item — satisfied by every sidebar section input. */
export interface SidebarSearchableItem {
  to: string
  label: string
  labelKey: string
  icon: LucideIcon
  color?: string
  dataTour?: string
}

export interface SidebarSearchableSection<TItem extends SidebarSearchableItem = SidebarSearchableItem> {
  title: string
  titleKey?: string
  items: readonly TItem[]
}

/** One flat, directly-renderable search hit. */
export interface SidebarSearchHit {
  to: string
  icon: LucideIcon
  color?: string
  dataTour?: string
  /** Pre-resolved display text (the caller owns i18n). */
  label: string
  /**
   * Collection label when the hit is a page nested inside a collection
   * (e.g. "Charging Activity"). Lets the row show "where this lives".
   */
  matchContext?: string
}

export interface SidebarSearchSection {
  title: string
  titleKey?: string
  hits: SidebarSearchHit[]
}

/** Resolve display text for an item or page (`{ label, labelKey }`). */
export type SidebarSearchText = (entry: { label: string; labelKey: string }) => string

/** Lowercase whitespace tokens; empty query → no tokens. */
export function tokenizeSidebarQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean)
}

/** True when every token appears somewhere in the haystack. */
export function matchesSidebarTokens(haystack: string, tokens: readonly string[]): boolean {
  return tokens.every(token => haystack.includes(token))
}

function haystackFor(
  entry: { to: string; label: string; labelKey: string },
  resolveText: SidebarSearchText,
): string {
  const keywords = navSearchKeywords[entry.to] ?? []
  return [resolveText(entry), entry.label, entry.labelKey, entry.to, ...keywords]
    .join(' ')
    .toLowerCase()
}

/**
 * Flatten + filter the complete catalog for a query.
 *
 * Returns one entry per matching section (catalog order), each with its
 * flat hits. Returns `[]` for a blank query — the caller renders the
 * regular tree instead of an empty result set.
 */
export function searchSidebarSections<TItem extends SidebarSearchableItem>(
  sections: readonly SidebarSearchableSection<TItem>[],
  collections: readonly SectionGroup[],
  query: string,
  resolveText: SidebarSearchText,
): SidebarSearchSection[] {
  const tokens = tokenizeSidebarQuery(query)
  if (tokens.length === 0) return []

  const groupByPrimary = new Map(collections.map(group => [group.primary, group]))
  const results: SidebarSearchSection[] = []

  for (const section of sections ?? []) {
    const hits = new Map<string, SidebarSearchHit>()
    const addHit = (hit: SidebarSearchHit) => {
      if (!hits.has(hit.to)) hits.set(hit.to, hit)
    }
    // Flatten one catalog item into its directly-renderable rows: the
    // item itself plus every nested collection page. Used when the
    // section title matches and the whole section must be returned.
    const flattenItem = (item: TItem, group: SectionGroup | undefined) => {
      addHit({
        to: item.to,
        icon: item.icon,
        color: item.color,
        dataTour: item.dataTour,
        label: resolveText(item),
      })
      for (const page of group?.pages ?? []) {
        addHit({
          to: page.to,
          icon: page.icon ?? item.icon,
          color: page.color ?? item.color,
          label: resolveText(page),
          matchContext: group?.primary === page.to ? undefined : group?.label,
        })
      }
    }

    const titleHaystack = [
      section.titleKey ? resolveText({ label: section.title, labelKey: section.titleKey }) : section.title,
      section.title,
    ]
      .join(' ')
      .toLowerCase()
    if (matchesSidebarTokens(titleHaystack, tokens)) {
      for (const item of section.items ?? []) {
        flattenItem(item, groupByPrimary.get(item.to))
      }
      if (hits.size > 0) {
        results.push({ title: section.title, titleKey: section.titleKey, hits: [...hits.values()] })
      }
      continue
    }

    for (const item of section.items ?? []) {
      const group = groupByPrimary.get(item.to)
      if (matchesSidebarTokens(haystackFor(item, resolveText), tokens)) {
        addHit({
          to: item.to,
          icon: item.icon,
          color: item.color,
          dataTour: item.dataTour,
          label: resolveText(item),
        })
      }
      for (const page of group?.pages ?? []) {
        if (page.to === item.to) continue
        if (!matchesSidebarTokens(haystackFor(page, resolveText), tokens)) continue
        addHit({
          to: page.to,
          icon: page.icon ?? item.icon,
          color: page.color ?? item.color,
          label: resolveText(page),
          matchContext: group?.label,
        })
      }
    }
    if (hits.size > 0) {
      results.push({ title: section.title, titleKey: section.titleKey, hits: [...hits.values()] })
    }
  }

  return results
}
