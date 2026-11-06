import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Column, DataTableRowGrouping } from './DataTable'
import { Button } from './Button'
import { Checkbox } from './Checkbox'
import { Modal } from './Modal'
import { Text } from './Typography'
import { MobileReferenceRow } from './mobile-grid-reference/MobileReferenceRow'
import { MobileReferenceState } from './mobile-grid-reference/MobileReferenceState'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
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
  grouping?: {
    config: DataTableRowGrouping<T>
    isOpen: (key: string) => boolean
    onToggle: (key: string) => void
  }
  compact?: boolean
}

/** A presentation of processed rows, not a query/filter/export controller. */
export function MobileDataTableAdapter<T>({
  rows, columns, allColumns, keyExtractor, presentation, label, rowLabel, selectedKeys,
  selectable, multiSelect, allSelected, someSelected, onToggleAll, onToggle,
  controls, count, onLoadMore, nextCount, onClear, emptyMessage, expandedContent,
  expandedKeys, onToggleExpanded, rowActions, grouping, compact = false,
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
  const groupedActions = grouping?.config.actionColumns ?? (
    grouping?.config.actionsColumn && grouping.config.actions
      ? { [grouping.config.actionsColumn]: grouping.config.actions } : undefined
  )
  const actionColumns = groupedActions ? columns.filter(column => groupedActions[column.key]) : []
  const actionCell = (column: Column<T>, content: ReactNode) => (
    <div key={column.key} data-mobile-action-column={column.key}
      style={column.mobileActionWidth == null ? undefined : { width: column.mobileActionWidth }}
      className="flex w-14 shrink-0 items-center justify-center">
      {content}
    </div>
  )
  const renderRow = (row: T) => {
    const key = keyExtractor(row)
    const mobileRow = buildMobileTableRow(row, key, columns, presentation, label)
    const humanLabel = rowLabel?.(row) ?? mobileRow.title
    return <div key={`${typeof key}:${key}`}>
      <div className="flex min-w-0 items-center">
        <div className="min-w-0 flex-1">
          <MobileReferenceRow
            row={mobileRow}
            variant={presentation.variant ?? 'cards'} selecting={selectable && selectionMode}
            compact={compact}
            selected={selectedKeys.has(key)}
            selectionLabel={selectedKeys.has(key)
              ? t('table.selection.deselectRowNamed', 'Deselect {{row}}', { row: humanLabel })
              : t('table.selection.selectRowNamed', 'Select {{row}}', { row: humanLabel })}
            onActivate={() => presentation.onOpenRow ? presentation.onOpenRow(row) : setDetailKey(key)}
            onToggle={() => {}}
            onSelectionEvent={event => onToggle(key, event)}
          />
        </div>
        {actionColumns.map(column => actionCell(column, column.render(row)))}
      </div>
      {(!grouping || presentation.inlineActions || rowActions || onToggleExpanded) && (
        <div data-mobile-row-actions="" className="flex w-full min-w-0 flex-wrap items-center gap-2 px-3 pb-3 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:break-words">
          {presentation.inlineActions?.(row)}
          {rowActions?.(row)}
          {onToggleExpanded && <Button size="sm" variant="ghost" wrapLabel
            aria-expanded={expandedKeys?.has(key) ?? false}
            onClick={() => onToggleExpanded(key)}>
            {expandedKeys?.has(key) ? t('table.expand.collapse', 'Collapse row') : t('table.expand.expand', 'Expand row')}
          </Button>}
          <Button size="sm" variant="ghost" className="min-h-11 min-w-11" wrapLabel
            aria-label={t('common.quickView', 'Quick view')}
            onClick={() => setDetailKey(key)}>{t('common.quickView', 'Quick view')}</Button>
        </div>
      )}
      {expandedKeys?.has(key) && <div className="p-3">{expandedContent?.(row)}</div>}
    </div>
  }
  const groups = grouping && [...rows.reduce((result, row) => {
    const key = grouping.config.key(row)
    const members = result.get(key) ?? []
    members.push(row)
    result.set(key, members)
    return result
  }, new Map<string, T[]>())]
  return (
    <div className="mgr-mobile min-w-0 [&_button]:min-h-11 [&_button]:min-w-11" data-mobile-table="" role="group" aria-label={label}>
      {controls && <div className="flex flex-wrap items-center gap-2 py-2">{controls}</div>}
      {selectable && <div className="flex flex-wrap items-center gap-2 pb-3">
        <Button size="sm" variant="secondary" className="min-h-11" wrapLabel
          aria-pressed={selectionMode} onClick={() => setSelectionMode(previous => !previous)}>
          {selectionMode ? t('common.cancel', 'Cancel') : t('developerReference.mobileGrid.selection.enter', 'Select')}
        </Button>
        {selectionMode && multiSelect && (
          <Checkbox className="min-h-11 min-w-11" checked={allSelected} indeterminate={someSelected}
            onChange={onToggleAll} aria-label={allSelected
              ? t('table.selection.deselectAll', 'Deselect all rows')
              : t('table.selection.selectAll', 'Select all rows')} />
        )}
      </div>}
      <div className="mgr-group bg-[var(--surface-1)]">
        <MobileReferenceState production state={state} callbacks={{
          onRetry: presentation.onRetry, onClear,
        }} />
        {showRows && actionColumns.some(column => column.headerAction) && (
          <div className="flex min-w-0 items-center border-b border-[var(--border-subtle)] py-2">
            <div className="min-w-0 flex-1" />
            {actionColumns.map(column => actionCell(column,
              <div className={cn('flex flex-col', column.align === 'right' ? 'items-end text-right' : 'items-center text-center')}>
                <Text size="xs" color="muted">{column.header}</Text>
                {column.headerAction}
              </div>))}
          </div>
        )}
        {showRows && (grouping && groups ? groups.map(([key, members]) => (
          <div key={key} data-mobile-group={key}>
            <div className="flex min-w-0 items-center border-b border-[var(--border-subtle)]">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                <Button variant="ghost" size="sm" className="min-h-11 min-w-11" wrapLabel
                  aria-expanded={grouping.isOpen(key)}
                  aria-label={grouping.isOpen(key)
                    ? t('table.collapseGroup', 'Collapse {{group}}', { group: grouping.config.label(key) })
                    : t('table.expandGroup', 'Expand {{group}}', { group: grouping.config.label(key) })}
                  onClick={() => grouping.onToggle(key)}>
                  <ChevronRight className={cn('h-4 w-4', grouping.isOpen(key) && 'rotate-90')} aria-hidden="true" />
                  {grouping.config.label(key)}
                </Button>
                {(grouping.config.mobileSummary ?? grouping.config.summary)?.(key, members)}
              </div>
              {actionColumns.map(column => actionCell(column, groupedActions?.[column.key]?.(key, members)))}
            </div>
            {grouping.isOpen(key) && members.map(renderRow)}
          </div>
        )) : rows.map(renderRow))}
      </div>
      {(count || (onLoadMore && showRows)) && <div className="min-w-0 space-y-2 break-words py-3">
        {count}
        {onLoadMore && showRows && <Button className="min-h-11 w-full" variant="secondary" wrapLabel
          onClick={onLoadMore}>{t('developerReference.mobileGrid.footer.loadMore', 'Load {{count}} more', { count: nextCount })}</Button>}
      </div>}
      <Modal open={detailRow != null} onClose={close}
        title={detailRow != null ? rowLabel?.(detailRow) ?? label : label} size="lg"
        footer={<Button className="min-h-11 min-w-11" wrapLabel onClick={close}>{t('common.close', 'Close')}</Button>}>
        {detailRow != null && <dl className="min-w-0 space-y-3">
          {allColumns.filter(column => presentation.canShowField?.(column.key, detailRow) !== false).map(column => (
            <div key={column.key} className="min-w-0 space-y-1 break-words">
              <Text as="dt" variant="caption">{column.header}</Text>
              <Text as="dd" variant="body" className={column.align === 'right' ? 'tabular-nums' : undefined}>{column.render(detailRow) ?? '—'}</Text>
            </div>
          ))}
          {presentation.allDetails?.(detailRow).filter(field =>
            presentation.canShowField?.(field.key, detailRow) !== false).map(field => (
            <div key={field.key} className="min-w-0 space-y-1 break-words">
              <Text as="dt" variant="caption">{field.label}</Text>
              <Text as="dd" variant="body">{field.value ?? '—'}</Text>
            </div>
          ))}
        </dl>}
      </Modal>
    </div>
  )
}
