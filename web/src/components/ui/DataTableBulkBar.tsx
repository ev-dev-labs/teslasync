import { type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { tableTokens } from '@/lib/tokens'

interface DataTableBulkBarProps {
  count: number
  onClear: () => void
  children?: ReactNode
  className?: string
}

/**
 * Selection toolbar shown above the table when at least one row is selected.
 * The consumer renders bulk actions (Export, Delete, Archive, …) into the
 * `children` slot. Always provides a "Clear selection" button + count.
 *
 * Styling lives in `tableTokens.bulkBar`.
 *
 * Wrap destructive bulk actions in `<ConfirmDialog>` (see TABLE_GUIDELINES.md).
 */
export function DataTableBulkBar({ count, onClear, children, className }: DataTableBulkBarProps) {
  const { t } = useTranslation()
  if (count <= 0) return null
  return (
    <div role="region" aria-label={t('table.bulkActions.region', 'Bulk actions')} className={cn(tableTokens.bulkBar, className)}>
      <span className="font-medium" aria-live="polite">
        {t('table.bulkActions.selected', '{{count}} selected', { count })}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {children}
        <button
          type="button"
          onClick={onClear}
          className={cn(
            'inline-flex items-center gap-1 rounded px-2 py-1 text-xs',
            'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/[0.06]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
            'transition-colors',
          )}
          aria-label={t('table.bulkActions.clear', 'Clear selection')}
        >
          <X className="h-3 w-3" aria-hidden="true" />
          <span>{t('table.bulkActions.clear', 'Clear selection')}</span>
        </button>
      </div>
    </div>
  )
}
