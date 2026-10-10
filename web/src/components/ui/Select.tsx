import { forwardRef, useId, type SelectHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
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
   * readers announce the visible label for implicit IDs. Explicit help
   * targets, names and field IDs retain their existing precedence.
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
  sm: 'min-h-11 md:min-h-9 px-3 py-1.5 text-sm',
  md: 'min-h-11 md:min-h-10 px-3 py-2 text-sm',
  lg: 'min-h-12 px-4 py-2.5 text-base',
  auto: 'px-d-pad-x py-d-pad-y text-d-base min-h-d-row',
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({
    options,
    label,
    help,
    error,
    hint,
    placeholder,
    size = 'md',
    className,
    id,
    required,
    'aria-describedby': ariaDescribedBy,
    ...props
  }, ref) => {
    const { t } = useTranslation();
    // Labels may repeat or change with locale; they must not own field identity.
    const reactId = useId();
    const selectId = id || `select-${reactId}`;
    const feedbackId = error
      ? `${selectId}-error`
      : hint
        ? `${selectId}-hint`
        : undefined;
    const describedBy = [ariaDescribedBy, feedbackId].filter(Boolean).join(' ') || undefined;
    return (
      <div className="min-w-0 space-y-1">
        {label && (
          <div className="flex min-w-0 items-center gap-1">
            <Label
              htmlFor={selectId}
              required={required}
              className="min-w-0 break-words text-sm font-medium text-[var(--text-secondary)]"
            >
              {label}
            </Label>
            {help && (
              <HelpIcon
                {...help}
                for={help.for ?? selectId}
                ariaLabel={help.ariaLabel ?? (!id && help.for == null
                  ? t('a11y.helpFor', { field: label, defaultValue: `Help for ${label}` })
                  : undefined)}
                className={cn('shrink-0', help.className)}
              />
            )}
          </div>
        )}
        <select
          ref={ref}
          id={selectId}
          required={required}
          aria-required={required ? 'true' : undefined}
          className={cn(
            'min-w-0 w-full rounded-shape-sm border border-[var(--control-border)] bg-[var(--control-bg)] text-[var(--text-primary)] transition-colors duration-fast motion-reduce:transition-none',
            sizeClasses[size],
            'focus-visible:border-[var(--focus-ring)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-app)]',
            'disabled:cursor-not-allowed disabled:border-[var(--border-default)] disabled:bg-[var(--surface-2)] disabled:text-[var(--text-secondary)] disabled:opacity-100',
            error && 'border-[var(--semantic-danger)]',
            className,
          )}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {(options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && <p id={`${selectId}-error`} role="alert" className="break-words text-xs text-[var(--semantic-danger)]">{error}</p>}
        {hint && !error && <p id={`${selectId}-hint`} className="break-words text-xs text-[var(--text-muted)]">{hint}</p>}
      </div>
    );
  },
);
Select.displayName = 'Select';
