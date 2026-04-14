import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Command, ArrowRight } from 'lucide-react'
import { Input } from './Input'
import { navSections } from '@/components/layout/Layout'
import clsx from 'clsx'

interface CommandItem {
  id: string
  label: string
  section: string
  icon: React.ReactNode
  action: () => void
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const go = useCallback((path: string) => { navigate(path); setOpen(false) }, [navigate])

  const commands: CommandItem[] = useMemo(() =>
    navSections.flatMap(section =>
      section.items.map(item => ({
        id: item.to,
        label: item.label,
        section: section.title,
        icon: <item.icon className="h-4 w-4" />,
        action: () => go(item.to),
      }))
    ),
  [go])

  const filtered = useMemo(() => {
    if (!query.trim()) return commands
    const q = query.toLowerCase()
    return commands.filter(cmd =>
      cmd.label.toLowerCase().includes(q) ||
      cmd.section.toLowerCase().includes(q)
    )
  }, [commands, query])

  useEffect(() => { setSelectedIndex(0) }, [filtered])

  // Keyboard shortcut to open
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
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
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
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
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ type: 'spring', bounce: 0.15, duration: 0.3 }}
            className="fixed left-1/2 top-[10%] sm:top-[15%] z-[201] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2"
          >
            <div className="overflow-hidden rounded-2xl shadow-2xl" style={{ border: '1px solid var(--glass-border)', background: 'var(--surface-1)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)' }}>
              {/* Search input */}
              <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                <Search className="h-5 w-5 text-[var(--text-muted)] flex-shrink-0" />
                <div className="flex-1">
                  <Input
                    ref={inputRef}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={handleInputKey}
                    placeholder="Search commands, pages..."
                    className="!bg-transparent !border-0 !ring-0 !shadow-none !p-0 !rounded-none text-sm"
                    style={{ color: 'var(--text-primary)' }}
                  />
                </div>
                <kbd className="hidden sm:flex items-center gap-1 rounded-lg bg-white/[0.05] border border-white/[0.08] px-2 py-1 text-[10px] text-[var(--text-muted)] font-mono">
                  ESC
                </kbd>
              </div>

              {/* Results */}
              <div ref={listRef} className="max-h-80 overflow-y-auto py-2 px-2">
                {filtered.length === 0 ? (
                  <div className="py-8 text-center text-sm text-[var(--text-muted)]">
                    No commands found for "{query}"
                  </div>
                ) : (
                  filtered.map((cmd, i) => (
                    <button
                      key={cmd.id}
                      onClick={cmd.action}
                      onMouseEnter={() => setSelectedIndex(i)}
                      className={clsx(
                        'flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition-colors',
                        i === selectedIndex
                          ? 'bg-white/[0.06] text-[var(--text-primary)]'
                          : 'text-[var(--text-secondary)] hover:bg-white/[0.03]'
                      )}
                    >
                      <span className={clsx(i === selectedIndex ? 'text-neon-cyan' : 'text-[var(--text-muted)]')}>
                        {cmd.icon}
                      </span>
                      <span className="flex-1 font-medium">{cmd.label}</span>
                      {i === selectedIndex && (
                        <ArrowRight className="h-3.5 w-3.5 text-neon-cyan" />
                      )}
                    </button>
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
      className="flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-sm text-[var(--text-muted)] hover:border-white/[0.12] hover:text-[var(--text-secondary)] transition-all"
    >
      <Search className="h-4 w-4" />
      <span className="flex-1 text-left">Search...</span>
      <kbd className="hidden sm:flex items-center gap-0.5 rounded-md bg-white/[0.05] border border-white/[0.08] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-muted)]">
        <Command className="h-2.5 w-2.5" />K
      </kbd>
    </button>
  )
}
