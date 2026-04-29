import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Command, ArrowRight, Zap, ChevronLeft, Car } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { navSearchKeywords, navSections } from '@/components/layout/Layout'
import { useVehicles } from '@/api/hooks/useVehicles'
import { useVehicleCommand } from '@/api/hooks/useVehicleCommand'
import { COMMANDS, type CommandDef } from '@/features/system/commands'

// ─── Types ──────────────────────────────────────────────────────────────────

interface PaletteItem {
  id: string
  label: string
  section: string
  icon: React.ReactNode
  action: () => void
  keywords?: string[]
  type?: 'navigate' | 'command'
  sublabel?: string
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

// ─── Recent commands (sessionStorage) ───────────────────────────────────────

const RECENT_KEY = 'teslasync-palette-recent'
const MAX_RECENT = 5

interface RecentCommand {
  command: string
  vehicleId: number
}

function getRecentCommands(): RecentCommand[] {
  try {
    const stored = sessionStorage.getItem(RECENT_KEY)
    return stored ? (JSON.parse(stored) as RecentCommand[]) : []
  } catch {
    return []
  }
}

function addRecentCommand(entry: RecentCommand) {
  const recent = getRecentCommands().filter(
    r => !(r.command === entry.command && r.vehicleId === entry.vehicleId)
  )
  recent.unshift(entry)
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT
  try {
    sessionStorage.setItem(RECENT_KEY, JSON.stringify(recent))
  } catch { /* noop */ }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getIconForConfig(cfg: PaletteCommandConfig, def: CommandDef): React.ReactNode {
  const IconComp = cfg.useOffIcon && def.iconOff ? def.iconOff : def.icon
  return <IconComp className="h-4 w-4" />
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
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const { data: vehicles } = useVehicles()
  const vehicleList = vehicles ?? []
  const commandMutation = useVehicleCommand()

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

  const go = useCallback((path: string) => { navigate(path); close() }, [navigate, close])

  const executeCommand = useCallback((command: string, vehicleId: number) => {
    commandMutation.mutate({ vehicleId, command })
    addRecentCommand({ command, vehicleId })
    close()
  }, [commandMutation, close])

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
          section: section.title,
          icon: <item.icon className="h-4 w-4" />,
          action: () => go(item.to),
          keywords,
          sublabel,
          type: 'navigate' as const,
        }
      })
    ),
  [go])

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

  const recentItems: PaletteItem[] = useMemo(() => {
    if (query.trim()) return []
    const recent = getRecentCommands()
    return recent.flatMap(r => {
      const cfg = PALETTE_COMMAND_CONFIGS.find(c => c.command === r.command)
      if (!cfg) return []
      const def = commandDefMap.get(cfg.defId)
      if (!def) return []
      const vehicle = vehicleList.find(v => v.id === r.vehicleId)
      if (!vehicle) return []
      const item: PaletteItem = {
        id: `recent-${r.command}-${r.vehicleId}`,
        label: t(cfg.labelKey, cfg.labelFallback),
        section: t('palette.section.recent', 'Recent'),
        icon: getIconForConfig(cfg, def),
        type: 'command',
        sublabel: `→ ${vehicle.display_name || vehicle.vin}`,
        action: () => executeCommand(r.command, r.vehicleId),
      }
      return [item]
    })
  }, [query, commandDefMap, vehicleList, t, executeCommand])

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

  // ── Filtered items ────────────────────────────────────────────────────────

  const allItems = useMemo(
    () => [...recentItems, ...navItems, ...commandItems],
    [recentItems, navItems, commandItems],
  )

  const filtered = useMemo(() => {
    if (!query.trim()) return allItems
    const q = query.toLowerCase()
    return allItems.filter(cmd => {
      const haystack = [
        cmd.label,
        cmd.section,
        cmd.sublabel ?? '',
        ...(cmd.keywords ?? []),
      ]
      return haystack.some(value => value.toLowerCase().includes(q))
    })
  }, [allItems, query])

  const displayItems = mode === 'vehicle-select' ? vehicleItems : filtered

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => { setSelectedIndex(0) }, [displayItems])

  // Keyboard shortcut to open
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
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

  // Focus input when opened; close sidebar on mobile
  useEffect(() => {
    if (open) {
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
            className="fixed inset-0 z-[200] bg-slate-950/35 backdrop-blur-sm dark:bg-black/60"
            onClick={close}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ type: 'spring', bounce: 0.15, duration: 0.3 }}
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
                            {isSelected && (
                              <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-[var(--theme-primary)]" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  ))
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
      onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
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

