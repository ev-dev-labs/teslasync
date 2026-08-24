/**
 * compactNav
 * ──────────
 * Progressive-disclosure information architecture for the DEFAULT (Linear)
 * sidebar.
 *
 * Why
 * ---
 * `navSections` in `Layout.tsx` is the canonical, complete route catalog
 * (20 groups / 150+ items). It stays exactly as-is — the Feature Hub
 * (`/explore`) and the command palette both enumerate it, so every route
 * remains discoverable and searchable. But rendering all 20 headers in the
 * primary sidebar is a wall of chrome: even collapsed it reads like a
 * side project rather than a product.
 *
 * This module derives a *curated* nine-group tree from that catalog for the
 * Linear style only. `notion` and `legacy` keep the complete catalog because
 * picking them is an explicit user choice to see everything.
 *
 * Guarantees (all covered by `__tests__/compactNav.test.ts`)
 * ---------------------------------------------------------
 * 1. At most `MAX_COMPACT_GROUPS` groups, in a fixed product order.
 * 2. No path appears twice across the whole compact tree.
 * 3. Every blueprint path is a real entry in the source catalog.
 * 4. Visibility predicates are respected: the builder only ever emits items
 *    that were present in the (already visibility-filtered) input sections.
 * 5. Location context is never lost. If the active route is a long-tail
 *    route that the curated set omits, the *exact* active item is injected
 *    into its mapped compact group and that group's title is returned as
 *    `activeSectionTitle`.
 *
 * Everything here is pure — no React, no i18n, no DOM.
 */

/** Canonical order of the compact groups. Also the render order. */
export const COMPACT_GROUP_TITLES = [
  'Overview',
  'Fleet',
  'Driving',
  'Charging & Energy',
  'Battery',
  'Reports & Analytics',
  'Automation & Alerts',
  'System & Developer',
  'Settings & Account',
] as const

export type CompactGroupTitle = (typeof COMPACT_GROUP_TITLES)[number]

/** Hard ceiling asserted by tests so the tree cannot silently regrow. */
export const MAX_COMPACT_GROUPS = 9

/** The Feature Hub — the escape hatch to the complete catalog. */
export const EXPLORE_PATH = '/explore'

/**
 * The curated core destinations, by compact group.
 *
 * Selection rule: a path earns a slot only if a typical owner would plausibly
 * reach for it in a normal week. Everything else is long-tail and lives
 * behind the command palette + `/explore` — and is still injected here on
 * demand when it is the active route (see `buildCompactNavTree`).
 */
export const COMPACT_NAV_BLUEPRINT: ReadonlyArray<{
  readonly title: CompactGroupTitle
  readonly paths: readonly string[]
}> = [
  {
    title: 'Overview',
    paths: ['/', '/action-center', '/live', '/timeline', EXPLORE_PATH],
  },
  {
    title: 'Fleet',
    paths: [
      '/vehicles',
      '/digital-twin',
      '/commands',
      '/locations',
      '/climate-control',
      '/security-access',
      '/maintenance',
      '/software-updates',
    ],
  },
  {
    title: 'Driving',
    paths: ['/drives', '/trips', '/trip-planner', '/geofences', '/mileage', '/drive-score'],
  },
  {
    title: 'Charging & Energy',
    paths: [
      '/charging',
      '/tesla-charging-history',
      '/charging-curve',
      '/smart-charge',
      '/energy',
      '/energy-products',
    ],
  },
  {
    title: 'Battery',
    paths: ['/battery', '/battery-degradation', '/battery-cells', '/projected-range', '/vampire-drain'],
  },
  {
    title: 'Reports & Analytics',
    paths: ['/statistics', '/analytics', '/efficiency', '/cost-analysis', '/tco', '/data-export'],
  },
  {
    title: 'Automation & Alerts',
    paths: [
      '/automations',
      '/notifications/inbox',
      '/notifications/alerts',
      '/notifications/rules',
      '/notifications/channels',
    ],
  },
  {
    title: 'System & Developer',
    paths: ['/system-status', '/signals', '/db-health', '/dev-tools', '/api-playground', '/backup'],
  },
  {
    title: 'Settings & Account',
    paths: ['/settings', '/tesla-account', '/integrations/helix', '/api-keys', '/account/privacy', '/roadmap'],
  },
]

