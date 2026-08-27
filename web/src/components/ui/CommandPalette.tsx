import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, ArrowRight, Zap, ChevronLeft, Car, ArrowRightLeft,
  Route, BatteryCharging, Bell, BellRing, MapPin, Workflow, Compass, MapPinned,
  Bookmark, FileText, CalendarDays, X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { navSearchKeywords, navSections } from '@/components/layout/Layout'
import { useIsForwardAuth } from '@/api/hooks/useAuthMode'
import { useVehicles } from '@/api/hooks/useVehicles'
import { useVehicleCommand } from '@/api/hooks/useVehicleCommand'
import { COMMANDS, type CommandDef } from '@/features/system/commands'
import { useCommandRegistry, type ResolvedCommand } from '@/hooks/useCommandRegistry'
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle'
import { scoreCommand } from '@/lib/commandRegistry'
import { recordCommandUse, getAllCommandScores } from '@/lib/commandFrecency'
import {
  getRecentPages,
  subscribeRecentPages,
  type RecentEntry,
  type RecentPageKind,
} from '@/lib/recentPages'
import { getPinnedNavPaths, subscribeNavPins } from '@/lib/navPins'
import { getRelatedRoutes, preserveWorkspaceScope } from '@/lib/contextNavigation'
import { activateShellOverlayGuard } from '@/components/layout/shellFocusTrap'
import { useGlobalSearch } from '@/api/hooks/useSearch'
import { useAllSavedViews } from '@/api/hooks/useSavedViews'
import { useAcknowledgeAlert, useAlerts, useReopenAlert } from '@/api/hooks/useAlerts'
import { useToast } from '@/components/feedback/Toast'
import type { Alert, SearchHitType } from '@/api/types'
import { markCommandPaletteDiscovered } from '@/features/onboarding/checklist'
import {
  parsePrefix,
  getScopeMeta,
  itemMatchesScope,
  PALETTE_SCOPE_HINTS,
  type PaletteScope,
} from '@/lib/palettePrefix'

// ─── Types ──────────────────────────────────────────────────────────────────

interface PaletteItem {
  id: string
  label: string
  section: string
  icon: React.ReactNode
  action: () => void
  keywords?: string[]
  type?: 'navigate' | 'command' | 'registry' | 'vehicle-switch' | 'search-hit'
  sublabel?: string
  /** Display-only shortcut hint shown next to the item (e.g. "?" or "g d") */
  shortcut?: string
}

type PaletteMode = 'search' | 'vehicle-select' | 'alert-select'

// ─── Palette-eligible commands ──────────────────────────────────────────────

interface PaletteCommandConfig {
  defId: string
  command: string
  labelKey: string
  labelFallback: string
  keywords: string[]
  useOffIcon?: boolean
}

const PALETTE_COMMAND_CONFIGS: PaletteCommandConfig[] = [
  // Security
  { defId: 'wake_up', command: 'wake_up', labelKey: 'palette.cmd.wakeUp', labelFallback: 'Wake Up Vehicle', keywords: ['wake', 'power', 'start', 'online'] },
  { defId: 'lock', command: 'lock', labelKey: 'palette.cmd.lock', labelFallback: 'Lock Vehicle', keywords: ['lock', 'security', 'doors', 'secure'] },
  { defId: 'lock', command: 'unlock', labelKey: 'palette.cmd.unlock', labelFallback: 'Unlock Vehicle', keywords: ['unlock', 'open', 'doors'], useOffIcon: true },
  { defId: 'sentry', command: 'sentry_on', labelKey: 'palette.cmd.sentryOn', labelFallback: 'Sentry Mode On', keywords: ['sentry', 'guard', 'security', 'surveillance'] },
  { defId: 'sentry', command: 'sentry_off', labelKey: 'palette.cmd.sentryOff', labelFallback: 'Sentry Mode Off', keywords: ['sentry', 'off', 'security'] },
  // Climate
  { defId: 'climate', command: 'climate_on', labelKey: 'palette.cmd.climateOn', labelFallback: 'Climate On', keywords: ['climate', 'ac', 'heat', 'cool', 'hvac', 'temperature'] },
  { defId: 'climate', command: 'climate_off', labelKey: 'palette.cmd.climateOff', labelFallback: 'Climate Off', keywords: ['climate', 'off', 'ac', 'stop'] },
  { defId: 'dog_mode', command: 'dog_mode', labelKey: 'palette.cmd.dogMode', labelFallback: 'Dog Mode', keywords: ['dog', 'pet', 'mode', 'keep'] },
  { defId: 'camp_mode', command: 'camp_mode', labelKey: 'palette.cmd.campMode', labelFallback: 'Camp Mode', keywords: ['camp', 'camping', 'mode', 'keep'] },
  // Charging
  { defId: 'charge_port_open', command: 'charge_port_open', labelKey: 'palette.cmd.chargePortOpen', labelFallback: 'Open Charge Port', keywords: ['charge', 'port', 'open', 'plug'] },
  { defId: 'close_charge_port', command: 'close_charge_port', labelKey: 'palette.cmd.chargePortClose', labelFallback: 'Close Charge Port', keywords: ['charge', 'port', 'close'] },
  { defId: 'charge', command: 'charge_start', labelKey: 'palette.cmd.chargeStart', labelFallback: 'Start Charging', keywords: ['charge', 'start', 'begin', 'plug'] },
  { defId: 'charge', command: 'charge_stop', labelKey: 'palette.cmd.chargeStop', labelFallback: 'Stop Charging', keywords: ['charge', 'stop', 'end'] },
  { defId: 'charge_max_range', command: 'charge_max_range', labelKey: 'palette.cmd.chargeMax', labelFallback: 'Charge to Max Range', keywords: ['charge', 'max', 'range', 'trip'] },
  { defId: 'charge_standard', command: 'charge_standard', labelKey: 'palette.cmd.chargeStandard', labelFallback: 'Charge to Standard', keywords: ['charge', 'standard', 'daily'] },
  // Doors & Trunk
  { defId: 'frunk_open', command: 'frunk_open', labelKey: 'palette.cmd.frunk', labelFallback: 'Open Frunk', keywords: ['frunk', 'front', 'trunk', 'hood'] },
  { defId: 'trunk_open', command: 'trunk_open', labelKey: 'palette.cmd.trunk', labelFallback: 'Open Trunk', keywords: ['trunk', 'rear', 'boot'] },
  // Windows
  { defId: 'vent_windows', command: 'vent_windows', labelKey: 'palette.cmd.ventWindows', labelFallback: 'Vent Windows', keywords: ['vent', 'windows', 'open', 'air'] },
  { defId: 'close_windows', command: 'close_windows', labelKey: 'palette.cmd.closeWindows', labelFallback: 'Close Windows', keywords: ['close', 'windows', 'shut'] },
  // Alerts
  { defId: 'honk_horn', command: 'honk_horn', labelKey: 'palette.cmd.horn', labelFallback: 'Honk Horn', keywords: ['horn', 'honk', 'beep', 'sound'] },
  { defId: 'flash_lights', command: 'flash_lights', labelKey: 'palette.cmd.flash', labelFallback: 'Flash Lights', keywords: ['flash', 'lights', 'blink', 'find'] },
  // Media
  { defId: 'media_toggle_playback', command: 'media_toggle_playback', labelKey: 'palette.cmd.playPause', labelFallback: 'Play / Pause', keywords: ['play', 'pause', 'music', 'media'] },
  { defId: 'media_next_track', command: 'media_next_track', labelKey: 'palette.cmd.nextTrack', labelFallback: 'Next Track', keywords: ['next', 'track', 'skip', 'music'] },
  { defId: 'media_prev_track', command: 'media_prev_track', labelKey: 'palette.cmd.prevTrack', labelFallback: 'Previous Track', keywords: ['previous', 'track', 'back', 'music'] },
]

