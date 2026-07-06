import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export interface SelectableCardProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Highlights the card as the active choice. Also drives `aria-selected`
   * so selection is never conveyed by color alone.
   */
  selected?: boolean
}

/**
 * SelectableCard — an accessible, full-width clickable surface for
 * single-select lists (listbox options), choice grids, and pickable rows.
 *
 * Renders a real `<button>` so keyboard operability and focus-visible rings
 * come for free and feature code never hand-rolls a raw control. Defaults to
 * `type="button"`, provides the glass selectable-surface styling (border,
 * hover, selected accent, ≥44px touch target), and reflects selection via
 * BOTH styling and `aria-selected`. When `disabled`, the card dims, shows a
 * not-allowed cursor, and drops its hover affordance (via the `enabled:`
 * variant) so an unavailable choice is never presented as a live target.
 * Callers pass the appropriate `role`
 * (e.g. `role="option"` inside a `role="listbox"`), an `aria-label`, and any
 * layout `className` — caller classes win on conflict via tailwind-merge.
 */
export const SelectableCard = forwardRef<HTMLButtonElement, SelectableCardProps>(
  ({ selected = false, className, type, role, children, ...props }, ref) => {
    // `aria-selected` is only valid on roles that support it (option, tab,
    // row, …). Attach it only when the caller supplies such a role, spread as
    // an object so a bare `button` role never carries an unsupported ARIA prop.
    const selectionAria = role ? { 'aria-selected': selected } : {}
    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        role={role}
        className={cn(
          'w-full min-h-11 rounded-xl border p-3 text-left transition-colors sm:p-4',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50',
          'disabled:cursor-not-allowed disabled:opacity-50',
          selected
            ? 'border-cyan-400/60 bg-cyan-500/5'
            : 'border-[var(--border-subtle)] bg-white/[0.02] enabled:hover:border-[var(--border-strong)] enabled:hover:bg-white/[0.04]',
          className,
        )}
        {...props}
        {...selectionAria}
      >
        {children}
      </button>
    )
  },
)
SelectableCard.displayName = 'SelectableCard'
