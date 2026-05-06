/**
 * Phase-46 / Prompt 12 — VisuallyHidden / SrOnly utility.
 *
 * Renders content that is invisible to sighted users but exposed to
 * assistive technologies (screen readers, voice control, refreshable
 * Braille displays).
 *
 * This is the canonical replacement for ad-hoc `<span class="sr-only">`
 * spans scattered across the codebase. Centralising the implementation
 * gives us:
 *
 *   1. A single styling target (Tailwind's built-in `.sr-only`) so we
 *      can swap implementations without touching every call-site.
 *   2. A `liveRegion` shorthand that pairs the hidden styling with the
 *      `role="status" aria-live="polite" aria-atomic="true"` triplet
 *      a screen-reader announcement actually requires — devs only have
 *      to remember one prop instead of three independent attributes.
 *   3. A `focusable` mode that makes the content visible when it
 *      receives keyboard focus — used for skip-link patterns
 *      ("Skip to main content") that must remain in the tab order.
 *
 * The component is element-polymorphic: by default it renders a
 * `<span>` (inline, no layout side-effects). Pass `as="label"` /
 * `as="a"` / `as="div"` etc. to switch the underlying tag while
 * keeping the visually-hidden semantics. The TypeScript signature
 * narrows extra props to the chosen tag (e.g. `htmlFor` is only
 * accepted when `as="label"`).
 *
 * NOTE: this is the ONLY file allowed to mention the literal Tailwind
 * `sr-only` class name in its source. The `audit:sr-only` script
 * (`web/scripts/audit-sr-only.mjs`, chained from `npm run lint`)
 * enforces that contract. New ad-hoc `sr-only` usage anywhere else
 * fails CI; route everything through this component or
 * `useAnnouncer()` instead.
 */

import {
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

/**
 * Props common to every VisuallyHidden render mode, regardless of the
 * underlying tag.
 *
 * `as` is generic so TypeScript can infer the element type from
 * `<VisuallyHidden as="label" htmlFor=…>` and validate the extra
 * attributes against that tag.
 */
export type VisuallyHiddenOwnProps<T extends ElementType = 'span'> = {
  /** HTML tag to render. Defaults to `span`. */
  as?: T;
  /**
   * When true, also wires `role="status"`, `aria-live="polite"`, and
   * `aria-atomic="true"` so the content is announced by screen
   * readers as a live region. Combine with state changes to fire SR
   * announcements (e.g. "Vehicle filter removed") without rendering
   * any visible UI.
   */
  liveRegion?: boolean;
  /**
   * Live-region urgency. `polite` (default) waits for the user to
   * finish their current AT activity. `assertive` interrupts —
   * reserve for genuine errors / "your session is about to expire"
   * style messages.
   */
  priority?: 'polite' | 'assertive';
  /**
   * When true, the content becomes visible on keyboard focus. Used
   * for the global "Skip to main content" link so keyboard users can
   * tab past the sidebar in one stroke. Pair with positioning
   * classes via `className` so the visible state lands somewhere
   * sensible (top-left corner, fixed position, high z-index).
   */
  focusable?: boolean;
  children?: ReactNode;
};

/**
 * Polymorphic prop type — narrows the extra accepted attributes to
 * those of the `as` element. Keeps `<VisuallyHidden as="label" htmlFor>`
 * and `<VisuallyHidden as="a" href>` type-safe while rejecting
 * tag-mismatched props (e.g. `htmlFor` on a `span`).
 */
export type VisuallyHiddenProps<T extends ElementType = 'span'> =
  VisuallyHiddenOwnProps<T> &
    Omit<ComponentPropsWithoutRef<T>, keyof VisuallyHiddenOwnProps<T>>;

/**
 * `focus:not-sr-only` toggles the Tailwind utility off while focused
 * so the element is visible. Authors supply their own
 * `focus:fixed focus:top-N focus:left-N ...` classes via
 * `className` to position the visible appearance — this base is
 * intentionally minimal so it composes with the host page's design
 * tokens.
 */
const FOCUSABLE_BASE = 'focus:not-sr-only focus-visible:not-sr-only';

export function VisuallyHidden<T extends ElementType = 'span'>({
  as,
  liveRegion = false,
  priority = 'polite',
  focusable = false,
  className,
  children,
  ...rest
}: VisuallyHiddenProps<T>) {
  const Component = (as ?? 'span') as ElementType;

  const liveProps = liveRegion
    ? {
        role: priority === 'assertive' ? 'alert' : 'status',
        'aria-live': priority,
        'aria-atomic': 'true' as const,
      }
    : undefined;

  return (
    <Component
      {...liveProps}
      {...rest}
      className={cn('sr-only', focusable && FOCUSABLE_BASE, className)}
    >
      {children}
    </Component>
  );
}
