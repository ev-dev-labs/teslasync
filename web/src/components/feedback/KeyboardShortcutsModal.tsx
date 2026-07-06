import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { Modal } from '@/components/ui'
import { SearchInput } from '@/components/forms'
import { useAllShortcuts, type ShortcutDefinition } from '@/hooks/useShortcutRegistry'

/**
 * KeyboardShortcutsModal — , refactored in .
 *
 * Single source of truth for the "?" cheat sheet. Reads from the
 * {@link useShortcutRegistry} so any page or component can declare new
 * shortcuts (`useShortcut(...)`) and have them appear here automatically.
 * The previous hardcoded `SHORTCUT_GROUPS` array (and the legacy
 * `KeyboardCheatSheet` component) are gone.
 *
 * Surfaces three controls:
 * - Search input (filters by description)
 * - Filter chips: All / Global / This page
 * - When the user is on a page that registered shortcuts, the modal jumps
 * to that page's group on open.
 *
 * Filter selection persists in `sessionStorage` so the user's choice
 * survives within the tab session (deliberately not localStorage —
 * "All" is a sensible long-term default).
 */

interface ShortcutGroup {
  title: string
  shortcuts: ShortcutDefinition[]
}

interface KeyboardShortcutsModalProps {
  open: boolean
  onClose: () => void
}

type FilterMode = 'all' | 'global' | 'page'

const FILTER_STORAGE_KEY = 'teslasync:shortcuts:filter:v1'

function readStoredFilter(): FilterMode {
  if (typeof window === 'undefined') return 'all'
  try {
    const raw = window.sessionStorage.getItem(FILTER_STORAGE_KEY)
    if (raw === 'all' || raw === 'global' || raw === 'page') return raw
  } catch {
    // ignored — sessionStorage may throw in private mode / SSR
  }
  return 'all'
}

function writeStoredFilter(mode: FilterMode): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(FILTER_STORAGE_KEY, mode)
  } catch {
    // ignored
  }
}

/**
 * Sort groups so the cheatsheet always reads top-down: navigation → actions
 * → table-ish → page-specific. Anything not in the priority map is alpha-
 * sorted at the bottom (page groups end up there naturally).
 */
const GROUP_PRIORITY: Record<string, number> = {
  navigation: 100,
  actions: 90,
  global: 90,
  commands: 80,
  table: 70,
  bulk: 60,
  form: 50,
  chart: 40,
  dashboard: 30,
  replay: 20,
}

function groupRank(label: string): number {
  const key = (label ?? '').toLowerCase().split(/\s|[(]/)[0]
  return GROUP_PRIORITY[key] ?? 0
}

export function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  const { t } = useTranslation()
  const location = useLocation()
  const allShortcuts = useAllShortcuts()
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<FilterMode>(readStoredFilter)

  // Reset the live search box every time the modal closes — it's a noisy
  // input that shouldn't bleed into the next session.
  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  const filteredGroups = useMemo<ShortcutGroup[]>(() => {
    const needle = search.trim().toLowerCase()
    const pathname = location.pathname

    const visible = (allShortcuts ?? []).filter((def) => {
      // Scope filter
      if (mode === 'global' && def.scope !== 'global') return false
      if (mode === 'page' && def.scope === 'global') return false
      if (def.scope !== 'global') {
        if (!def.routeMatch) return false
        const matches =
          typeof def.routeMatch === 'string'
            ? pathname.startsWith(def.routeMatch)
            : def.routeMatch.test(pathname)
        if (!matches) return false
      }
      // Search filter
      if (needle && !def.description.toLowerCase().includes(needle)) return false
      return true
    })

    // Group by translated label
    const byGroup = new Map<string, ShortcutDefinition[]>()
    for (const def of visible) {
      const list = byGroup.get(def.group)
      if (list) list.push(def)
      else byGroup.set(def.group, [def])
    }

    // Sort groups + sort entries inside each by id for stable rendering
    return Array.from(byGroup.entries())
      .map<ShortcutGroup>(([title, shortcuts]) => ({
        title,
        shortcuts: [...shortcuts].sort((a, b) => a.id.localeCompare(b.id)),
      }))
      .sort((a, b) => {
        const ra = groupRank(a.title)
        const rb = groupRank(b.title)
        if (ra !== rb) return rb - ra
        return a.title.localeCompare(b.title)
      })
  }, [allShortcuts, mode, search, location.pathname])

  const handleFilter = useCallback((next: FilterMode) => {
    setMode(next)
    writeStoredFilter(next)
  }, [])

  const filterOptions = useMemo<Array<{ id: FilterMode; label: string }>>(
    () => [
      { id: 'all', label: t('shortcuts.filter.all', 'All') },
      { id: 'global', label: t('shortcuts.filter.global', 'Global') },
      { id: 'page', label: t('shortcuts.filter.page', 'This page') },
    ],
    [t],
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('shortcuts.title', 'Keyboard Shortcuts')}
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('shortcuts.search', 'Search shortcuts…')}
            debounceMs={120}
            className="flex-1"
          />
          <div
            role="tablist"
            aria-label={t('shortcuts.filter.label', 'Filter shortcuts')}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--glass-border)] bg-[var(--surface-2)] p-0.5"
          >
            {filterOptions.map((opt) => {
              const active = opt.id === mode
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => handleFilter(opt.id)}
                  className={
                    'rounded-md px-3 py-1 text-xs font-medium transition-colors ' +
                    (active
                      ? 'bg-[var(--accent-blue,#3b82f6)]/20 text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]')
                  }
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-1">
          {filteredGroups.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--text-muted)]">
              {t('shortcuts.empty', 'No shortcuts match your search.')}
            </p>
          ) : (
            filteredGroups.map((group) => (
              <section key={group.title}>
                <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">
                  {group.title}
                </h3>
                <div className="space-y-1.5">
                  {group.shortcuts.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between py-1"
                    >
                      <span className="text-sm text-[var(--text-secondary)]">
                        {s.description}
                      </span>
                      <div className="flex items-center gap-1">
                        {(s.keys ?? []).map((key, i) => (
                          <span key={i} className="flex items-center gap-1">
                            {i > 0 && (
                              <span className="text-[var(--text-muted)] text-xs">+</span>
                            )}
                            <kbd
                              className="px-2 py-0.5 rounded bg-[var(--surface-2)] border border-[var(--glass-border)]
                                text-xs font-mono text-[var(--text-secondary)] min-w-[24px] text-center"
                            >
                              {key}
                            </kbd>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </Modal>
  )
}
