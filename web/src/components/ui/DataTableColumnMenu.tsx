import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Columns3, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import {
  applyColumnLayout,
  defaultColumnLayout,
  effectiveColumnOrder,
  moveColumn,
  toggleHiddenColumn,
  type ColumnLayout,
} from '@/lib/columnOrderStore'

/**
 * Combined column visibility and reorder menu.
 * This supersedes `DataTableColumnsMenu` for tables that opt into either
 * `columnVisibility` or `columnReorder`. Renders an icon-button trigger
 * + popover with one row per column:
 *   [✓] Header                         ↑   ↓
 * - Checkbox toggles visibility (with the same "at least one must stay
 *   visible" guardrail as the legacy menu).
 * - ↑ / ↓ buttons are the keyboard fallback for drag-to-reorder; they
 *   move the column up / down within the effective order list.
 * - "Reset to defaults" button at the bottom clears the persisted layout
 *   so the table reverts to its source-defined order + `defaultVisible`
 *   visibility.
 * The component is deliberately storage-agnostic — DataTable owns the
 * `localStorage` round-trip and feeds us the current `layout` + a
 * controlled `onChange`.
 */

interface ColumnDescriptor {
  key: string
  header: string
  /** When true, the column cannot be hidden (e.g. selection / expand columns).
   *  Reorder is unaffected. */
  required?: boolean
  /** Default visibility for the "Reset" computation. Defaults to true. */
  defaultVisible?: boolean
}

interface DataTableColumnMenuProps {
  columns: ColumnDescriptor[]
  layout: ColumnLayout | null
  onChange: (next: ColumnLayout) => void
  onReset: () => void
  /** When false, ↑/↓ buttons are hidden and the menu acts as a pure
   *  visibility checklist (matches legacy `showColumnsMenu` behavior). */
  reorderable?: boolean
  /** When false, checkboxes are hidden and the menu acts as a pure
   *  reorder list. */
  toggleable?: boolean
  trigger?: (open: () => void) => ReactNode
  className?: string
}