// ─── Recent commands (localStorage) ─────────────────────────────────────────
//
// Persisted across reloads via localStorage so power users see their
// workflow patterns surface to the top of the palette. Tracks every
// command type (vehicle, registry/action, navigation), not only vehicle
// commands. Stored capped at 10.
//
// The empty-query "Most Used" section is sourced from `commandFrecency`
// instead of this LRU list. The LRU helpers below stay
// exported for tests + as a backward-compatible storage primitive — every
// recorded action still writes to BOTH localStorage keys so a future feature
// can reuse the strict-recency view without re-instrumenting every callsite.

const RECENT_KEY = 'teslasync.recentCommands'
const RECENT_MAX_STORED = 10
const MOST_USED_MAX_DISPLAY = 5

export interface RecentCommandEntry {
  /** Discriminator — `vehicle` runs a vehicle command, `registry` invokes a static
   * commandRegistry entry by id, `nav` navigates to a path. */
  kind: 'vehicle' | 'registry' | 'nav'
  /** For `vehicle` — the Tesla command name (e.g. "lock", "honk_horn") */
  command?: string
  /** For `vehicle` — the target vehicle */
  vehicleId?: number
  /** For `registry` — the CommandDefinition.id */
  registryId?: string
  /** For `nav` — the route path */
  path?: string
}

function recentKey(entry: RecentCommandEntry): string {
  switch (entry.kind) {
    case 'vehicle':
      return `vehicle:${entry.command}:${entry.vehicleId}`
    case 'registry':
      return `registry:${entry.registryId}`
    case 'nav':
      return `nav:${entry.path}`
  }
}

export function getRecentCommands(): RecentCommandEntry[] {
  try {
    const stored = localStorage.getItem(RECENT_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (r): r is RecentCommandEntry =>
        r != null &&
        typeof r === 'object' &&
        (r.kind === 'vehicle' || r.kind === 'registry' || r.kind === 'nav'),
    )
  } catch {
    return []
  }
}

