import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Label } from './Label';
import { HelpIcon, type HelpIconProps } from './HelpIcon';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  /**
   * Optional `<HelpIcon>` rendered immediately after the label. The
   * HelpIcon's `for` defaults to the input's resolved id so screen
   * readers announce "Help for {{id}}" when the trigger is focused.
   */
  help?: Omit<HelpIconProps, 'for'> & { for?: string };
  error?: string;
  hint?: string;
  icon?: ReactNode;
  suffix?: ReactNode;
  /**
   * Sizing scale. Defaults to `'md'` for back-compat with existing
   * callers. Pass `'auto'` to follow the user's `ui_density` setting
   * via density-aware Tailwind utilities (`min-h-d-row px-d-pad-x
   * text-d-base`); see `useDensitySync` and `index.css`.
   */
  size?: 'sm' | 'md' | 'lg' | 'auto';
}

const sizeClasses: Record<NonNullable<InputProps['size']>, string> = {
  sm: 'min-h-9 px-3 py-1.5 text-sm',
  md: 'min-h-10 px-3 py-2 text-sm',
  lg: 'min-h-12 px-4 py-2.5 text-base',
  auto: 'px-d-pad-x py-d-pad-y text-d-base min-h-d-row',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({
    label,
    help,
    error,
    hint,
    icon,
    suffix,
    size = 'md',
    className,
    id,
    required,
    'aria-describedby': ariaDescribedBy,
    ...props
  }, ref) => {
    const reactId = useId();
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-') || `input-${reactId}`;
    const feedbackId = error
      ? `${inputId}-error`
      : hint
        ? `${inputId}-hint`
        : undefined;
    const describedBy = [ariaDescribedBy, feedbackId].filter(Boolean).join(' ') || undefined;
    return (
      <div className="space-y-1">
        {label && (
          <div className="flex items-center gap-1">
            <Label
              htmlFor={inputId}
              required={required}
              className="text-sm font-medium text-[var(--text-secondary)]"
            >
              {label}
            </Label>
            {help && <HelpIcon {...help} for={help.for ?? inputId} />}
          </div>
        )}
        <div className="relative">
          {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">{icon}</span>}
          <input
            ref={ref}
            id={inputId}
            required={required}
            aria-required={required ? 'true' : undefined}
            className={cn(
              'w-full rounded-shape-md border border-[var(--control-border)] bg-[var(--control-bg)] text-[var(--text-primary)] transition-colors',
              sizeClasses[size],
              'placeholder:text-[var(--text-muted)] focus-visible:border-[var(--theme-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-app)]',
              'disabled:cursor-not-allowed disabled:border-[var(--border-default)] disabled:bg-[var(--surface-2)] disabled:text-[var(--text-secondary)] disabled:opacity-100',
              error && 'border-rose-500',
              icon && 'pl-10',
              suffix && 'pr-10',
              className,
            )}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={describedBy}
            {...props}
          />
          {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2">{suffix}</span>}
        </div>
        {error && <p id={`${inputId}-error`} role="alert" className="text-xs text-rose-300">{error}</p>}
        {hint && !error && <p id={`${inputId}-hint`} className="text-xs text-[var(--text-muted)]">{hint}</p>}
      </div>
    );
  },
);
Input.displayName = 'Input';