export function DataTableColumnMenu({
  columns,
  layout,
  onChange,
  onReset,
  reorderable = true,
  toggleable = true,
  trigger,
  className,
}: DataTableColumnMenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Defensive: props are typed to require an array, but a transient
  // `undefined` from a still-loading parent must never crash the menu on
  // the `.map` / `.length` reads below.
  const safeColumns = useMemo(() => columns ?? [], [columns])

  // Derived layout views are pure functions of (columns, layout); memoize so
  // the Map/Set/array rebuilds don't run on every unrelated re-render.
  const orderedKeys = useMemo(
    () => effectiveColumnOrder(safeColumns, layout),
    [safeColumns, layout],
  )
  const colByKey = useMemo(
    () => new Map(safeColumns.map((c) => [c.key, c] as const)),
    [safeColumns],
  )
  const visibleCount = useMemo(
    () => applyColumnLayout(safeColumns, layout).length,
    [safeColumns, layout],
  )

  const ensureLayout = (): ColumnLayout =>
    layout ?? defaultColumnLayout(safeColumns)

  // Effective hidden set used to drive checkbox `checked` state. When the
  // user hasn't touched anything yet, we honor `defaultVisible: false` so
  // the menu reflects the table's initial render.
  const effectiveHidden = useMemo(
    () => new Set((layout ?? defaultColumnLayout(safeColumns)).hidden),
    [layout, safeColumns],
  )

  const handleToggle = (key: string) => {
    const base = ensureLayout()
    const col = colByKey.get(key)
    const isHidden = base.hidden.includes(key)
    // Refuse to hide a required column or the last remaining visible one.
    // The checkbox is also rendered `disabled` for these cases, but the
    // state-mutation path must enforce the invariant independently so a
    // programmatic / keyboard toggle can never violate it.
    if (!isHidden && (col?.required || visibleCount <= 1)) return
    onChange(toggleHiddenColumn(base, key))
  }

  const handleMove = (key: string, direction: -1 | 1) => {
    const base = ensureLayout()
    const currentOrder = effectiveColumnOrder(safeColumns, base)
    const fromIndex = currentOrder.indexOf(key)
    if (fromIndex < 0) return
    const toIndex = fromIndex + direction
    if (toIndex < 0 || toIndex >= currentOrder.length) return
    const nextOrder = moveColumn(currentOrder, key, toIndex)
    onChange({ order: nextOrder, hidden: base.hidden.slice() })
  }

  const triggerLabel = reorderable
    ? t('table.columns.menuReorder', 'Reorder or hide columns')
    : t('table.columns.menu', 'Show or hide columns')

  return (
    <div ref={containerRef} className={cn('relative inline-block', className)}>
      {trigger ? (
        trigger(() => setOpen((v) => !v))
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={triggerLabel}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs',
            'border border-white/[0.08] bg-white/[0.03]',
            'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/[0.06]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
            'transition-colors',
          )}
        >
          <Columns3 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t('table.columns.button', 'Columns')}</span>
        </button>
      )}

      {open && (
        <div
          role="menu"
          aria-label={triggerLabel}
          data-testid="datatable-column-menu"
          className={cn(
            'absolute right-0 z-30 mt-1 w-72 rounded-lg p-2',
            'border border-white/[0.08] bg-[var(--surface-elevated)] shadow-xl',
          )}
        >
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-2xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
              {reorderable
                ? t('table.columns.headingReorder', 'Columns')
                : t('table.columns.heading', 'Visible columns')}
            </span>
            <button
              type="button"
              onClick={() => {
                onReset()
              }}
              data-testid="datatable-column-menu-reset"
              className="inline-flex items-center gap-1 text-2xs font-medium text-cyan-300 hover:text-cyan-200 focus-visible:outline-none focus-visible:underline"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              <span>{t('table.columns.reset', 'Reset')}</span>
            </button>
          </div>
          <ul className="space-y-0.5 max-h-72 overflow-y-auto" role="presentation">
            {orderedKeys.map((key, idx) => {
              const col = colByKey.get(key)
              if (!col) return null
              const isHidden = effectiveHidden.has(key)
              const checked = !isHidden
              const checkboxDisabled = col.required || (checked && visibleCount <= 1)
              const upDisabled = idx === 0
              const downDisabled = idx === orderedKeys.length - 1
              return (
                <li key={col.key}>
                  <div
                    className={cn(
                      'flex items-center gap-2 px-2 py-1.5 rounded text-sm',
                      'text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]',
                    )}
                  >
                    {toggleable && (
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={checkboxDisabled}
                        onChange={() => handleToggle(col.key)}
                        aria-label={t('table.columns.toggleColumn', 'Show or hide {{col}}', {
                          col: col.header || col.key,
                        })}
                        className={cn(
                          'rounded border-[var(--border-strong)] bg-[var(--surface-2)] text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0',
                          checkboxDisabled && 'opacity-50 cursor-not-allowed',
                        )}
                      />
                    )}
                    <span className="flex-1 truncate">{col.header || col.key}</span>
                    {reorderable && (
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => handleMove(col.key, -1)}
                          disabled={upDisabled}
                          aria-label={t('table.columns.moveUp', 'Move {{col}} up', {
                            col: col.header || col.key,
                          })}
                          data-testid={`datatable-column-menu-up-${col.key}`}
                          className={cn(
                            'inline-flex h-6 w-6 items-center justify-center rounded',
                            'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.06]',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
                            'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent',
                          )}
                        >
                          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMove(col.key, 1)}
                          disabled={downDisabled}
                          aria-label={t('table.columns.moveDown', 'Move {{col}} down', {
                            col: col.header || col.key,
                          })}
                          data-testid={`datatable-column-menu-down-${col.key}`}
                          className={cn(
                            'inline-flex h-6 w-6 items-center justify-center rounded',
                            'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.06]',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
                            'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent',
                          )}
                        >
                          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
            {orderedKeys.length === 0 && (
              <li
                data-testid="datatable-column-menu-empty"
                className="px-2 py-3 text-center text-2xs text-[var(--text-muted)]"
              >
                {t('table.columns.empty', 'No columns to configure')}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
