import { type ReactNode } from 'react'
import { cn } from '@/lib/cn'

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
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-shape-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-fast sm:gap-2 sm:px-4 sm:py-2 sm:text-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
              selected
                ? 'bg-[var(--surface-3)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text-secondary)]',
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
