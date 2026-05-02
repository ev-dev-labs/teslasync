import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Command, ArrowRight, Zap, ChevronLeft, Car, ArrowRightLeft,
  Route, BatteryCharging, Bell, BellRing, MapPin, Workflow, Compass, MapPinned,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { navSearchKeywords, navSections } from '@/components/layout/Layout'
import { useVehicles } from '@/api/hooks/useVehicles'
import { useVehicleCommand } from '@/api/hooks/useVehicleCommand'
import { COMMANDS, type CommandDef } from '@/features/system/commands'
import { useCommandRegistry, type ResolvedCommand } from '@/hooks/useCommandRegistry'
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle'
import { scoreCommand } from '@/lib/commandRegistry'
import { useGlobalSearch } from '@/api/hooks/useSearch'
import type { SearchHitType } from '@/api/types'
import { markCommandPaletteDiscovered } from '@/features/onboarding/checklist'

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
// Phase 40 / Prompt 19: persisted across reloads via localStorage so power users
// see their workflow patterns surface to the top of the palette. Tracks every
// command type (vehicle, registry/action, navigation), not only vehicle
// commands. Stored capped at 10; UI surfaces top 5.

const RECENT_KEY = 'teslasync.recentCommands'
const RECENT_MAX_STORED = 10
const RECENT_MAX_DISPLAY = 5

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

function getIconForConfig(cfg: PaletteCommandConfig, def: CommandDef): React.ReactNode {
  const IconComp = cfg.useOffIcon && def.iconOff ? def.iconOff : def.icon
  return <IconComp className="h-4 w-4" />
}

// ─── Search hit helpers ─────────────────────────────────────────────────────
//
// Phase-40 / Prompt 41: shared between the live palette results and the
// dedicated /search page so type icons stay consistent across surfaces.

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

// ─── CommandPalette ─────────────────────────────────────────────────────────

interface CommandPaletteProps {
  /** Called when the palette opens — Layout uses this to close the mobile sidebar */
  onOpen?: () => void
}

