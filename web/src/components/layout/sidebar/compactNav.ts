/**
 * compactNav
 * ──────────
 * Progressive-disclosure information architecture for the DEFAULT (Linear)
 * sidebar.
 *
 * Why
 * ---
 * `navSections` in `Layout.tsx` is the canonical, complete route catalog
 * (20+ groups / 190+ items). It stays exactly as-is — the Feature Hub
 * (`/explore`) and the command palette both enumerate it, so every route
 * remains discoverable and searchable. But rendering all of it in the
 * primary sidebar is a wall of chrome: even collapsed it reads like a
 * side project rather than a product.
 *
 * This module derives a *curated* tree from that catalog for the Linear
 * style only. `notion` and `legacy` keep the complete catalog because
 * picking them is an explicit user choice to see everything.
 *
 * Shape of the tree
 * -----------------
 * Two tiers, never interleaved:
 *
 *   primary   Overview · Vehicles · Drives · Charging · Energy · Insights ·
 *             Operations
 *             The everyday hierarchy. Identical set for every principal;
 *             only the ORDER changes with the product persona.
 *
 *   advanced  Advanced Intelligence · Administration · Developer ·
 *             Settings & Account
 *             Deliberate parking spots for admin / developer / experimental
 *             destinations. They are never deleted or hidden — a group the
 *             current principal lacks the capability for is sorted last and
 *             flagged `restricted` so the sidebar can collapse it, while the
 *             palette and `/explore` keep listing every authorized route.
 *
 * Guarantees (all covered by `__tests__/compactNav.test.ts`)
 * ---------------------------------------------------------
 * 1. At most `MAX_COMPACT_GROUPS` groups, primary tier always first.
 * 2. No path appears twice across the whole compact tree.
 * 3. Every blueprint path is a real entry in the source catalog.
 * 4. Visibility predicates are respected: the builder only ever emits items
 *    that were present in the (already visibility-filtered) input sections.
 * 5. Location context is never lost. If the active route is a long-tail
 *    route that the curated set omits, the *exact* active item is injected
 *    into its mapped group and that group's title is returned as
 *    `activeSectionTitle` — even when the group is `restricted`.
 *
 * Everything here is pure — no React, no i18n, no DOM.
 */
import { hasNavCapability, type NavCapability } from '@/lib/navCapabilities'
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

/** Hard ceiling asserted by tests so the tree cannot silently regrow. */
export const MAX_COMPACT_GROUPS = 11

/** The Feature Hub — the escape hatch to the complete catalog. */
export const EXPLORE_PATH = '/explore'

export interface CompactBlueprintGroup {
  readonly title: CompactGroupTitle
  readonly tier: CompactGroupTier
  /** Capability required to *promote* the group. `core` = always promoted. */
  readonly capability: NavCapability
  readonly paths: readonly string[]
}

/**
 * The curated core destinations, by compact group.
 *
 * Selection rule: a path earns a primary slot only if a typical owner would
 * plausibly reach for it in a normal week. Everything else is long-tail and
 * lives in an advanced group, behind the command palette, and in `/explore`
 * — and is still injected here on demand when it is the active route (see
 * `buildCompactNavTree`).
 */
export const COMPACT_NAV_BLUEPRINT: readonly CompactBlueprintGroup[] = [
  {
    title: 'Overview',
    tier: 'primary',
    capability: 'core',
    paths: ['/', '/action-center', '/live', '/timeline', EXPLORE_PATH],
  },
  {
    title: 'Vehicles',
    tier: 'primary',
    capability: 'core',
    paths: [
      '/vehicles',
      '/digital-twin',
      '/vehicle-management',
      '/commands',
      '/locations',
      '/climate-control',
      '/maintenance',
      '/software-updates',
    ],
  },
  {
    title: 'Drives',
    tier: 'primary',
    capability: 'core',
    paths: ['/drives', '/trips', '/trip-planner', '/geofences', '/mileage', '/drive-score'],
  },
  {
    title: 'Charging',
    tier: 'primary',
    capability: 'core',
    paths: [
      '/charging',
      '/tesla-charging-history',
      '/charging-curve',
      '/smart-charge',
      '/cost-analysis',
    ],
  },
  {
    title: 'Energy',
    tier: 'primary',
    capability: 'core',
    paths: [
      '/energy',
      '/battery',
      '/battery-degradation',
      '/battery-cells',
      '/projected-range',
      '/vampire-drain',
      '/energy-products',
    ],
  },
  {
    title: 'Insights',
    tier: 'primary',
    capability: 'core',
    paths: ['/statistics', '/analytics', '/efficiency', '/tco', '/weekly-digest', '/data-export'],
  },
  {
    title: 'Operations',
    tier: 'primary',
    capability: 'core',
    paths: [
      '/automations',
      '/notifications/inbox',
      '/notifications/alerts',
      '/notifications/rules',
      '/notifications/channels',
      '/security-access',
      '/system-status',
    ],
  },
  {
    title: 'Advanced Intelligence',
    tier: 'advanced',
    capability: 'core',
    paths: [
      '/intelligence-packs',
      '/anomaly-detection',
      '/period-compare',
      '/what-if',
      '/drive-dna',
      '/time-machine',
    ],
  },
  {
    title: 'Administration',
    tier: 'advanced',
    capability: 'administration',
    paths: [
      '/admin/audit-log',
      '/admin/flags',
      '/admin/dlq',
      '/api-keys',
      '/backup',
      '/data-repair',
      '/fleet-api',
    ],
  },
  {
    title: 'Developer',
    tier: 'advanced',
    capability: 'developer',
    paths: [
      '/dev-tools',
      '/api-playground',
      '/signals',
      '/db-health',
      '/state-debugger',
      '/mqtt-inspector',
    ],
  },
  {
    title: 'Settings & Account',
    tier: 'advanced',
    capability: 'core',
    paths: ['/settings', '/tesla-account', '/integrations/helix', '/account/privacy', '/roadmap'],
  },
]

