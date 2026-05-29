import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface NavSectionHeaderProps {
  /** Localized label text. */
  label: string
  /** Optional right-aligned action slot (e.g. expand/collapse buttons). */
  action?: ReactNode
  /** When set, applied to the label so consumers can pair section content via `aria-labelledby`. */
  id?: string
  className?: string
}

/**
 * Sidebar section header — a quiet, label-weight title used to group nav items.
 *
 * Visual rules:
 *   - 10px font, weight 600, uppercase, 0.14em tracking
 *   - text color: text-[var(--text-muted)]
 *   - padding: px-3 py-1, no extra mb-* (the parent container handles vertical
 *     rhythm via space-y-* / its own margins)
 *   - When `action` is provided, uses a flex row with the action shrunk to its
 *     intrinsic size; the label retains the same metrics so all sidebar headers
 *     read as one row, not as a button bar.
 */
export function NavSectionHeader({ label, action, id, className }: NavSectionHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between gap-2 px-3 py-1', className)}>
      <p
        id={id}
        className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]"
      >
        {label}
      </p>
      {action}
    </div>
  )
}

export default NavSectionHeader