export function addRecentCommand(entry: RecentCommandEntry) {
  const target = recentKey(entry)
  const recent = getRecentCommands().filter((r) => recentKey(r) !== target)
  recent.unshift(entry)
  if (recent.length > RECENT_MAX_STORED) recent.length = RECENT_MAX_STORED
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
  } catch {
    /* noop — quota or disabled storage */
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Stable ids so the input can point at the highlighted row. */
const PALETTE_LISTBOX_ID = 'command-palette-listbox'

function paletteRowId(index: number): string {
  return `command-palette-option-${index}`
}

function getIconForConfig(cfg: PaletteCommandConfig, def: CommandDef): React.ReactNode {
  const IconComp = cfg.useOffIcon && def.iconOff ? def.iconOff : def.icon
  return <IconComp className="h-4 w-4" />
}

// ─── Search hit helpers ─────────────────────────────────────────────────────
//
// Shared between the live palette results and the dedicated /search page
// so type icons stay consistent across surfaces.

function searchHitIcon(type: SearchHitType): React.ReactNode {
  switch (type) {
    case 'vehicle': return <Car className="h-4 w-4" />
    case 'drive': return <Route className="h-4 w-4" />
    case 'charging': return <BatteryCharging className="h-4 w-4" />
    case 'alert': return <BellRing className="h-4 w-4" />
    case 'notification': return <Bell className="h-4 w-4" />
    case 'geofence': return <MapPinned className="h-4 w-4" />
    case 'automation': return <Workflow className="h-4 w-4" />
    case 'location': return <MapPin className="h-4 w-4" />
    case 'trip': return <Compass className="h-4 w-4" />
    default: return <Search className="h-4 w-4" />
  }
}

function searchSectionLabel(type: SearchHitType, t: TFunction): string {
  switch (type) {
    case 'vehicle': return t('search.section.vehicle', 'Vehicles')
    case 'drive': return t('search.section.drive', 'Drives')
    case 'charging': return t('search.section.charging', 'Charging')
    case 'alert': return t('search.section.alert', 'Alerts')
    case 'notification': return t('search.section.notification', 'Notifications')
    case 'geofence': return t('search.section.geofence', 'Geofences')
    case 'automation': return t('search.section.automation', 'Automations')
    case 'location': return t('search.section.location', 'Locations')
    case 'trip': return t('search.section.trip', 'Trips')
    default: return t('search.section.results', 'Results')
  }
}

// ─── Recent-page helpers ────────────────────────────────────────────────────
//
// Pages visited via React Router are written to `lib/recentPages` by the
// `RecentPagesRecorder` mounted in App.tsx. The palette surfaces the top
// MOST_USED_MAX_DISPLAY entries in a "Recent" section directly under the
// frecency-driven "Most Used" section when the input is empty. Items
// share their underlying path id so a navigation away from the palette
// re-bumps frecency in lockstep.

const RECENT_PAGES_DISPLAY_LIMIT = MOST_USED_MAX_DISPLAY

/**
 * Delay before the search input takes focus on open.
 *
 * The panel mounts behind an entrance animation; focusing synchronously fights
 * that transition and, on iOS Safari, can raise the keyboard before the panel
 * has settled. Exported so tests can advance exactly this long instead of
 * hard-coding the number.
 */
export const PALETTE_INPUT_FOCUS_DELAY_MS = 50

/**
 * `useLayoutEffect` on the client, `useEffect` on the server.
 *
 * We need commit-phase timing for the latest-callback ref, but React logs a
 * warning when `useLayoutEffect` runs during server rendering (it is a no-op
 * there). Selecting the hook by environment keeps commit-phase ordering in the
 * browser without assuming an SSR pass never happens.
 *
 * TeslaSync ships client-only today — `main.tsx` uses `createRoot` (not
 * `hydrateRoot`), the build is `tsc && vite build` with no SSR entry, and
 * sibling shared components (`Popover`, `ContextMenu`) already call
 * `useLayoutEffect` unguarded. This guard is therefore cheap insurance rather
 * than a live requirement, and is deliberately NOT unit-tested: under jsdom
 * `window` is defined, so a `renderToString` probe would exercise the client
 * branch and only assert React's own warning behaviour.
 */
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * Cap for the "Related to this page" section. Contextual links are a nudge,
 * not a second navigation tree — a long list would crowd out search results.
 */
const RELATED_ROUTES_DISPLAY_LIMIT = 4

function recentPageIcon(kind: RecentPageKind): React.ReactNode {
  switch (kind) {
    case 'vehicle': return <Car className="h-4 w-4" />
    case 'drive': return <Route className="h-4 w-4" />
    case 'charging': return <BatteryCharging className="h-4 w-4" />
    case 'trip': return <Compass className="h-4 w-4" />
    case 'geofence': return <MapPinned className="h-4 w-4" />
    case 'year-review': return <CalendarDays className="h-4 w-4" />
    default: return <FileText className="h-4 w-4" />
  }
}

function formatRecentVisitedAgo(t: TFunction, visitedAt: number, now: number): string {
  const diffMs = Math.max(0, now - visitedAt)
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return t('palette.recent.justNow', 'Just now')
  if (diffMin < 60) return t('palette.recent.minutesAgo', { count: diffMin, defaultValue: `${diffMin}m ago` })
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return t('palette.recent.hoursAgo', { count: diffHr, defaultValue: `${diffHr}h ago` })
  const diffDay = Math.floor(diffHr / 24)
  return t('palette.recent.daysAgo', { count: diffDay, defaultValue: `${diffDay}d ago` })
}

// ─── CommandPalette ─────────────────────────────────────────────────────────

interface CommandPaletteProps {
  /** Called when the palette opens — Layout uses this to close the mobile sidebar */
  onOpen?: () => void
  /** Used by the lazy host so the invocation that loaded the chunk is not lost. */
  initialOpen?: boolean
}

export function CommandPalette({ onOpen, initialOpen = false }: CommandPaletteProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(initialOpen)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [mode, setMode] = useState<PaletteMode>('search')
  const [pendingCommand, setPendingCommand] = useState<string | null>(null)
  const [recentVersion, setRecentVersion] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Latest-callback ref, same pattern as `<Modal>`'s `onCloseRef`.
  //
  // Production passes an inline arrow (`<CommandPaletteHost onOpen={() =>
  // setSidebarOpen(false)} />` in Layout), so `onOpen` gets a fresh identity on
  // EVERY Layout render — route changes, SSE alerts, live telemetry ticks,
  // notification counts. Listing it in the focus effect's dependencies made
  // that effect tear down and re-run while the palette was still open, which
  // cancelled and rescheduled the 50 ms focus timer (deferring focus
  // indefinitely under frequent renders), re-fired `onOpen`, and reset
  // `query` / `mode` / `selectedIndex` — wiping whatever the user had typed.
  //
  // Reading the callback through a ref keeps the effect keyed on `open` alone,
  // so it runs exactly once per false→true transition regardless of how often
  // the parent re-renders.
  //
  // The ref is updated in the COMMIT phase, not during render. Concurrent
  // React may start a render, abandon it, and render again with different
  // props; a render-phase assignment would leave the ref holding a callback
  // from a tree that was never committed. A layout effect runs only for
  // committed work and, critically, runs BEFORE passive effects — so the
  // focus effect below always reads the committed callback.
  const onOpenRef = useRef(onOpen)
  useIsomorphicLayoutEffect(() => {
    onOpenRef.current = onOpen
  })
  // Element that had focus when the palette opened. Restored on close so
  // keyboard users land back on the control they invoked the palette from
  // instead of at the top of the document.
  const returnFocusRef = useRef<HTMLElement | null>(null)
  // Has `onOpen` already been announced for the CURRENT open epoch?
  //
  // Under `<StrictMode>` React deliberately replays effects (setup → cleanup →
  // setup) on mount, and `<CommandPaletteHost>` mounts the palette with
  // `initialOpen`, so the opening branch runs twice for a single user-visible
  // open. The focus timer is safe to reschedule, but the callback is not
  // idempotent from the parent's point of view. This flag survives the replay
  // (a ref is not reset by an effect cleanup) and is cleared only by a
  // committed close, so exactly one notification is delivered per open epoch.
  const openNotifiedRef = useRef(false)
  // Pending delayed input-focus timer + the intent it was scheduled under.
  // Both are cleared the moment the palette stops wanting focus, so a timer
  // that is already in flight cannot resurrect it. See the focus effect below.
  const focusTimeoutRef = useRef<number | null>(null)
  const focusIntentRef = useRef(false)
  const clearPendingInputFocus = useCallback(() => {
    if (focusTimeoutRef.current != null) {
      window.clearTimeout(focusTimeoutRef.current)
      focusTimeoutRef.current = null
    }
  }, [])
  // Panel node — the focus-containment boundary for the `aria-modal` dialog.
  const panelRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()

  const { data: vehicles } = useVehicles()
  const vehicleList = vehicles ?? []
  const { data: savedViews } = useAllSavedViews()
  const savedViewList = savedViews ?? []
  const alertsQuery = useAlerts()
  const openAlertList = useMemo(
    () => (alertsQuery.data ?? []).filter((alert) => !alert.acknowledged_at),
    [alertsQuery.data],
  )
  const commandMutation = useVehicleCommand()
  const acknowledgeAlertMutation = useAcknowledgeAlert({ showSuccessToast: false })
  const reopenAlertMutation = useReopenAlert()
  const { commands: registryCommands } = useCommandRegistry()
  const { vehicleId: activeVehicleId, setVehicleId } = useSelectedVehicle()
  const toast = useToast()

  // Command def lookup (stable — COMMANDS is a module-level constant)
  const commandDefMap = useMemo(() => new Map(COMMANDS.map(c => [c.id, c])), [])

  // ── Actions ───────────────────────────────────────────────────────────────

  const close = useCallback(() => {
    setOpen(false)
    setMode('search')
    setPendingCommand(null)
  }, [])

  const goBack = useCallback(() => {
    setMode('search')
    setPendingCommand(null)
    setSelectedIndex(0)
    setQuery('')
  }, [])

  const bumpRecent = useCallback(() => setRecentVersion(v => v + 1), [])

  const go = useCallback((path: string) => {
    addRecentCommand({ kind: 'nav', path })
    recordCommandUse(path)
    bumpRecent()
    // Carry the canonical global scope (selected vehicle / analysis window)
    // onto destinations that own those controls, so a palette jump does not
    // silently reset the user's scope. Deep links and back/forward keep
    // working because the scope lives in the URL either way.
    navigate(preserveWorkspaceScope(path, location.search))
    close()
  }, [navigate, close, bumpRecent, location.search])

  const executeCommand = useCallback((command: string, vehicleId: number) => {
    commandMutation.mutate({ vehicleId, command })
    addRecentCommand({ kind: 'vehicle', command, vehicleId })
    recordCommandUse(`cmd-${command}`)
    bumpRecent()
    close()
  }, [commandMutation, close, bumpRecent])

  const selectCommand = useCallback((command: string) => {
    if (vehicleList.length === 1) {
      executeCommand(command, vehicleList[0].id)
    } else if (vehicleList.length > 1) {
      setPendingCommand(command)
      setMode('vehicle-select')
      setSelectedIndex(0)
      setQuery('')
    }
  }, [vehicleList, executeCommand])

  const selectAlertToAcknowledge = useCallback(() => {
    setMode('alert-select')
    setSelectedIndex(0)
    setQuery('')
  }, [])

  const acknowledgeAlert = useCallback((alert: Alert) => {
    acknowledgeAlertMutation.mutate(
      { id: alert.id },
      {
        onSuccess: () => {
          toast.toast({
            type: 'success',
            title: t('alerts.ack.success', 'Alert acknowledged'),
            duration: 5000,
            action: {
              label: t('alerts.ack.undo', 'Undo'),
              onClick: () => {
                reopenAlertMutation.mutate(alert.id)
              },
            },
          })
        },
      },
    )
    recordCommandUse('action.alerts.acknowledge')
    bumpRecent()
    close()
  }, [
    acknowledgeAlertMutation,
    bumpRecent,
    close,
    reopenAlertMutation,
    t,
    toast,
  ])

  const switchActiveVehicle = useCallback((id: number) => {
    setVehicleId(id)
    addRecentCommand({ kind: 'registry', registryId: `switch-vehicle-${id}` })
    recordCommandUse(`switch-vehicle-${id}`)
    bumpRecent()
    close()
  }, [setVehicleId, close, bumpRecent])

  const runRegistryCommand = useCallback((cmd: ResolvedCommand) => {
    addRecentCommand({ kind: 'registry', registryId: cmd.id })
    recordCommandUse(cmd.id)
    bumpRecent()
    void cmd.invoke()
    close()
  }, [close, bumpRecent])

  // ── Build palette items ───────────────────────────────────────────────────

  // Hide auth-gated nav items (e.g. /me/activity) from search when running in
  // open mode — same policy as the sidebar nav.
  const isForwardAuth = useIsForwardAuth()

  const navItems: PaletteItem[] = useMemo(() =>
    navSections.flatMap(section =>
      section.items
        .filter(item => !('requiresAuth' in item) || !(item as { requiresAuth?: boolean }).requiresAuth || isForwardAuth)
        .map(item => {
          const keywords = navSearchKeywords[item.to] ?? []
          const sublabel = keywords.length > 0
            ? `${section.title} · ${keywords.slice(0, 3).join(', ')}`
            : section.title
          return {
            id: item.to,
            label: item.label,
            section: t('palette.section.pages', 'Pages'),
            icon: <item.icon className="h-4 w-4" />,
            action: () => go(item.to),
            keywords,
            sublabel,
            type: 'navigate' as const,
          }
        })
    ),
  [go, t, isForwardAuth])

  // ── Pinned destinations ───────────────────────────────────────────────────
  //
  // The sidebar's "Quick access" list, mirrored into the palette so a pinned
  // page is reachable without leaving the keyboard. Backed by the same
  // `lib/navPins` storage + change bus the sidebar writes to, so pinning from
  // the sidebar updates an already-open palette. Pins that no longer resolve
  // to a visible catalog entry (route removed, auth-gated in open mode) are
  // silently dropped rather than rendering a dead row.
  useEffect(() => subscribeNavPins(() => bumpRecent()), [bumpRecent])

  const navItemByPath = useMemo(
    () => new Map(navItems.map((item) => [item.id, item])),
    [navItems],
  )

  const pinnedPageItems: PaletteItem[] = useMemo(() => {
    if (query.trim()) return []
    void recentVersion
    const sectionLabel = t('palette.section.pinned', 'Pinned')
    return getPinnedNavPaths()
      .map((path) => navItemByPath.get(path))
      .filter((item): item is PaletteItem => Boolean(item))
      .map((item) => ({
        ...item,
        // Re-key so the canonical "Pages" row keeps its own React key.
        id: `pinned-page-${item.id}`,
        section: sectionLabel,
        icon: <Bookmark className="h-4 w-4" />,
        sublabel: item.id,
      }))
  }, [navItemByPath, query, recentVersion, t])

  // ── Contextual destinations ───────────────────────────────────────────────
  //
  // "Where else can I go from here?" — derived strictly from the declared
  // route hierarchy in `lib/routeMeta` (parent + siblings under the same
  // parent). Nothing is invented: a route with no declared parent produces no
  // rows at all, so the palette never shows speculative filler.
  const relatedRouteItems: PaletteItem[] = useMemo(() => {
    if (query.trim()) return []
    const sectionLabel = t('palette.section.related', 'Related to this page')
    return getRelatedRoutes(location.pathname, { limit: RELATED_ROUTES_DISPLAY_LIMIT }).map(
      (route): PaletteItem => ({
        id: `related-route-${route.path}`,
        label: t(route.i18nKey, route.defaultLabel) as string,
        sublabel:
          route.relation === 'parent'
            ? t('palette.related.parent', 'Back to section')
            : t('palette.related.sibling', 'Same section'),
        section: sectionLabel,
        icon: <Compass className="h-4 w-4" />,
        type: 'navigate' as const,
        keywords: ['related', route.relation, route.path],
        action: () => go(route.path),
      }),
    )
  }, [go, location.pathname, query, t])

  const commandItems: PaletteItem[] = useMemo(() => {
    if (vehicleList.length === 0) return []
    const vehicleName = vehicleList.length === 1 ? (vehicleList[0].display_name || vehicleList[0].vin) : undefined
    return PALETTE_COMMAND_CONFIGS.flatMap(cfg => {
      const def = commandDefMap.get(cfg.defId)
      if (!def) return []
      const item: PaletteItem = {
        id: `cmd-${cfg.command}`,
        label: t(cfg.labelKey, cfg.labelFallback),
        section: t('palette.section.commands', 'Vehicle Commands'),
        icon: getIconForConfig(cfg, def),
        keywords: cfg.keywords,
        type: 'command',
        sublabel: vehicleName ? `→ ${vehicleName}` : t('palette.cmd.selectVehicle', 'Select vehicle…'),
        action: () => selectCommand(cfg.command),
      }
      return [item]
    })
  }, [commandDefMap, vehicleList, t, selectCommand])

  // Vehicle SWITCHING — different from vehicle COMMANDS. Renders one entry per
  // vehicle that calls setVehicleId() and stays on the current page. Hidden when
  // the fleet has only one vehicle (nothing to switch to). The currently active
  // vehicle is also hidden so the list never includes a no-op.
  const vehicleSwitchItems: PaletteItem[] = useMemo(() => {
    if (vehicleList.length < 2) return []
    return vehicleList
      .filter(v => v.id !== activeVehicleId)
      .map(v => ({
        id: `switch-vehicle-${v.id}`,
        label: t('palette.cmd.switchVehicle', { name: v.display_name || v.vin, defaultValue: `Switch to ${v.display_name || v.vin}` }),
        section: t('palette.section.vehicles', 'Vehicles'),
        icon: <ArrowRightLeft className="h-4 w-4" />,
        type: 'vehicle-switch' as const,
        sublabel: `${v.model ?? ''} · ${v.state ?? 'unknown'}`.trim(),
        keywords: ['switch', 'vehicle', 'select', v.display_name ?? '', v.vin ?? ''].filter(Boolean) as string[],
        action: () => switchActiveVehicle(v.id),
      }))
  }, [vehicleList, activeVehicleId, t, switchActiveVehicle])

  const savedViewItems: PaletteItem[] = useMemo(
    () =>
      savedViewList.map((view) => {
        const queryString = view.query.trim().replace(/^\?/, '')
        const destination = queryString
          ? `${view.route}?${queryString}`
          : view.route
        const id = `saved-view-${view.id}`
        return {
          id,
          label: view.name,
          section: t('palette.section.savedViews', 'Saved views'),
          icon: <Bookmark className="h-4 w-4" />,
          type: 'navigate' as const,
          sublabel: view.route,
          keywords: [
            'saved',
            'view',
            view.name.replace(/[-_]+/g, ' '),
            view.route,
            view.query,
            view.is_pinned ? 'pinned' : '',
            view.is_default ? 'default' : '',
          ].filter(Boolean),
          action: () => {
            recordCommandUse(id)
            go(destination)
          },
        }
      }),
    [savedViewList, t, go],
  )

  const contextualActionItems: PaletteItem[] = useMemo(
    () => [{
      id: 'action.alerts.acknowledge',
      label: t('palette.cmd.acknowledgeAlert', 'Acknowledge an alert'),
      section: t('palette.section.actions', 'Actions'),
      icon: <BellRing className="h-4 w-4" />,
      type: 'registry',
      sublabel: t('palette.acknowledgeAlert.hint', 'Choose from recent open alerts'),
      keywords: ['acknowledge', 'alert', 'open', 'resolve', 'triage', 'respond'],
      action: selectAlertToAcknowledge,
    }],
    [selectAlertToAcknowledge, t],
  )

  // Static registry: theme, refresh, navigate-to-feature, etc. Keep them in
  // their own section so power users can scan for "preferences" and "actions".
  const registryItems: PaletteItem[] = useMemo(() =>
    registryCommands.map(c => {
      const sectionLabel = c.section === 'preferences'
        ? t('palette.section.preferences', 'Preferences')
        : c.section === 'actions'
          ? t('palette.section.actions', 'Actions')
          : c.section === 'pages'
            ? t('palette.section.pages', 'Pages')
            : t('palette.section.vehicles', 'Vehicles')
      const Icon = c.icon
      return {
        id: c.id,
        label: c.label,
        section: sectionLabel,
        icon: <Icon className="h-4 w-4" />,
        keywords: c.keywords,
        shortcut: c.shortcut,
        type: 'registry' as const,
        action: () => runRegistryCommand(c),
      }
    }),
  [registryCommands, t, runRegistryCommand])

  // ── Most-used items ───────────────────────────────────────────────────────
  //
  // Empty-query view: surface a user's frecency-ranked top commands at the
  // top of the palette. Replaces the strict-LRU "Recent" section so a user
  // who runs "Open Drives" three times a day sees it first even after a
  // single one-off "Open Settings" click. Falls back to nothing (just the
  // categorized list) when no commands have been recorded yet — a fresh
  // install gets the original alphabetical-by-section experience.
  //
  // We pull from the static catalog (registry / nav / vehicle-switch /
  // command) rather than re-deriving keys from the frecency store, because
  // the store only knows ids — we need labels, icons, and actions to render.
  // Unmatched ids (e.g. removed nav entries from a previous version) are
  // silently dropped.
  const mostUsedItems: PaletteItem[] = useMemo(() => {
    if (query.trim()) return []
    void recentVersion
    const candidates: PaletteItem[] = [
      ...registryItems,
      ...vehicleSwitchItems,
      ...savedViewItems,
      ...contextualActionItems,
      ...navItems,
      ...commandItems,
    ]
    const scores = getAllCommandScores()
    const ranked = candidates
      .map(item => ({ item, score: scores[item.id] ?? 0 }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MOST_USED_MAX_DISPLAY)
    const sectionLabel = t('palette.section.mostUsed', 'Most Used')
    return ranked.map(({ item }): PaletteItem => ({
      ...item,
      // Re-key so React doesn't see the same id twice (the underlying item
      // also appears in its own native section below).
      id: `most-used-${item.id}`,
      section: sectionLabel,
    }))
  }, [
    query,
    recentVersion,
    registryItems,
    vehicleSwitchItems,
    savedViewItems,
    contextualActionItems,
    navItems,
    commandItems,
    t,
  ])

  // ── Recent pages ──────────────────────────────────────────────────────────
  //
  // Surfaces the user's most recently visited routes when the input is
  // empty. Distinct from "Most Used" — that ranks by frecency of *actions*
  // (palette commands, theme toggles, registry items); this one is a
  // strict-recency view of *navigation*. The two complement each other:
  // a power user who runs "Toggle theme" five times this week still wants
  // their last-opened drive one click away.
  //
  // We bump `recentVersion` whenever the lib's same-tab/cross-tab event
  // bus fires, so an active palette refreshes the list as the user
  // navigates through the underlying app (e.g. via the sidebar) without
  // closing the palette.
  useEffect(() => {
    return subscribeRecentPages(() => bumpRecent())
  }, [bumpRecent])

  const recentPageItems: PaletteItem[] = useMemo(() => {
    if (query.trim()) return []
    void recentVersion
    const now = Date.now()
    const sectionLabel = t('palette.section.recent', 'Recent')
    return getRecentPages(RECENT_PAGES_DISPLAY_LIMIT).map(
      (entry: RecentEntry): PaletteItem => ({
        // Prefix the path so this row never collides with the matching
        // nav/registry entry that may also be in `allItems`. Same trick
        // as `most-used-…` above.
        id: `recent-page-${entry.path}`,
        label: entry.title,
        sublabel: formatRecentVisitedAgo(t, entry.visited_at, now),
        section: sectionLabel,
        icon: recentPageIcon(entry.kind),
        type: 'navigate' as const,
        keywords: [entry.path, entry.kind],
        action: () => go(entry.path),
      }),
    )
  }, [query, recentVersion, t, go])

  // ── Vehicle selector items ────────────────────────────────────────────────

  const vehicleItems: PaletteItem[] = useMemo(() =>
    vehicleList.map(v => ({
      id: `vehicle-${v.id}`,
      label: v.display_name || v.vin,
      section: t('palette.section.selectVehicle', 'Select Vehicle'),
      icon: <Car className="h-4 w-4" />,
      type: 'navigate' as const,
      sublabel: `${v.model ?? ''} · ${v.state ?? 'unknown'}`.trim(),
      action: () => { if (pendingCommand) executeCommand(pendingCommand, v.id) },
    })),
  [vehicleList, pendingCommand, executeCommand, t])

  const alertItems: PaletteItem[] = useMemo(
    () =>
      openAlertList.map((alert) => ({
        id: `acknowledge-alert-${alert.id}`,
        label: alert.title?.trim() || t('operations.alerts.untitled', 'Untitled alert'),
        section: t('palette.section.openAlerts', 'Open alerts'),
        icon: <BellRing className="h-4 w-4" />,
        type: 'command' as const,
        sublabel: [alert.severity, alert.message].filter(Boolean).join(' · '),
        keywords: [alert.type, alert.severity, alert.message].filter(Boolean),
        action: () => acknowledgeAlert(alert),
      })),
    [acknowledgeAlert, openAlertList, t],
  )

  // ── Live entity search ────────────────────────────────────────────────────
  //
  // Debounce by 200 ms so each keystroke does not fan out to the backend's
  // ~9 ILIKE sub-queries. The hook itself enforces the >= 2 char floor.

  // Parse a recognized scope prefix off the front of the query. When a scope
  // is active, the palette restricts results to items whose `type` belongs to
  // that scope (e.g. ">" → only `command`-typed items). The remainder of the
  // query is the actual search term passed to the scorer + debounced search.
  const parsedQuery = useMemo(() => parsePrefix(query), [query])
  const activeScope: PaletteScope | null = parsedQuery.scope
  const scopedTerm = parsedQuery.term

  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    // Use the *scoped* term so a prefix like "/" doesn't get sent to the
    // backend search endpoint as part of the query string.
    const trimmed = scopedTerm.trim()
    if (trimmed.length === 0) {
      setDebouncedQuery('')
      return
    }
    const handle = window.setTimeout(() => setDebouncedQuery(trimmed), 200)
    return () => window.clearTimeout(handle)
  }, [scopedTerm])

  const { data: searchData } = useGlobalSearch(debouncedQuery, {
    // When a scope is active the search hits are filtered out anyway —
    // skip the network round-trip entirely.
    disabled: mode !== 'search' || activeScope !== null,
    limit: 5,
  })

  const searchResultItems: PaletteItem[] = useMemo(() => {
    const hits = searchData?.hits ?? []
    if (hits.length === 0) return []
    return hits.map((hit): PaletteItem => ({
      id: `search-${hit.type}-${hit.id}`,
      label: hit.title,
      sublabel: hit.subtitle,
      section: searchSectionLabel(hit.type, t),
      icon: searchHitIcon(hit.type),
      type: 'search-hit',
      action: () => go(hit.url),
    }))
  }, [searchData, t, go])

  const showViewAllResults = (searchData?.hits?.length ?? 0) > 0 && debouncedQuery.length >= 2

  // ── Filtered items ────────────────────────────────────────────────────────
  //
  // Order matters — recents render first when no query, registry/vehicles
  // surface above the long nav list when the query matches them, and the
  // PALETTE_COMMAND_CONFIGS items stay at the bottom (long list).
  //
  // `recentPageItems` slots in directly after `mostUsedItems`. Both are
  // empty when a query is present, so the
  // ordering is irrelevant during search; it only matters in the empty
  // state, where the user sees Most Used → Recent → Pages → … .

  const allItems = useMemo(
    () => [
      ...searchResultItems,
      ...mostUsedItems,
      ...pinnedPageItems,
      ...relatedRouteItems,
      ...recentPageItems,
      ...savedViewItems,
      ...contextualActionItems,
      ...registryItems,
      ...vehicleSwitchItems,
      ...navItems,
      ...commandItems,
    ],
    [
      searchResultItems,
      mostUsedItems,
      pinnedPageItems,
      relatedRouteItems,
      recentPageItems,
      savedViewItems,
      contextualActionItems,
      registryItems,
      vehicleSwitchItems,
      navItems,
      commandItems,
    ],
  )

  const filtered = useMemo(() => {
    // First narrow by scope (if any). Without an active scope this is a no-op.
    const scopedItems = activeScope === null
      ? allItems
      : allItems.filter(cmd => itemMatchesScope(cmd.type, activeScope))

    // Empty term: show every item in the scope (or every item if no scope).
    // Server search hits are kept out of unscoped empty-query results too —
    // that path was already empty-string-keyed in `useGlobalSearch`.
    if (!scopedTerm.trim()) return scopedItems
    // Frecency snapshot used as a tiebreaker — among items with identical
    // match scores, the more frecent one ranks higher. We read once per
    // query change, not per item, to avoid N localStorage hits.
    void recentVersion
    const frecencyScores = getAllCommandScores()
    // Score every item with the same fuzzy matcher used for registry commands
    // so "btr" matches "Battery Health" via subsequence, not just substring.
    const scored = scopedItems
      .map(cmd => {
        // Server-ranked entity hits skip local filtering — the backend
        // already matched on the user's query and computed scores per
        // entity. Pinning them at a high pseudo-score keeps Results above
        // the static items inside groupedItems while remaining in their
        // own per-type sections.
        if (cmd.type === 'search-hit') return { cmd, score: 9999, frecency: 0 }
        // Score the label once, with keywords passed in. scoreCommand already
        // handles label tiers (1000/501+/200+/150) AND keyword tiers (100/50)
        // AND label-subsequence (25) in the right order. Iterating over each
        // keyword as if it were the label inflated keyword matches to label
        // tiers — e.g. a keyword "debugger" matched query "d" via label
        // startsWith → 501, tying with the real "Drives" label and pushing
        // unrelated items (State Machine, Theme: Dark) ahead of true label
        // matches. See commandRegistry.test.ts "label prefix outranks
        // keyword prefix".
        let best = scoreCommand(scopedTerm, cmd.label, cmd.keywords)
        // Sublabel/section as a lighter substring fallback
        if (best === 0) {
          const q = scopedTerm.toLowerCase()
          if ((cmd.sublabel ?? '').toLowerCase().includes(q)) best = 10
          else if (cmd.section.toLowerCase().includes(q)) best = 5
        }
        // Most-used items carry a `most-used-`-prefixed id; look up the
        // underlying id for frecency so duplicate display variants stay in
        // sync with their canonical entries.
        const lookupId = cmd.id.startsWith('most-used-') ? cmd.id.slice('most-used-'.length) : cmd.id
        const frecency = frecencyScores[lookupId] ?? 0
        return { cmd, score: best, frecency }
      })
      .filter(s => s.score > 0)
      .sort((a, b) => (b.score - a.score) || (b.frecency - a.frecency))
    return scored.map(s => s.cmd)
  }, [allItems, activeScope, scopedTerm, recentVersion])

  const displayItems =
    mode === 'vehicle-select'
      ? vehicleItems
      : mode === 'alert-select'
        ? alertItems
        : filtered

  // Stable semantic key over the visible items. `displayItems` is a fresh
  // ternary on every render — even when its underlying memoised value is
  // unchanged the array IDENTITY churns, so resetting selectedIndex on
  // [displayItems] would fire continuously and the user could never
  // navigate past row 0 (regression observed in prod 2026-05-10). We
  // collapse the visible set into a single string so React's Object.is
  // sees a stable value while contents are stable.
  const displayItemIdsKey = useMemo(
    () => displayItems.map(item => item.id).join('\u0000'),
    [displayItems],
  )

  // Clamp the rendered/selected index against the actual list length so
  // it stays in-range even if the list shrunk after a state update.
  const effectiveSelectedIndex =
    displayItems.length > 0 ? Math.min(selectedIndex, displayItems.length - 1) : 0

  // ── Effects ───────────────────────────────────────────────────────────────

  // Reset selection only on semantic changes — typing/clearing the query,
  // entering/leaving vehicle-select mode, or the visible item set actually
  // changing (id-equality, not reference-equality). This avoids the
  // "ArrowDown does nothing" bug where a render-time array reference
  // change would otherwise undo the user's navigation.
  useEffect(() => { setSelectedIndex(0) }, [query, mode, displayItemIdsKey])

  // Esc closes the palette (or pops a contextual selection mode). Esc fires from
  // anywhere — closing modals from inside an input is expected, and the
  // palette's own input is the most common Esc target.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl+K is owned by useKeyboardShortcuts (mounted in Layout) which
      // dispatches the `toggle-command-palette` custom event. Listening for
      // Ctrl+K here as well caused the palette to toggle twice on a single
      // keypress (open → immediately close), so this branch was removed.
      // See the `toggle-command-palette` listener below for the real wiring.
      if (e.key === 'Escape') {
        if (mode !== 'search') {
          goBack()
        } else if (open && activeScope !== null) {
          // First ESC with an active scope clears the scope chip + term so
          // the user lands back on the unfiltered palette. A second ESC
          // closes the palette outright.
          setQuery('')
          setSelectedIndex(0)
        } else {
          setOpen(false)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mode, goBack, open, activeScope])

  // useKeyboardShortcuts dispatches this custom event when the user presses
  // Ctrl+K outside a form field. Listening here keeps the palette in sync
  // with the global shortcut layer without duplicating focus rules.
  useEffect(() => {
    function handleToggle() { setOpen(prev => !prev) }
    window.addEventListener('toggle-command-palette', handleToggle as EventListener)
    return () => window.removeEventListener('toggle-command-palette', handleToggle as EventListener)
  }, [])

  // Focus input when opened; close sidebar on mobile. On close, focus returns
  // to whatever owned it before the palette took over (the header trigger, a
  // page action, …) so keyboard and screen-reader users never lose their place.
  //
  // The input focus is DELAYED (the panel mounts behind an entrance
  // animation), which opens a race: a user who hits Escape — or clicks the
  // backdrop — within that window would get their trigger focus restored, and
  // then the stale timer would yank focus straight back into a palette that is
  // already closing. `AnimatePresence` keeps the panel (and the input) mounted
  // through the exit transition, so `inputRef.current` is still a live,
  // connected node at that point and the steal really does happen.
  //
  // Three guards close it: the timer id is stored and cleared by the effect
  // cleanup (so a close, a re-open, or an unmount all cancel it), an intent
  // flag is cleared on close, and the callback itself re-checks that the
  // palette still wants focus and that the input is still connected.
  //
  // The `onOpen` notification is separately guarded by `openNotifiedRef` so a
  // StrictMode effect replay (or any other repeated setup for the same open
  // epoch) announces the open exactly once. Rescheduling the focus timer on
  // replay is harmless; telling the parent twice is not.
  useEffect(() => {
    clearPendingInputFocus()

    if (open) {
      const active = document.activeElement
      if (
        active instanceof HTMLElement &&
        active !== document.body &&
        !active.closest('[data-role="command-palette"]')
      ) {
        returnFocusRef.current = active
      }
      // First-open instrumentation marks the "try-command-palette"
      // onboarding-checklist task as complete the moment
      // the user discovers the palette. Idempotent — only writes the flag the
      // first time, so subsequent opens are a no-op.
      markCommandPaletteDiscovered()
      setQuery('')
      setSelectedIndex(0)
      setMode('search')
      setPendingCommand(null)
      if (!openNotifiedRef.current) {
        openNotifiedRef.current = true
        onOpenRef.current?.()
      }
      focusIntentRef.current = true
      focusTimeoutRef.current = window.setTimeout(() => {
        focusTimeoutRef.current = null
        if (!focusIntentRef.current) return
        const input = inputRef.current
        if (!input || !input.isConnected) return
        input.focus()
      }, PALETTE_INPUT_FOCUS_DELAY_MS)
      return clearPendingInputFocus
    }

    // Committed close ends the epoch: the next open is a new one and must
    // notify again.
    openNotifiedRef.current = false
    focusIntentRef.current = false
    const target = returnFocusRef.current
    returnFocusRef.current = null
    if (target && target.isConnected) {
      target.focus({ preventScroll: true })
    }
    return undefined
    // Keyed on `open` (plus a stable clearer) ONLY — see `onOpenRef` above for
    // why the callback must not be a dependency.
  }, [open, clearPendingInputFocus])

  // `aria-modal="true"` is only truthful when the rest of the page is actually
  // unreachable. The palette is not portaled to <body>, so we lean on the
  // shared shell guard: Tab / Shift+Tab wrap inside the panel, and every
  // ancestor-sibling outside the overlay is marked inert + aria-hidden while
  // it is open. The guard deliberately does NOT move or restore focus — the
  // effect above owns both, so focus return happens exactly once.
  //
  // The backdrop shares `data-role="command-palette"` with the positioner and
  // is exempted from inerting, otherwise `inert` would swallow the
  // click-outside-to-close gesture.
  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return
    return activateShellOverlayGuard({
      focusContainer: panel,
      backgroundAnchor: panel,
      isOwnRoot: (element) => element.getAttribute('data-role') === 'command-palette',
    })
  }, [open])

  // Keyboard nav within palette
  function handleInputKey(e: React.KeyboardEvent) {
    const maxIndex = displayItems.length - 1
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (maxIndex >= 0) {
        setSelectedIndex(prev => Math.min(Math.min(prev, maxIndex) + 1, maxIndex))
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (maxIndex >= 0) {
        setSelectedIndex(prev => Math.max(Math.min(prev, maxIndex) - 1, 0))
      }
    } else if (e.key === 'Home' && maxIndex >= 0) {
      e.preventDefault()
      setSelectedIndex(0)
    } else if (e.key === 'End' && maxIndex >= 0) {
      e.preventDefault()
      setSelectedIndex(maxIndex)
    } else if (e.key === 'Enter' && displayItems[effectiveSelectedIndex]) {
      e.preventDefault()
      displayItems[effectiveSelectedIndex].action()
    } else if (e.key === 'Backspace' && query === '' && mode !== 'search') {
      e.preventDefault()
      goBack()
    } else if (e.key === 'Backspace' && activeScope !== null && scopedTerm === '' && mode === 'search') {
      // When the scope chip is the only thing in the input, Backspace clears
      // the chip — same behaviour as removing a token from a tag input.
      e.preventDefault()
      setQuery('')
      setSelectedIndex(0)
    }
  }

  // Scroll selected into view. Uses data-palette-row so we can target the
  // actual button across section-grouped DOM (children of `listRef.current`
  // are section group <div>s, NOT individual rows). Re-runs when the
  // visible items change too, in case the row at `effectiveSelectedIndex`
  // shifted out of view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-palette-row="${effectiveSelectedIndex}"]`,
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [effectiveSelectedIndex, displayItemIdsKey])

  // ── Helpers ───────────────────────────────────────────────────────────────

  const pendingCommandLabel = useMemo(() => {
    if (!pendingCommand) return ''
    const cfg = PALETTE_COMMAND_CONFIGS.find(c => c.command === pendingCommand)
    return cfg ? t(cfg.labelKey, cfg.labelFallback) : pendingCommand
  }, [pendingCommand, t])

  // Group items by section for display. Each group also carries an index so
  // we can build a stable React key — the same section can appear more than
  // once when items of one section are interleaved with another by ranking
  // (e.g. "Most Used" then "Pages" then more "Pages" further down). Using
  // section name alone as a key triggers React's duplicate-key warning.
  const groupedItems = useMemo(() => {
    const groups: { section: string; items: { item: PaletteItem; globalIndex: number }[] }[] = []
    let currentSection = ''
    displayItems.forEach((item, i) => {
      if (item.section !== currentSection) {
        currentSection = item.section
        groups.push({ section: currentSection, items: [] })
      }
      groups[groups.length - 1].items.push({ item, globalIndex: i })
    })
    return groups
  }, [displayItems])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            data-role="command-palette"
            // Not migrated to <Modal>: the command palette is its own
            // keyboard-driven primitive
            // with custom search behavior, multi-mode navigation, and a
            // distinct visual treatment (top-anchored card, not centered
            // dialog). New interactive dialogs MUST use <Modal>.
            // eslint-disable-next-line no-restricted-syntax
            className="fixed inset-0 z-[200] bg-[var(--bg-app)] backdrop-blur-sm dark:bg-[var(--surface-overlay)]"
            onClick={close}
          />
          <div
            data-command-palette-positioner
            // Viewport-centered at EVERY width and zoom level. The palette
            // deliberately does NOT offset by the sidebar width: that made the
            // panel jump horizontally the moment the `xl` breakpoint flipped
            // (browser zoom changes the CSS viewport, so zooming alone moved
            // the panel). `inset-0` + `overflow-y-auto` also keeps the whole
            // panel reachable at 200% zoom instead of clipping past the fold.
            //
            // Phase-45 / Prompt 04: NOT migrated to <Modal>. The palette is a
            // keyboard-driven system overlay with its own combobox/listbox
            // semantics and top-anchored geometry; <Modal> centres and traps
            // differently. The backdrop above is the click-out surface.
            // eslint-disable-next-line no-restricted-syntax
            className="pointer-events-none fixed inset-0 z-[201] flex items-start justify-center overflow-y-auto px-4 py-[max(2rem,8vh)]"
          >
            <motion.div
              ref={panelRef}
              initial={{ opacity: 0, scale: 0.95, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -20 }}
              transition={{ type: 'spring', bounce: 0.15, duration: 0.3 }}
              data-role="command-palette"
              data-command-palette-panel
              className="pointer-events-auto w-full max-w-lg"
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label={t('palette.dialogLabel', 'Command palette')}
                className="flex max-h-[84vh] flex-col overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--surface-1)] text-[var(--text-primary)] shadow-2xl backdrop-blur-xl"
              >
              {/* Search input / contextual selection header */}
              <div className="flex shrink-0 items-center gap-3 border-b border-[var(--glass-border)] px-5 py-4">
                {mode !== 'search' ? (
                  <>
                    <button
                      type="button"
                      onClick={goBack}
                      aria-label={t('palette.back', 'Back')}
                      className="flex-shrink-0 rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
                    >
                      <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                    </button>
                    <div className="flex-1 flex items-center gap-2">
                      {mode === 'vehicle-select'
                        ? <Zap className="h-4 w-4 text-[var(--theme-primary)]" aria-hidden="true" />
                        : <BellRing className="h-4 w-4 text-[var(--theme-primary)]" aria-hidden="true" />}
                      <span className="text-sm text-[var(--text-secondary)]">
                        {mode === 'vehicle-select'
                          ? t('palette.selectVehicleFor', { command: pendingCommandLabel, defaultValue: `Send "${pendingCommandLabel}" to…` })
                          : t('palette.acknowledgeAlert.select', 'Choose an open alert to acknowledge')}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <Search className="h-5 w-5 flex-shrink-0 text-[var(--text-muted)]" />
                    {activeScope !== null && (
                      <button
                        type="button"
                        onClick={() => {
                          setQuery('')
                          setSelectedIndex(0)
                          inputRef.current?.focus()
                        }}
                        aria-label={t('palette.clearScope', { scope: getScopeMeta(activeScope).label, defaultValue: `Clear ${getScopeMeta(activeScope).label} filter` })}
                        className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[rgba(var(--theme-primary-rgb),0.25)] bg-[rgba(var(--theme-primary-rgb),0.10)] px-2 py-1 text-xs font-medium text-[var(--theme-primary)] hover:bg-[rgba(var(--theme-primary-rgb),0.18)] transition-colors"
                        data-palette-scope-chip={activeScope}
                      >
                        <span className="font-mono">{getScopeMeta(activeScope).prefix}</span>
                        <span>{t(`palette.scope.${activeScope}`, getScopeMeta(activeScope).label)}</span>
                        <X className="h-3 w-3 opacity-70" aria-hidden />
                      </button>
                    )}
                    <div className="flex-1">
                      <Input
                        ref={inputRef}
                        role="combobox"
                        aria-expanded
                        aria-controls={PALETTE_LISTBOX_ID}
                        aria-autocomplete="list"
                        aria-activedescendant={
                          displayItems.length > 0
                            ? paletteRowId(effectiveSelectedIndex)
                            : undefined
                        }
                        value={scopedTerm}
                        onChange={e => {
                          const next = e.target.value
                          if (activeScope === null) {
                            setQuery(next)
                          } else {
                            // Keep the chip visible by reconstructing the
                            // raw query with the active prefix in front.
                            setQuery(`${getScopeMeta(activeScope).prefix} ${next}`)
                          }
                        }}
                        onKeyDown={handleInputKey}
                        placeholder={
                          activeScope !== null
                            ? t(`palette.placeholder.${activeScope}`, getScopeMeta(activeScope).placeholder)
                            : t('palette.placeholder', 'Search pages, commands…')
                        }
                        className="!rounded-none !border-0 !bg-transparent !p-0 text-sm text-[var(--text-primary)] !shadow-none !ring-0 placeholder:text-[var(--text-muted)]"
                      />
                    </div>
                    <kbd className="hidden items-center gap-1 rounded-lg border border-[var(--glass-border)] bg-[var(--surface-2)] px-2 py-1 font-mono text-2xs text-[var(--text-muted)] sm:flex">
                      ESC
                    </kbd>
                  </>
                )}
              </div>

              {/* Results */}
              <div
                ref={listRef}
                id={PALETTE_LISTBOX_ID}
                role="listbox"
                tabIndex={-1}
                aria-label={t('palette.resultsLabel', 'Results')}
                className="max-h-80 min-h-0 overflow-y-auto px-2 py-2"
                onKeyDown={mode !== 'search' ? handleInputKey : undefined}
              >
                {displayItems.length === 0 ? (
                  <div className="py-8 text-center text-sm text-[var(--text-muted)]">
                    {mode === 'vehicle-select'
                      ? t('palette.noVehicles', 'No vehicles available')
                      : mode === 'alert-select'
                        ? alertsQuery.isLoading
                          ? t('palette.acknowledgeAlert.loading', 'Loading open alerts…')
                          : alertsQuery.isError
                            ? t('palette.acknowledgeAlert.error', 'Open alerts are unavailable right now')
                            : t('palette.acknowledgeAlert.empty', 'No open alerts to acknowledge')
                      : activeScope !== null && !scopedTerm
                        ? t(`palette.scope.${activeScope}.empty`, {
                            scope: getScopeMeta(activeScope).label,
                            defaultValue: `No ${getScopeMeta(activeScope).label.toLowerCase()} available`,
                          })
                        : t('palette.noResults', { query: scopedTerm || query, defaultValue: `No results for "${scopedTerm || query}"` })
                    }
                  </div>
                ) : (
                  groupedItems.map((group, groupIndex) => (
                    <div key={`${group.section}-${groupIndex}`} role="group" aria-label={group.section}>
                      <div className="px-4 pt-3 pb-1 text-2xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                        {group.section}
                      </div>
                      {group.items.map(({ item, globalIndex }) => {
                        const isCommand = item.type === 'command'
                        const isSelected = globalIndex === effectiveSelectedIndex
                        return (
                          <button
                            key={item.id}
                            id={paletteRowId(globalIndex)}
                            role="option"
                            type="button"
                            // Options are NOT in the tab order: the ARIA
                            // combobox pattern navigates them with Arrow keys
                            // via `aria-activedescendant`. Keeping them
                            // tabbable would also make Tab cycle through
                            // dozens of rows inside the focus trap.
                            tabIndex={-1}
                            data-palette-row={globalIndex}
                            data-palette-selected={isSelected || undefined}
                            aria-selected={isSelected}
                            aria-current={isSelected || undefined}
                            onClick={item.action}
                            onMouseEnter={() => setSelectedIndex(globalIndex)}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition-colors min-h-[44px]',
                              isSelected
                                ? 'bg-[rgba(var(--theme-primary-rgb),0.10)] text-[var(--text-primary)] ring-1 ring-[rgba(var(--theme-primary-rgb),0.18)]'
                                : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]'
                            )}
                          >
                            <span className={cn(
                              'flex-shrink-0',
                              isCommand
                                ? isSelected ? 'text-[var(--theme-primary)]' : 'text-[var(--theme-primary)] opacity-70'
                                : isSelected ? 'text-[var(--theme-primary)]' : 'text-[var(--text-muted)]'
                            )}>
                              {item.icon}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium truncate">{item.label}</span>
                                {isCommand && (
                                  <Zap className="h-3 w-3 flex-shrink-0 text-[var(--theme-primary)] opacity-70" />
                                )}
                              </div>
                              {item.sublabel && (
                                <span className="block truncate text-xs text-[var(--text-muted)]">
                                  {item.sublabel}
                                </span>
                              )}
                            </div>
                            {item.shortcut && (
                              <kbd
                                aria-label={t('palette.shortcut', { keys: item.shortcut, defaultValue: `Shortcut: ${item.shortcut}` })}
                                className="hidden flex-shrink-0 rounded-md border border-[var(--glass-border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-2xs text-[var(--text-muted)] sm:inline-flex"
                              >
                                {item.shortcut}
                              </kbd>
                            )}
                            {isSelected && (
                              <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-[var(--theme-primary)]" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  ))
                )}
                {showViewAllResults && mode === 'search' && (
                  <div className="border-t border-[var(--glass-border)] mt-1 pt-2">
                    <button
                      onClick={() => go(`/search?q=${encodeURIComponent(debouncedQuery)}`)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-2 text-left text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
                    >
                      <span className="flex items-center gap-2">
                        <Search className="h-3.5 w-3.5" />
                        {t('search.palette.viewAll', { query: debouncedQuery, defaultValue: `View all results for "${debouncedQuery}"` })}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="shrink-0 border-t border-[var(--glass-border)] px-5 py-3 text-2xs text-[var(--text-muted)]">
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="flex items-center gap-1">
                    <kbd className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono">↑↓</kbd> {t('palette.navigate', 'Navigate')}
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono">↵</kbd> {t('palette.select', 'Select')}
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono">ESC</kbd>{' '}
                    {mode !== 'search'
                      ? t('palette.back', 'Back')
                      : activeScope !== null
                        ? t('palette.clearFilter', 'Clear filter')
                        : t('palette.close', 'Close')}
                  </span>
                  {mode === 'search' && vehicleList.length > 0 && (
                    <span className="ml-auto flex items-center gap-1 text-[var(--theme-primary)]">
                      <Zap className="h-3 w-3" /> {vehicleList.length} {vehicleList.length === 1 ? t('palette.vehicle', 'vehicle') : t('palette.vehicles', 'vehicles')}
                    </span>
                  )}
                </div>
                {/* Scope-prefix hint strip — only shown on the empty-query
                    landing state so it teaches the shortcut without
                    distracting from search results. */}
                {mode === 'search' && activeScope === null && query === '' && (
                  <div
                    className="mt-2 flex items-center gap-3 flex-wrap text-[var(--text-muted)]"
                    data-palette-scope-hints
                  >
                    <span className="text-2xs uppercase tracking-wider opacity-70">
                      {t('palette.filterBy', 'Filter')}
                    </span>
                    {PALETTE_SCOPE_HINTS.map(hint => (
                      <button
                        key={hint.scope}
                        type="button"
                        onClick={() => {
                          setQuery(`${hint.prefix} `)
                          setSelectedIndex(0)
                          inputRef.current?.focus()
                        }}
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs hover:bg-[var(--surface-2)] hover:text-[var(--text-secondary)] transition-colors"
                      >
                        <kbd className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-2xs">{hint.prefix}</kbd>
                        <span>{t(`palette.scope.${hint.scope}`, hint.label)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}
