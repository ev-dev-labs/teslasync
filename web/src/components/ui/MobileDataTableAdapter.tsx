import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Column } from './DataTable'
import { Button } from './Button'
import { Checkbox } from './Checkbox'
import { Modal } from './Modal'
import { Text } from './Typography'
import { MobileReferenceRow } from './mobile-grid-reference/MobileReferenceRow'
import { MobileReferenceState } from './mobile-grid-reference/MobileReferenceState'
import type { MobileRow } from './mobile-grid-reference/types'
import type { MobileDataTablePresentation, MobileTableRowKey } from './MobileDataTableAdapter.types'
import './mobile-grid-reference/mobile-grid-reference.css'

export function buildMobileTableRow<T>(
  row: T, key: MobileTableRowKey, columns: readonly Column<T>[],
  presentation: MobileDataTablePresentation<T>, label: string,
): MobileRow<MobileTableRowKey> {
  const permitted = columns.filter(column => presentation.canShowField?.(column.key, row) !== false)
  const display = (column: Column<T>) => {
    const value = presentation.displayValue(row, column.key)
    return value == null ? '—' : String(value)
  }
  const title = permitted.find(column => presentation.roles[column.key] === 'title')
  const primary = permitted.find(column => presentation.roles[column.key] === 'primary')
  const metadata = permitted.filter(column => presentation.roles[column.key] === 'meta')
  const badge = permitted.find(column => presentation.roles[column.key] === 'badge')
  return {
    key, title: title ? display(title) : label, primary: primary ? display(primary) : '',
    // Additional metadata stays in full details; the card has at most three fields.
    meta: metadata.slice(0, 3).map(column => ({ key: column.key, label: column.header, value: display(column) })),
    badge: badge ? { label: badge.header, value: display(badge) } : undefined,
    progress: presentation.progress && permitted.some(column => column.key === presentation.progress?.columnKey)
      ? presentation.progress.value(row) : undefined,
    details: permitted.map(column => ({ key: column.key, label: column.header, value: display(column) })),
  }
}

interface Props<T> {
  rows: readonly T[]
  columns: readonly Column<T>[]
  allColumns: readonly Column<T>[]
  keyExtractor: (row: T) => MobileTableRowKey
  presentation: MobileDataTablePresentation<T>
  label: string
  rowLabel?: (row: T) => string
  selectedKeys: ReadonlySet<MobileTableRowKey>
  selectable: boolean
  multiSelect: boolean
  allSelected: boolean
  someSelected: boolean
  onToggleAll: () => void
  onToggle: (key: MobileTableRowKey, event: React.MouseEvent | React.ChangeEvent | React.KeyboardEvent) => void
  controls: ReactNode
  count: ReactNode
  onLoadMore?: () => void
  nextCount?: number
  onClear?: () => void
  emptyMessage: string
  expandedContent?: (row: T) => ReactNode
  expandedKeys?: ReadonlySet<MobileTableRowKey>
  onToggleExpanded?: (key: MobileTableRowKey) => void
  rowActions?: (row: T) => ReactNode
}

