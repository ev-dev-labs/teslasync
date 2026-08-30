import { useState, useMemo, useEffect } from 'react'
import { Search, Zap, Battery, Gauge, Shield, Thermometer, Radio, Settings, Wrench, ChevronDown, CheckCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Input, Modal, Select } from '.'

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
  { value: 86400, label: '24h', color: 'text-[var(--text-muted)]', desc: 'Daily' },
]

/** Fallback sampling cadence (seconds) applied when a caller omits `initialInterval`. */
const DEFAULT_INTERVAL = 10

// Static <Select> option lists, derived once at module load so the hot signal
// list never rebuilds identical arrays on every render.
const MASTER_INTERVAL_OPTIONS = INTERVAL_OPTIONS.map(o => ({ value: String(o.value), label: `${o.label} (${o.desc})` }))
const SIGNAL_INTERVAL_OPTIONS = INTERVAL_OPTIONS.map(o => ({ value: String(o.value), label: o.label }))

const PRESETS = [
  { name: '⚡ Real-time Driving', desc: 'Driving signals at 1s, battery at 10s, config at 24h',
    apply: (fields: SignalConfig[]) => fields.map(f => ({
      ...f,
      selected: true,
      interval: ['Driving','Powertrain','Location'].includes(f.category) ? 1 :
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
  { name: '🏎️ Track Mode', desc: 'Driving & powertrain at 1s, everything else at 30s',
    apply: (fields: SignalConfig[]) => fields.map(f => ({
      ...f,
      selected: true,
      interval: ['Driving','Powertrain','Location'].includes(f.category) ? 1 :
                ['Vehicle Config','User Preference'].includes(f.category) ? 3600 : 30,
    })),
  },
  { name: '💰 Cost Saver', desc: 'Essential signals only at 5–15min, non-essentials off',
    apply: (fields: SignalConfig[]) => fields.map(f => ({
      ...f,
      selected: ['Location','Charging','Vehicle State','Safety'].includes(f.category),
      interval: f.category === 'Vehicle State' ? 900 :
                ['Location','Charging','Safety'].includes(f.category) ? 300 : 300,
    })),
  },
  { name: '😴 Sleep Watch', desc: 'Security & location at 60s, charging at 1min, rest off',
    apply: (fields: SignalConfig[]) => fields.map(f => ({
      ...f,
      selected: ['Safety','Vehicle State','Location','Charging','Climate'].includes(f.category),
      interval: ['Safety','Vehicle State','Charging'].includes(f.category) ? 60 :
                ['Location','Climate'].includes(f.category) ? 300 : 300,
    })),
  },
  { name: '🔧 Diagnostics', desc: 'Powertrain/tires/climate at 5s, driving at 10s',
    apply: (fields: SignalConfig[]) => fields.map(f => ({
      ...f,
      selected: true,
      interval: ['Powertrain','Tires & Service','Climate'].includes(f.category) ? 5 :
                ['Driving','Charging','Vehicle State','Safety','Location'].includes(f.category) ? 10 :
                f.category === 'Media' ? 60 : 3600,
    })),
  },
  { name: '🗺️ Trip Logger', desc: 'Location at 1s, driving at 5s — optimized for routes',
    apply: (fields: SignalConfig[]) => fields.map(f => ({
      ...f,
      selected: !['Media','User Preference','Vehicle Config'].includes(f.category),
      interval: f.category === 'Location' ? 1 :
                f.category === 'Driving' ? 5 :
                ['Powertrain','Charging'].includes(f.category) ? 30 :
                ['Climate','Vehicle State','Safety'].includes(f.category) ? 60 : 300,
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

/**
 * Build the flat signal list from the category definitions, pre-selecting any
 * field present in `initialSelected`. Null-safe: missing `categories`/`fields`
 * collapse to an empty list rather than throwing on `.flatMap`/`.map`.
 */
function seedSignals(
  categories: CategoryDef[] | undefined,
  initialSelected: string[] | undefined,
  interval: number,
): SignalConfig[] {
  const selected = initialSelected ?? []
  return (categories ?? []).flatMap(cat =>
    (cat.fields ?? []).map(f => ({
      name: f,
      category: cat.category,
      selected: selected.includes(f),
      interval,
    })),
  )
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
  const { t } = useTranslation()
  const seedInterval = initialInterval ?? DEFAULT_INTERVAL

  const [signals, setSignals] = useState<SignalConfig[]>(() => seedSignals(categories, initialSelected, seedInterval))
  const [search, setSearch] = useState('')
  const [masterInterval, setMasterInterval] = useState(seedInterval)
  const [expandedCats, setExpandedCats] = useState<Set<string>>(() => new Set((categories ?? []).map(c => c.category)))

  // Re-seed from the latest props whenever the dialog opens so a reopened modal
  // reflects the current saved configuration (and a cleared search) instead of
  // stale first-mount state. Keyed on `open` only: a parent re-render while the
  // modal is already open must NOT wipe the user's in-progress edits.
  useEffect(() => {
    if (!open) return
    setSignals(seedSignals(categories, initialSelected, seedInterval))
    setMasterInterval(seedInterval)
    setExpandedCats(new Set((categories ?? []).map(c => c.category)))
    setSearch('')
  }, [open])

  const query = search.trim().toLowerCase()
  const filtered = useMemo(
    () => signals.filter(s => s.name.toLowerCase().includes(query)),
    [signals, query],
  )

  const selectedCount = signals.filter(s => s.selected).length
  const totalCount = signals.length
  const allSelected = totalCount > 0 && selectedCount === totalCount
  const at500msCount = signals.filter(s => s.selected && s.interval === 0).length
  const at10sCount = signals.filter(s => s.selected && s.interval === 10).length

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, SignalConfig[]>()
    for (const s of filtered) {
      const arr = map.get(s.category) ?? []
      arr.push(s)
      map.set(s.category, arr)
    }
    return map
  }, [filtered])

  const categoryIntervalOptions = useMemo(
    () => [{ value: '', label: t('signalConfig.setAll', 'Set all…') }, ...SIGNAL_INTERVAL_OPTIONS],
    [t],
  )

  const updateSignal = (name: string, updates: Partial<SignalConfig>) => {
    setSignals(prev => prev.map(s => (s.name === name ? { ...s, ...updates } : s)))
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
    const allCatSelected = catSignals.length > 0 && catSignals.every(s => s.selected)
    setSignals(prev => prev.map(s => (s.category === category ? { ...s, selected: !allCatSelected } : s)))
  }

  const setCategoryInterval = (category: string, interval: number) => {
    setSignals(prev => prev.map(s => (s.category === category ? { ...s, interval } : s)))
  }

  const toggleExpanded = (category: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  const applyPreset = (preset: typeof PRESETS[0]) => {
    setSignals(prev => preset.apply(prev))
  }

  const handleSubmit = () => {
    const selected = signals.filter(s => s.selected).map(s => ({ name: s.name, interval: s.interval }))
    onSubmit(selected)
    onClose()
  }

  // The shared <Modal> enforces viewport-bound sizing
  // (max-h-[90vh] desktop / max-h-[100dvh] mobile) so the dialog never escapes
  // the screen. Master controls + footer are positioned `sticky` so they remain
  // visible while the signal list scrolls.
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('signalConfig.title', 'Fleet Telemetry Signal Configuration')}
      size="full"
    >
      <p className="-mt-1 mb-3 text-xs text-[var(--text-muted)]">
        {t('signalConfig.selectedSummary', '{{selected}} / {{total}} signals selected', {
          selected: selectedCount,
          total: totalCount,
        })}
      </p>

      {/* Master Controls — sticky to top of Modal scroll container */}
      <div className="sticky top-0 z-10 -mx-4 -mt-3 space-y-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:-mx-6 sm:px-6">
        {/* Presets */}
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(p => (
            <button key={p.name} type="button" onClick={() => applyPreset(p)} title={p.desc}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.03] border border-white/[0.08] hover:border-neon-cyan/30 hover:bg-neon-cyan/5 transition-colors">
              {p.name}
            </button>
          ))}
        </div>

        {/* Master Toggle + Master Interval */}
        <div className="flex items-center gap-4 flex-wrap">
          <button type="button" onClick={() => toggleAll(!allSelected)} aria-pressed={allSelected}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              allSelected ? 'bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan' : 'bg-white/[0.03] border-white/[0.08] text-[var(--text-secondary)]'
            )}>
            <span className={cn('h-3 w-3 rounded border flex items-center justify-center', allSelected ? 'bg-neon-cyan border-neon-cyan' : 'border-[var(--border-strong)]')}>
              {allSelected && <CheckCircle className="h-2 w-2 text-[var(--text-on-accent)]" aria-hidden="true" />}
            </span>
            {allSelected ? t('signalConfig.deselectAll', 'Deselect All') : t('signalConfig.selectAll', 'Select All')}
          </button>

          <div className="flex items-center gap-2">
            <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">{t('signalConfig.masterInterval', 'Master Interval:')}</span>
            <Select value={String(masterInterval)} onChange={e => setMasterIntervalAll(Number(e.target.value))}
              aria-label={t('signalConfig.masterIntervalLabel', 'Master sampling interval for all signals')}
              className="px-2 py-1 text-xs"
              options={MASTER_INTERVAL_OPTIONS}
            />
          </div>

          <div className="relative ml-auto flex-1 max-w-xs">
            <Input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder={t('signalConfig.searchPlaceholder', 'Search signals...')}
              aria-label={t('signalConfig.searchLabel', 'Search signals')}
              icon={<Search className="h-3.5 w-3.5" aria-hidden="true" />}
              className="w-full text-xs"
            />
          </div>
        </div>
      </div>

      {/* Signal List */}
      <div className="space-y-2 py-3">
        {grouped.size === 0 ? (
          <EmptyState
            icon={<Search className="h-6 w-6" aria-hidden="true" />}
            message={query
              ? t('signalConfig.noMatches', 'No signals match “{{query}}”.', { query: search.trim() })
              : t('signalConfig.noSignals', 'No telemetry signals are available to configure.')}
          />
        ) : (
          Array.from(grouped.entries()).map(([category, catSignals]) => {
            const expanded = expandedCats.has(category)
            const allCatSelected = catSignals.every(s => s.selected)
            const someCatSelected = catSignals.some(s => s.selected)
            const CatIcon = CATEGORY_ICONS[category] ?? Zap
            const catSelectedCount = catSignals.filter(s => s.selected).length

            return (
              <div key={category} className="border border-white/[0.06] rounded-xl overflow-hidden">
                {/* Category Header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.02]">
                  <button type="button" onClick={() => toggleCategory(category)} aria-pressed={allCatSelected}
                    aria-label={allCatSelected
                      ? t('signalConfig.deselectCategory', 'Deselect all {{category}} signals', { category })
                      : t('signalConfig.selectCategory', 'Select all {{category}} signals', { category })}
                    className={cn('touch-target-overlay h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0',
                      allCatSelected ? 'bg-neon-cyan border-neon-cyan' : someCatSelected ? 'bg-neon-cyan/40 border-neon-cyan/60' : 'border-[var(--border-strong)]'
                    )}>
                    {allCatSelected && <CheckCircle className="h-2.5 w-2.5 text-[var(--text-on-accent)]" aria-hidden="true" />}
                  </button>
                  <button type="button" onClick={() => toggleExpanded(category)} aria-expanded={expanded}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <ChevronDown className={cn('h-3.5 w-3.5 text-[var(--text-muted)] transition-transform', !expanded && '-rotate-90')} aria-hidden="true" />
                    <CatIcon className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{category}</span>
                    <span className="text-2xs text-[var(--text-muted)]">({catSelectedCount}/{catSignals.length})</span>
                  </button>
                  <div className="ml-auto flex items-center gap-2">
                    <Select value="" onChange={e => { if (e.target.value) setCategoryInterval(category, Number(e.target.value)) }}
                      aria-label={t('signalConfig.setCategoryInterval', 'Set interval for all {{category}} signals', { category })}
                      className="bg-transparent border border-white/[0.08] rounded px-1.5 py-0.5 text-2xs text-[var(--text-muted)]"
                      options={categoryIntervalOptions}
                    />
                  </div>
                </div>

                {/* Signal Rows */}
                {expanded && (
                  <div className="divide-y divide-white/[0.03]">
                    {catSignals.map(sig => {
                      const intervalOpt = INTERVAL_OPTIONS.find(o => o.value === sig.interval) ?? INTERVAL_OPTIONS[3]
                      return (
                        <div key={sig.name} className={cn(
                          'flex items-center gap-2 px-4 py-1.5 transition-colors',
                          sig.selected ? 'bg-white/[0.01]' : 'opacity-40'
                        )}>
                          <button type="button" onClick={() => updateSignal(sig.name, { selected: !sig.selected })} aria-pressed={sig.selected}
                            aria-label={sig.selected
                              ? t('signalConfig.deselectSignal', 'Deselect {{signal}}', { signal: sig.name })
                              : t('signalConfig.selectSignal', 'Select {{signal}}', { signal: sig.name })}
                            className={cn('touch-target-overlay h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0',
                              sig.selected ? 'bg-neon-cyan border-neon-cyan' : 'border-[var(--border-strong)]'
                            )}>
                            {sig.selected && <CheckCircle className="h-2.5 w-2.5 text-[var(--text-on-accent)]" aria-hidden="true" />}
                          </button>
                          <span className="text-xs font-mono flex-1 truncate">{sig.name}</span>
                          <Select value={String(sig.interval)}
                            onChange={e => updateSignal(sig.name, { interval: Number(e.target.value) })}
                            aria-label={t('signalConfig.intervalForSignal', 'Sampling interval for {{signal}}', { signal: sig.name })}
                            className={cn(
                              'border border-white/[0.1] rounded px-2 py-0.5 text-xs min-w-[80px]',
                              intervalOpt.color
                            )}
                            options={SIGNAL_INTERVAL_OPTIONS}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Footer — sticky to bottom of Modal scroll container */}
      <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:-mx-6 sm:-mb-6 sm:px-6">
        <div className="text-xs text-[var(--text-muted)]">
          {t('signalConfig.footerSelected', '{{n}} signals selected', { n: selectedCount })}
          {selectedCount > 0 && ` • ${t('signalConfig.footerAt500', '{{n}} at 500ms', { n: at500msCount })}`}
          {selectedCount > 0 && ` • ${t('signalConfig.footerAt10s', '{{n}} at 10s', { n: at10sCount })}`}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-medium border border-white/[0.1] hover:bg-white/[0.05] transition-colors">
            {t('common.cancel', 'Cancel')}
          </button>
          <button type="button" onClick={handleSubmit} disabled={selectedCount === 0}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-neon-cyan text-[var(--text-on-accent)] hover:bg-neon-cyan/80 disabled:opacity-40 transition-colors flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5" aria-hidden="true" />
            {t('signalConfig.subscribeCount', 'Subscribe {{n}} Signals', { n: selectedCount })}
          </button>
        </div>
      </div>
    </Modal>
  )
}
