import { forwardRef, useId, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface ToggleProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
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
 * Switch toggle (WAI-ARIA `role="switch"`).
 *
 * Accessibility:
 * - Renders a real `<button>` so Space/Enter natively toggle the value.
 * - The visible label, when supplied, is associated with the button via
 *   `aria-labelledby` so screen readers announce both the switch state and
 *   its label.
 * - The outer wrapper is a neutral `<div>`; the previous `<label>` element
 *   was misleading because `<label>` has no semantic relationship to a
 *   `role="switch"` control.
 * - `aria-checked` reflects the current state; clicking the label text also
 *   toggles via the wrapper's onClick (delegating to the button).
 * - Icon-only switches (no visible `label`) can be named by passing
 *   `aria-label`/`aria-labelledby`; these — along with `aria-describedby`
 *   and `title` — are forwarded to the button so they name/describe the
 *   actual control rather than the neutral wrapper `<div>`.
 */
export const Toggle = forwardRef<HTMLDivElement, ToggleProps>(
  (
    {
      label,
      checked,
      onChange,
      disabled = false,
      size = 'md',
      className,
      // Naming/description attributes belong on the interactive
      // `role="switch"` button, not the neutral wrapper `<div>`.
      // Pulling them out of `...props` means a caller that passes
      // `aria-label` (icon-only switch with no visible `label`) actually
      // names the control instead of a generic div a screen reader skips.
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      'aria-describedby': ariaDescribedBy,
      title,
      ...props
    },
    ref,
  ) => {
    const labelId = useId();
    // `role="switch"` REQUIRES a boolean `aria-checked`; a nullish `checked`
    // (JS callers / loosely-typed props) would otherwise drop the attribute
    // and leave the state unannounced. Normalise once and reuse everywhere.
    const isChecked = checked ?? false;
    return (
      <div
        ref={ref}
        className={cn(
          'inline-flex max-w-full items-center gap-2 select-none',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
          className,
        )}
        onClick={(e) => {
          if (disabled) return;
          // Allow clicking the label text to toggle, but ignore clicks that
          // already targeted the button (which fires its own onClick).
          if ((e.target as HTMLElement).closest('button')) return;
          onChange(!isChecked);
        }}
        {...props}
      >
        <button
          type="button"
          role="switch"
          aria-checked={isChecked}
          // Visible `label` wins (points at the rendered span); otherwise
          // fall back to a caller-supplied `aria-labelledby`/`aria-label`.
          aria-label={ariaLabel}
          aria-labelledby={label ? labelId : ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          title={title}
          disabled={disabled}
          onClick={() => onChange(!isChecked)}
          className={cn(
            'inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full md:h-6 md:min-w-0',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
            size === 'sm' ? 'md:w-9' : 'md:w-11',
          )}
        >
          <span
            className={cn(
              'relative inline-flex shrink-0 items-center rounded-full px-0.5 ring-1 ring-inset ring-[var(--control-border)] transition-colors duration-fast ease-standard motion-reduce:transition-none',
              // Preserve track boundaries when forced colors flatten the tint.
              'forced-colors:border forced-colors:border-[ButtonBorder]',
              trackSize[size],
              isChecked
                ? 'bg-[var(--semantic-info)]'
                : 'bg-[var(--control-track-off)]',
            )}
          >
            <span
              className={cn(
                'pointer-events-none inline-block rounded-full bg-[var(--control-thumb)] transition-transform duration-fast ease-standard motion-reduce:transition-none',
                'forced-colors:border forced-colors:border-[ButtonBorder]',
                thumbSize[size],
                'translate-x-0',
                isChecked && thumbTranslate[size],
              )}
              aria-hidden="true"
            />
          </span>
        </button>
        {label && (
          <span id={labelId} className="min-w-0 break-words text-sm font-medium text-[var(--text-secondary)]">
            {label}
          </span>
        )}
      </div>
    );
  },
);
Toggle.displayName = 'Toggle';
