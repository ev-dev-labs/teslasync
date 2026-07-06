import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Columns3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'

interface ColumnDescriptor {
  key: string
  header: string
  /** When true, this column cannot be hidden (e.g. selection / expand columns). */
  required?: boolean
}

interface DataTableColumnsMenuProps {
  columns: ColumnDescriptor[]
  visibleKeys: string[]
  onChange: (next: string[]) => void
  /** Optional trigger render-prop. Receives a `toggle` callback that opens or
   *  closes the popover. Defaults to a small "Columns" icon button. */
  trigger?: (toggle: () => void) => ReactNode
  className?: string
}

/**
 * Popover with checkboxes for toggling column visibility. Persists nothing on
 * its own — DataTable owns persistence via tableId.
 *
 * Click-outside closes the popover. Escape also closes.
 *
 * `required` columns are always treated as visible: they render checked, cannot
 * be unchecked, and are always included in the emitted key list regardless of
 * what `visibleKeys` contains. The last remaining visible column can never be
 * hidden either, so the table always renders at least one column.
 */
export function DataTableColumnsMenu({
  columns,
  visibleKeys,
  onChange,
  trigger,
  className,
}: DataTableColumnsMenuProps) {
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

  const cols = columns ?? []

  const visibleSet = useMemo(() => new Set(visibleKeys ?? []), [visibleKeys])
  const requiredKeys = useMemo(
    () => new Set((columns ?? []).filter((c) => c.required).map((c) => c.key)),
    [columns],
  )

  // Keys that are effectively visible right now = every required column plus the
  // caller's chosen ones, in source column order. Drives the "keep at least one
  // visible" guard and the disabled state of the last remaining checkbox.
  const visibleColumnKeys = useMemo(
    () =>
      (columns ?? [])
        .map((c) => c.key)
        .filter((k) => requiredKeys.has(k) || visibleSet.has(k)),
    [columns, requiredKeys, visibleSet],
  )

  // Emit a fresh key list in source column order, always keeping required
  // columns present so a "cannot be hidden" column can never fall out.
  const emit = useCallback(
    (next: Set<string>) => {
      onChange(
        (columns ?? []).map((c) => c.key).filter((k) => requiredKeys.has(k) || next.has(k)),
      )
    },
    [columns, requiredKeys, onChange],
  )

  const toggle = useCallback(
    (key: string) => {
      if (requiredKeys.has(key)) return // required columns are always visible
      const next = new Set(visibleSet)
      if (next.has(key)) {
        // Don't allow hiding the last visible column — at least one must stay.
        if (visibleColumnKeys.length <= 1) return
        next.delete(key)
      } else {
        next.add(key)
      }
      emit(next)
    },
    [requiredKeys, visibleSet, visibleColumnKeys, emit],
  )

  const showAll = useCallback(
    () => onChange((columns ?? []).map((c) => c.key)),
    [columns, onChange],
  )

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
          aria-label={t('table.columns.menu', 'Show or hide columns')}
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
          aria-label={t('table.columns.menu', 'Show or hide columns')}
          data-testid="datatable-columns-menu"
          className={cn(
            'absolute right-0 z-30 mt-1 w-56 rounded-lg p-2',
            'border border-white/[0.08] bg-[var(--surface-elevated)] shadow-xl',
          )}
        >
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-2xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
              {t('table.columns.heading', 'Visible columns')}
            </span>
            <button
              type="button"
              onClick={showAll}
              disabled={cols.length === 0}
              className="text-2xs font-medium text-cyan-300 hover:text-cyan-200 focus-visible:outline-none focus-visible:underline disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('table.columns.showAll', 'Show all')}
            </button>
          </div>
          {cols.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-[var(--text-muted)]">
              {t('table.columns.empty', 'No columns to configure')}
            </p>
          ) : (
            <ul className="space-y-0.5 max-h-64 overflow-y-auto" role="presentation">
              {cols.map((col) => {
                const checked = col.required || visibleSet.has(col.key)
                const disabled = col.required || (checked && visibleColumnKeys.length <= 1)
                return (
                  <li key={col.key}>
                    <label
                      className={cn(
                        'flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer',
                        'text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]',
                        disabled && 'opacity-50 cursor-not-allowed',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(col.key)}
                        data-testid={`datatable-columns-menu-checkbox-${col.key}`}
                        className="rounded border-[var(--border-strong)] bg-[var(--surface-2)] text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                      />
                      <span className="truncate">{col.header || col.key}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
