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
        'flex items-center gap-1 rounded-xl bg-white/[0.02] p-1 border border-white/[0.06] overflow-x-auto scrollbar-thin',
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
              'flex items-center gap-1.5 sm:gap-2 rounded-lg px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium transition-all duration-normal whitespace-nowrap shrink-0',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
              selected
                ? 'bg-white/[0.08] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
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
