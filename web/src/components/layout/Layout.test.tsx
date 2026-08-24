/**
 * Layout — behaviour + hardening tests.
 *
 * `Layout` is the application shell: it owns the sidebar (three styles),
 * the pinned/recent/section nav model, the live badges (unread alerts,
 * vehicle count, stale sessions), the mobile drawer, the header
 * ThemeQuickSwitcher popover, and the active-link scroll behaviour.
 *
 * The file also exports two pure data structures — `navSections` and
 * `navSearchKeywords` — that drive navigation and command-palette search.
 *
 * Because the shell wires in ~50 side-effecting children and hooks, we mock
 * every leaf/child module and every ambient hook so the tests exercise
 * *Layout's own* orchestration logic rather than its dependencies. Network
 * is mocked at the `@/api/client` boundary; nothing hits a real endpoint.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  within,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// ── Shared, hoisted mutable state + spies ─────────────────────────────
// `vi.hoisted` runs before the `vi.mock` factories below, so both the
// factories and the test bodies can read/mutate this object.
const H = vi.hoisted(() => {
  const ALERTS = [
    { id: 1, is_read: false, severity: 'critical', title: 'A', message: 'm' },
    { id: 2, is_read: true, severity: 'info', title: 'B', message: 'm' },
  ]
  const VEHICLES = [{ id: 1 }, { id: 2 }]
  const STALE = { stale_charging: [{ id: 1 }], stale_drives: [{ id: 1 }, { id: 2 }] }

  const defaultReq = (url: unknown) => {
    if (typeof url === 'string') {
      if (url.startsWith('/alerts')) return Promise.resolve(ALERTS)
      if (url === '/vehicles') return Promise.resolve(VEHICLES)
      if (url.startsWith('/data-repair')) return Promise.resolve(STALE)
    }
    return Promise.resolve({})
  }

  return {
    ALERTS,
    VEHICLES,
    STALE,
    defaultReq,
    request: vi.fn(defaultReq),
    sidebarStyle: { value: 'legacy' as string },
    sidebarProps: { linear: null as Record<string, unknown> | null, notion: null as Record<string, unknown> | null },
    forwardAuth: { value: false },
    toast: {
      toast: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    },
    realtime: vi.fn(),
  }
})

// ── framer-motion: a prop-stripping passthrough. Keeps AnimatePresence
//    children mounted synchronously so expand/collapse is deterministic. ──
vi.mock('framer-motion', () => {
  const DROP = new Set([
    'initial', 'animate', 'exit', 'transition', 'variants', 'whileHover',
    'whileTap', 'whileFocus', 'whileInView', 'whileDrag', 'layout', 'layoutId',
    'drag', 'dragConstraints', 'dragElastic', 'dragMomentum', 'onDrag',
    'onDragStart', 'onDragEnd', 'viewport', 'custom', 'onAnimationStart',
    'onAnimationComplete', 'onLayoutAnimationComplete', 'layoutDependency',
    'layoutScroll', 'transformTemplate',
  ])
  const clean = (props: Record<string, unknown>) => {
    const out: Record<string, unknown> = {}
    for (const k in props) if (!DROP.has(k)) out[k] = props[k]
    return out
  }
  const make = (tag: string) => {
    const C = (props: Record<string, unknown>) => {
      const { children, ...rest } = props ?? {}
      const Tag = tag as unknown as React.ElementType
      return <Tag {...clean(rest)}>{children as React.ReactNode}</Tag>
    }
    C.displayName = `motion.${tag}`
    return C
  }
  const cache = new Map<string, ReturnType<typeof make>>()
  const motion = new Proxy(function noop() {}, {
    get: (_t, key) => {
      if (typeof key !== 'string') return undefined
      if (!cache.has(key)) cache.set(key, make(key))
      return cache.get(key)
    },
    apply: (_t, _this, args: unknown[]) => make((args[0] as string) ?? 'div'),
  })
  return {
    motion,
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
    useInView: () => true,
    LayoutGroup: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    MotionConfig: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    useAnimation: () => ({ start: () => Promise.resolve(), stop: () => {}, set: () => {} }),
  }
})

// ── react-i18next: deterministic passthrough translator ───────────────
vi.mock('react-i18next', () => {
  const t = (key: string, second?: unknown, third?: unknown) => {
    let fallback: string | undefined
    let opts: Record<string, unknown> | undefined
    if (typeof second === 'string') {
      fallback = second
      opts = third as Record<string, unknown> | undefined
    } else {
      opts = second as Record<string, unknown> | undefined
      fallback = (opts?.defaultValue as string) ?? key
    }
    let out = fallback ?? key
    if (opts) {
      for (const [k, v] of Object.entries(opts)) {
        if (k === 'defaultValue') continue
        out = out.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
      }
    }
    return out
  }
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: () => Promise.resolve() } }),
    Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  }
})

// ── GuardedLink: plain anchors that forward props (incl. aria-current) ──
vi.mock('../feedback/GuardedLink', () => {
  const Anchor = ({
    to,
    children,
    className,
    onClick,
    ...rest
  }: {
    to: unknown
    children?: React.ReactNode
    className?: unknown
    onClick?: (e: React.MouseEvent) => void
    [k: string]: unknown
  }) => (
    <a
      href={typeof to === 'string' ? to : '/'}
      className={typeof className === 'string' ? className : undefined}
      onClick={onClick}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </a>
  )
  return { GuardedLink: Anchor, GuardedNavLink: Anchor }
})

// ── Ambient hooks (no-op side effects) ────────────────────────────────
vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: () => ({ mode: 'idle', showCheatSheet: false, toggleCheatSheet: vi.fn() }),
}))
vi.mock('@/hooks/useTour', () => ({
  useTour: () => ({
    isActive: false,
    currentStep: 0,
    totalSteps: 0,
    step: null,
    targetRect: null,
    start: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
    skip: vi.fn(),
    finish: vi.fn(),
  }),
}))
vi.mock('@/hooks/useSidebarStyle', () => ({
  useSidebarStyle: () => H.sidebarStyle.value,
}))
vi.mock('../../hooks/useRealtimeEvents', () => ({
  useRealtimeEvents: (opts: unknown) => H.realtime(opts),
}))
vi.mock('../../hooks/useNotificationListener', () => ({ useNotificationListener: vi.fn() }))
vi.mock('../../hooks/useTitleBadge', () => ({ useTitleBadge: vi.fn() }))
vi.mock('../../hooks/useFaviconBadge', () => ({ useFaviconBadge: vi.fn() }))
vi.mock('../../hooks/useDynamicAppIcon', () => ({ useDynamicAppIcon: vi.fn() }))
vi.mock('../../hooks/useCriticalAlertFlash', () => ({ useCriticalAlertFlash: vi.fn() }))
vi.mock('../feedback/Toast', () => ({ useToast: () => H.toast }))

// ── API boundary ──────────────────────────────────────────────────────
vi.mock('@/api/client', () => ({
  request: (...args: unknown[]) => H.request(...args),
  ApiError: class ApiError extends Error {},
}))
vi.mock('@/api/hooks/useAuthMode', () => ({
  useIsForwardAuth: () => H.forwardAuth.value,
}))
vi.mock('@/api/hooks/useSettings', () => ({
  useSettings: () => ({ data: { completed_tours: [] }, isFetched: true }),
  settingsKeys: { settings: ['settings'] },
}))

// ── tour registry / broadcast (pure-ish, mocked for determinism) ──────
vi.mock('@/lib/tourRegistry', () => ({
  TOUR_START_EVENT: 'teslasync:tour:start',
  TOURS: {},
  dispatchTourStart: vi.fn(),
  isTourCompleted: () => false,
  completedTourToken: (id: string, v: number) => `${id}@${v}`,
  seedCompletedFromServer: vi.fn(),
  markTourCompleted: vi.fn(),
}))
vi.mock('@/lib/broadcast', () => ({
  subscribe: vi.fn(() => () => {}),
  broadcast: vi.fn(),
}))

// ── Child components: trivial stubs (some carry test ids / labels) ────
vi.mock('../feedback/InstallPrompt', () => ({ default: () => null }))
vi.mock('../feedback/OfflineBanner', () => ({ OfflineBanner: () => null }))
vi.mock('../feedback/NewVersionBanner', () => ({ NewVersionBanner: () => null }))
vi.mock('../feedback/TeslaReauthBanner', () => ({ TeslaReauthBanner: () => null }))
vi.mock('../feedback/RateLimitBanner', () => ({ RateLimitBanner: () => null }))
vi.mock('../feedback/MaintenanceBanner', () => ({ MaintenanceBanner: () => null }))
vi.mock('../feedback/ImpersonationBanner', () => ({ ImpersonationBanner: () => null }))
vi.mock('../feedback/TopProgress', () => ({ TopProgress: () => null }))
vi.mock('../feedback/SessionExpiringModal', () => ({ SessionExpiringModal: () => null }))
vi.mock('../feedback/SessionExpiredModal', () => ({ SessionExpiredModal: () => null }))
vi.mock('../feedback/GotoIndicator', () => ({ GotoIndicator: () => null }))
vi.mock('../feedback/KeyboardShortcutsModal', () => ({ KeyboardShortcutsModal: () => null }))
vi.mock('../feedback/FeedbackModal', () => ({ FeedbackModal: () => null }))
vi.mock('../feedback/TourOverlay', () => ({ TourOverlay: () => null }))
vi.mock('../feedback/ChangelogModal', () => ({ ChangelogModal: () => null }))
vi.mock('../feedback/DraftRestorePrompt', () => ({ DraftRestorePrompt: () => null }))
vi.mock('../feedback/SkipToContent', () => ({ SkipToContent: () => null }))
vi.mock('../feedback/BrowserCompatBanner', () => ({ BrowserCompatBanner: () => null }))
vi.mock('../feedback/TimeMachineBanner', () => ({ TimeMachineBanner: () => null }))
vi.mock('../feedback/CookieConsentBanner', () => ({ CookieConsentBanner: () => null }))
vi.mock('@/components/a11y', () => ({ AnnouncerRegion: () => null }))
vi.mock('@/lib/globalShortcuts', () => ({ GlobalShortcuts: () => null }))
vi.mock('@/features/onboarding/TourLauncher', () => ({ TourLauncher: () => null }))
vi.mock('@/components/motion', () => ({
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      children,
      layoutId: _layoutId,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: Record<string, unknown> & { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
  RouteTransition: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))
vi.mock('./BottomTabBar', () => ({
  BottomTabBar: () => null,
  BOTTOM_TAB_PATHS: new Set(['/', '/vehicles', '/charging', '/drives']),
}))
vi.mock('./sidebar/LinearSidebar', () => ({
  LinearSidebar: (props: Record<string, unknown>) => {
    H.sidebarProps.linear = props
    return <div data-testid="linear-sidebar" />
  },
}))
vi.mock('./sidebar/NotionSidebar', () => ({
  NotionSidebar: (props: Record<string, unknown>) => {
    H.sidebarProps.notion = props
    return <div data-testid="notion-sidebar" />
  },
}))
vi.mock('./StatusBar', () => ({
  StatusBar: () => null,
  useStatusBarPrefs: () => ({ enabled: true, iconOnly: false }),
}))
vi.mock('../data-display/ServiceStatus', () => ({ ServiceStatusBanner: () => null }))
vi.mock('./BreadcrumbOverridesContext', () => ({
  BreadcrumbOverridesProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))
vi.mock('./LayoutBreadcrumbs', () => ({
  LayoutBreadcrumbs: ({ variant }: { variant?: string }) => (
    <div data-testid="breadcrumbs" data-variant={variant ?? 'page'} />
  ),
}))
vi.mock('./VehiclePicker', () => ({
  VehiclePicker: ({ className }: { className?: string }) => (
    <div data-testid="vehicle-picker" className={className} />
  ),
}))
vi.mock('./NotificationBellPopover', () => ({ NotificationBellPopover: () => null }))
vi.mock('./sidebar/NavSectionHeader', () => ({
  NavSectionHeader: ({ label, action, id }: { label: string; action?: React.ReactNode; id?: string }) => (
    <div>
      <span id={id}>{label}</span>
      {action}
    </div>
  ),
}))

// ── @/components/ui: faithful Button + trivial ThemePicker ────────────
vi.mock('@/components/ui', async () => {
  const { forwardRef } = await import('react')
  const Button = forwardRef<HTMLButtonElement, Record<string, unknown>>((props, ref) => {
    const { children, variant, size, loading, icon, ...rest } = props
    void variant
    void size
    void loading
    void icon
    return (
      <button ref={ref} {...(rest as Record<string, unknown>)}>
        {children as React.ReactNode}
      </button>
    )
  })
  Button.displayName = 'Button'
  return {
    Button,
    Caption: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
      <span {...props}>{children}</span>
    ),
    CommandPalette: () => null,
    CommandPaletteTrigger: () => <div data-testid="cmd-trigger" />,
    Logo: () => <div data-testid="logo" />,
    ThemePicker: () => <div data-testid="theme-picker" />,
  }
})

// Import AFTER the mocks so the shell wires the stubs.
import Layout, { navSections, navSearchKeywords } from './Layout'
import {
  CANONICAL_SECTION_TO_COMPACT_GROUP,
  COMPACT_GROUP_TITLES,
  COMPACT_NAV_BLUEPRINT,
  EXPLORE_PATH,
  MAX_COMPACT_GROUPS,
} from './sidebar/compactNav'

// ── Helpers ────────────────────────────────────────────────────────────

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc">{`${loc.pathname}${loc.hash}`}</div>
}

function renderLayout(route = '/', opts: { defaultPins?: boolean } = {}) {
  // The default pinned rail duplicates section links (e.g. "My Vehicles"),
  // which breaks unique-name queries. Seed an empty pinned list so section
  // links stay unique; tests that need the shipped defaults opt back in.
  if (!opts.defaultPins) {
    localStorage.setItem('teslasync-pinned-nav-paths', '[]')
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <Layout />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const origRAF = window.requestAnimationFrame
const origCAF = window.cancelAnimationFrame

beforeEach(() => {
  cleanup()
  localStorage.clear()
  H.sidebarStyle.value = 'legacy'
  H.sidebarProps.linear = null
  H.sidebarProps.notion = null
  H.forwardAuth.value = false
  H.request.mockReset()
  H.request.mockImplementation(H.defaultReq)
  H.realtime.mockReset()
  Object.values(H.toast).forEach((fn) => fn.mockReset())

  // jsdom gaps used by Layout's active-link scroll effect.
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  window.requestAnimationFrame = origRAF
  window.cancelAnimationFrame = origCAF
})

// ══════════════════════════════════════════════════════════════════════
// Pure data exports
// ══════════════════════════════════════════════════════════════════════

describe('navSections (data export)', () => {
  const allItems = navSections.flatMap((s) => s.items)

  it('is a non-empty list of sections that each own at least one item', () => {
    expect(Array.isArray(navSections)).toBe(true)
    expect(navSections.length).toBeGreaterThan(5)
    expect(navSections.every((s) => typeof s.title === 'string' && s.title.length > 0)).toBe(true)
    expect(navSections.every((s) => Array.isArray(s.items) && s.items.length > 0)).toBe(true)
  })

  it('leads with Home → Dashboard at the root path', () => {
    expect(navSections[0].title).toBe('Home')
    const dashboard = navSections[0].items.find((i) => i.to === '/')
    expect(dashboard).toBeTruthy()
    expect(dashboard?.label).toBe('Dashboard')
  })

  it('exposes the Action Center decision inbox from Home', () => {
    const actionCenter = navSections[0].items.find((i) => i.to === '/action-center')
    expect(actionCenter?.label).toBe('Action Center')
    expect(navSearchKeywords['/action-center']).toContain('decision inbox')
  })

  it('places Vehicle Management in the Vehicles group', () => {
    const vehiclesSection = navSections.find((section) => section.title === 'Vehicles')
    const management = vehiclesSection?.items.find(
      (item) => item.to === '/vehicle-management',
    )
    expect(management?.label).toBe('Vehicle Management')
    expect(navSearchKeywords['/vehicle-management']).toContain('enterprise roles')
  })

  it('every item has a rooted, unique path and a non-empty label', () => {
    const paths = allItems.map((i) => i.to)
    expect(paths.every((p) => typeof p === 'string' && p.startsWith('/'))).toBe(true)
    expect(allItems.every((i) => typeof i.label === 'string' && i.label.length > 0)).toBe(true)
    // No duplicate destinations across the whole tree.
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('encodes visibility predicates: minVehicles on Compare, requiresAuth on account items', () => {
    const compare = allItems.find((i) => i.to === '/vehicle-comparison') as { minVehicles?: number }
    expect(compare?.minVehicles).toBe(2)
    const twoFactor = allItems.find((i) => i.to === '/account/2fa') as { requiresAuth?: boolean }
    expect(twoFactor?.requiresAuth).toBe(true)
  })
})

describe('navSearchKeywords (data export)', () => {
  it('maps rooted paths to non-empty keyword arrays', () => {
    const entries = Object.entries(navSearchKeywords)
    expect(entries.length).toBeGreaterThan(10)
    expect(entries.every(([path]) => path.startsWith('/'))).toBe(true)
    expect(entries.every(([, kws]) => Array.isArray(kws) && kws.length > 0)).toBe(true)
    expect(entries.every(([, kws]) => kws.every((k) => typeof k === 'string'))).toBe(true)
  })

  it('carries meaningful synonyms for known destinations', () => {
    expect(navSearchKeywords['/']).toContain('home')
    expect(navSearchKeywords['/charging']).toContain('charge')
    expect(navSearchKeywords['/battery']).toContain('soh')
    expect(navSearchKeywords['/action-center']).toContain('recommendations')
    expect(navSearchKeywords['/vehicle-management']).toContain('pricing')
  })
})

// ══════════════════════════════════════════════════════════════════════
// Sidebar-style selection
// ══════════════════════════════════════════════════════════════════════

describe('Layout — sidebar style selection', () => {
  it('renders the LinearSidebar when the style preference is "linear"', () => {
    H.sidebarStyle.value = 'linear'
    renderLayout('/')
    expect(screen.getByTestId('linear-sidebar')).toBeInTheDocument()
    expect(screen.queryByTestId('notion-sidebar')).toBeNull()
  })

  it('renders the NotionSidebar when the style preference is "notion"', () => {
    H.sidebarStyle.value = 'notion'
    renderLayout('/')
    expect(screen.getByTestId('notion-sidebar')).toBeInTheDocument()
    expect(screen.queryByTestId('linear-sidebar')).toBeNull()
  })

  it('renders the built-in legacy nav (no sidebar component) when style is "legacy"', () => {
    H.sidebarStyle.value = 'legacy'
    renderLayout('/')
    expect(screen.queryByTestId('linear-sidebar')).toBeNull()
    expect(screen.queryByTestId('notion-sidebar')).toBeNull()
    // The legacy nav exposes the "Sections" header from NavSectionHeader.
    expect(screen.getByText('Sections')).toBeInTheDocument()
  })
})

// ══════════════════════════════════════════════════════════════════════
// Compact (progressive-disclosure) IA for the default Linear sidebar
// ══════════════════════════════════════════════════════════════════════

describe('compact nav blueprint ↔ navSections catalog', () => {
  const catalogPaths = new Set(navSections.flatMap((s) => s.items).map((i) => i.to))
  const blueprintPaths = COMPACT_NAV_BLUEPRINT.flatMap((g) => g.paths)

  it('declares at most nine product-oriented groups in the canonical order', () => {
    expect(COMPACT_GROUP_TITLES.length).toBeLessThanOrEqual(MAX_COMPACT_GROUPS)
    expect(COMPACT_NAV_BLUEPRINT.map((g) => g.title)).toEqual([...COMPACT_GROUP_TITLES])
    expect([...COMPACT_GROUP_TITLES]).toEqual([
      'Overview',
      'Fleet',
      'Driving',
      'Charging & Energy',
      'Battery',
      'Reports & Analytics',
      'Automation & Alerts',
      'System & Developer',
      'Settings & Account',
    ])
  })

  it('never repeats a path across the curated groups', () => {
    expect(new Set(blueprintPaths).size).toBe(blueprintPaths.length)
  })

  it('only curates paths that really exist in the canonical catalog', () => {
    const orphans = blueprintPaths.filter((p) => !catalogPaths.has(p))
    expect(orphans).toEqual([])
  })

  it('keeps the required core destinations reachable from the compact tree', () => {
    for (const required of ['/', EXPLORE_PATH, '/vehicles', '/drives', '/charging', '/battery', '/settings']) {
      expect(blueprintPaths).toContain(required)
    }
    const overview = COMPACT_NAV_BLUEPRINT.find((g) => g.title === 'Overview')
    // The Feature Hub is a first-class Overview row — it is the escape hatch
    // to the complete catalog for every long-tail route.
    expect(overview?.paths).toContain(EXPLORE_PATH)
  })

  it('maps every canonical section title onto a compact group', () => {
    for (const section of navSections) {
      const mapped = CANONICAL_SECTION_TO_COMPACT_GROUP[section.title]
      expect(mapped, `no compact group mapped for "${section.title}"`).toBeTruthy()
      expect(COMPACT_GROUP_TITLES).toContain(mapped)
    }
  })

  it('leaves the canonical catalog itself untouched (still the full route list)', () => {
    expect(navSections.length).toBeGreaterThan(MAX_COMPACT_GROUPS)
    expect(navSections.flatMap((s) => s.items).length).toBeGreaterThan(blueprintPaths.length * 2)
  })
})

describe('Layout — compact Linear sidebar wiring', () => {
  const linearProps = () =>
    H.sidebarProps.linear as unknown as {
      sections: Array<{ title: string; items: Array<{ to: string }> }>
      activeSectionTitle?: string
    }

  it('feeds the Linear sidebar the compact nine-group tree, not the full catalog', () => {
    H.sidebarStyle.value = 'linear'
    renderLayout('/')

    const { sections } = linearProps()
    expect(sections.length).toBeLessThanOrEqual(MAX_COMPACT_GROUPS)
    expect(sections.map((s) => s.title)).toEqual([...COMPACT_GROUP_TITLES])

    const paths = sections.flatMap((s) => s.items.map((i) => i.to))
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths).toContain(EXPLORE_PATH)
    expect(paths.length).toBeLessThan(navSections.flatMap((s) => s.items).length / 2)
  })

  it('reports the compact group as the active section for a curated route', () => {
    H.sidebarStyle.value = 'linear'
    renderLayout('/drives')
    expect(linearProps().activeSectionTitle).toBe('Driving')
  })

  it('injects a long-tail active route into its mapped compact group', () => {
    H.sidebarStyle.value = 'linear'
    // /dashcam lives in the canonical "Diagnostics" section and is NOT part
    // of the curated set — it must still light up under System & Developer.
    renderLayout('/dashcam')

    const { sections, activeSectionTitle } = linearProps()
    expect(activeSectionTitle).toBe('System & Developer')
    const group = sections.find((s) => s.title === 'System & Developer')
    expect(group?.items.map((i) => i.to)).toContain('/dashcam')
    // Injection must not duplicate anything elsewhere in the tree.
    const paths = sections.flatMap((s) => s.items.map((i) => i.to))
    expect(paths.filter((p) => p === '/dashcam')).toHaveLength(1)
  })

  it('keeps the complete catalog for the Notion style (explicit user choice)', () => {
    H.sidebarStyle.value = 'notion'
    renderLayout('/dashcam')

    const props = H.sidebarProps.notion as unknown as {
      sections: Array<{ title: string }>
      activeSectionTitle?: string
    }
    expect(props.sections.map((s) => s.title)).toContain('Diagnostics')
    expect(props.sections.length).toBeGreaterThan(MAX_COMPACT_GROUPS)
    expect(props.activeSectionTitle).toBe('Diagnostics')
  })
})

describe('Layout — global page chrome', () => {
  it('mounts the persistent workspace command header with compact breadcrumbs', () => {
    renderLayout('/notifications/archived')
    const workspaceHeader = document.querySelector('[data-role="workspace-header"]')
    expect(workspaceHeader).toBeInTheDocument()
    expect(within(workspaceHeader as HTMLElement).getByTestId('breadcrumbs')).toHaveAttribute(
      'data-variant',
      'workspace',
    )
    expect(within(workspaceHeader as HTMLElement).getByTestId('cmd-trigger')).toBeInTheDocument()
  })

  it('keeps page breadcrumbs available below the desktop workspace breakpoint', () => {
    renderLayout('/notifications/archived')
    const compactBreadcrumbs = document.querySelector('[data-role="compact-breadcrumbs"]')

    expect(compactBreadcrumbs).toHaveClass('xl:hidden')
    expect(
      within(compactBreadcrumbs as HTMLElement).getByTestId('breadcrumbs'),
    ).toHaveAttribute('data-variant', 'page')
  })

  it('keeps desktop scope in the command header and mobile scope in the drawer', () => {
    renderLayout('/')
    const pickers = screen.getAllByTestId('vehicle-picker')
    expect(pickers).toHaveLength(2)
    expect(pickers.filter(picker => picker.classList.contains('xl:hidden'))).toHaveLength(1)
    const workspaceHeader = document.querySelector('[data-role="workspace-header"]')
    expect(within(workspaceHeader as HTMLElement).getByTestId('vehicle-picker')).not.toHaveClass(
      'xl:hidden',
    )
  })

  it('lets pages use the full main-column width without a centered max-width cap', () => {
    const { container } = renderLayout('/')
    const viewport = container.querySelector('[data-role="page-viewport"]')

    expect(viewport).toHaveClass('w-full')
    expect(viewport).not.toHaveClass('mx-auto', 'max-w-[1920px]')
  })
})

// ══════════════════════════════════════════════════════════════════════
// Legacy sidebar navigation + active state
// ══════════════════════════════════════════════════════════════════════

describe('Layout — legacy nav rendering + active state', () => {
  it('exposes a labelled "Primary" navigation landmark', () => {
    renderLayout('/')
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
  })

  it('marks the active route link with aria-current="page" and surfaces it as the current section', () => {
    renderLayout('/vehicles')
    const link = screen.getByRole('link', { name: 'My Vehicles' })
    expect(link).toHaveAttribute('aria-current', 'page')
    // The current-section panel echoes the active item label (its <p> carries a
    // unique "<label> — <section>" title).
    expect(screen.getByTitle('My Vehicles — Vehicles')).toHaveTextContent('My Vehicles')
  })

  it('does not mark unrelated links as current', () => {
    renderLayout('/vehicles')
    // Dashboard lives in the Pinned rail and its own section; it is not active.
    const dashboardLinks = screen.getAllByRole('link', { name: 'Dashboard' })
    expect(dashboardLinks.length).toBeGreaterThan(0)
    dashboardLinks.forEach((l) => expect(l).not.toHaveAttribute('aria-current', 'page'))
  })
})

// ══════════════════════════════════════════════════════════════════════
// Live badges (data-driven)
// ══════════════════════════════════════════════════════════════════════

describe('Layout — live nav badges', () => {
  it('shows the vehicle count badge on the "My Vehicles" link', async () => {
    renderLayout('/vehicles')
    await waitFor(() => {
      const link = screen.getByRole('link', { name: 'My Vehicles' })
      expect(within(link).getByText('2')).toBeInTheDocument()
    })
  })

  it('shows the unread-alert badge on the "Alert Center" link', async () => {
    renderLayout('/notifications/alerts')
    await waitFor(() => {
      const link = screen.getByRole('link', { name: 'Alert Center' })
      // ALERTS fixture has exactly one unread entry.
      expect(within(link).getByText('1')).toBeInTheDocument()
    })
  })

  it('shows the stale-session badge on the "Data Repair" link', async () => {
    renderLayout('/data-repair')
    await waitFor(() => {
      const link = screen.getByRole('link', { name: 'Data Repair' })
      // STALE fixture: 1 charging + 2 drives = 3.
      expect(within(link).getByText('3')).toBeInTheDocument()
    })
  })
})

// ══════════════════════════════════════════════════════════════════════
// Visibility predicates (isVisibleNavItem)
// ══════════════════════════════════════════════════════════════════════

describe('Layout — nav item visibility', () => {
  it('hides requiresAuth items in open mode and reveals them under ForwardAuth', () => {
    H.forwardAuth.value = false
    const { unmount } = renderLayout('/tesla-account')
    expect(screen.queryByRole('link', { name: 'Two-Factor Auth' })).toBeNull()
    unmount()

    H.forwardAuth.value = true
    renderLayout('/tesla-account')
    expect(screen.getByRole('link', { name: 'Two-Factor Auth' })).toBeInTheDocument()
  })

  it('hides minVehicles items when the fleet is too small', async () => {
    H.request.mockImplementation((url: unknown) => {
      if (url === '/vehicles') return Promise.resolve([{ id: 1 }])
      return H.defaultReq(url)
    })
    renderLayout('/vehicles')
    // With a single vehicle, "Compare Vehicles" (minVehicles: 2) stays hidden.
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'My Vehicles' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('link', { name: 'Compare Vehicles' })).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════
// Section expand / collapse
// ══════════════════════════════════════════════════════════════════════

describe('Layout — section expand/collapse', () => {
  it('toggles a collapsed section open and closed on header click', async () => {
    renderLayout('/')
    const chargingToggle = screen.getByRole('button', { name: /Charging/ })
    expect(chargingToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: 'Charging Overview' })).toBeNull()

    fireEvent.click(chargingToggle)
    expect(chargingToggle).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('link', { name: 'Charging Overview' })).toBeInTheDocument()

    fireEvent.click(chargingToggle)
    expect(chargingToggle).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Charging Overview' })).toBeNull(),
    )
  })

  it('"Expand all" opens every section and then disables itself', async () => {
    renderLayout('/')
    const expandAll = screen.getByRole('button', { name: 'Expand all sections' })
    expect(expandAll).not.toBeDisabled()
    fireEvent.click(expandAll)
    // A deep-section link that was collapsed before now renders.
    expect(await screen.findByRole('link', { name: 'Charging Overview' })).toBeInTheDocument()
    await waitFor(() => expect(expandAll).toBeDisabled())
  })
})

// ══════════════════════════════════════════════════════════════════════
// Pin / unpin
// ══════════════════════════════════════════════════════════════════════

describe('Layout — pin/unpin current page', () => {
  const PINNED_KEY = 'teslasync-pinned-nav-paths'

  it('pins the current (unpinned) page and persists it', async () => {
    renderLayout('/drives')
    const pin = screen.getByRole('button', { name: 'Pin current page' })
    expect(pin).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(pin)

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]') as string[]
      expect(stored).toContain('/drives')
    })
    expect(
      screen.getByRole('button', { name: 'Remove current page from pinned' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('unpins a page that is pinned by default and persists the removal', async () => {
    // '/vehicles' ships in DEFAULT_PINNED_NAV_PATHS.
    renderLayout('/vehicles', { defaultPins: true })
    const unpin = screen.getByRole('button', { name: 'Remove current page from pinned' })
    expect(unpin).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(unpin)

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]') as string[]
      expect(stored).not.toContain('/vehicles')
    })
    expect(screen.getByRole('button', { name: 'Pin current page' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})

// ══════════════════════════════════════════════════════════════════════
// Mobile drawer
// ══════════════════════════════════════════════════════════════════════

describe('Layout — mobile drawer', () => {
  it('opens and closes the sidebar drawer from the mobile header controls', async () => {
    renderLayout('/')
    const aside = screen.getByRole('navigation', { name: 'Primary' })
    expect(aside).toHaveAttribute('data-sidebar-open', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
    await waitFor(() => expect(aside).toHaveAttribute('data-sidebar-open', 'true'))

    fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }))
    await waitFor(() => expect(aside).toHaveAttribute('data-sidebar-open', 'false'))
  })
})

// ══════════════════════════════════════════════════════════════════════
// ThemeQuickSwitcher popover
// ══════════════════════════════════════════════════════════════════════

describe('Layout — ThemeQuickSwitcher', () => {
  it('opens a themed dialog and closes it on Escape', async () => {
    renderLayout('/')
    const trigger = screen.getAllByRole('button', { name: 'Open theme picker' })[0]
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Open theme picker' })
    expect(within(dialog).getByTestId('theme-picker')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('"Customize…" navigates to the appearance settings and closes the popover', async () => {
    renderLayout('/')
    fireEvent.click(screen.getAllByRole('button', { name: 'Open theme picker' })[0])
    const dialog = await screen.findByRole('dialog', { name: 'Open theme picker' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Customize…' }))

    await waitFor(() =>
      expect(screen.getByTestId('loc').textContent).toBe('/settings#appearance'),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════
// Active-link scroll effect (reduced-motion + resilience — the source fix)
// ══════════════════════════════════════════════════════════════════════

describe('Layout — active-link scroll behaviour', () => {
  function runRafSynchronously() {
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0)
      return 1
    }) as typeof window.requestAnimationFrame
    window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame
  }

  it('smooth-scrolls the active link into view when reduced motion is OFF', () => {
    const scrollSpy = vi.fn()
    Element.prototype.scrollIntoView = scrollSpy
    runRafSynchronously()

    renderLayout('/vehicles')

    expect(scrollSpy).toHaveBeenCalled()
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
  })

  it('jumps instantly (behavior "auto") when reduced motion is ON', () => {
    const scrollSpy = vi.fn()
    Element.prototype.scrollIntoView = scrollSpy
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: true,
      media: q,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia
    runRafSynchronously()

    renderLayout('/vehicles')

    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }))
  })

  it('never crashes the shell when scrollIntoView throws for every call shape', () => {
    Element.prototype.scrollIntoView = vi.fn(() => {
      throw new Error('scrollIntoView unavailable')
    })
    runRafSynchronously()

    expect(() => renderLayout('/vehicles')).not.toThrow()
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
  })
})
