import { forwardRef, useId, type HTMLAttributes } from 'react';
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
 * Switch toggle (WAI-ARIA `role="switch"`).
 *
 * Accessibility (Phase-40 / Prompt 20):
 * - Renders a real `<button>` so Space/Enter natively toggle the value.
 * - The visible label, when supplied, is associated with the button via
 *   `aria-labelledby` so screen readers announce both the switch state and
 *   its label.
 * - The outer wrapper is a neutral `<div>`; the previous `<label>` element
 *   was misleading because `<label>` has no semantic relationship to a
 *   `role="switch"` control.
 * - `aria-checked` reflects the current state; clicking the label text also
 *   toggles via the wrapper's onClick (delegating to the button).
 */
export const Toggle = forwardRef<HTMLDivElement, ToggleProps>(
  ({ label, checked, onChange, size = 'md', className, ...props }, ref) => {
    const labelId = useId();
    return (
      <div
        ref={ref}
        className={cn('inline-flex items-center gap-2 cursor-pointer select-none', className)}
        onClick={(e) => {
          // Allow clicking the label text to toggle, but ignore clicks that
          // already targeted the button (which fires its own onClick).
          if ((e.target as HTMLElement).closest('button')) return;
          onChange(!checked);
        }}
        {...props}
      >
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={label ? labelId : undefined}
          onClick={() => onChange(!checked)}
          className={cn(
            'relative inline-flex shrink-0 rounded-full transition-colors duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
            trackSize[size],
            checked
              ? 'bg-cyan-500 dark:bg-cyan-600'
              : 'bg-gray-300 dark:bg-gray-600',
          )}
        >
          <span
            className={cn(
              'pointer-events-none inline-block rounded-full bg-white shadow-sm transition-transform duration-200',
              thumbSize[size],
              'translate-y-[3px] translate-x-[3px]',
              checked && thumbTranslate[size],
            )}
            aria-hidden="true"
          />
        </button>
        {label && (
          <span id={labelId} className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {label}
          </span>
        )}
      </div>
    );
  },
);
Toggle.displayName = 'Toggle';
