/**
 * compactNav
 * ──────────
 * Sidebar navigation helpers: persona-aware section ordering plus the
 * active-path matching every nav surface shares.
 *
 * `navSections` in `Layout.tsx` is the canonical, complete route catalog.
 * `prioritizeCanonicalNavSections` orders it per product persona without
 * dropping anything; the path matchers decide which row lights up for a
 * pathname (longest covering `to` wins, so nested routes highlight the
 * most specific entry).
 *
 * Everything here is pure — no React, no i18n, no DOM.
 */
import type { ProductPersona } from '@/lib/productPreferences'

/** The everyday hierarchy, in product order. */
export const PRIMARY_GROUP_TITLES = [
  'Overview',
  'Vehicles',
  'Drives',
  'Charging',
  'Energy',
  'Insights',
  'Operations',
] as const

/** Intentional parking spots for advanced / privileged destinations. */
export const ADVANCED_GROUP_TITLES = [
  'Advanced Intelligence',
  'Administration',
  'Developer',
  'Settings & Account',
] as const

/** Canonical order of the compact groups. Also the default render order. */
export const COMPACT_GROUP_TITLES = [
  ...PRIMARY_GROUP_TITLES,
  ...ADVANCED_GROUP_TITLES,
] as const

export type PrimaryGroupTitle = (typeof PRIMARY_GROUP_TITLES)[number]
export type AdvancedGroupTitle = (typeof ADVANCED_GROUP_TITLES)[number]
export type CompactGroupTitle = (typeof COMPACT_GROUP_TITLES)[number]

export type CompactGroupTier = 'primary' | 'advanced'

/** Tier lookup for a compact group title. Unknown titles read as `advanced`. */
export function compactGroupTier(title: string): CompactGroupTier {
  return (PRIMARY_GROUP_TITLES as readonly string[]).includes(title) ? 'primary' : 'advanced'
}

/**
 * Canonical `navSections` title → compact group. Drives the persona-aware
 * section ranking in `prioritizeCanonicalNavSections`.
 */
export const CANONICAL_SECTION_TO_COMPACT_GROUP: Readonly<
  Record<string, CompactGroupTitle>
> = {
  Home: 'Overview',
  Vehicles: 'Vehicles',
  'Tesla Physics': 'Advanced Intelligence',
  Service: 'Operations',
  Cabin: 'Energy',
  Commands: 'Operations',
  Controls: 'Vehicles',
  Driving: 'Drives',
  Charging: 'Charging',
  Battery: 'Energy',
  Energy: 'Energy',
  Reports: 'Insights',
  Automation: 'Operations',
  Notifications: 'Operations',
  Security: 'Operations',
  'Advanced Intelligence': 'Advanced Intelligence',
  'Ownership Intelligence': 'Advanced Intelligence',
  Data: 'Administration',
  Diagnostics: 'Developer',
  Account: 'Settings & Account',
  Settings: 'Settings & Account',
  Integrations: 'Settings & Account',
  About: 'Settings & Account',
}

export interface CompactNavItemLike {
  to: string
}

export interface CompactNavSectionLike<TItem extends CompactNavItemLike> {
  title: string
  items: TItem[]
}

/**
 * Persona ordering applies to the PRIMARY tier only. Advanced groups keep
 * their blueprint order so admin/developer surfaces never leapfrog the
 * everyday hierarchy for any persona.
 */
const PERSONA_PRIMARY_ORDER: Readonly<
  Record<ProductPersona, readonly PrimaryGroupTitle[]>
> = {
  owner: PRIMARY_GROUP_TITLES,
  fleet_operator: [
    'Overview',
    'Vehicles',
    'Operations',
    'Charging',
    'Drives',
    'Energy',
    'Insights',
  ],
  analyst: [
    'Overview',
    'Insights',
    'Drives',
    'Charging',
    'Energy',
    'Vehicles',
    'Operations',
  ],
  administrator: [
    'Overview',
    'Operations',
    'Vehicles',
    'Charging',
    'Energy',
    'Drives',
    'Insights',
  ],
}

