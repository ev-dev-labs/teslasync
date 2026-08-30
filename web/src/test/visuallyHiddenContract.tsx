import type { ReactElement } from 'react';
import { VisuallyHidden } from '@/components/a11y';

/**
 * Test helper for asserting the shared visually-hidden contract.
 *
 * ## Why this exists
 *
 * Tests that need to prove "this element is a screen-reader-only live region"
 * used to assert the Tailwind utility class by name. That is wrong twice over:
 *
 *  1. The static accessibility audit (`scripts/audit-sr-*.mjs`) reserves that
 *     literal class for `components/a11y/VisuallyHidden.tsx` — and its own
 *     docs call out "no string concat tricks slipping past code review", so
 *     splicing the name back together to dodge the scan is not a fix either.
 *  2. It couples the assertion to an implementation detail the accessibility
 *     owners are free to change. If `<VisuallyHidden>` swaps Tailwind's
 *     utility for a `clip: rect(...)` polyfill, a class-name assertion breaks
 *     while saying nothing about the behaviour under test.
 *
 * So the contract is derived from the shared primitive itself: whatever
 * `<VisuallyHidden liveRegion>` produces *is* the definition of a
 * visually-hidden live region. A future change to the primitive updates every
 * consumer's expectation automatically, and this file never spells the class.
 *
 * `VisuallyHidden` is a pure function of its props (no hooks), so it can be
 * invoked directly to read the element it would render — no DOM, no
 * testing-library dependency, and no second render tree in the assertion path.
 */

/** The attributes `<VisuallyHidden liveRegion>` guarantees on its element. */
export interface VisuallyHiddenLiveRegionContract {
  /** Class list the primitive applies. Never spelled literally in tests. */
  className: string;
  /** `status` for polite, `alert` for assertive. */
  role: string;
  ariaLive: string;
  ariaAtomic: string;
}

interface VisuallyHiddenRenderedProps {
  className?: string;
  role?: string;
  'aria-live'?: string;
  'aria-atomic'?: string;
}

/**
 * Read the live-region contract straight off the shared primitive.
 *
 * @param priority matches `<VisuallyHidden priority>` — `polite` (default)
 *                 yields `role="status"`, `assertive` yields `role="alert"`.
 */
export function visuallyHiddenLiveRegionContract(
  priority: 'polite' | 'assertive' = 'polite',
): VisuallyHiddenLiveRegionContract {
  const element = VisuallyHidden({
    as: 'div',
    liveRegion: true,
    priority,
    children: null,
  }) as ReactElement<VisuallyHiddenRenderedProps>;
  const props = element.props;

  return {
    className: props.className ?? '',
    role: props.role ?? '',
    ariaLive: props['aria-live'] ?? '',
    ariaAtomic: props['aria-atomic'] ?? '',
  };
}

/** The class list `<VisuallyHidden>` applies, derived rather than spelled. */
export function visuallyHiddenClassName(): string {
  return visuallyHiddenLiveRegionContract().className;
}

/**
 * `true` when `element` carries the full visually-hidden live-region contract
 * — hidden styling AND the `role` / `aria-live` / `aria-atomic` triplet.
 *
 * Returns a boolean rather than asserting so this module stays free of a
 * test-runner dependency (it is type-checked by the app project).
 */
export function isVisuallyHiddenLiveRegion(
  element: Element | null | undefined,
  priority: 'polite' | 'assertive' = 'polite',
): boolean {
  if (element == null) return false;
  const contract = visuallyHiddenLiveRegionContract(priority);
  const classes = new Set(element.className.split(/\s+/).filter(Boolean));
  const hasHiddenStyling = contract.className
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => classes.has(token));

  return (
    hasHiddenStyling
    && element.getAttribute('role') === contract.role
    && element.getAttribute('aria-live') === contract.ariaLive
    && element.getAttribute('aria-atomic') === contract.ariaAtomic
  );
}
