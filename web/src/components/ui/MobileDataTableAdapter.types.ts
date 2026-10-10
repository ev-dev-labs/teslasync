import type { ReactNode } from 'react'
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
  inlineActions?: (row: T) => ReactNode
  onOpenRow?: (row: T) => void
}

export interface MobileDataTableDetail {
  key: string
  label: string
  value: ReactNode
}