/**
 * Rank used to sort emitted groups: primary tier first (persona order),
 * then granted advanced groups, then restricted advanced groups.
 */
function groupRank(
  group: { title: CompactGroupTitle; tier: CompactGroupTier; restricted: boolean },
  persona: ProductPersona,
): number {
  if (group.tier === 'primary') {
    const order = PERSONA_PRIMARY_ORDER[persona] ?? PRIMARY_GROUP_TITLES
    const index = order.indexOf(group.title as PrimaryGroupTitle)
    return index >= 0 ? index : PRIMARY_GROUP_TITLES.length
  }
  const advancedIndex = ADVANCED_GROUP_TITLES.indexOf(
    group.title as AdvancedGroupTitle,
  )
  const base =
    100 + (advancedIndex >= 0 ? advancedIndex : ADVANCED_GROUP_TITLES.length)
  return group.restricted ? base + 100 : base
}

/**
 * Order the COMPLETE canonical catalog by mapping each canonical section
 * onto its compact group and reusing the persona ranking. Nothing is
 * dropped.
 */
export function prioritizeCanonicalNavSections<TSection extends { title: string }>(
  sections: readonly TSection[],
  persona: ProductPersona,
): TSection[] {
  const rankFor = (title: string): number => {
    const mapped = CANONICAL_SECTION_TO_COMPACT_GROUP[title]
    if (!mapped) return Number.MAX_SAFE_INTEGER
    return groupRank(
      { title: mapped, tier: compactGroupTier(mapped), restricted: false },
      persona,
    )
  }

  return sections
    .map((section, index) => ({ section, index }))
    .sort(
      (left, right) =>
        rankFor(left.section.title) - rankFor(right.section.title) ||
        left.index - right.index,
    )
    .map(({ section }) => section)
}

/**
 * Prefix match used to decide whether a catalog `to` covers a pathname.
 * Exact match for the root; exact-or-descendant for everything else.
 * Sibling prefixes (`/drives` vs `/drives-archive`) do not match.
 */
export function isCompactActivePath(pathname: string, to: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/')
}

/**
 * Among catalog destinations that cover `pathname`, the longest `to` wins.
 * `/settings/fleet-setup` must not also light `/settings`; `/tesla-physics/clocks`
 * must not also light `/tesla-physics`. Unlisted children still fall back to the
 * parent (`/drives/42` → `/drives`).
 */
export function bestMatchingNavPath(
  pathname: string,
  catalog: Iterable<string>,
): string | null {
  let best: string | null = null
  for (const to of catalog) {
    if (!isCompactActivePath(pathname, to)) continue
    if (best == null || to.length > best.length) best = to
  }
  return best
}

export function isExclusiveActivePath(
  pathname: string,
  to: string,
  catalog: Iterable<string>,
): boolean {
  return bestMatchingNavPath(pathname, catalog) === to
}

/**
 * Resolve the active catalog entry for a pathname.
 *
 * Unlike Layout's first-match lookup, this prefers the *most specific*
 * (longest) matching `to`. That matters for injection: at
 * `/analytics/carbon` we want to inject "Carbon Intelligence", not silently
 * light up the broader `/analytics` row and lose the user's real location.
 */
export function findMostSpecificNavEntry<TItem extends CompactNavItemLike>(
  sections: ReadonlyArray<CompactNavSectionLike<TItem>>,
  pathname: string,
): { sectionTitle: string; item: TItem } | null {
  let best: { sectionTitle: string; item: TItem } | null = null
  for (const section of sections ?? []) {
    for (const item of section?.items ?? []) {
      if (!isCompactActivePath(pathname, item.to)) continue
      if (!best || item.to.length > best.item.to.length) {
        best = { sectionTitle: section.title, item }
      }
    }
  }
  return best
}
