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
 * most leaf/child modules and ambient hooks so the tests exercise Layout's
 * orchestration. Logo and NotificationBellPopover retain their actual DOM.
 * Network is mocked at the `@/api/client` boundary; nothing hits a real endpoint.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  within,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
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
  const REPAIR_STATS = { open: 1, in_review: 2 }

  const defaultReq = (url: unknown, _options?: import('@/api/client').ApiRequestOptions) => {
    if (typeof url === 'string') {
      if (url.startsWith('/alerts')) return Promise.resolve(ALERTS)
      if (url === '/vehicles') return Promise.resolve(VEHICLES)
      if (url === '/data-repair/cases/stats') return Promise.resolve(REPAIR_STATS)
      if (url.startsWith('/data-repair')) return Promise.resolve(STALE)
    }
    return Promise.resolve({})
  }

  return {
    ALERTS,
    VEHICLES,
    STALE,
    REPAIR_STATS,
    defaultReq,
    request: vi.fn(defaultReq),
    sidebarProps: { unified: null as Record<string, unknown> | null },
    forwardAuth: { value: false },
    presentation: { mode: 'standard' as 'standard' | 'report' | 'kiosk' },
    toast: {
      toast: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    },
    realtime: vi.fn(),
    notificationListener: vi.fn(),
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
vi.mock('@/hooks/usePresentationMode', () => ({
  usePresentationMode: () => ({
    mode: H.presentation.mode,
    isActive: H.presentation.mode !== 'standard',
    isReport: H.presentation.mode === 'report',
    isKiosk: H.presentation.mode === 'kiosk',
    config: {
      hideCursor: true,
      cursorTimeout: 5,
      dimAfter: 0,
      dimLevel: 0.5,
      showClock: true,
      clockPosition: 'bottom-right',
    },
    isDimmed: false,
    isCursorHidden: false,
    rotation: {
      dashboardCount: 0,
      currentIndex: 0,
      enabled: false,
    },
    enterReport: vi.fn(),
    enterKiosk: vi.fn(),
    exitPresentation: vi.fn(),
  }),
}))
vi.mock('../../hooks/useRealtimeEvents', () => ({
  useRealtimeEvents: (opts: unknown) => H.realtime(opts),
}))
vi.mock('../../hooks/useNotificationListener', () => ({
  useNotificationListener: () => H.notificationListener(),
}))
vi.mock('../../hooks/useTitleBadge', () => ({ useTitleBadge: vi.fn() }))
vi.mock('../../hooks/useFaviconBadge', () => ({ useFaviconBadge: vi.fn() }))
vi.mock('../../hooks/useDynamicAppIcon', () => ({ useDynamicAppIcon: vi.fn() }))
vi.mock('../../hooks/useCriticalAlertFlash', () => ({ useCriticalAlertFlash: vi.fn() }))
vi.mock('../feedback/Toast', () => ({ useToast: () => H.toast }))

// ── API boundary ──────────────────────────────────────────────────────
vi.mock('@/api/client', () => ({
  request: (...args: Parameters<typeof H.defaultReq>) => H.request(...args),
  ApiError: class ApiError extends Error {},
}))
vi.mock('@/api/hooks/useAuthMode', () => ({
  useIsForwardAuth: () => H.forwardAuth.value,
  // Capability-aware nav grouping reads the raw auth-mode contract. Open mode
  // (`mode: 'open'`) is the default fixture: the local operator owns every
  // administrative surface, so advanced groups are promoted, not restricted.
  useAuthMode: () => ({
    data: {
      mode: H.forwardAuth.value ? 'forward_auth' : 'open',
      capabilities: {
        step_up_reauth: H.forwardAuth.value,
        totp_enrollment: H.forwardAuth.value,
        session_list: H.forwardAuth.value,
        impersonation: false,
        rbac: H.forwardAuth.value,
      },
    },
  }),
}))
vi.mock('@/api/hooks/useSettings', () => ({
  useSettings: () => ({ data: { completed_tours: [] }, isFetched: true }),
  settingsKeys: { settings: ['settings'] },
}))

// ── tour registry / broadcast (pure-ish, mocked for determinism) ──────
vi.mock('@/lib/tourRegistry', () => ({
  TOUR_START_EVENT: 'teslasync:tour:start',
  TOUR_OPEN_LAUNCHER_EVENT: 'teslasync:tour:openLauncher',
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
vi.mock('../feedback/InstallPrompt', () => ({ default: () => <div data-testid="install-prompt-stub" /> }))
vi.mock('../feedback/OfflineBanner', () => ({ OfflineBanner: () => null }))
vi.mock('../feedback/NewVersionBanner', () => ({ NewVersionBanner: () => null }))
vi.mock('../feedback/TeslaReauthBanner', () => ({ TeslaReauthBanner: () => null }))
vi.mock('../feedback/RateLimitBanner', () => ({ RateLimitBanner: () => <div data-testid="rate-limit-banner-stub" /> }))
vi.mock('../feedback/MaintenanceBanner', () => ({ MaintenanceBanner: () => null }))
vi.mock('../feedback/ImpersonationBanner', () => ({ ImpersonationBanner: () => null }))
vi.mock('../feedback/TopProgress', () => ({ TopProgress: () => null }))
vi.mock('../feedback/SessionExpiringModal', () => ({ SessionExpiringModal: () => null }))
vi.mock('../feedback/SessionExpiredModal', () => ({ SessionExpiredModal: () => null }))
vi.mock('../feedback/ReauthDialog', () => ({
  ReauthDialogRoot: () => <div data-testid="reauth-root" />,
}))
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
vi.mock('./sidebar/CommandDeck', () => ({
  CommandDeck: (props: Record<string, unknown>) => {
    H.sidebarProps.unified = props
    // Stand-in current-page link so the active-link scroll effect has a
    // target; the real deck's rows are covered by CommandDeck.test.tsx.
    return (
      <div data-testid="command-deck">
        <a aria-current="page" href="/">
          Current page
        </a>
      </div>
    )
  },
}))
vi.mock('./StatusBar', () => ({
  StatusBar: () => <div data-testid="status-bar" />,
  useStatusBarPrefs: () => ({ enabled: true, iconOnly: false }),
}))
vi.mock('./presentation/PresentationOverlay', () => ({
  PresentationOverlay: ({ mode }: { mode: string }) => (
    <div data-testid="presentation-overlay" data-mode={mode} />
  ),
}))
vi.mock('./presentation/ReportMasthead', () => ({
  ReportMasthead: () => <div data-testid="report-masthead" />,
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
vi.mock('./WorkspaceContextControl', () => ({
  // Mirror the real component's `hidden` contract so route-aware scope tests
  // assert on genuine behaviour rather than an always-on stub.
  WorkspaceContextControl: ({ hidden = false }: { hidden?: boolean }) =>
    hidden ? null : <div data-testid="workspace-context-control" />,
}))
vi.mock('@/hooks/useMediaQuery', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useMediaQuery')>('@/hooks/useMediaQuery')
  return {
    ...actual,
    // Keep the real bell DOM without adding a listener to the shell's aliased media fixture.
    useIsMobile: () => window.matchMedia('(max-width: 640px)').matches,
  }
})
vi.mock('./sidebar/NavSectionHeader', () => ({
  NavSectionHeader: ({ label, action, id }: { label: string; action?: React.ReactNode; id?: string }) => (
    <div>
      <span id={id}>{label}</span>
      {action}
    </div>
  ),
}))
vi.mock('@/api/hooks/useNavigationPins', () => ({
  useNavigationPins: () => ({
    ready: true,
    toggle: () => Promise.resolve(),
    restore: () => undefined,
  }),
}))

// ── @/components/ui: faithful Button + trivial ThemePicker ────────────
vi.mock('@/components/ui/runtime', async () => {
  const { forwardRef } = await import('react')
  const { default: Logo } = await import('@/components/ui/Logo')
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
    Logo,
    ThemePicker: () => <div data-testid="theme-picker" />,
  }
})
vi.mock('../ui/CommandPaletteTrigger', () => ({
  CommandPaletteTrigger: () => <div data-testid="cmd-trigger" />,
}))
vi.mock('@/components/ui/ThemePicker', () => ({
  ThemePicker: () => <div data-testid="theme-picker" />,
}))

// Import AFTER the mocks so the shell wires the stubs.
import Layout, { navSections, reconcileNavPaths } from './Layout'
import { navSearchKeywords } from './navSearchKeywords'
import { DIAGNOSTIC_GROUPS } from './diagnosticGroups'
import { flattenSidebarItems } from './sidebar/collections'
import { prioritizeCanonicalNavSections } from './sidebar/compactNav'
import type { SectionGroup } from './sectionGroups'
import {
  DEFAULT_PINNED_NAV_PATHS,
  PINNED_NAV_STORAGE_KEY,
  RECENT_NAV_STORAGE_KEY,
  __resetNavPinsSessionOverridesForTests,
  setPinnedNavPaths,
} from '@/lib/navPins'

// ── Helpers ────────────────────────────────────────────────────────────

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc">{`${loc.pathname}${loc.hash}`}</div>
}

function renderLayout(route = '/', opts: { defaultPins?: boolean; probe?: React.ReactNode } = {}) {
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
        {opts.probe}
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// The mobile drawer is deck-owned since the sidenav redesign: Layout owns the
// trigger + appbar visibility and hands the open state to the deck through
// `mobileBrowseOpen`, while every close path (item select, backdrop, sheet
// dismiss, Escape) funnels back through the deck's `onItemSelect`. These
// helpers read that seam contract from the mocked CommandDeck.
const deckProps = () =>
  H.sidebarProps.unified as unknown as {
    mobileBrowseOpen?: boolean
    panelOpen: boolean
    onItemSelect: () => void
    onPanelOpenChange: (open: boolean) => void
  }

function GoToDrives() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate('/drives')}>
      go to drives
    </button>
  )
}

const origRAF = window.requestAnimationFrame
const origCAF = window.cancelAnimationFrame

beforeEach(() => {
  cleanup()
  localStorage.clear()
  __resetNavPinsSessionOverridesForTests()
  H.sidebarProps.unified = null
  H.forwardAuth.value = false
  H.presentation.mode = 'standard'
  H.request.mockReset()
  H.request.mockImplementation(H.defaultReq)
  H.realtime.mockReset()
  H.notificationListener.mockReset()
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
    expect(actionCenter?.label).toBe('Action center')
    expect(navSearchKeywords['/action-center']).toContain('decision inbox')
  })

  it('places Vehicle Management in the Vehicles group', () => {
    const vehiclesSection = navSections.find((section) => section.title === 'Vehicles')
    const management = vehiclesSection?.items.find(
      (item) => item.to === '/vehicle-management',
    )
    expect(management?.label).toBe('Vehicle management')
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

  it('gives every item a unique stable labelKey and every section a titleKey', () => {
    const labelKeys = allItems.map((i) => i.labelKey)
    expect(labelKeys.every((k) => typeof k === 'string' && k.startsWith('nav.items.'))).toBe(true)
    expect(new Set(labelKeys).size).toBe(labelKeys.length)
    const titleKeys = navSections.map((s) => s.titleKey)
    expect(titleKeys.every((k) => typeof k === 'string' && (k as string).startsWith('nav.groups.'))).toBe(true)
    expect(new Set(titleKeys).size).toBe(titleKeys.length)
  })

  it('resolves every nav labelKey/titleKey in the en catalog with the authored label', async () => {
    const en = (await import('@/i18n/en.json')).default as Record<string, any>
    const nav = en.nav as { items: Record<string, string>; groups: Record<string, string> }
    for (const item of allItems) {
      const slug = item.labelKey.slice('nav.items.'.length)
      expect(nav.items[slug]).toBe(item.label)
    }
    for (const section of navSections) {
      const slug = (section.titleKey as string).slice('nav.groups.'.length)
      expect(nav.groups[slug]).toBe(section.title)
    }
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

describe('Layout — unified sidebar wiring', () => {
  const unifiedProps = () =>
    H.sidebarProps.unified as unknown as {
      sections: Array<{ title: string; items: Array<{ to: string }> }>
      pinnedItems: Array<{ to: string }>
      recentItems: Array<{ to: string }>
      panelCollapsed: boolean
      panelOpen: boolean
      onTogglePanelCollapsed: () => void
      onPanelOpenChange: (open: boolean) => void
    }

  it('renders the CommandDeck as the only sidebar', async () => {
    renderLayout('/')
    expect(await screen.findByTestId('command-deck')).toBeInTheDocument()
  })

  it('mounts one step-up challenge host for sensitive actions', () => {
    renderLayout('/api-keys')
    expect(screen.getAllByTestId('reauth-root')).toHaveLength(1)
  })

  it('sizes the Command Deck rail to 348px expanded, 76px collapsed, with no resize handle', async () => {
    // Fresh default is open on desktop (the docked case this test sizes).
    const previousWidth = window.innerWidth
    window.innerWidth = 1440
    const first = renderLayout('/')
    expect(await screen.findByTestId('command-deck')).toBeInTheDocument()
    // The panel is open by default (no stored preference): 76px rail + 272px panel.
    expect(screen.getByTestId('command-deck').closest('[data-presentation-mode]')).toHaveStyle({
      '--shell-sidebar-width': '348px',
    })
    expect(screen.queryByRole('separator', { name: 'Resize sidebar' })).toBeNull()
    act(() => unifiedProps().onPanelOpenChange(false))
    expect(screen.getByTestId('command-deck').closest('[data-presentation-mode]')).toHaveStyle({
      '--shell-sidebar-width': '76px',
    })
    expect(screen.queryByRole('separator', { name: 'Resize sidebar' })).toBeNull()
    first.unmount()

    localStorage.setItem('teslasync-deck-panel-open', '0')
    renderLayout('/')
    expect(await screen.findByTestId('command-deck')).toBeInTheDocument()
    expect(screen.getByTestId('command-deck').closest('[data-presentation-mode]')).toHaveStyle({
      '--shell-sidebar-width': '76px',
    })
    expect(screen.queryByRole('separator', { name: 'Resize sidebar' })).toBeNull()
    window.innerWidth = previousWidth
  })

  it('restores the secondary panel open state after a reload', async () => {
    // Fresh default is open on desktop (docked, harmless); covered for
    // smaller viewports by 'keeps the panel closed on fresh tablet loads'.
    const previousWidth = window.innerWidth
    window.innerWidth = 1440
    const first = renderLayout('/')
    expect(await screen.findByTestId('command-deck')).toBeInTheDocument()
    // Open is the default: first paint shows the panel until the user closes it.
    expect(unifiedProps().panelOpen).toBe(true)
    act(() => unifiedProps().onPanelOpenChange(false))
    expect(localStorage.getItem('teslasync-deck-panel-open')).toBe('0')
    first.unmount()

    const second = renderLayout('/')
    expect(await screen.findByTestId('command-deck')).toBeInTheDocument()
    expect(unifiedProps().panelOpen).toBe(false)
    act(() => unifiedProps().onPanelOpenChange(true))
    expect(localStorage.getItem('teslasync-deck-panel-open')).toBe('1')
    second.unmount()

    renderLayout('/')
    expect(await screen.findByTestId('command-deck')).toBeInTheDocument()
    expect(unifiedProps().panelOpen).toBe(true)
    window.innerWidth = previousWidth
  })

  it('keeps the panel closed on fresh tablet loads so the modal never covers first paint', async () => {
    const previousWidth = window.innerWidth
    window.innerWidth = 768
    try {
      renderLayout('/')
      expect(await screen.findByTestId('command-deck')).toBeInTheDocument()
      expect(unifiedProps().panelOpen).toBe(false)
      // An explicit stored choice still wins on small viewports.
      act(() => unifiedProps().onPanelOpenChange(true))
      expect(localStorage.getItem('teslasync-deck-panel-open')).toBe('1')
    } finally {
      window.innerWidth = previousWidth
    }
  })

  it('maps the docked secondary panel width to its open state and persists that preference', async () => {
    const previousWidth = window.innerWidth
    window.innerWidth = 1440
    const first = renderLayout('/')
    expect(await screen.findByTestId('command-deck')).toBeInTheDocument()
    const shell = screen.getByTestId('command-deck').closest('[data-presentation-mode]')
    expect(shell).toHaveStyle({ '--shell-sidebar-width': '348px' })
    act(() => unifiedProps().onPanelOpenChange(false))
    expect(shell).toHaveStyle({ '--shell-sidebar-width': '76px' })
    expect(localStorage.getItem('teslasync-deck-panel-open')).toBe('0')
    act(() => unifiedProps().onPanelOpenChange(true))
    expect(shell).toHaveStyle({ '--shell-sidebar-width': '348px' })
    expect(localStorage.getItem('teslasync-deck-panel-open')).toBe('1')
    first.unmount()

    renderLayout('/')
    expect(await screen.findByTestId('command-deck')).toBeInTheDocument()
    expect(unifiedProps().panelOpen).toBe(true)
    expect(screen.getByTestId('command-deck').closest('[data-presentation-mode]')).toHaveStyle({
      '--shell-sidebar-width': '348px',
    })
    window.innerWidth = previousWidth
  })

  it('feeds the unified sidebar the complete catalog as its search corpus', () => {
    renderLayout('/dashcam')

    const { sections } = unifiedProps()
    expect(sections.map((s) => s.title)).toContain('Diagnostics')
    expect(sections.length).toBeGreaterThan(11)
    // Canonical section titles survive (no compact-group remapping).
    expect(sections.map((s) => s.title)).toContain('Security')
  })

  it('passes pinned and recent items through for quick access + recents', async () => {
    localStorage.setItem('teslasync-pinned-nav-paths', JSON.stringify(['/drives']))
    // defaultPins skips the helper's empty-pin seeding so the seed survives.
    renderLayout('/trips', { defaultPins: true })
    expect(await screen.findByTestId('command-deck')).toBeInTheDocument()

    const { pinnedItems, recentItems } = unifiedProps()
    expect(pinnedItems.map((i) => i.to)).toContain('/drives')
    expect(Array.isArray(recentItems)).toBe(true)
  })

  it('leads suggestions with the Action Center while a critical alert is unread', async () => {
    renderLayout('/trips')

    // ALERTS fixture: one unread critical entry. The alerts query resolves
    // after first paint, so wait for the live row to take the lead.
    await waitFor(() => {
      const props = H.sidebarProps.unified as unknown as {
        suggestions?: Array<{ to: string; reason: string }>
      } | null
      expect(props?.suggestions?.[0]?.to).toBe('/action-center')
    })
    const { suggestions } = H.sidebarProps.unified as unknown as {
      suggestions: Array<{ to: string; reason: string }>
    }
    expect(suggestions[0].reason).toBe('1 need attention')
    // Related fill never echoes pins, recents, or the current page.
    const paths = suggestions.map((s) => s.to)
    expect(paths).not.toContain('/trips')
    expect(new Set(paths).size).toBe(paths.length)
  })
})

describe('Layout — grouped sidebar sections', () => {
  const deckSections = () =>
    H.sidebarProps.unified as unknown as {
      pathname: string
      sections: Array<{ title: string; items: Array<{ to: string; label: string }> }>
      activeSectionTitle?: string
    }

  it('feeds the deck the complete catalog with the canonical active section', () => {
    renderLayout('/dashcam')

    const props = deckSections()
    expect(props.sections.map((s) => s.title)).toContain('Diagnostics')
    expect(props.sections.length).toBeGreaterThan(11)
    expect(props.activeSectionTitle).toBe('Security')
  })

  it('shows six Reports entries while keeping every route in the catalog', () => {
    renderLayout('/analytics')

    const props = deckSections()
    const reports = props.sections.find(section => section.title === 'Reports')
    expect(reports?.items.map(item => item.to)).toEqual([
      '/statistics', '/efficiency', '/cost-analysis',
      '/share-card', '/analytics/carbon', '/benchmarks/privacy',
    ])
    expect(reports?.items.slice(0, 3).map(item => item.label)).toEqual([
      'Fleet insights', 'Driving efficiency', 'Costs',
    ])
    // Flat rows key off the real location, not the group primary.
    expect(props.pathname).toBe('/analytics')
    expect(navSections.find(section => section.title === 'Reports')?.items).toHaveLength(11)
  })

  it('groups diagnostics without removing any catalog destinations', () => {
    renderLayout('/admin/ingest-xray')

    const props = deckSections()
    const diagnostics = props.sections.find(section => section.title === 'Diagnostics')
    expect(diagnostics?.items.map(item => item.to)).toEqual([
      '/system-status', '/db-health', '/anomaly-detection',
      '/signals', '/admin/flags', '/admin/vehicle-cost', '/signal-correlation',
    ])
    expect(diagnostics?.items.find(item => item.to === '/signals')?.label).toBe('Telemetry troubleshooting')
    expect(props.pathname).toBe('/admin/ingest-xray')
    expect(navSections.find(section => section.title === 'Diagnostics')?.items).toHaveLength(33)
    expect(DIAGNOSTIC_GROUPS.every(group => group.pages.every(page =>
      navSections.find(section => section.title === 'Diagnostics')?.items
        .some(item => item.to === page.to && item.labelKey === page.labelKey),
    ))).toBe(true)
  })

  it('orders sections for the owner persona: daily driving first, admin last', () => {
    const titles = prioritizeCanonicalNavSections(navSections, 'owner').map((section) => section.title)
    expect(titles).toEqual([
      'Home',
      'Vehicles',
      'Driving',
      'Charging',
      'Battery',
      'Energy',
      'Cabin',
      'Reports',
      'Service',
      'Commands',
      'Automation',
      'Notifications',
      'Security',
      'Advanced intelligence',
      'Ownership intelligence',
      'Tesla physics',
      'Data',
      'Diagnostics',
      'Account',
      'Settings',
      'Integrations',
      'About',
      'Experiments',
    ])
  })

  it('uses distinct icons for system status and Tesla API usage', () => {
    const diagnostics = navSections.find((section) => section.title === 'Diagnostics')
    const status = diagnostics?.items.find((item) => item.to === '/system-status')
    const usage = diagnostics?.items.find((item) => item.to === '/tesla-api-usage')
    expect(status?.icon).toBeDefined()
    expect(usage?.icon).toBeDefined()
    expect(status?.icon).not.toBe(usage?.icon)
  })
})

describe('Layout — global page chrome', () => {
  it('installs the browser-notification delivery hook on the settings route', () => {
    renderLayout('/notifications/browser')
    expect(H.notificationListener).toHaveBeenCalled()
  })

  it('keeps rate-limit notices inside the report column instead of consuming horizontal page space', () => {
    const { container } = renderLayout('/')
    const main = container.querySelector('[data-role="main-content"]')
    expect(main?.parentElement).toContainElement(screen.getByTestId('rate-limit-banner-stub'))
  })

  it('keeps the outer shell out of native anchor scrolling', () => {
    const { container } = renderLayout('/')
    const main = container.querySelector('[data-role="main-content"]')

    expect(main?.parentElement).toHaveClass(
      'min-h-0',
      'min-w-0',
      'overflow-hidden',
      'supports-[overflow:clip]:overflow-clip',
    )
  })

  it('places the install affordance in the scrollable page flow, not over page content', () => {
    const { container } = renderLayout('/')
    const main = container.querySelector('[data-role="main-content"]')
    const viewport = container.querySelector('[data-role="page-viewport"]')
    const prompt = screen.getByTestId('install-prompt-stub')

    expect(main).toContainElement(prompt)
    expect(viewport).toContainElement(prompt)
    expect(prompt.nextElementSibling).not.toBeNull()
    expect(container.querySelectorAll('[data-testid="install-prompt-stub"]')).toHaveLength(1)
  })

  it('marks only drill fixture history as synthetic in standard mode', async () => {
    H.request.mockImplementation((url: unknown) =>
      url === '/vehicles'
        ? Promise.resolve([{ id: 219, vin: 'DRILL000000000001' }])
        : H.defaultReq(url),
    )
    renderLayout('/drives')
    expect(await screen.findByTestId('demo-data-notice')).toHaveTextContent('not live activity')
  })

  it('does not show a sample-data notice for ordinary vehicles', async () => {
    renderLayout('/drives')
    await waitFor(() => expect(H.request).toHaveBeenCalledWith('/vehicles', expect.anything()))
    expect(screen.queryByTestId('demo-data-notice')).not.toBeInTheDocument()
  })

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

  it('keeps vehicle scope as a single desktop instance in the command header', () => {
    renderLayout('/')
    const pickers = screen.getAllByTestId('vehicle-picker').filter(node =>
      node.closest('[data-role="workspace-header"]'))
    const mobile = document.querySelector('[data-role="mobile-workspace-controls"]')!
    expect(within(mobile as HTMLElement).getAllByTestId('vehicle-picker')).toHaveLength(1)
    // Exactly one desktop picker and one mobile picker; neither lives in navigation.
    expect(pickers).toHaveLength(1)
    const workspaceHeader = document.querySelector('[data-role="workspace-header"]')
    expect(workspaceHeader).toContainElement(pickers[0])
    expect(within(workspaceHeader as HTMLElement).getByTestId('vehicle-picker')).not.toHaveClass(
      'xl:hidden',
    )
    expect(workspaceHeader).toHaveClass('hidden', 'xl:grid')
  })

  it('renders a single analysis-window control in the command header on a range-owning route', () => {
    renderLayout('/drives')
    const controls = screen.getAllByTestId('workspace-context-control').filter(node =>
      node.closest('[data-role="workspace-header"]'))
    const mobile = document.querySelector('[data-role="mobile-workspace-controls"]')!
    expect(within(mobile as HTMLElement).getAllByTestId('workspace-context-control')).toHaveLength(1)
    // Desktop and mobile chrome each own one scope control; navigation owns none.
    expect(controls).toHaveLength(1)

    const workspaceHeader = document.querySelector('[data-role="workspace-header"]')
    expect(
      within(workspaceHeader as HTMLElement).getAllByTestId('workspace-context-control'),
    ).toHaveLength(1)
    expect(controls[0].closest('.xl\\:hidden')).toBeNull()
  })

  it('hides the analysis-window control entirely on routes that do not consume it', () => {
    renderLayout('/battery')
    expect(screen.queryAllByTestId('workspace-context-control')).toHaveLength(0)
    // Vehicle scope IS meaningful on /battery, so that control stays.
    expect(screen.getAllByTestId('vehicle-picker').length).toBeGreaterThan(0)
  })

  it('hides the vehicle picker on fleet-wide and workflow routes', () => {
    renderLayout('/settings')
    expect(screen.queryAllByTestId('vehicle-picker')).toHaveLength(0)
    expect(screen.queryAllByTestId('workspace-context-control')).toHaveLength(0)
  })

  it('re-evaluates context ownership across a route transition', () => {
    const { unmount } = renderLayout('/drives')
    expect(screen.getAllByTestId('workspace-context-control').length).toBeGreaterThan(0)
    unmount()

    renderLayout('/vehicles/42')
    // Detail route: vehicle context is implied by the URL, range is not owned.
    expect(screen.queryAllByTestId('workspace-context-control')).toHaveLength(0)
  })

  it('lets pages use the full main-column width without a centered max-width cap', () => {
    const { container } = renderLayout('/')
    const viewport = container.querySelector('[data-role="page-viewport"]')

    expect(viewport).toHaveClass('w-full')
    expect(viewport).not.toHaveClass('mx-auto', 'max-w-[1920px]')
  })

  it('switches the shell to a print-ready report view', async () => {
    H.presentation.mode = 'report'
    const { container } = renderLayout('/battery')

    expect(
      container.querySelector('[data-presentation-mode="report"]'),
    ).toBeInTheDocument()
    expect(await screen.findByTestId('report-masthead')).toBeInTheDocument()
    expect(await screen.findByTestId('presentation-overlay')).toHaveAttribute(
      'data-mode',
      'report',
    )
    expect(document.querySelector('[data-role="workspace-header"]')).toBeNull()
    expect(screen.queryByTestId('status-bar')).toBeNull()
    // The sidebar is unmounted (not merely hidden) outside standard mode.
    expect(container.querySelector('nav[data-role="sidebar"]')).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull()
    expect(container.querySelector('[data-role="page-viewport"]')).toHaveClass(
      'max-w-[1600px]',
    )
  })

  it('switches the shell to a full-viewport kiosk view', async () => {
    H.presentation.mode = 'kiosk'
    const { container } = renderLayout('/')

    expect(
      container.querySelector('[data-presentation-mode="kiosk"]'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('report-masthead')).toBeNull()
    expect(await screen.findByTestId('presentation-overlay')).toHaveAttribute(
      'data-mode',
      'kiosk',
    )
    expect(document.querySelector('[data-role="workspace-header"]')).toBeNull()
    expect(screen.queryByTestId('status-bar')).toBeNull()
    expect(container.querySelector('[data-role="page-viewport"]')).toHaveClass(
      'p-0',
    )
  })
})

// ══════════════════════════════════════════════════════════════════════
// Legacy sidebar navigation + active state
// ══════════════════════════════════════════════════════════════════════

describe('Layout — sidebar landmark', () => {
  it('exposes a labelled "Primary" navigation landmark', () => {
    renderLayout('/')
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
  })
})

// ══════════════════════════════════════════════════════════════════════
// Live badges (data-driven)
// ══════════════════════════════════════════════════════════════════════

describe('Layout — live nav badges', () => {
  const deckCounts = () =>
    H.sidebarProps.unified as unknown as {
      alertCount: number
      vehicleCount: number
      staleCount: number
    }

  it('passes the vehicle count to the deck for the "My Vehicles" badge', async () => {
    renderLayout('/vehicles')
    // VEHICLES fixture has two entries.
    await waitFor(() => expect(deckCounts().vehicleCount).toBe(2))
  })

  it('passes the unread-alert count to the deck for the inbox badge', async () => {
    renderLayout('/notifications/inbox')
    // ALERTS fixture has exactly one unread entry.
    await waitFor(() => expect(deckCounts().alertCount).toBe(1))
  })

  it('passes the durable-case count to the deck for the "Data Repair" badge', async () => {
    renderLayout('/data-repair')
    // REPAIR_STATS fixture: 1 open + 2 in review = 3.
    await waitFor(() => expect(deckCounts().staleCount).toBe(3))
  })

  it('does not run the deep stale-session diagnostic from global chrome', async () => {
    renderLayout('/')
    await waitFor(() => {
      expect(H.request).toHaveBeenCalledWith(
        '/data-repair/cases/stats',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    })
    expect(H.request).not.toHaveBeenCalledWith(
      '/data-repair/stale-sessions',
      expect.anything(),
    )
  })
})

// ══════════════════════════════════════════════════════════════════════
// Visibility predicates (isVisibleNavItem)
// ══════════════════════════════════════════════════════════════════════

describe('Layout — nav item visibility', () => {
  // Expand collection primaries exactly like the deck renders them.
  const deckPaths = () => {
    const props = H.sidebarProps.unified as unknown as {
      sections: Array<{ items: Parameters<typeof flattenSidebarItems>[0] }>
      collections: readonly SectionGroup[]
    }
    return props.sections.flatMap((section) =>
      flattenSidebarItems(section.items, props.collections).map((entry) => entry.to),
    )
  }

  it('hides requiresAuth items in open mode and reveals them under ForwardAuth', () => {
    H.forwardAuth.value = false
    const { unmount } = renderLayout('/tesla-account')
    expect(deckPaths()).not.toContain('/account/2fa')
    unmount()

    H.forwardAuth.value = true
    renderLayout('/tesla-account')
    expect(deckPaths()).toContain('/account/2fa')
  })

  it('hides minVehicles items when the fleet is too small', async () => {
    H.request.mockImplementation((url: unknown) => {
      if (url === '/vehicles') return Promise.resolve([{ id: 1 }])
      return H.defaultReq(url)
    })
    renderLayout('/vehicles')
    // With a single vehicle, "Compare Vehicles" (minVehicles: 2) stays hidden.
    await waitFor(() => {
      expect(deckPaths()).toContain('/vehicles')
    })
    expect(deckPaths()).not.toContain('/vehicle-comparison')
  })
})

// ══════════════════════════════════════════════════════════════════════
// Mobile drawer
// ══════════════════════════════════════════════════════════════════════

describe('Layout — mobile drawer', () => {
  it.each([320, 375, 390, 430])('scopes the notification target minimum to the mobile appbar at %spx', async width => {
    const previousWidth = window.innerWidth
    const media = window.matchMedia('')
    window.innerWidth = width
    vi.mocked(window.matchMedia).mockImplementation(query => ({
      ...media,
      media: query,
      matches: query === '(max-width: 640px)',
    }))
    H.request.mockImplementation((url: unknown) =>
      url === '/notifications/unread-count'
        ? Promise.resolve({ count: 7 })
        : H.defaultReq(url),
    )
    try {
      renderLayout('/')
      const header = screen.getByRole('banner', { name: 'Site header' })
      const bell = await within(header).findByRole('button', { name: '7 unread notifications' })
      const wrapper = bell.parentElement!
      // Verify actual descendant targeting; jsdom does not measure native hit areas.
      expect(wrapper).toHaveAttribute('data-role', 'notification-bell-popover')
      expect(wrapper).toHaveClass('max-md:[&>button]:min-h-11', 'max-md:[&>button]:min-w-11')
      expect(wrapper.querySelector(':scope > button')).toBe(bell)
      expect(bell).toHaveClass('h-9', 'w-9', 'p-0')
      expect(bell).toHaveAttribute('aria-expanded', 'false')
      expect(bell).toHaveTextContent('7')
      expect(bell.querySelector('span')).toHaveAttribute('aria-hidden', 'true')
      expect(bell.querySelector('svg')).toHaveClass('h-5', 'w-5')
      expect(header.querySelector('[data-role="mobile-header-actions"]')).toHaveClass('shrink-0', 'ms-auto')
      fireEvent.click(bell)
      await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/notifications/inbox'))
      expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument()
    } finally {
      window.innerWidth = previousWidth
    }
  })

  it('keeps the workspace notification bell compact and outside the mobile target override', async () => {
    const { container } = renderLayout('/')
    await waitFor(() => expect(
      container.querySelector('[data-role="workspace-header"] [data-role="notification-bell-popover"] > button'),
    ).not.toBeNull())
    const workspaceHeader = container.querySelector<HTMLElement>('[data-role="workspace-header"]')!
    const bell = within(workspaceHeader).getByRole('button', { name: 'Notifications' })
    expect(bell.parentElement).toHaveClass('relative', 'inline-block')
    expect(bell.parentElement).not.toHaveClass('max-md:[&>button]:min-h-11', 'max-md:[&>button]:min-w-11')
    expect(bell).toHaveClass('h-9', 'w-9', 'p-0')
    expect(bell).not.toHaveClass('h-11', 'w-11', 'min-h-11', 'min-w-11')
    expect(bell).toHaveAttribute('aria-expanded', 'false')
    expect(bell.querySelector('span')).not.toBeInTheDocument()
    expect(workspaceHeader).toHaveClass('hidden', 'xl:grid', 'gap-4')
  })

  it.each([
    ['ltr', 1], ['rtl', 1], ['ltr', 2], ['rtl', 2],
  ])('contains the mobile wordmark without shrinking controls (%s, scale %s)', (direction, scale) => {
    document.documentElement.setAttribute('dir', String(direction))
    const previousFontSize = document.documentElement.style.fontSize
    document.documentElement.style.fontSize = `${Number(scale) * 16}px`
    try {
      renderLayout('/')
      const header = screen.getByRole('banner', { name: 'Site header' })
      const menu = within(header).getByRole('button', { name: 'Open sidebar' })
      const headerWordmark = within(header).getByText('TeslaSync')
      const headerLogo = headerWordmark.parentElement!
      expect(headerLogo).toHaveClass('min-w-0', 'max-w-full', '[&>span]:min-w-0', '[&>span]:truncate')
      expect(headerWordmark).toBeVisible()
      expect(headerWordmark).toHaveTextContent(/^TeslaSync$/)
      expect(headerLogo.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
      expect(headerLogo.parentElement).toHaveClass('min-w-0', 'flex-1', 'basis-16')
      expect(headerLogo.parentElement).not.toHaveClass('-ml-10')
      expect(header).toHaveClass('flex-wrap', 'gap-2')
      expect(menu).toHaveClass('h-11', 'w-11', 'shrink-0', '-ms-1')
      expect(header.querySelector('[data-role="mobile-header-actions"]')).toHaveClass('shrink-0', 'ms-auto')
      expect(header).not.toHaveClass('overflow-hidden')
      expect(headerLogo).not.toHaveClass('overflow-hidden')

      fireEvent.click(menu)

      // The drawer chrome is deck-owned now: Layout hands the open state to
      // the deck and unmounts the appbar (drawer brand/close/wordmark are
      // covered by the deck scope).
      expect(deckProps().mobileBrowseOpen).toBe(true)
      expect(screen.queryByRole('banner', { name: 'Site header' })).toBeNull()
      expect(screen.getByRole('navigation', { name: 'Primary' })).toHaveClass('sidenav-host')

      act(() => {
        deckProps().onItemSelect()
      })
      expect(deckProps().mobileBrowseOpen).toBe(false)
      expect(screen.getByRole('banner', { name: 'Site header' })).toBeInTheDocument()
      expect(within(screen.getByRole('banner', { name: 'Site header' })).getByText('TeslaSync')).toBeVisible()
    } finally {
      document.documentElement.removeAttribute('dir')
      document.documentElement.style.fontSize = previousFontSize
    }
  })

  it('reserves the actual wrapped appbar height and disconnects on drawer entry', () => {
    const callbacks: ResizeObserverCallback[] = []
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { callbacks.push(callback) }
      observe = observe
      disconnect = disconnect
    })
    try {
      const { container } = renderLayout('/')
      const header = screen.getByRole('banner', { name: 'Site header' })
      const spacer = container.querySelector<HTMLElement>('[data-role="appbar-spacer"]')!
      expect(observe).toHaveBeenCalledWith(header)
      vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
        height: 196, width: 375, x: 0, y: 0, top: 0, left: 0, right: 375, bottom: 196, toJSON: () => ({}),
      })
      act(() => callbacks[0]([], {} as ResizeObserver))
      expect(spacer.style.height).toBe('196px')
      expect(spacer).toHaveClass('shrink-0', 'xl:hidden')
      fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
      expect(deckProps().mobileBrowseOpen).toBe(true)
      expect(disconnect).toHaveBeenCalledTimes(1)
      expect(spacer.style.height).toBe('')
      expect(screen.queryByRole('banner', { name: 'Site header' })).toBeNull()
      act(() => {
        deckProps().onItemSelect()
      })
      expect(deckProps().mobileBrowseOpen).toBe(false)
      expect(observe).toHaveBeenCalledTimes(2)
      expect(observe).toHaveBeenLastCalledWith(screen.getByRole('banner', { name: 'Site header' }))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it.each([false, true])('leaves drawer motion to the deck host CSS in either state (reduced motion: %s)', reduced => {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: reduced && q === '(prefers-reduced-motion: reduce)',
      media: q,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia
    renderLayout('/')
    const aside = screen.getByRole('navigation', { name: 'Primary' })
    const trigger = screen.getByRole('button', { name: 'Open sidebar' })

    // The sidebar host carries no motion classes of its own: slide/fade
    // motion (reduced-motion included) lives in sidenav.css + the deck
    // Modal, so the preference never changes Layout's output.
    expect(aside).toHaveClass('sidenav-host')
    expect(aside).not.toHaveAttribute('data-sidebar-open')
    expect(aside.className).not.toContain('transition')
    expect(aside.className).not.toContain('translate-')
    expect(aside.className).not.toContain('visible')
    expect(deckProps().mobileBrowseOpen).toBe(false)

    fireEvent.click(trigger)

    expect(deckProps().mobileBrowseOpen).toBe(true)
    // Opening changes deck props, never host classes.
    expect(aside).toHaveClass('sidenav-host')
    expect(aside.className).not.toContain('transition')
    expect(aside.className).not.toContain('translate-')
    expect(aside.className).not.toContain('visible')
    expect(screen.queryByRole('banner', { name: 'Site header' })).toBeNull()

    act(() => {
      deckProps().onItemSelect()
    })
    expect(deckProps().mobileBrowseOpen).toBe(false)
    expect(aside).toHaveClass('sidenav-host')
    expect(aside.className).not.toContain('transition')
  })

  it('moves no focus and schedules no frame on drawer open or close (focus is deck-owned)', () => {
    renderLayout('/')
    const frames = vi.fn((_callback: FrameRequestCallback) => 73)
    window.requestAnimationFrame = frames as unknown as typeof window.requestAnimationFrame
    const callsBefore = frames.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
    expect(deckProps().mobileBrowseOpen).toBe(true)
    // The appbar (and trigger) unmounts; Layout moves focus nowhere itself —
    // the deck Modal owns entry focus.
    expect(document.body).toHaveFocus()
    expect(frames.mock.calls.length).toBe(callsBefore)
    act(() => {
      deckProps().onItemSelect()
    })
    expect(deckProps().mobileBrowseOpen).toBe(false)
    expect(document.body).toHaveFocus()
    expect(frames.mock.calls.length).toBe(callsBefore)
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeInTheDocument()
  })

  it('schedules no repair frame when the drawer closes immediately after opening', () => {
    renderLayout('/')
    const frames = vi.fn((_callback: FrameRequestCallback) => 74)
    const cancels = vi.fn()
    window.requestAnimationFrame = frames as unknown as typeof window.requestAnimationFrame
    window.cancelAnimationFrame = cancels as unknown as typeof window.cancelAnimationFrame
    const callsBefore = frames.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
    expect(deckProps().mobileBrowseOpen).toBe(true)
    act(() => {
      deckProps().onItemSelect()
    })
    expect(deckProps().mobileBrowseOpen).toBe(false)
    // No focus-repair machinery remains in Layout: no frames, no cancels.
    expect(frames.mock.calls.length).toBe(callsBefore)
    expect(cancels).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeInTheDocument()
  })

  it('delegates the overlay guard to the deck: Layout inerts nothing and renders no backdrop', async () => {
    renderLayout('/')
    const main = screen.getByRole('main')
    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
    expect(deckProps().mobileBrowseOpen).toBe(true)
    // Layout neither traps focus nor hides the background — the deck Modal
    // owns the guard (focus trap, inert background, backdrop → onItemSelect).
    expect(main.closest('[inert]')).toBeNull()
    expect(screen.getByRole('main')).toBe(main)
    expect(document.querySelector('[data-sidebar-backdrop]')).toBeNull()
    expect(screen.queryByRole('banner', { name: 'Site header' })).toBeNull()

    act(() => {
      deckProps().onItemSelect()
    })
    await waitFor(() => expect(deckProps().mobileBrowseOpen).toBe(false))
    expect(screen.getByRole('banner', { name: 'Site header' })).toBeInTheDocument()
    expect(main.closest('[inert]')).toBeNull()
  })

  it('closes the drawer when the route changes', async () => {
    renderLayout('/trips', { probe: <GoToDrives /> })
    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
    expect(deckProps().mobileBrowseOpen).toBe(true)

    // Navigation supersedes the overlay even without deck cooperation.
    fireEvent.click(screen.getByRole('button', { name: 'go to drives' }))
    await waitFor(() => expect(deckProps().mobileBrowseOpen).toBe(false))
    expect(screen.getByTestId('loc')).toHaveTextContent('/drives')
    expect(screen.getByRole('banner', { name: 'Site header' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeInTheDocument()
  })

  it('provides a 44px mobile drawer trigger target', () => {
    renderLayout('/')
    const trigger = screen.getByRole('button', { name: 'Open sidebar' })
    expect(trigger).toHaveClass('h-11', 'w-11')
    fireEvent.click(trigger)
    expect(deckProps().mobileBrowseOpen).toBe(true)
    // The drawer's own close control (44px "Close" + "Hide panel") is
    // Modal/deck-owned; Layout hands off and unmounts the appbar.
    expect(screen.queryByRole('banner', { name: 'Site header' })).toBeNull()
  })

  it('does not move focus when the drawer closes over a newly focused portaled modal', async () => {
    renderLayout('/')
    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
    expect(deckProps().mobileBrowseOpen).toBe(true)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    const action = document.createElement('button')
    action.textContent = 'Dialog action'
    dialog.append(action)
    document.body.append(dialog)
    try {
      action.focus()
      act(() => {
        deckProps().onItemSelect()
      })
      await waitFor(() => expect(deckProps().mobileBrowseOpen).toBe(false))
      await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
      expect(action).toHaveFocus()
    } finally {
      dialog.remove()
    }
  })

  it('opens and closes the sidebar drawer from the mobile header controls', async () => {
    renderLayout('/')
    const aside = screen.getByRole('navigation', { name: 'Primary' })
    expect(deckProps().mobileBrowseOpen).toBe(false)
    expect(aside).not.toHaveAttribute('data-sidebar-open')
    expect(screen.getByRole('banner', { name: 'Site header' }).className).toContain('safe-area-inset-top')
    expect(document.querySelector('[data-role="appbar-spacer"]')?.className).toContain('safe-area-inset-top')

    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
    await waitFor(() => expect(deckProps().mobileBrowseOpen).toBe(true))
    expect(screen.queryByRole('banner', { name: 'Site header' })).toBeNull()

    // Escape is deck-Modal-owned: Layout neither closes nor re-opens on it.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(deckProps().mobileBrowseOpen).toBe(true)

    act(() => {
      deckProps().onItemSelect()
    })
    await waitFor(() => expect(deckProps().mobileBrowseOpen).toBe(false))
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeInTheDocument()
  })

  it('returns the mobile trigger after deck close and after navigation', async () => {
    renderLayout('/trips', { probe: <GoToDrives /> })
    const trigger = () => screen.getByRole('button', { name: 'Open sidebar' })
    // Deck-initiated close (item select, backdrop, sheet dismiss) funnels
    // through onItemSelect and restores the appbar trigger…
    fireEvent.click(trigger())
    expect(deckProps().mobileBrowseOpen).toBe(true)
    act(() => {
      deckProps().onItemSelect()
    })
    await waitFor(() => expect(deckProps().mobileBrowseOpen).toBe(false))
    expect(trigger()).toBeInTheDocument()

    // …and a route change closes the drawer even without deck cooperation.
    fireEvent.click(trigger())
    expect(deckProps().mobileBrowseOpen).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'go to drives' }))
    await waitFor(() => expect(deckProps().mobileBrowseOpen).toBe(false))
    expect(screen.getByTestId('loc')).toHaveTextContent('/drives')
    expect(trigger()).toBeInTheDocument()
  })

  it('ignores Escape for drawer state in every consumption state (deck-owned)', async () => {
    renderLayout('/')
    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
    await waitFor(() => expect(deckProps().mobileBrowseOpen).toBe(true))

    // A nested control consuming Escape…
    const main = screen.getByRole('main')
    const consumeEscape = (event: KeyboardEvent) => event.preventDefault()
    main.addEventListener('keydown', consumeEscape)
    fireEvent.keyDown(main, { key: 'Escape' })
    expect(deckProps().mobileBrowseOpen).toBe(true)

    // …and an unconsumed document-level Escape both leave Layout state alone.
    main.removeEventListener('keydown', consumeEscape)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(deckProps().mobileBrowseOpen).toBe(true)

    act(() => {
      deckProps().onItemSelect()
    })
    await waitFor(() => expect(deckProps().mobileBrowseOpen).toBe(false))
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
    expect(await within(dialog).findByTestId('theme-picker')).toBeInTheDocument()
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

  it('uses a native named navigation landmark without changing sidebar state', () => {
    renderLayout('/')
    const navigation = screen.getByRole('navigation', { name: 'Primary' })
    expect(navigation.tagName).toBe('NAV')
    expect(navigation).toHaveAttribute('data-role', 'sidebar')
    expect(navigation).not.toHaveAttribute('data-sidebar-open')
    expect(deckProps().mobileBrowseOpen).toBe(false)
    const panelOpen = deckProps().panelOpen
    // Opening the theme picker changes no sidebar state.
    fireEvent.click(screen.getAllByRole('button', { name: 'Open theme picker' })[0])
    expect(deckProps().mobileBrowseOpen).toBe(false)
    expect(deckProps().panelOpen).toBe(panelOpen)
  })

  it('moves keyboard focus into the mounted picker and restores its visible trigger on Escape', async () => {
    renderLayout('/')
    const trigger = screen.getAllByRole('button', { name: 'Open theme picker' })[0]
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Open theme picker' })
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('leaves the parent picker open when another dialog owns Escape or prevents it', async () => {
    renderLayout('/')
    fireEvent.click(screen.getAllByRole('button', { name: 'Open theme picker' })[0])
    const dialog = await screen.findByRole('dialog', { name: 'Open theme picker' })
    const child = document.createElement('div')
    child.setAttribute('role', 'dialog')
    child.setAttribute('aria-modal', 'true')
    child.tabIndex = -1
    document.body.append(child)
    try {
      child.focus()
      fireEvent.keyDown(child, { key: 'Escape' })
      expect(dialog).toBeInTheDocument()
      fireEvent.mouseDown(child)
      expect(dialog).toBeInTheDocument()
    } finally {
      child.remove()
    }
    dialog.focus()
    const preventedEscape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    preventedEscape.preventDefault()
    fireEvent(dialog, preventedEscape)
    expect(dialog).toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('closes on outside mousedown and keeps programmatic opening and resize/scroll placement', async () => {
    renderLayout('/')
    const trigger = screen.getAllByRole('button', { name: 'Open theme picker' })[0]
    const bounds = vi.spyOn(trigger, 'getBoundingClientRect')
    bounds.mockReturnValue({ top: 20, bottom: 56, left: 320, right: 356, width: 36, height: 36, x: 320, y: 20, toJSON: () => ({}) })
    trigger.focus()
    act(() => window.dispatchEvent(new Event('open-theme-popover')))
    const dialogs = await screen.findAllByRole('dialog', { name: 'Open theme picker' })
    expect(dialogs).toHaveLength(screen.getAllByRole('button', { name: 'Open theme picker' }).length)
    const dialog = dialogs.find(candidate => candidate.style.top === '64px')
    if (!dialog) throw new Error('Anchored trigger did not open its picker')
    expect(dialog.style.top).toBe('64px')
    bounds.mockReturnValue({ top: 36, bottom: 72, left: 300, right: 336, width: 36, height: 36, x: 300, y: 36, toJSON: () => ({}) })
    fireEvent.resize(window)
    expect(dialog.style.top).toBe('80px')
    bounds.mockReturnValue({ top: 40, bottom: 76, left: 300, right: 336, width: 36, height: 36, x: 300, y: 40, toJSON: () => ({}) })
    fireEvent.scroll(document)
    expect(dialog.style.top).toBe('84px')
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0))
    expect(screen.getAllByRole('button', { name: 'Open theme picker' })).toContain(document.activeElement)
    bounds.mockRestore()
  })

  it('does not restore the theme trigger after intentional Customize navigation', async () => {
    renderLayout('/')
    const trigger = screen.getAllByRole('button', { name: 'Open theme picker' })[0]
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Open theme picker' })
    const customize = within(dialog).getByRole('button', { name: 'Customize…' })
    customize.focus()
    const focus = vi.spyOn(trigger, 'focus')
    fireEvent.click(customize)
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/settings#appearance'))
    expect(focus).not.toHaveBeenCalled()
    focus.mockRestore()
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

// ══════════════════════════════════════════════════════════════════════
// Pinned / recent nav persistence: shared bus, reconciliation, no loops
// ══════════════════════════════════════════════════════════════════════

describe('reconcileNavPaths (pure)', () => {
  const catalogPaths = navSections.flatMap((s) => s.items).map((i) => i.to)

  it('keeps every path the canonical catalog still serves', () => {
    const sample = catalogPaths.slice(0, 5)
    expect(reconcileNavPaths(sample)).toEqual(sample)
  })

  it('drops paths the catalog no longer contains (dead links)', () => {
    expect(reconcileNavPaths(['/drives', '/route-removed-in-v3', '/charging'])).toEqual([
      '/drives',
      '/charging',
    ])
  })

  it('preserves order and is a no-op on an empty list', () => {
    expect(reconcileNavPaths(['/charging', '/drives'])).toEqual(['/charging', '/drives'])
    expect(reconcileNavPaths([])).toEqual([])
  })

  it('keeps visibility-gated destinations (transient state is not a dead link)', () => {
    // /vehicle-comparison is hidden below two vehicles but still exists.
    expect(reconcileNavPaths(['/vehicle-comparison'])).toEqual(['/vehicle-comparison'])
  })
})

describe('Layout — nav pin persistence', () => {
  const deckPinnedPaths = () =>
    (
      (H.sidebarProps.unified as unknown as {
        pinnedItems?: Array<{ to: string }>
      } | null)?.pinnedItems ?? []
    ).map((item) => item.to)

  function readStoredPins(): string[] | null {
    const raw = localStorage.getItem(PINNED_NAV_STORAGE_KEY)
    return raw == null ? null : (JSON.parse(raw) as string[])
  }

  it('does not re-persist the shipped defaults on first mount', () => {
    localStorage.clear()
    renderLayout('/', { defaultPins: true })

    // "Never customized" must stay that way — writing the defaults back would
    // freeze them as an explicit user list and fire the change bus on boot.
    expect(readStoredPins()).toBeNull()
    expect(deckPinnedPaths()).toEqual([...DEFAULT_PINNED_NAV_PATHS])
  })

  it('reconciles a stored dead path out of the rail and rewrites storage once', () => {
    localStorage.setItem(
      PINNED_NAV_STORAGE_KEY,
      JSON.stringify(['/drives', '/route-removed-in-v3', '/charging']),
    )
    renderLayout('/', { defaultPins: true })

    expect(deckPinnedPaths()).toEqual(['/drives', '/charging'])
    expect(readStoredPins()).toEqual(['/drives', '/charging'])
  })

  it('never re-persists an invalid stored value verbatim', () => {
    localStorage.setItem(
      PINNED_NAV_STORAGE_KEY,
      JSON.stringify(['/drives', 42, null, 'https://evil.example', '//evil.example']),
    )
    renderLayout('/', { defaultPins: true })

    expect(readStoredPins()).toEqual(['/drives'])
    expect(deckPinnedPaths()).toEqual(['/drives'])
  })

  it('does not write when the persisted value already matches state (no loop)', () => {
    localStorage.setItem(PINNED_NAV_STORAGE_KEY, JSON.stringify(['/drives', '/charging']))

    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    try {
      renderLayout('/', { defaultPins: true })
      const pinWrites = setItem.mock.calls.filter(
        ([key]) => key === PINNED_NAV_STORAGE_KEY,
      )
      expect(pinWrites).toHaveLength(0)
    } finally {
      setItem.mockRestore()
    }
    expect(readStoredPins()).toEqual(['/drives', '/charging'])
  })

  it('adopts a same-tab pin change published on the shared bus', async () => {
    localStorage.setItem(PINNED_NAV_STORAGE_KEY, JSON.stringify(['/drives']))
    renderLayout('/', { defaultPins: true })
    expect(deckPinnedPaths()).toEqual(['/drives'])

    act(() => {
      setPinnedNavPaths(['/charging', '/battery'])
    })

    await waitFor(() => {
      expect(deckPinnedPaths()).toEqual(['/charging', '/battery'])
    })
  })

  it('adopts a cross-tab pin change delivered as a storage event', async () => {
    localStorage.setItem(PINNED_NAV_STORAGE_KEY, JSON.stringify(['/drives']))
    renderLayout('/', { defaultPins: true })
    expect(deckPinnedPaths()).toEqual(['/drives'])

    act(() => {
      // Another tab wrote the key directly; only the storage event reaches us.
      localStorage.setItem(PINNED_NAV_STORAGE_KEY, JSON.stringify(['/battery', '/live']))
      window.dispatchEvent(
        new StorageEvent('storage', { key: PINNED_NAV_STORAGE_KEY }),
      )
    })

    await waitFor(() => {
      expect(deckPinnedPaths()).toEqual(['/battery', '/live'])
    })
  })

  it('reconciles a dead path pushed by another tab instead of rendering it', async () => {
    localStorage.setItem(PINNED_NAV_STORAGE_KEY, JSON.stringify(['/drives']))
    renderLayout('/', { defaultPins: true })

    act(() => {
      localStorage.setItem(
        PINNED_NAV_STORAGE_KEY,
        JSON.stringify(['/charging', '/route-removed-in-v3']),
      )
      window.dispatchEvent(
        new StorageEvent('storage', { key: PINNED_NAV_STORAGE_KEY }),
      )
    })

    await waitFor(() => {
      expect(deckPinnedPaths()).toEqual(['/charging'])
    })
    expect(readStoredPins()).toEqual(['/charging'])
  })

  it('ignores storage events for unrelated keys', async () => {
    localStorage.setItem(PINNED_NAV_STORAGE_KEY, JSON.stringify(['/drives']))
    renderLayout('/', { defaultPins: true })

    act(() => {
      localStorage.setItem(PINNED_NAV_STORAGE_KEY, JSON.stringify(['/battery']))
      window.dispatchEvent(new StorageEvent('storage', { key: 'some-other-key' }))
    })

    await waitFor(() => {
      expect(deckPinnedPaths()).toEqual(['/drives'])
    })
  })

  it('settles after a same-tab publish without a write storm', async () => {
    localStorage.setItem(PINNED_NAV_STORAGE_KEY, JSON.stringify(['/drives']))
    renderLayout('/', { defaultPins: true })

    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    try {
      act(() => {
        setPinnedNavPaths(['/charging'])
      })
      await waitFor(() => {
        expect(deckPinnedPaths()).toEqual(['/charging'])
      })
      // Exactly the one publish the test made; the subscription must not
      // bounce it back into a second write.
      const pinWrites = setItem.mock.calls.filter(
        ([key]) => key === PINNED_NAV_STORAGE_KEY,
      )
      expect(pinWrites).toHaveLength(1)
    } finally {
      setItem.mockRestore()
    }
  })

  it('keeps recent-nav paths on the same bus and reconciliation path', async () => {
    localStorage.setItem(PINNED_NAV_STORAGE_KEY, JSON.stringify([]))
    localStorage.setItem(
      RECENT_NAV_STORAGE_KEY,
      JSON.stringify(['/charging', '/route-removed-in-v3']),
    )
    renderLayout('/', { defaultPins: true })

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(RECENT_NAV_STORAGE_KEY) as string)).toEqual([
        '/charging',
      ])
    })
  })
})

describe('Layout — nav pins under a rejected write', () => {
  const deckPinnedPaths = () =>
    (
      (H.sidebarProps.unified as unknown as {
        pinnedItems?: Array<{ to: string }>
      } | null)?.pinnedItems ?? []
    ).map((item) => item.to)

  function withRejectedWrites(run: () => void) {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      const error = new Error('QuotaExceededError')
      error.name = 'QuotaExceededError'
      throw error
    }
    try {
      run()
    } finally {
      Storage.prototype.setItem = original
    }
  }

  it('keeps the published pins when persistence is rejected (no stale rollback)', async () => {
    localStorage.setItem(PINNED_NAV_STORAGE_KEY, JSON.stringify(['/drives']))
    renderLayout('/', { defaultPins: true })
    expect(deckPinnedPaths()).toEqual(['/drives'])

    act(() => {
      withRejectedWrites(() => {
        setPinnedNavPaths(['/charging', '/battery'])
      })
    })

    await waitFor(() => {
      expect(deckPinnedPaths()).toEqual(['/charging', '/battery'])
    })
    // Storage genuinely still holds the old list — the shell must not adopt it.
    expect(JSON.parse(localStorage.getItem(PINNED_NAV_STORAGE_KEY) as string)).toEqual([
      '/drives',
    ])
    await waitFor(() => {
      expect(deckPinnedPaths()).toEqual(['/charging', '/battery'])
    })
  })

  it('still reconciles dead paths out of a non-persisted payload', async () => {
    localStorage.setItem(PINNED_NAV_STORAGE_KEY, JSON.stringify(['/drives']))
    renderLayout('/', { defaultPins: true })

    act(() => {
      withRejectedWrites(() => {
        setPinnedNavPaths(['/charging', '/route-removed-in-v3'])
      })
    })

    await waitFor(() => {
      expect(deckPinnedPaths()).toEqual(['/charging'])
    })
  })

  it('does not retry a rejected write on every render', async () => {
    localStorage.setItem(PINNED_NAV_STORAGE_KEY, JSON.stringify(['/drives']))
    renderLayout('/', { defaultPins: true })

    act(() => {
      withRejectedWrites(() => {
        setPinnedNavPaths(['/charging'])
      })
    })
    await waitFor(() => {
      expect(deckPinnedPaths()).toEqual(['/charging'])
    })

    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    try {
      // Force re-renders; the shell must not hammer the exhausted quota.
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })
      await waitFor(() => {
        expect(deckPinnedPaths()).toEqual(['/charging'])
      })
      const pinWrites = setItem.mock.calls.filter(
        ([key]) => key === PINNED_NAV_STORAGE_KEY,
      )
      expect(pinWrites).toHaveLength(0)
    } finally {
      setItem.mockRestore()
    }
  })
})

describe('Layout — restrained host chrome and shared offsets', () => {
  it('uses a neutral opaque mobile header and preserves safe-area clearance', () => {
    const { container } = renderLayout('/')
    const header = container.querySelector('[data-role="appbar"]')
    expect(header).toHaveClass('bg-[var(--surface-1)]', 'xl:hidden')
    expect(header).not.toHaveClass('backdrop-blur-md', 'bg-[var(--surface-1)]/95')
    expect(header?.parentElement?.querySelector('[data-role="main-content"]')?.parentElement?.firstElementChild).toHaveClass('h-[calc(4.25rem+env(safe-area-inset-top,0px))]')
    expect(within(header as HTMLElement).getByRole('button', { name: 'Open theme picker' })).toHaveClass(
      'h-11', 'w-11', 'md:h-9', 'md:w-9',
    )
    expect(container.querySelector('[data-role="main-content"]')).toHaveClass(
      'overflow-y-auto', 'pb-[var(--shell-chrome-bottom)]',
    )
  })

  it('renders no Layout-owned drawer scrim: the overlay backdrop is deck-Modal-owned', () => {
    const { container } = renderLayout('/')
    expect(container.querySelector('[data-sidebar-backdrop]')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
    expect(deckProps().mobileBrowseOpen).toBe(true)
    // Still no Layout scrim while open — the deck Modal renders the
    // theme-neutral `bg-[var(--surface-overlay)]` backdrop (see Modal.tsx).
    expect(container.querySelector('[data-sidebar-backdrop]')).not.toBeInTheDocument()
    act(() => {
      deckProps().onItemSelect()
    })
    expect(deckProps().mobileBrowseOpen).toBe(false)
    expect(container.querySelector('[data-sidebar-backdrop]')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeInTheDocument()
  })

  it.each(['report', 'kiosk'] as const)('reserves no absent mobile header or bottom chrome in %s mode', mode => {
    H.presentation.mode = mode
    const { container } = renderLayout('/')
    expect(container.querySelector('[data-role="appbar"]')).not.toBeInTheDocument()
    expect(container.querySelector('[data-role="main-content"]')?.parentElement?.firstElementChild).toBe(
      container.querySelector('[data-role="main-content"]'),
    )
    expect(container.querySelector('[data-role="main-content"]')).not.toHaveClass(
      'pb-[var(--shell-chrome-bottom)]',
    )
    expect(document.documentElement.dataset.statusBar).toBe('off')
    expect(document.documentElement.dataset.tabBar).toBe('off')
  })
})
