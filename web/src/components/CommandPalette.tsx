import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, LayoutDashboard, Car, Route, BatteryCharging, MapPin, Settings, Radar, Bolt,
  HeartPulse, Gamepad2, Bell, BarChart3, Command, ArrowRight, Lock, Thermometer, Navigation
} from 'lucide-react'
import clsx from 'clsx'
import { getSearch, type SearchResult } from '../api'

interface CommandItem {
  id: string
  label: string
  section: string
  icon: React.ReactNode
  action: () => void
  keywords?: string[]
  subtitle?: string
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const triggerRef = useRef<HTMLElement | null>(null)
  const navigate = useNavigate()

  const go = useCallback((path: string) => { navigate(path); setOpen(false) }, [navigate])

  const commands: CommandItem[] = useMemo(() => [
    { id: 'dashboard', label: 'Dashboard', section: 'Pages', icon: <LayoutDashboard className="h-4 w-4" />, action: () => go('/'), keywords: ['home', 'command center'] },
    { id: 'live-map', label: 'Live Map', section: 'Pages', icon: <Radar className="h-4 w-4" />, action: () => go('/live'), keywords: ['track', 'location', 'gps'] },
    { id: 'fleet', label: 'Fleet', section: 'Pages', icon: <Car className="h-4 w-4" />, action: () => go('/vehicles'), keywords: ['vehicles', 'cars', 'tesla'] },
    { id: 'energy', label: 'Energy', section: 'Pages', icon: <Bolt className="h-4 w-4" />, action: () => go('/energy'), keywords: ['power', 'consumption', 'kwh'] },
    { id: 'battery', label: 'Battery Health', section: 'Pages', icon: <HeartPulse className="h-4 w-4" />, action: () => go('/battery'), keywords: ['degradation', 'health', 'capacity'] },
    { id: 'drives', label: 'Drives', section: 'Pages', icon: <Route className="h-4 w-4" />, action: () => go('/drives'), keywords: ['trips', 'travel', 'history'] },
    { id: 'charging', label: 'Charging', section: 'Pages', icon: <BatteryCharging className="h-4 w-4" />, action: () => go('/charging'), keywords: ['charge', 'supercharger', 'sessions'] },
    { id: 'analytics', label: 'Analytics', section: 'Pages', icon: <BarChart3 className="h-4 w-4" />, action: () => go('/analytics'), keywords: ['stats', 'metrics', 'comparison'] },
    { id: 'commands', label: 'Vehicle Commands', section: 'Pages', icon: <Gamepad2 className="h-4 w-4" />, action: () => go('/commands'), keywords: ['control', 'lock', 'hvac', 'horn'] },
    { id: 'alerts', label: 'Alerts', section: 'Pages', icon: <Bell className="h-4 w-4" />, action: () => go('/alerts'), keywords: ['notifications', 'warnings'] },
    { id: 'geofences', label: 'Geofences', section: 'Pages', icon: <MapPin className="h-4 w-4" />, action: () => go('/geofences'), keywords: ['zones', 'boundaries', 'fences'] },
    { id: 'settings', label: 'Settings', section: 'Pages', icon: <Settings className="h-4 w-4" />, action: () => go('/settings'), keywords: ['preferences', 'config', 'account'] },
    // Quick actions
    { id: 'cmd-lock', label: 'Lock Vehicle', section: 'Commands', icon: <Lock className="h-4 w-4" />, action: () => go('/commands'), keywords: ['lock', 'secure', 'doors'] },
    { id: 'cmd-unlock', label: 'Unlock Vehicle', section: 'Commands', icon: <Lock className="h-4 w-4" />, action: () => go('/commands'), keywords: ['unlock', 'open'] },
    { id: 'cmd-climate', label: 'Climate On', section: 'Commands', icon: <Thermometer className="h-4 w-4" />, action: () => go('/commands'), keywords: ['climate', 'hvac', 'heat', 'cool', 'ac'] },
    { id: 'cmd-honk', label: 'Honk Horn', section: 'Commands', icon: <Bell className="h-4 w-4" />, action: () => go('/commands'), keywords: ['honk', 'horn', 'find'] },
  ], [go])