/** A presentation of processed rows, not a query/filter/export controller. */
export function MobileDataTableAdapter<T>({
  rows, columns, allColumns, keyExtractor, presentation, label, rowLabel, selectedKeys,
  selectable, multiSelect, allSelected, someSelected, onToggleAll, onToggle,
  controls, count, onLoadMore, nextCount, onClear, emptyMessage, expandedContent,
  expandedKeys, onToggleExpanded, rowActions,
}: Props<T>) {
  const { t } = useTranslation()
  const [selectionMode, setSelectionMode] = useState(false)
  const [detailKey, setDetailKey] = useState<MobileTableRowKey | null>(null)
  const detailRow = detailKey == null ? undefined : rows.find(row => keyExtractor(row) === detailKey)
  useEffect(() => {
    if (detailKey != null && detailRow == null) setDetailKey(null)
  }, [detailKey, detailRow])
  const state = presentation.state?.kind === 'ready' || !presentation.state
    ? rows.length ? { kind: 'ready' as const } : { kind: 'empty' as const, message: emptyMessage }
    : presentation.state
  const showRows = state.kind === 'ready' || (state.kind === 'error' && state.retained)
  const close = () => setDetailKey(null)
  return (
    <div className="mgr-mobile min-w-0 [&_button]:min-h-11 [&_button]:min-w-11" data-mobile-table="" aria-label={label}>
      <div className="flex flex-wrap items-center gap-2 py-2">{controls}</div>
      {selectable && <Button size="sm" variant="secondary" className="min-h-11"
        aria-pressed={selectionMode} onClick={() => setSelectionMode(previous => !previous)}>
        {selectionMode ? t('common.cancel', 'Cancel') : t('developerReference.mobileGrid.selection.enter', 'Select')}
      </Button>}
      {selectable && selectionMode && multiSelect && (
        <Checkbox className="min-h-11" checked={allSelected} indeterminate={someSelected}
          onChange={onToggleAll} aria-label={allSelected
            ? t('table.selection.deselectAll', 'Deselect all rows')
            : t('table.selection.selectAll', 'Select all rows')} />
      )}
      <div className="mgr-group overflow-clip bg-[var(--surface-1)]">
        <MobileReferenceState production state={state} callbacks={{
          onRetry: presentation.onRetry, onClear,
        }} />
        {showRows && rows.map(row => {
          const key = keyExtractor(row)
          const mobileRow = buildMobileTableRow(row, key, columns, presentation, label)
          const humanLabel = rowLabel?.(row) ?? mobileRow.title
          return <div key={`${typeof key}:${key}`}>
            <div className="flex min-w-0 items-center">
              <div className="min-w-0 flex-1">
                <MobileReferenceRow
                  row={mobileRow}
                  variant={presentation.variant ?? 'cards'} selecting={selectable && selectionMode}
                  selected={selectedKeys.has(key)}
                  selectionLabel={selectedKeys.has(key)
                    ? t('table.selection.deselectRowNamed', 'Deselect {{row}}', { row: humanLabel })
                    : t('table.selection.selectRowNamed', 'Select {{row}}', { row: humanLabel })}
                  onActivate={() => presentation.onOpenRow ? presentation.onOpenRow(row) : setDetailKey(key)}
                  onToggle={() => {}}
                  onSelectionEvent={event => onToggle(key, event)}
                />
              </div>
              <div data-mobile-row-actions="" className="flex shrink-0 flex-col gap-1 p-2">
                {presentation.inlineActions?.(row)}
                {rowActions?.(row)}
                {onToggleExpanded && <Button size="sm" variant="ghost"
                  aria-expanded={expandedKeys?.has(key) ?? false}
                  onClick={() => onToggleExpanded(key)}>
                  {expandedKeys?.has(key) ? t('table.expand.collapse', 'Collapse row') : t('table.expand.expand', 'Expand row')}
                </Button>}
                <Button size="sm" variant="ghost" className="min-h-11 min-w-11"
                  aria-label={t('common.quickView', 'Quick view')}
                  onClick={() => setDetailKey(key)}>{t('common.quickView', 'Quick view')}</Button>
              </div>
            </div>
            {expandedKeys?.has(key) && <div className="p-3">{expandedContent?.(row)}</div>}
          </div>
        })}
      </div>
      <div className="space-y-2 py-3">
        {count}
        {onLoadMore && showRows && <Button className="min-h-11 w-full" variant="secondary"
          onClick={onLoadMore}>{t('developerReference.mobileGrid.footer.loadMore', 'Load {{count}} more', { count: nextCount })}</Button>}
      </div>
      <Modal open={detailRow != null} onClose={close}
        title={detailRow != null ? rowLabel?.(detailRow) ?? label : label} size="lg"
        footer={<Button className="min-h-11 min-w-11" onClick={close}>{t('common.close', 'Close')}</Button>}>
        {detailRow != null && <div className="space-y-3">
          {allColumns.filter(column => presentation.canShowField?.(column.key, detailRow) !== false).map(column => (
            <div key={column.key} className="min-w-0 break-words">
              <Text size="sm" color="muted">{column.header}</Text>
              <div className={column.align === 'right' ? 'tabular-nums' : undefined}>{column.render(detailRow)}</div>
            </div>
          ))}
          {presentation.allDetails?.(detailRow).filter(field =>
            presentation.canShowField?.(field.key, detailRow) !== false).map(field => (
            <div key={field.key} className="min-w-0 break-words">
              <Text size="sm" color="muted">{field.label}</Text>
              <div>{field.value}</div>
            </div>
          ))}
        </div>}
      </Modal>
    </div>
  )
}
