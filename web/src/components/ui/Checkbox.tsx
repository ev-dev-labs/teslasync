import {
  forwardRef,
  useId,
  useRef,
  type ComponentPropsWithoutRef,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';

const sizes = {
  sm: { box: 'h-3.5 w-3.5', icon: 'h-2.5 w-2.5' },
  md: { box: 'h-4 w-4', icon: 'h-3 w-3' },
  lg: { box: 'h-5 w-5', icon: 'h-3.5 w-3.5' },
} as const;

export type CheckboxSize = keyof typeof sizes;

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'size'> {
  /** Optional inline label rendered to the right of the box. */
  label?: ReactNode;
  /** Mixed-state checkbox (typically used by "select all" headers). */
  indeterminate?: boolean;
  /** Visual size of the box. Defaults to `md`. */
  size?: CheckboxSize;
  /** Standard React-style change handler reporting the new boolean. */
  onChange?: (checked: boolean) => void;
}

/**
 * Accessible checkbox primitive, built on Radix UI's `Checkbox` primitive
 * (the WAI-ARIA `checkbox` pattern) instead of a hand-rolled visually-hidden
 * `<input type="checkbox">`. Radix owns the verified `role="checkbox"` /
 * `aria-checked` (including `aria-checked="mixed"` for the indeterminate
 * state) / `data-state` contract, Space-key toggling, focus management, and a
 * hidden bubble `<input type="checkbox">` for native `<form>` submission —
 * this file only owns the visual layer (Radix primitives render unstyled).
 *
 * The external prop API is unchanged: callers still pass a boolean `checked`,
 * an `onChange(next: boolean)` handler, `indeterminate`, `size`, an optional
 * `label`, and any standard attributes (`id`, `name`, `value`, `disabled`,
 * `tabIndex`, `aria-*`, `data-*`, …), which are forwarded onto the control.
 *
 * Accessibility & interaction:
 * - `Checkbox.Root` renders a real focusable `<button role="checkbox">`, so
 *   Space natively toggles the value and the state is exposed via
 *   `aria-checked` — the indeterminate flag maps to Radix's tri-state
 *   `CheckedState`, giving `aria-checked="mixed"` for "select all" headers
 *   without the manual `el.indeterminate = …` DOM write the old version did.
 * - A visible `label`, when supplied, is associated with the control via
 *   `aria-labelledby` (a `<button>` is not a "labelable" element, so a
 *   wrapping/`htmlFor` `<label>` would not associate) and clicking it toggles
 *   the checkbox by forwarding to the control — matching the previous
 *   wrapping-`<label>` behaviour. A caller-supplied `aria-label` is used only
 *   when there is no visible label, so screen readers never announce a
 *   doubled name.
 * - The wrapper stays a neutral `<div>`: a native `<label>` would forward its
 *   click to Radix's hidden bubble `<input>` (mounted when the checkbox sits
 *   inside a `<form>`) rather than the visible control. Clicks are forwarded
 *   by positively matching the wrapper background or the `[data-checkbox-label]`
 *   span — NOT a `.closest('button')`-style exclusion — because that bubble
 *   `<input>` is a *sibling* of the button and replays its own click on every
 *   toggle, which an exclusion would miss and cause a re-toggle ping-pong.
 * - The control's hit target is invisibly expanded to the 44×44px minimum
 *   (WCAG 2.5.5 / mobile tap-target guidance) via a `before` pseudo element so
 *   the compact `sm`/`md`/`lg` visual box doesn't shrink the tappable area on
 *   touch devices.
 */
export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(
  (
    {
      label,
      indeterminate = false,
      size = 'md',
      onChange,
      className,
      disabled,
      checked,
      defaultChecked,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      ...rest
    },
    forwardedRef,
  ) => {
    const rootRef = useRef<HTMLButtonElement | null>(null);
    const labelId = useId();
    const dims = sizes[size];
    const hasLabel = label != null;

    const setRefs = (node: HTMLButtonElement | null) => {
      rootRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) (forwardedRef as { current: HTMLButtonElement | null }).current = node;
    };

    // Collapse our boolean `checked` + separate `indeterminate` flag onto
    // Radix's single tri-state `CheckedState` (`boolean | 'indeterminate'`).
    const checkedState: CheckboxPrimitive.CheckedState | undefined = indeterminate
      ? 'indeterminate'
      : checked;

    return (
      <div
        className={cn(
          'inline-flex items-center gap-2 select-none',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
          className,
        )}
        onClick={e => {
          // Forward only clicks that land on the wrapper background or the
          // visible label text to the control. The Radix <Checkbox.Root>
          // button (and, inside a <form>, its hidden bubble <input> sibling)
          // already handle their own clicks; positively matching these two
          // safe targets — rather than excluding known internals — avoids the
          // double-toggle / bubble-input ping-pong documented in <Toggle>.
          if (disabled) return;
          const target = e.target as HTMLElement;
          if (target === e.currentTarget || target.closest('[data-checkbox-label]')) {
            rootRef.current?.click();
          }
        }}
      >
        <CheckboxPrimitive.Root
          ref={setRefs}
          checked={checkedState}
          defaultChecked={defaultChecked}
          disabled={disabled}
          onCheckedChange={next => {
            // Radix hands back the new tri-state; a user toggle only ever
            // yields `true`/`false` (it never re-enters 'indeterminate' on its
            // own), so collapse to the boolean our callers expect.
            onChange?.(next === true);
          }}
          aria-label={hasLabel ? undefined : ariaLabel}
          aria-labelledby={hasLabel ? labelId : ariaLabelledBy}
          className={cn(
            'relative inline-flex shrink-0 items-center justify-center rounded border text-transparent transition-colors',
            dims.box,
            'border-[var(--border-strong)] bg-white/[0.04]',
            'data-[state=checked]:border-cyan-500 data-[state=checked]:bg-cyan-500/20 data-[state=checked]:text-cyan-300',
            'data-[state=indeterminate]:border-cyan-500 data-[state=indeterminate]:bg-cyan-500/20 data-[state=indeterminate]:text-cyan-300',
            'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
            'disabled:cursor-not-allowed disabled:opacity-50',
            // Forced-colors flattens the tinted fill to a system colour, so
            // checked/unchecked look identical — keep a system-colour border
            // so the box survives Windows High Contrast.
            'forced-colors:border-[ButtonBorder]',
            // Invisible 44x44 hit-slop centered on the compact visual box so
            // the tap target meets the WCAG 2.5.5 / mobile minimum without
            // inflating the artwork. Mirrors <Toggle>/<Slider>.
            "before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
          )}
          {...(rest as ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>)}
        >
          <CheckboxPrimitive.Indicator className="pointer-events-none inline-flex items-center justify-center">
            {indeterminate ? <Minus className={dims.icon} /> : <Check className={dims.icon} />}
          </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
        {hasLabel && (
          <span id={labelId} data-checkbox-label="" className="text-sm text-[var(--text-primary)]">
            {label}
          </span>
        )}
      </div>
    );
  },
);
Checkbox.displayName = 'Checkbox';
