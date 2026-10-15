import { type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { typography } from '@/lib/tokens'

export interface TabNavItem {
  key: string
  label: string
  icon?: ReactNode
}

export interface TabNavProps {
  tabs: TabNavItem[]
  active: string
  onChange: (key: string) => void
  /** Accessible name for the segmented control (WAI-ARIA `role="group"`). */
  ariaLabel?: string
  className?: string
}

/** Horizontal tab navigation bar with icon support. */
export function TabNav({ tabs, active, onChange, ariaLabel, className }: TabNavProps) {
  // Data-driven call sites forward `tabs` straight from query results, so a
  // still-loading/undefined value must degrade to an empty strip rather than
  // throwing on `.map`.
  const items = tabs ?? []
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'flex items-center gap-1 overflow-x-auto rounded-shape-lg border border-[var(--border-default)] bg-[var(--surface-1)] p-1 scrollbar-thin',
        className,
      )}
    >
      {items.map(t => {
        const selected = active === t.key
        return (
          <button
            key={t.key}
            // Native buttons default to type="submit"; without this an in-form
            // TabNav (e.g. the alerts filter strip) would submit the surrounding
            // form on every tab change.
            type="button"
            onClick={() => onChange(t.key)}
            // The active tab is otherwise conveyed by colour alone — expose it
            // programmatically so assistive tech announces the selected state.
            aria-pressed={selected}
            className={cn(
              'flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-shape-sm border border-transparent px-2.5 py-1.5 transition-colors duration-fast ease-standard motion-reduce:transition-none sm:gap-2 sm:px-4 sm:py-2 md:min-h-0 md:min-w-0',
              typography.size.sm, typography.weight.medium,
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-[Highlight]',
              selected
                ? cn('border-[var(--border-strong)] bg-[var(--surface-3)] forced-colors:border-[Highlight] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]', typography.color.primary)
                : cn('hover:bg-[var(--surface-2)] hover:text-[var(--text-secondary)] forced-colors:text-[ButtonText]', typography.color.muted),
            )}
          >
            {t.icon}
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
