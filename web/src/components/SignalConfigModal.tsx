import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, Search, Zap, Battery, Gauge, Shield, Thermometer, Radio, Settings, Wrench, ChevronDown, CheckCircle } from 'lucide-react'
import clsx from 'clsx'
import { Input, Select } from './ui'

const INTERVAL_OPTIONS = [
  { value: 0, label: '500ms', color: 'text-neon-cyan', desc: 'Real-time' },
  { value: 1, label: '1s', color: 'text-cyan-300', desc: 'Fast' },
  { value: 5, label: '5s', color: 'text-blue-400', desc: 'Medium' },
  { value: 10, label: '10s', color: 'text-[var(--text-secondary)]', desc: 'Default' },
  { value: 30, label: '30s', color: 'text-[var(--text-muted)]', desc: 'Slow' },
  { value: 60, label: '60s', color: 'text-[var(--text-muted)]', desc: '1 min' },
  { value: 300, label: '5m', color: 'text-[var(--text-muted)]', desc: 'Rare' },
  { value: 900, label: '15m', color: 'text-[var(--text-muted)]', desc: '15 min' },
  { value: 3600, label: '1h', color: 'text-[var(--text-muted)]', desc: '1 hour' },
  { value: 86400, label: '24h', color: 'text-gray-700', desc: 'Daily' },
]

const PRESETS = [
  { name: '⚡ Real-time Driving', desc: 'Driving signals at 500ms, battery at 10s, config at 24h',
    apply: (fields: SignalConfig[]) => fields.map(f => ({
      ...f,
      selected: true,
      interval: ['Driving','Powertrain','Location'].includes(f.category) ? 0 :
                ['Charging','Climate','Tires & Service'].includes(f.category) ? 10 :
                ['Vehicle Config','User Preference'].includes(f.category) ? 86400 : 10,
    })),
  },
  { name: '⚖️ Balanced', desc: 'All signals at 10s — good balance of data and battery',
    apply: (fields: SignalConfig[]) => fields.map(f => ({ ...f, selected: true, interval: 10 })),
  },
  { name: '🔋 Low Power', desc: 'All signals at 60s — minimal battery impact',
    apply: (fields: SignalConfig[]) => fields.map(f => ({ ...f, selected: true, interval: 60 })),
  },
  { name: '🏎️ Track Mode', desc: 'Driving & powertrain at 500ms, everything else at 30s',
    apply: (fields: SignalConfig[]) => fields.map(f => ({
      ...f,
      selected: true,
      interval: ['Driving','Powertrain'].includes(f.category) ? 0 :
                f.category === 'Location' ? 0 :
                ['Vehicle Config','User Preference'].includes(f.category) ? 3600 : 30,
    })),
  },
]

interface SignalConfig {
  name: string
  category: string
  selected: boolean
  interval: number
}

interface CategoryDef {
  category: string
  fields: string[]
}

const CATEGORY_ICONS: Record<string, typeof Zap> = {
  'Driving': Gauge, 'Charging': Battery, 'Climate': Thermometer,
  'Vehicle State': Shield, 'Safety': Shield, 'Powertrain': Zap,
  'Tires & Service': Wrench, 'Media': Radio, 'Location': Gauge,
  'User Preference': Settings, 'Vehicle Config': Settings,
}

interface Props {
  open: boolean
  onClose: () => void
  categories: CategoryDef[]
  initialSelected: string[]
  initialInterval: number
  onSubmit: (signals: { name: string; interval: number }[]) => void
}