const BLUEPRINT_BY_TITLE = new Map<CompactGroupTitle, CompactBlueprintGroup>(
  COMPACT_NAV_BLUEPRINT.map((group) => [group.title, group]),
)

/** Tier lookup for a compact group title. Unknown titles read as `advanced`. */
export function compactGroupTier(title: string): CompactGroupTier {
  return BLUEPRINT_BY_TITLE.get(title as CompactGroupTitle)?.tier ?? 'advanced'
}

/**
 * Where a long-tail route lands when it has to be injected: canonical
 * `navSections` title → compact group. Keeps "I am somewhere sensible"
 * true for every one of the 190+ routes, not just the curated ones.
 */
export const CANONICAL_SECTION_TO_COMPACT_GROUP: Readonly<
  Record<string, CompactGroupTitle>
> = {
  Home: 'Overview',
  Vehicles: 'Vehicles',
  Service: 'Vehicles',
  Cabin: 'Vehicles',
  Commands: 'Vehicles',
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

/** Group used when a section title has no explicit mapping (defensive). */
const FALLBACK_COMPACT_GROUP: CompactGroupTitle = 'Advanced Intelligence'

export interface CompactNavItemLike {
  to: string
}

export interface CompactNavSectionLike<TItem extends CompactNavItemLike> {
  title: string
  items: TItem[]
}

export interface CompactNavGroup<TItem extends CompactNavItemLike> {
  title: CompactGroupTitle
  tier: CompactGroupTier
  /** Capability that promotes this group. */
  capability: NavCapability
  /**
   * True when the current principal lacks {@link capability}. The group is
   * still emitted (nothing is deleted) but sorts last and should render
   * collapsed.
   */
  restricted: boolean
  items: TItem[]
}

export interface CompactNavTree<TItem extends CompactNavItemLike> {
  sections: Array<CompactNavGroup<TItem>>
  /** Compact group holding the active route, or `undefined` when unknown. */
  activeSectionTitle?: CompactGroupTitle
  /** True when the active route was long-tail and had to be injected. */
  injectedActivePath?: string
}

export interface BuildCompactNavTreeOptions {
  /** Capabilities granted to the current principal (see `lib/navCapabilities`). */
  capabilities?: ReadonlySet<NavCapability>
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

export function prioritizeCompactNavTree<TItem extends CompactNavItemLike>(
  tree: CompactNavTree<TItem>,
  persona: ProductPersona,
): CompactNavTree<TItem> {
  return {
    ...tree,
    sections: [...tree.sections].sort(
      (left, right) => groupRank(left, persona) - groupRank(right, persona),
    ),
  }
}

/**
 * Order the COMPLETE canonical catalog (used by the Notion / legacy sidebar
 * styles and the mobile drawer) by mapping each canonical section onto its
 * compact group and reusing the persona ranking. Nothing is dropped.
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
  options: BuildCompactNavTreeOptions = {},
): CompactNavTree<TItem> {
  const safeSections = sections ?? []
  // A missing capability set means "not resolved yet" — treat core-only
  // groups as promoted and everything else as restricted so privileged
  // surfaces never flash into the primary position before the auth-mode
  // contract lands.
  const capabilities = options.capabilities ?? new Set<NavCapability>(['core'])

  // path → item, first occurrence wins (mirrors the catalog's own ordering).
  const byPath = new Map<string, TItem>()
  for (const section of safeSections) {
    for (const item of section?.items ?? []) {
      if (!byPath.has(item.to)) byPath.set(item.to, item)
    }
  }

  const used = new Set<string>()
  const groups: Array<CompactNavGroup<TItem>> = COMPACT_NAV_BLUEPRINT.map((group) => {
    const items: TItem[] = []
    for (const path of group.paths) {
      if (used.has(path)) continue
      const item = byPath.get(path)
      if (!item) continue
      used.add(path)
      items.push(item)
    }
    return {
      title: group.title,
      tier: group.tier,
      capability: group.capability,
      restricted: !hasNavCapability(capabilities, group.capability),
      items,
    }
  })

  const activeEntry = findMostSpecificNavEntry(safeSections, pathname)
  let activeSectionTitle: CompactGroupTitle | undefined
  let injectedActivePath: string | undefined

  if (activeEntry) {
    const curatedGroup = groups.find((group) =>
      group.items.some((item) => item.to === activeEntry.item.to),
    )
    if (curatedGroup) {
      activeSectionTitle = curatedGroup.title
    } else {
      // Long-tail route: inject the exact active item so the user keeps
      // location context and a one-click path back out of the page.
      const targetTitle =
        CANONICAL_SECTION_TO_COMPACT_GROUP[activeEntry.sectionTitle] ??
        FALLBACK_COMPACT_GROUP
      const target = groups.find((group) => group.title === targetTitle)
      if (target) {
        target.items.push(activeEntry.item)
        used.add(activeEntry.item.to)
        activeSectionTitle = target.title
        injectedActivePath = activeEntry.item.to
      }
    }
  }

  return {
    sections: groups.filter((group) => group.items.length > 0),
    activeSectionTitle,
    injectedActivePath,
  }
}
