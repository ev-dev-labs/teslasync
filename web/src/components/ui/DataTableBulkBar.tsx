import { type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { tableTokens } from '@/lib/tokens'
import { Button } from './Button'
import { Icon } from './Icon'
import { Text } from './Typography'

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
  // Coerce to a safe non-negative integer: callers commonly wire
  // `count={data?.length}` or `count={selection.size}`, which can surface
  // undefined/NaN/fractional/Infinity before a query resolves. A bare
  // `count <= 0` check lets NaN and undefined slip through and would render
  // a nonsensical "NaN selected" / "undefined selected" toolbar.
  const safeCount = Number.isFinite(count) ? Math.trunc(count) : 0
  if (safeCount <= 0) return null
  return (
    <div role="region" aria-label={t('table.bulkActions.region', 'Bulk actions')} className={cn(tableTokens.bulkBar, 'min-w-0 max-w-full', className)}>
      <Text size="sm" weight="medium" color="primary" className="min-w-0 break-words" aria-live="polite">
        {t('table.bulkActions.selected', '{{count}} selected', { count: safeCount })}
      </Text>
      <div className="ms-auto flex min-w-0 max-w-full flex-wrap items-center gap-2">
        {children}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          wrapLabel
          onClick={onClear}
          className="min-h-11 md:min-h-9 text-[var(--text-secondary)]"
          icon={<Icon icon={X} size="xs" />}
          aria-label={t('table.bulkActions.clear', 'Clear selection')}
        >
          {t('table.bulkActions.clear', 'Clear selection')}
        </Button>
      </div>
    </div>
  )
}
