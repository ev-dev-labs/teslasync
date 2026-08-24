import { forwardRef, useId, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { Label } from './Label';
import { HelpIcon, type HelpIconProps } from './HelpIcon';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'size'> {
  options: SelectOption[];
  label?: string;
  /**
   * Optional `<HelpIcon>` rendered immediately after the label. The
   * HelpIcon's `for` defaults to the select's resolved id so screen
   * readers announce "Help for {{id}}" when the trigger is focused.
   */
  help?: Omit<HelpIconProps, 'for'> & { for?: string };
  error?: string;
  hint?: string;
  placeholder?: string;
  /**
   * Sizing scale. Defaults to `'md'` for back-compat. Pass `'auto'` to
   * follow the user's `ui_density` setting via density-aware Tailwind
   * utilities.
   */
  size?: 'sm' | 'md' | 'lg' | 'auto';
}

const sizeClasses: Record<NonNullable<SelectProps['size']>, string> = {
  sm: 'min-h-9 px-3 py-1.5 text-sm',
  md: 'min-h-10 px-3 py-2 text-sm',
  lg: 'min-h-12 px-4 py-2.5 text-base',
  auto: 'px-d-pad-x py-d-pad-y text-d-base min-h-d-row',
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ options, label, help, error, hint, placeholder, size = 'md', className, id, required, ...props }, ref) => {
    // Fall back to a stable, unique React id so the error/hint nodes and
    // their `aria-describedby` wiring never collapse to `undefined-error`
    // (invalid + duplicated across label-less selects) when neither `id`
    // nor `label` is supplied.
    const reactId = useId();
    const selectId = id || label?.toLowerCase().replace(/\s+/g, '-') || `select-${reactId}`;
    return (
      <div className="space-y-1">
        {label && (
          <div className="flex items-center gap-1">
            <Label
              htmlFor={selectId}
              required={required}
              className="text-sm font-medium text-[var(--text-secondary)]"
            >
              {label}
            </Label>
            {help && <HelpIcon {...help} for={help.for ?? selectId} />}
          </div>
        )}
        <select
          ref={ref}
          id={selectId}
          required={required}
          aria-required={required ? 'true' : undefined}
          className={cn(
            'w-full rounded-shape-md border border-[var(--control-border)] bg-[var(--control-bg)] text-[var(--text-primary)] transition-colors',
            sizeClasses[size],
            'focus-visible:border-[var(--theme-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-app)]',
            'disabled:cursor-not-allowed disabled:border-[var(--border-default)] disabled:bg-[var(--surface-2)] disabled:text-[var(--text-secondary)] disabled:opacity-100',
            error && 'border-rose-500',
            className,
          )}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {(options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && <p id={`${selectId}-error`} className="text-xs text-red-500">{error}</p>}
        {hint && !error && <p id={`${selectId}-hint`} className="text-xs text-[var(--text-muted)]">{hint}</p>}
      </div>
    );
  },
);
Select.displayName = 'Select';
