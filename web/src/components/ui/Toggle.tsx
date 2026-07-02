import { forwardRef, useId, type HTMLAttributes } from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/cn';

export interface ToggleProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  size?: 'sm' | 'md';
  className?: string;
}

const trackSize = {
  sm: 'h-5 w-9',
  md: 'h-6 w-11',
} as const;

const thumbSize = {
  sm: 'h-3.5 w-3.5',
  md: 'h-5 w-5',
} as const;

const thumbTranslate = {
  sm: 'translate-x-4',
  md: 'translate-x-5',
} as const;

/**
 * Switch toggle, built on Radix UI's `Switch` primitive (WAI-ARIA `switch`
 * pattern) instead of a hand-rolled `<button role="switch">`. Radix owns
 * the verified `role="switch"` / `aria-checked` / `data-state` contract,
 * Space+Enter keyboard handling, and a hidden bubble `<input type="checkbox">`
 * for native `<form>` submission — this file only owns the visual layer
 * (Radix primitives render unstyled).
 *
 * Accessibility:
 * - `Switch.Root` renders a real `<button>`, so Space/Enter natively toggle
 *   the value (unchanged from the previous hand-rolled button, now backed by
 *   Radix's own test suite instead of ours).
 * - The visible `label` prop, when supplied, is associated with the switch
 *   via `aria-labelledby` so screen readers announce both the switch state
 *   and its label.
 * - A caller-supplied `aria-label`/`aria-labelledby` (used by icon-only
 *   toggles that render no visible `label` text, e.g. dashboard widget
 *   rows) is forwarded onto the switch itself — the actual interactive
 *   element — rather than left inert on the wrapper `<div>`, which fixes
 *   those toggles previously exposing no accessible name at all.
 * - The outer wrapper stays a neutral `<div>` (not `<label>`): `<label>`
 *   has no semantic relationship to a `role="switch"` control, and a native
 *   `<label>` would forward its click to Radix's hidden bubble `<input>`
 *   rather than the visible switch. Clicking the label text still toggles
 *   via the wrapper's own `onClick`, positively matched to the wrapper's
 *   own background or the `[data-toggle-label]` span — NOT a `!closest
 *   ('button')`-style exclusion, because Radix's hidden bubble `<input>`
 *   (mounted whenever the switch sits inside a `<form>`) is a *sibling* of
 *   the button and dispatches its own synthetic bubbling click on every
 *   toggle; excluding only "button" ancestors misses that sibling and
 *   causes an infinite re-toggle ping-pong.
 * - The switch's hit target is invisibly expanded to the 44×44px minimum
 *   (WCAG 2.5.5 / mobile tap-target guidance) via a `before` pseudo
 *   element so the compact `sm`/`md` visual track sizes don't shrink the
 *   tappable area on touch devices.
 */
export const Toggle = forwardRef<HTMLDivElement, ToggleProps>(
  (
    {
      label,
      checked,
      onChange,
      size = 'md',
      className,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      ...props
    },
    ref,
  ) => {
    const labelId = useId();
    return (
      <div
        ref={ref}
        className={cn('inline-flex items-center gap-2 cursor-pointer select-none', className)}
        onClick={(e) => {
          // Only handle clicks that land on the wrapper's own background or
          // the visible label text. Radix's <Switch.Root> (and, inside a
          // <form>, its hidden bubble <input type="checkbox"> sibling used
          // to make the switch participate in native form submission)
          // already handle their own clicks — including one dispatched
          // programmatically on that hidden input, whose target is a
          // *sibling* of the button, not a descendant, so a `.closest
          // ('button')`-style exclusion can't catch it. Re-toggling here
          // for those would double-fire onChange, and for the bubble
          // input's synthetic replay specifically, cause an infinite
          // toggle ping-pong (each toggle re-triggers Radix's bubble-sync
          // effect, which dispatches another click). Positive-matching
          // just the two safe targets sidesteps needing to enumerate every
          // internal element Radix renders.
          const target = e.target as HTMLElement;
          if (target === e.currentTarget || target.closest('[data-toggle-label]')) {
            onChange(!checked);
          }
        }}
        {...props}
      >
        <SwitchPrimitive.Root
          checked={checked}
          onCheckedChange={onChange}
          aria-label={label ? undefined : ariaLabel}
          aria-labelledby={label ? labelId : ariaLabelledBy}
          className={cn(
            'relative inline-flex shrink-0 rounded-full transition-colors duration-normal',
            'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
            // Invisible 44x44 hit-slop centered on the visible track so both
            // `size="sm"` (20x36 visual) and `size="md"` (24x44 visual) meet
            // the mobile minimum tap target without inflating the artwork.
            "before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
            // Forced-colors mode flattens the
            // track tint to a system colour, making on/off visually
            // identical. Add a system-colour border on the track and
            // (below) on the thumb so the off-state knob is visible
            // and the switch boundary survives Windows High Contrast.
            'forced-colors:border forced-colors:border-[ButtonBorder]',
            trackSize[size],
            checked
              ? 'bg-cyan-500 dark:bg-cyan-600'
              : 'bg-gray-300 dark:bg-gray-600',
          )}
        >
          <SwitchPrimitive.Thumb
            aria-hidden="true"
            className={cn(
              'pointer-events-none inline-block rounded-full bg-white shadow-sm transition-transform duration-normal',
              // Outline the thumb so it remains
              // distinguishable from the (now system-coloured) track.
              'forced-colors:border forced-colors:border-[ButtonBorder]',
              thumbSize[size],
              'translate-y-[3px] translate-x-[3px]',
              checked && thumbTranslate[size],
            )}
          />
        </SwitchPrimitive.Root>
        {label && (
          <span
            id={labelId}
            data-toggle-label=""
            className="text-sm font-medium text-gray-700 dark:text-[var(--text-secondary)]"
          >
            {label}
          </span>
        )}
      </div>
    );
  },
);
Toggle.displayName = 'Toggle';
