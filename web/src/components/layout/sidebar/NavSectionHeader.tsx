import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Label } from '@/components/ui/Typography'

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
 *   - Existing label typography role, preserving localized label casing
 *   - Theme-aware muted foreground, no decorative letter spacing
 *   - padding: px-3 py-1, no extra mb-* (the parent container handles vertical
 *     rhythm via space-y-* / its own margins)
 *   - When `action` is provided, uses a flex row with the action shrunk to its
 *     intrinsic size; the label retains the same metrics so all sidebar headers
 *     read as one row, not as a button bar.
 */
export function NavSectionHeader({ label, action, id, className }: NavSectionHeaderProps) {
  return (
    <div className={cn('flex min-w-0 items-center justify-between gap-2 px-3 py-1', className)}>
      <Label
        as="p"
        id={id}
        className="min-w-0 break-words"
      >
        {label}
      </Label>
      {action}
    </div>
  )
}

export default NavSectionHeader