/**
 * Where a long-tail route lands when it has to be injected: canonical
 * `navSections` title → compact group. Keeps "I am somewhere sensible"
 * true for every one of the 150+ routes, not just the curated ones.
 */
export const CANONICAL_SECTION_TO_COMPACT_GROUP: Readonly<Record<string, CompactGroupTitle>> = {
  Home: 'Overview',
  Vehicles: 'Fleet',
  Service: 'Fleet',
  Cabin: 'Fleet',
  Commands: 'Fleet',
  Security: 'Fleet',
  Driving: 'Driving',
  Charging: 'Charging & Energy',
  Energy: 'Charging & Energy',
  Battery: 'Battery',
  Reports: 'Reports & Analytics',
  'Advanced Intelligence': 'Reports & Analytics',
  'Ownership Intelligence': 'Reports & Analytics',
  Automation: 'Automation & Alerts',
  Notifications: 'Automation & Alerts',
  Data: 'System & Developer',
  Diagnostics: 'System & Developer',
  Account: 'Settings & Account',
  Settings: 'Settings & Account',
  Integrations: 'Settings & Account',
  About: 'Settings & Account',
}

/** Group used when a section title has no explicit mapping (defensive). */
const FALLBACK_COMPACT_GROUP: CompactGroupTitle = 'Overview'

export interface CompactNavItemLike {
  to: string
}

export interface CompactNavSectionLike<TItem extends CompactNavItemLike> {
  title: string
  items: TItem[]
}

export interface CompactNavTree<TItem extends CompactNavItemLike> {
  sections: Array<{ title: CompactGroupTitle; items: TItem[] }>
  /** Compact group holding the active route, or `undefined` when unknown. */
  activeSectionTitle?: CompactGroupTitle
  /** True when the active route was long-tail and had to be injected. */
  injectedActivePath?: string
}

/**
 * Same semantics as Layout's `isActiveNavPath`: exact match for the root,
 * exact-or-descendant for everything else.
 */
export function isCompactActivePath(pathname: string, to: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/')
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

/**
 * Build the compact tree from the complete (already visibility-filtered)
 * catalog sections.
 *
 * The input is never mutated and item object identity is preserved, so
 * icons, badges, `dataTour` hooks and pin actions keep working untouched.
 */
export function buildCompactNavTree<TItem extends CompactNavItemLike>(
  sections: ReadonlyArray<CompactNavSectionLike<TItem>>,
  pathname: string,
): CompactNavTree<TItem> {
  const safeSections = sections ?? []

  // path → item, first occurrence wins (mirrors the catalog's own ordering).
  const byPath = new Map<string, TItem>()
  for (const section of safeSections) {
    for (const item of section?.items ?? []) {
      if (!byPath.has(item.to)) byPath.set(item.to, item)
    }
  }

  const used = new Set<string>()
  const groups = COMPACT_NAV_BLUEPRINT.map(group => {
    const items: TItem[] = []
    for (const path of group.paths) {
      if (used.has(path)) continue
      const item = byPath.get(path)
      if (!item) continue
      used.add(path)
      items.push(item)
    }
    return { title: group.title, items }
  })

  const activeEntry = findMostSpecificNavEntry(safeSections, pathname)
  let activeSectionTitle: CompactGroupTitle | undefined
  let injectedActivePath: string | undefined

  if (activeEntry) {
    const curatedGroup = groups.find(group =>
      group.items.some(item => item.to === activeEntry.item.to),
    )
    if (curatedGroup) {
      activeSectionTitle = curatedGroup.title
    } else {
      // Long-tail route: inject the exact active item so the user keeps
      // location context and a one-click path back out of the page.
      const targetTitle =
        CANONICAL_SECTION_TO_COMPACT_GROUP[activeEntry.sectionTitle] ?? FALLBACK_COMPACT_GROUP
      const target = groups.find(group => group.title === targetTitle)
      if (target) {
        target.items.push(activeEntry.item)
        used.add(activeEntry.item.to)
        activeSectionTitle = target.title
        injectedActivePath = activeEntry.item.to
      }
    }
  }

  return {
    sections: groups.filter(group => group.items.length > 0),
    activeSectionTitle,
    injectedActivePath,
  }
}
