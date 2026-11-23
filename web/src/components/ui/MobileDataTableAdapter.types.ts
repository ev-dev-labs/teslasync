import type { ReactNode } from 'react'
import type { DataTableRowGrouping } from './DataTable'
import type { MobileRole, MobileState, MobileVariant } from './mobile-grid-reference/types'

export type MobileTableRowKey = string | number

/** Display-only contract. DataTable retains filtering, selection, paging and export ownership. */
export interface MobileDataTablePresentation<T> {
  variant?: MobileVariant
  roles: Readonly<Record<string, MobileRole>>
  /** Explicit display accessors; never derive numbers or identity from rendered JSX. */
  displayValue: (row: T, columnKey: string) => string | number | null | undefined
  progress?: {
    columnKey: string
    value: (row: T) => { from: number; to: number; label: string } | undefined
  }
  state?: MobileState
  onRetry?: () => void
  onClear?: () => void
  /** Privacy mask applies to summaries AND details. Hidden layout columns are otherwise available in details. */
  canShowField?: (columnKey: string, row: T) => boolean
  allDetails?: (row: T) => readonly MobileDataTableDetail[]
  inlineActions?: (row: T, visibleColumns: ReadonlySet<string>) => ReactNode
  onOpenRow?: (row: T) => void
  rowHref?: (row: T) => string
  onQuickView?: (row: T) => void
  quickViewLabel?: string
  /** Use cards through this allocated width when a record needs more room. */
  cardMaxWidth?: number
  /** Group cards without changing the native table's row order or layout. */
  grouping?: DataTableRowGrouping<T>
  badgeVariant?: (row: T) => 'neutral' | 'success' | 'warning' | 'info' | 'danger'
  /** Place mobile column controls in the shared table toolbar instead of a separate row. */
  controlsInToolbar?: boolean
  /** Use the compact column picker instead of repeating controls above the cards. */
  columnToolsInPicker?: boolean
  /** Set false when a surrounding summary already supplies the row count. */
  showRowCount?: boolean
  /** Let card rows follow the table's compact-density setting. */
  compactRows?: boolean
}

export interface MobileDataTableDetail {
  key: string
  label: string
  value: ReactNode
}