  // Debounced search against backend
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (q.length < 2) {
      setSearchResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(() => {
      getSearch(q)
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false))
    }, 250)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  // Build search result items from backend
  const apiItems: CommandItem[] = useMemo(() => {
    return searchResults.map((r) => {
      if (r.type === 'vehicle') {
        return {
          id: `sr-vehicle-${r.id}`,
          label: r.display_name || 'Unknown Vehicle',
          subtitle: `${r.vin} · ${r.model}`,
          section: 'Vehicles',
          icon: <Car className="h-4 w-4" />,
          action: () => go(`/vehicles/${r.id}`),
        }
      }
      if (r.type === 'drive') {
        const date = r.start_date ? new Date(r.start_date).toLocaleDateString() : ''
        const dist = r.distance != null ? `${r.distance.toFixed(1)} km` : ''
        return {
          id: `sr-drive-${r.id}`,
          label: r.address || 'Drive',
          subtitle: [date, dist].filter(Boolean).join(' · '),
          section: 'Drives',
          icon: <Navigation className="h-4 w-4" />,
          action: () => go(`/drives/${r.id}`),
        }
      }
      // location
      return {
        id: `sr-location-${r.id}`,
        label: r.display_name || 'Location',
        subtitle: r.visit_count != null ? `${r.visit_count} visits` : undefined,
        section: 'Locations',
        icon: <MapPin className="h-4 w-4" />,
        action: () => go('/locations'),
      }
    })
  }, [searchResults, go])

  // Filter local commands + merge API results
  const filtered = useMemo(() => {
    if (!query.trim()) return commands
    const q = query.toLowerCase()
    const localMatches = commands.filter(cmd =>
      cmd.label.toLowerCase().includes(q) ||
      cmd.section.toLowerCase().includes(q) ||
      cmd.keywords?.some(k => k.includes(q))
    )
    return [...localMatches, ...apiItems]
  }, [commands, query, apiItems])

  // Group items by section for display
  const grouped = useMemo(() => {
    const groups: { section: string; items: (CommandItem & { globalIndex: number })[] }[] = []
    const sectionMap = new Map<string, (CommandItem & { globalIndex: number })[]>()
    filtered.forEach((item, i) => {
      const arr = sectionMap.get(item.section)
      const entry = { ...item, globalIndex: i }
      if (arr) {
        arr.push(entry)
      } else {
        const newArr = [entry]
        sectionMap.set(item.section, newArr)
        groups.push({ section: item.section, items: newArr })
      }
    })
    return groups
  }, [filtered])

  useEffect(() => { setSelectedIndex(0) }, [filtered])

  // Keyboard shortcut to open
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        triggerRef.current = document.activeElement as HTMLElement
        setOpen(prev => !prev)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Focus input when opened, restore focus when closed
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setSearchResults([])
      setTimeout(() => inputRef.current?.focus(), 50)
    } else if (triggerRef.current) {
      triggerRef.current.focus()
      triggerRef.current = null
    }
  }, [open])

  // Keyboard nav within palette
  function handleInputKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => Math.min(prev + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault()
      filtered[selectedIndex].action()
    }
  }

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ type: 'spring', bounce: 0.15, duration: 0.3 }}
            className="fixed left-1/2 top-[15%] z-[201] w-full max-w-lg -translate-x-1/2"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
          >
            <div className="overflow-hidden rounded-2xl shadow-2xl" style={{ border: '1px solid var(--glass-border)', background: 'var(--surface-1)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)' }}>
              {/* Search input */}
              <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                <Search className="h-5 w-5 text-[var(--text-muted)] flex-shrink-0" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={handleInputKey}
                  placeholder="Search pages, vehicles, drives, locations..."
                  aria-label="Search commands"
                  aria-autocomplete="list"
                  aria-controls="command-palette-list"
                  aria-activedescendant={filtered[selectedIndex] ? `cmd-${filtered[selectedIndex].id}` : undefined}
                  className="flex-1 bg-transparent text-sm placeholder-gray-500 outline-none"
                  style={{ color: 'var(--text-primary)' }}
                />
                {searching && (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-transparent border-t-[var(--text-muted)]" />
                )}
                <kbd className="hidden sm:flex items-center gap-1 rounded-lg bg-white/[0.05] border border-white/[0.08] px-2 py-1 text-[10px] text-[var(--text-muted)] font-mono">
                  ESC
                </kbd>
              </div>

              {/* Results grouped by section */}
              <div ref={listRef} id="command-palette-list" role="listbox" aria-label="Search results" className="max-h-80 overflow-y-auto py-2 px-2">
                {filtered.length === 0 ? (
                  <div className="py-8 text-center text-sm text-[var(--text-muted)]">
                    {searching ? 'Searching...' : `No results found for "${query}"`}
                  </div>
                ) : (
                  grouped.map((group) => (
                    <div key={group.section}>
                      <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                        {group.section}
                      </div>
                      {group.items.map((cmd) => (
                        <button
                          key={cmd.id}
                          id={`cmd-${cmd.id}`}
                          role="option"
                          data-index={cmd.globalIndex}
                          aria-selected={cmd.globalIndex === selectedIndex}
                          onClick={cmd.action}
                          onMouseEnter={() => setSelectedIndex(cmd.globalIndex)}
                          className={clsx(
                            'flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition-colors',
                            cmd.globalIndex === selectedIndex
                              ? 'bg-white/[0.06] text-[var(--text-primary)]'
                              : 'text-[var(--text-secondary)] hover:bg-white/[0.03]'
                          )}
                        >
                          <span className={clsx(cmd.globalIndex === selectedIndex ? 'text-neon-cyan' : 'text-[var(--text-muted)]')}>
                            {cmd.icon}
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className="font-medium">{cmd.label}</span>
                            {cmd.subtitle && (
                              <span className="ml-2 text-xs text-[var(--text-muted)] truncate">{cmd.subtitle}</span>
                            )}
                          </div>
                          {cmd.globalIndex === selectedIndex && (
                            <ArrowRight className="h-3.5 w-3.5 text-neon-cyan flex-shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center gap-4 px-5 py-3 text-[10px]" style={{ borderTop: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono">↑↓</kbd> Navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono">↵</kbd> Select
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono">ESC</kbd> Close
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// Trigger button for the sidebar
export function CommandPaletteTrigger() {
  return (
    <button
      onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
      className="flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-sm text-[var(--text-muted)] hover:border-white/[0.12] hover:text-gray-300 transition-all"
    >
      <Search className="h-4 w-4" />
      <span className="flex-1 text-left">Search...</span>
      <kbd className="hidden sm:flex items-center gap-0.5 rounded-md bg-white/[0.05] border border-white/[0.08] px-1.5 py-0.5 text-[10px] font-mono text-gray-600">
        <Command className="h-2.5 w-2.5" />K
      </kbd>
    </button>
  )
}