export default function SignalConfigModal({ open, onClose, categories, initialSelected, initialInterval, onSubmit }: Props) {
  const [signals, setSignals] = useState<SignalConfig[]>(() =>
    categories.flatMap(cat => cat.fields.map(f => ({
      name: f,
      category: cat.category,
      selected: initialSelected.includes(f),
      interval: initialInterval,
    })))
  )
  const [search, setSearch] = useState('')
  const [masterInterval, setMasterInterval] = useState(initialInterval)
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set(categories.map(c => c.category)))

  const filtered = useMemo(() =>
    signals.filter(s => s.name.toLowerCase().includes(search.toLowerCase())),
    [signals, search]
  )

  const selectedCount = signals.filter(s => s.selected).length
  const totalCount = signals.length
  const allSelected = selectedCount === totalCount

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, SignalConfig[]>()
    for (const s of filtered) {
      const arr = map.get(s.category) || []
      arr.push(s)
      map.set(s.category, arr)
    }
    return map
  }, [filtered])

  const updateSignal = (name: string, updates: Partial<SignalConfig>) => {
    setSignals(prev => prev.map(s => s.name === name ? { ...s, ...updates } : s))
  }

  const toggleAll = (selected: boolean) => {
    setSignals(prev => prev.map(s => ({ ...s, selected })))
  }

  const setMasterIntervalAll = (interval: number) => {
    setMasterInterval(interval)
    setSignals(prev => prev.map(s => ({ ...s, interval })))
  }

  const toggleCategory = (category: string) => {
    const catSignals = signals.filter(s => s.category === category)
    const allCatSelected = catSignals.every(s => s.selected)
    setSignals(prev => prev.map(s => s.category === category ? { ...s, selected: !allCatSelected } : s))
  }

  const setCategoryInterval = (category: string, interval: number) => {
    setSignals(prev => prev.map(s => s.category === category ? { ...s, interval } : s))
  }

  const applyPreset = (preset: typeof PRESETS[0]) => {
    setSignals(prev => preset.apply(prev))
  }

  const handleSubmit = () => {
    const selected = signals.filter(s => s.selected).map(s => ({ name: s.name, interval: s.interval }))
    onSubmit(selected)
    onClose()
  }

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4" onClick={onClose}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Zap className="h-5 w-5 text-neon-cyan" />
              Fleet Telemetry Signal Configuration
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">{selectedCount} / {totalCount} signals selected</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Master Controls */}
        <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--surface)] space-y-3">
          {/* Presets */}
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(p => (
              <button key={p.name} onClick={() => applyPreset(p)} title={p.desc}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.03] border border-white/[0.08] hover:border-neon-cyan/30 hover:bg-neon-cyan/5 transition-colors">
                {p.name}
              </button>
            ))}
          </div>

          {/* Master Toggle + Master Interval */}
          <div className="flex items-center gap-4 flex-wrap">
            <button onClick={() => toggleAll(!allSelected)}
              className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                allSelected ? 'bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan' : 'bg-white/[0.03] border-white/[0.08] text-[var(--text-secondary)]'
              )}>
              <div className={clsx('h-3 w-3 rounded border flex items-center justify-center', allSelected ? 'bg-neon-cyan border-neon-cyan' : 'border-white/20')}>
                {allSelected && <CheckCircle className="h-2 w-2 text-black" />}
              </div>
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>

            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Master Interval:</span>
              <Select value={String(masterInterval)} onChange={e => setMasterIntervalAll(Number(e.target.value))}
                className="px-2 py-1 text-xs"
                options={INTERVAL_OPTIONS.map(o => ({ value: String(o.value), label: `${o.label} (${o.desc})` }))}
              />
            </div>

            <div className="relative ml-auto flex-1 max-w-xs">
              <Input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search signals..."
                icon={<Search className="h-3.5 w-3.5" />}
                className="w-full text-xs"
              />
            </div>
          </div>
        </div>

        {/* Signal List */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {Array.from(grouped.entries()).map(([category, catSignals]) => {
            const expanded = expandedCats.has(category)
            const allCatSelected = catSignals.every(s => s.selected)
            const someCatSelected = catSignals.some(s => s.selected)
            const CatIcon = CATEGORY_ICONS[category] || Zap

            return (
              <div key={category} className="border border-white/[0.06] rounded-xl overflow-hidden">
                {/* Category Header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.02] cursor-pointer" onClick={() => {
                  setExpandedCats(prev => {
                    const next = new Set(prev)
                    next.has(category) ? next.delete(category) : next.add(category)
                    return next
                  })
                }}>
                  <ChevronDown className={clsx('h-3.5 w-3.5 text-[var(--text-muted)] transition-transform', !expanded && '-rotate-90')} />
                  <button onClick={e => { e.stopPropagation(); toggleCategory(category) }}
                    className={clsx('h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0',
                      allCatSelected ? 'bg-neon-cyan border-neon-cyan' : someCatSelected ? 'bg-neon-cyan/40 border-neon-cyan/60' : 'border-white/20'
                    )}>
                    {allCatSelected && <CheckCircle className="h-2.5 w-2.5 text-black" />}
                  </button>
                  <CatIcon className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{category}</span>
                  <span className="text-[10px] text-[var(--text-muted)]">({catSignals.filter(s => s.selected).length}/{catSignals.length})</span>
                  <div className="ml-auto flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <Select value="" onChange={e => { if (e.target.value) setCategoryInterval(category, Number(e.target.value)); e.target.value = '' }}
                      className="bg-transparent border border-white/[0.08] rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]"
                      options={[
                        { value: '', label: 'Set all...' },
                        ...INTERVAL_OPTIONS.map(o => ({ value: String(o.value), label: o.label })),
                      ]}
                    />
                  </div>
                </div>

                {/* Signal Rows */}
                {expanded && (
                  <div className="divide-y divide-white/[0.03]">
                    {catSignals.map(sig => {
                      const intervalOpt = INTERVAL_OPTIONS.find(o => o.value === sig.interval) || INTERVAL_OPTIONS[3]
                      return (
                        <div key={sig.name} className={clsx(
                          'flex items-center gap-2 px-4 py-1.5 transition-colors',
                          sig.selected ? 'bg-white/[0.01]' : 'opacity-40'
                        )}>
                          <button onClick={() => updateSignal(sig.name, { selected: !sig.selected })}
                            className={clsx('h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0',
                              sig.selected ? 'bg-neon-cyan border-neon-cyan' : 'border-white/20'
                            )}>
                            {sig.selected && <CheckCircle className="h-2.5 w-2.5 text-black" />}
                          </button>
                          <span className="text-xs font-mono flex-1 truncate">{sig.name}</span>
                          <Select value={String(sig.interval)}
                            onChange={e => updateSignal(sig.name, { interval: Number(e.target.value) })}
                            className={clsx(
                              'border border-white/[0.1] rounded px-2 py-0.5 text-xs min-w-[80px]',
                              intervalOpt.color
                            )}
                            options={INTERVAL_OPTIONS.map(o => ({ value: String(o.value), label: o.label }))}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--surface)] flex items-center justify-between">
          <div className="text-xs text-[var(--text-muted)]">
            {selectedCount} signals selected
            {selectedCount > 0 && ` • ${signals.filter(s => s.selected && s.interval === 0).length} at 500ms`}
            {selectedCount > 0 && ` • ${signals.filter(s => s.selected && s.interval === 10).length} at 10s`}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-medium border border-white/[0.1] hover:bg-white/[0.05] transition-colors">
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={selectedCount === 0}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-neon-cyan text-black hover:bg-neon-cyan/80 disabled:opacity-40 transition-colors flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5" />
              Subscribe {selectedCount} Signals
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
