import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export interface SelectableCardProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Highlights the active choice and drives `aria-pressed` for native buttons
   * or `aria-selected` for supporting roles, never conveying state by color alone.
   */
  selected?: boolean
}

/**
 * SelectableCard — an accessible, full-width clickable surface for
 * single-select lists (listbox options), choice grids, and pickable rows.
 *
 * Renders a real `<button>` so keyboard operability and focus-visible rings
 * come for free and feature code never hand-rolls a raw control. Defaults to
 * `type="button"`, provides neutral selectable-surface styling (border,
 * hover, selected accent, ≥44px touch target), and reflects selection via
 * styling and ARIA. Native buttons use `aria-pressed` (caller override allowed).
 * When `disabled`, the card dims, shows a
 * not-allowed cursor, and drops its hover affordance (via the `enabled:`
 * variant) so an unavailable choice is never presented as a live target.
 * Callers pass the appropriate `role`
 * (e.g. `role="option"` inside a caller-managed keyboard-navigable listbox),
 * an `aria-label`, and any
 * layout `className` — caller classes win on conflict via tailwind-merge.
 */
export const SelectableCard = forwardRef<HTMLButtonElement, SelectableCardProps>(
  ({ selected = false, className, type, role, children, ...props }, ref) => {
    const selectionAria = role && ['option', 'tab', 'row', 'gridcell', 'treeitem', 'columnheader', 'rowheader'].includes(role)
      ? { 'aria-selected': selected }
      : {}
    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        role={role}
        aria-pressed={!role || role === 'button' ? selected : undefined}
        className={cn(
          'w-full min-w-0 min-h-11 rounded-panel border p-3 text-start break-words text-[var(--text-primary)] transition-colors duration-fast motion-reduce:transition-none sm:p-4',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)]',
          'forced-colors:bg-[ButtonFace] forced-colors:text-[ButtonText] forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-[Highlight]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          selected
            ? 'border-[var(--theme-primary)] bg-surface-2 forced-colors:border-[Highlight]'
            : 'border-[var(--border-subtle)] bg-surface-1 enabled:hover:border-[var(--border-strong)] enabled:hover:bg-surface-2 forced-colors:border-[ButtonText]',
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
