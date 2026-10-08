import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Columns3, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { Checkbox } from './Checkbox'
import { Icon } from './Icon'
import { Label, Text } from './Typography'
import {
  applyColumnLayout,
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

  const ensureLayout = (): ColumnLayout => ({
    order: orderedKeys,
    hidden: Array.from(effectiveHidden),
  })

  // Effective hidden set used to drive checkbox `checked` state. When the
  // user hasn't touched anything yet, we honor `defaultVisible: false` so
  // the menu reflects the table's initial render.
  const effectiveHidden = useMemo(
    () => {
      const visible = new Set(applyColumnLayout(safeColumns, layout).map((column) => column.key))
      return new Set(safeColumns.filter((column) => !visible.has(column.key)).map((column) => column.key))
    },
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

  const allVisible = safeColumns.length > 0 && visibleCount === safeColumns.length
  const handleToggleAll = () => {
    const base = ensureLayout()
    if (!allVisible) {
      onChange({ order: base.order, hidden: [] })
      return
    }
    // A usable table always retains required columns, or its first ordered column.
    const retained = new Set(safeColumns.filter(column => column.required).map(column => column.key))
    if (retained.size === 0 && orderedKeys[0]) retained.add(orderedKeys[0])
    onChange({ order: base.order, hidden: orderedKeys.filter(key => !retained.has(key)) })
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
            'inline-flex min-h-11 items-center gap-2 rounded-shape-sm px-3 py-2 md:min-h-9',
            'border border-[var(--control-border)] bg-[var(--control-bg)]',
            'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--control-bg-hover)]',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
            'transition-colors duration-fast ease-standard motion-reduce:transition-none',
          )}
        >
          <Icon icon={Columns3} size="sm" />
          <Text variant="bodySm">{t('table.columns.button', 'Columns')}</Text>
        </button>
      )}

      {open && (
        <div
          role="menu"
          aria-label={triggerLabel}
          data-testid="datatable-column-menu"
          className={cn(
            'absolute end-0 z-30 mt-1 w-72 rounded-shape-lg p-2',
            'border border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-e2',
          )}
        >
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <Label className="min-w-0 break-words">
              {reorderable
                ? t('table.columns.headingReorder', 'Columns')
                : t('table.columns.heading', 'Visible columns')}
            </Label>
            <button
              type="button"
              onClick={() => {
                onReset()
              }}
              data-testid="datatable-column-menu-reset"
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-shape-sm px-2 text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] md:min-h-6"
            >
              <Icon icon={RotateCcw} size="xs" />
              <Text variant="bodySm">{t('table.columns.reset', 'Reset')}</Text>
            </button>
          </div>
          {toggleable && safeColumns.length > 0 && (
            <div className="mb-1 border-b border-[var(--border-subtle)] px-2 pb-2">
              <Checkbox
                label={t('table.columns.selectAll', 'Select all')}
                aria-label={t('table.columns.selectAll', 'Select all')}
                checked={allVisible}
                indeterminate={!allVisible && visibleCount > 0}
                aria-checked={allVisible ? true : visibleCount > 0 ? 'mixed' : false}
                disabled={allVisible && (safeColumns.length === 1 || safeColumns.every(column => column.required))}
                onChange={handleToggleAll}
                className="min-h-11 w-full"
              />
            </div>
          )}
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
                      'flex items-center gap-2 rounded-shape-sm px-2 py-2',
                      'text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)]',
                    )}
                  >
                    {toggleable && (
                      <Checkbox
                        checked={checked}
                        disabled={checkboxDisabled}
                        onChange={() => handleToggle(col.key)}
                        aria-label={t('table.columns.toggleColumn', 'Show or hide {{col}}', {
                          col: col.header || col.key,
                        })}
                      />
                    )}
                    <Text variant="bodySm" className="min-w-0 flex-1 break-words">{col.header || col.key}</Text>
                    {reorderable && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleMove(col.key, -1)}
                          disabled={upDisabled}
                          aria-label={t('table.columns.moveUp', 'Move {{col}} up', {
                            col: col.header || col.key,
                          })}
                          data-testid={`datatable-column-menu-up-${col.key}`}
                          className={cn(
                            'inline-flex h-11 w-11 items-center justify-center rounded-shape-sm md:h-6 md:w-6',
                            'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--control-bg-hover)]',
                            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
                            'disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-transparent',
                          )}
                        >
                          <Icon icon={ArrowUp} size="sm" />
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
                            'inline-flex h-11 w-11 items-center justify-center rounded-shape-sm md:h-6 md:w-6',
                            'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--control-bg-hover)]',
                            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
                            'disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-transparent',
                          )}
                        >
                          <Icon icon={ArrowDown} size="sm" />
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
                className="px-2 py-3 text-center"
              >
                <Text variant="bodySm">{t('table.columns.empty', 'No columns to configure')}</Text>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