export function CommandPalette({ onOpen }: CommandPaletteProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [mode, setMode] = useState<'search' | 'vehicle-select'>('search')
  const [pendingCommand, setPendingCommand] = useState<string | null>(null)
  const [recentVersion, setRecentVersion] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const { data: vehicles } = useVehicles()
  const vehicleList = vehicles ?? []
  const commandMutation = useVehicleCommand()
  const { commands: registryCommands, getById: getRegistryById } = useCommandRegistry()
  const { vehicleId: activeVehicleId, setVehicleId } = useSelectedVehicle()

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
    bumpRecent()
    navigate(path)
    close()
  }, [navigate, close, bumpRecent])

  const executeCommand = useCallback((command: string, vehicleId: number) => {
    commandMutation.mutate({ vehicleId, command })
    addRecentCommand({ kind: 'vehicle', command, vehicleId })
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

  const switchActiveVehicle = useCallback((id: number) => {
    setVehicleId(id)
    addRecentCommand({ kind: 'registry', registryId: `switch-vehicle-${id}` })
    bumpRecent()
    close()
  }, [setVehicleId, close, bumpRecent])

  const runRegistryCommand = useCallback((cmd: ResolvedCommand) => {
    addRecentCommand({ kind: 'registry', registryId: cmd.id })
    bumpRecent()
    void cmd.invoke()
    close()
  }, [close, bumpRecent])

  // ── Build palette items ───────────────────────────────────────────────────

  const navItems: PaletteItem[] = useMemo(() =>
    navSections.flatMap(section =>
      section.items.map(item => {
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
  [go, t])

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

  const recentItems: PaletteItem[] = useMemo(() => {
    if (query.trim()) return []
    // Read recents — recentVersion exists solely to invalidate this memo after
    // addRecentCommand mutates localStorage so the "Recent" section refreshes
    // without us needing a storage event listener.
    void recentVersion
    const recent = getRecentCommands().slice(0, RECENT_MAX_DISPLAY)
    return recent.flatMap<PaletteItem>(r => {
      if (r.kind === 'vehicle' && r.command && r.vehicleId != null) {
        const cfg = PALETTE_COMMAND_CONFIGS.find(c => c.command === r.command)
        if (!cfg) return []
        const def = commandDefMap.get(cfg.defId)
        if (!def) return []
        const vehicle = vehicleList.find(v => v.id === r.vehicleId)
        if (!vehicle) return []
        return [{
          id: `recent-vehicle-${r.command}-${r.vehicleId}`,
          label: t(cfg.labelKey, cfg.labelFallback),
          section: t('palette.section.recent', 'Recent'),
          icon: getIconForConfig(cfg, def),
          type: 'command',
          sublabel: `→ ${vehicle.display_name || vehicle.vin}`,
          action: () => executeCommand(r.command!, r.vehicleId!),
        }]
      }
      if (r.kind === 'registry' && r.registryId) {
        // Vehicle-switch entries are dynamic — not in the registry — so handle
        // them explicitly before falling back to the registry lookup.
        if (r.registryId.startsWith('switch-vehicle-')) {
          const vid = Number(r.registryId.slice('switch-vehicle-'.length))
          const vehicle = vehicleList.find(v => v.id === vid)
          if (!vehicle) return []
          return [{
            id: `recent-${r.registryId}`,
            label: t('palette.cmd.switchVehicle', { name: vehicle.display_name || vehicle.vin, defaultValue: `Switch to ${vehicle.display_name || vehicle.vin}` }),
            section: t('palette.section.recent', 'Recent'),
            icon: <ArrowRightLeft className="h-4 w-4" />,
            type: 'vehicle-switch',
            sublabel: `${vehicle.model ?? ''} · ${vehicle.state ?? 'unknown'}`.trim(),
            action: () => switchActiveVehicle(vid),
          }]
        }
        const reg = getRegistryById(r.registryId)
        if (!reg) return []
        const Icon = reg.icon
        return [{
          id: `recent-${r.registryId}`,
          label: reg.label,
          section: t('palette.section.recent', 'Recent'),
          icon: <Icon className="h-4 w-4" />,
          type: 'registry',
          shortcut: reg.shortcut,
          action: () => runRegistryCommand(reg),
        }]
      }
      if (r.kind === 'nav' && r.path) {
        // Find the nav entry to recover its label and icon
        for (const section of navSections) {
          const item = section.items.find(i => i.to === r.path)
          if (!item) continue
          return [{
            id: `recent-nav-${r.path}`,
            label: item.label,
            section: t('palette.section.recent', 'Recent'),
            icon: <item.icon className="h-4 w-4" />,
            type: 'navigate',
            sublabel: section.title,
            action: () => go(r.path!),
          }]
        }
      }
      return []
    })
  }, [query, recentVersion, commandDefMap, vehicleList, t, executeCommand, getRegistryById, runRegistryCommand, switchActiveVehicle, go])

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

  // ── Live entity search (Phase-40 / Prompt 41) ─────────────────────────────
  //
  // Debounce by 200 ms so each keystroke does not fan out to the backend's
  // ~9 ILIKE sub-queries. The hook itself enforces the >= 2 char floor.

  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length === 0) {
      setDebouncedQuery('')
      return
    }
    const handle = window.setTimeout(() => setDebouncedQuery(trimmed), 200)
    return () => window.clearTimeout(handle)
  }, [query])

  const { data: searchData } = useGlobalSearch(debouncedQuery, {
    disabled: mode !== 'search',
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

  const allItems = useMemo(
    () => [...searchResultItems, ...recentItems, ...registryItems, ...vehicleSwitchItems, ...navItems, ...commandItems],
    [searchResultItems, recentItems, registryItems, vehicleSwitchItems, navItems, commandItems],
  )

  const filtered = useMemo(() => {
    if (!query.trim()) return allItems
    // Score every item with the same fuzzy matcher used for registry commands
    // so "btr" matches "Battery Health" via subsequence, not just substring.
    const scored = allItems
      .map(cmd => {
        // Server-ranked entity hits skip local filtering — the backend
        // already matched on the user's query and computed scores per
        // entity. Pinning them at a high pseudo-score keeps Results above
        // the static items inside groupedItems while remaining in their
        // own per-type sections.
        if (cmd.type === 'search-hit') return { cmd, score: 9999 }
        const haystack = [cmd.label, ...(cmd.keywords ?? [])]
        let best = 0
        for (let i = 0; i < haystack.length; i++) {
          const s = scoreCommand(query, haystack[i], i === 0 ? cmd.keywords : undefined)
          if (s > best) best = s
        }
        // Sublabel/section as a lighter substring fallback
        if (best === 0) {
          const q = query.toLowerCase()
          if ((cmd.sublabel ?? '').toLowerCase().includes(q)) best = 10
          else if (cmd.section.toLowerCase().includes(q)) best = 5
        }
        return { cmd, score: best }
      })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
    return scored.map(s => s.cmd)
  }, [allItems, query])

  const displayItems = mode === 'vehicle-select' ? vehicleItems : filtered

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => { setSelectedIndex(0) }, [displayItems])

  // Esc closes the palette (or pops vehicle-select mode). Esc fires from
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
        if (mode === 'vehicle-select') {
          goBack()
        } else {
          setOpen(false)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mode, goBack])

  // useKeyboardShortcuts dispatches this custom event when the user presses
  // Ctrl+K outside a form field. Listening here keeps the palette in sync
  // with the global shortcut layer without duplicating focus rules.
  useEffect(() => {
    function handleToggle() { setOpen(prev => !prev) }
    window.addEventListener('toggle-command-palette', handleToggle as EventListener)
    return () => window.removeEventListener('toggle-command-palette', handleToggle as EventListener)
  }, [])

  // Focus input when opened; close sidebar on mobile
  useEffect(() => {
    if (open) {
      // Phase-40 / Prompt 68 — first-open instrumentation: marks the
      // "try-command-palette" onboarding-checklist task as complete the moment
      // the user discovers the palette. Idempotent — only writes the flag the
      // first time, so subsequent opens are a no-op.
      markCommandPaletteDiscovered()
      setQuery('')
      setSelectedIndex(0)
      setMode('search')
      setPendingCommand(null)
      onOpen?.()
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open, onOpen])

  // Keyboard nav within palette
  function handleInputKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => Math.min(prev + 1, displayItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && displayItems[selectedIndex]) {
      e.preventDefault()
      displayItems[selectedIndex].action()
    } else if (e.key === 'Backspace' && query === '' && mode === 'vehicle-select') {
      e.preventDefault()
      goBack()
    }
  }

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // ── Helpers ───────────────────────────────────────────────────────────────

  const pendingCommandLabel = useMemo(() => {
    if (!pendingCommand) return ''
    const cfg = PALETTE_COMMAND_CONFIGS.find(c => c.command === pendingCommand)
    return cfg ? t(cfg.labelKey, cfg.labelFallback) : pendingCommand
  }, [pendingCommand, t])

  // Group items by section for display
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
            className="fixed inset-0 z-[200] bg-slate-950/35 backdrop-blur-sm dark:bg-black/60"
            onClick={close}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ type: 'spring', bounce: 0.15, duration: 0.3 }}
            data-role="command-palette"
            className="fixed left-4 right-4 top-[10%] z-[201] max-w-lg sm:left-1/2 sm:right-auto sm:top-[15%] sm:-translate-x-1/2 sm:w-[calc(100%-2rem)]"
          >
            <div className="overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--surface-1)] text-[var(--text-primary)] shadow-2xl backdrop-blur-xl">
              {/* Search input / vehicle-select header */}
              <div className="flex items-center gap-3 border-b border-[var(--glass-border)] px-5 py-4">
                {mode === 'vehicle-select' ? (
                  <>
                    <button
                      onClick={goBack}
                      className="flex-shrink-0 rounded-lg p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <div className="flex-1 flex items-center gap-2">
                      <Zap className="h-4 w-4 text-[var(--theme-primary)]" />
                      <span className="text-sm text-[var(--text-secondary)]">
                        {t('palette.selectVehicleFor', { command: pendingCommandLabel, defaultValue: `Send "${pendingCommandLabel}" to…` })}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <Search className="h-5 w-5 flex-shrink-0 text-[var(--text-muted)]" />
                    <div className="flex-1">
                      <Input
                        ref={inputRef}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleInputKey}
                        placeholder={t('palette.placeholder', 'Search pages, commands…')}
                        className="!rounded-none !border-0 !bg-transparent !p-0 text-sm text-[var(--text-primary)] !shadow-none !ring-0 placeholder:text-[var(--text-muted)]"
                      />
                    </div>
                    <kbd className="hidden items-center gap-1 rounded-lg border border-[var(--glass-border)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[10px] text-[var(--text-muted)] sm:flex">
                      ESC
                    </kbd>
                  </>
                )}
              </div>

              {/* Results */}
              <div ref={listRef} className="max-h-80 overflow-y-auto py-2 px-2" onKeyDown={mode === 'vehicle-select' ? handleInputKey : undefined}>
                {displayItems.length === 0 ? (
                  <div className="py-8 text-center text-sm text-[var(--text-muted)]">
                    {mode === 'vehicle-select'
                      ? t('palette.noVehicles', 'No vehicles available')
                      : t('palette.noResults', { query, defaultValue: `No results for "${query}"` })
                    }
                  </div>
                ) : (
                  groupedItems.map(group => (
                    <div key={group.section}>
                      <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                        {group.section}
                      </div>
                      {group.items.map(({ item, globalIndex }) => {
                        const isCommand = item.type === 'command'
                        const isSelected = globalIndex === selectedIndex
                        return (
                          <button
                            key={item.id}
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
                                <span className="block truncate text-[11px] text-[var(--text-muted)]">
                                  {item.sublabel}
                                </span>
                              )}
                            </div>
                            {item.shortcut && (
                              <kbd
                                aria-label={t('palette.shortcut', { keys: item.shortcut, defaultValue: `Shortcut: ${item.shortcut}` })}
                                className="hidden flex-shrink-0 rounded-md border border-[var(--glass-border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)] sm:inline-flex"
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
              <div className="flex items-center gap-4 border-t border-[var(--glass-border)] px-5 py-3 text-[10px] text-[var(--text-muted)]">
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono">↑↓</kbd> {t('palette.navigate', 'Navigate')}
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono">↵</kbd> {t('palette.select', 'Select')}
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono">ESC</kbd> {mode === 'vehicle-select' ? t('palette.back', 'Back') : t('palette.close', 'Close')}
                </span>
                {mode === 'search' && vehicleList.length > 0 && (
                  <span className="ml-auto flex items-center gap-1 text-[var(--theme-primary)]">
                    <Zap className="h-3 w-3" /> {vehicleList.length} {vehicleList.length === 1 ? t('palette.vehicle', 'vehicle') : t('palette.vehicles', 'vehicles')}
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ─── Trigger button for the sidebar ─────────────────────────────────────────

export function CommandPaletteTrigger() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent('toggle-command-palette'))}
      className="flex w-full items-center gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface-1)] px-4 py-2.5 text-sm text-[var(--text-muted)] transition-all hover:border-[var(--theme-primary)] hover:text-[var(--text-secondary)]"
    >
      <Search className="h-4 w-4" />
      <span className="flex-1 text-left">Search...</span>
      <kbd className="hidden items-center gap-0.5 rounded-md border border-[var(--glass-border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)] sm:flex">
        <Command className="h-2.5 w-2.5" />K
      </kbd>
    </button>
  )
}

