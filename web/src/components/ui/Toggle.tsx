import { forwardRef, useId, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface ToggleProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Keep a disabled control focusable when its explanation is in a tooltip. */
  focusableWhenDisabled?: boolean;
  size?: 'sm' | 'md';
  /** Visual partial state; callers must include its meaning in the accessible name or description. */
  indeterminate?: boolean;
  className?: string;
}

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
      focusableWhenDisabled = false,
      size: _size,
      indeterminate = false,
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
        data-app-part="field"
        data-app-field-kind="choice"
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
          data-app-part="field-control"
          role="switch"
          aria-checked={isChecked}
          // Visible `label` wins (points at the rendered span); otherwise
          // fall back to a caller-supplied `aria-labelledby`/`aria-label`.
          aria-label={ariaLabel}
          aria-labelledby={label ? labelId : ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          title={title}
          disabled={disabled && !focusableWhenDisabled}
          aria-disabled={disabled && focusableWhenDisabled ? true : undefined}
          onClick={() => { if (!disabled) onChange(!isChecked); }}
          className={cn(
            'inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full md:h-6 md:min-w-0',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
            'md:w-11',
          )}
        >
          <span
            data-app-switch-track
            className={cn(
              'relative inline-flex shrink-0 items-center rounded-full px-0.5 ring-1 ring-inset ring-[var(--control-border)] transition-colors duration-fast ease-standard motion-reduce:transition-none',
              // Preserve track boundaries when forced colors flatten the tint.
              'forced-colors:border forced-colors:border-[ButtonBorder]',
              'h-6 w-11',
              isChecked
                ? 'bg-[var(--theme-primary)]'
                : 'bg-[var(--control-track-off)]',
            )}
          >
            <span
              className={cn(
                'pointer-events-none relative inline-block h-5 w-5 rounded-full bg-[var(--control-thumb)] ring-1 ring-inset ring-[var(--control-border)] transition-transform duration-fast ease-standard motion-reduce:transition-none',
                'forced-colors:border forced-colors:border-[ButtonBorder]',
                'translate-x-0',
                isChecked && 'translate-x-5',
              )}
              aria-hidden="true"
            >
              {indeterminate && <span className="absolute left-1/2 top-1/2 h-0.5 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--text-secondary)]" />}
            </span>
          </span>
        </button>
        {label && (
          <span data-app-part="field-label" id={labelId} className="min-w-0 break-words text-sm font-medium text-[var(--text-secondary)]">
            {label}
          </span>
        )}
      </div>
    );
  },
);
Toggle.displayName = 'Toggle';
