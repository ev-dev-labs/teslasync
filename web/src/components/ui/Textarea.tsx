import { forwardRef, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Label } from './Label';
import { HelpIcon, type HelpIconProps } from './HelpIcon';

export interface TextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> {
  label?: string;
  /**
 * Optional `<HelpIcon>` rendered immediately after the label. The
 * HelpIcon's `for` defaults to the textarea's resolved id so screen
 * For an implicit id, the accessible name uses the visible label. Explicit
 * id/help target/name overrides retain their existing precedence.
 */
  help?: Omit<HelpIconProps, 'for'> & { for?: string };
  error?: string;
  hint?: string;
  /**
 * Sizing scale. Defaults to `'md'` for back-compat. Pass `'auto'` to
 * follow the user's `ui_density` setting via density-aware Tailwind
 * utilities. (.)
 */
  size?: 'sm' | 'md' | 'lg' | 'auto';
}

const sizeClasses: Record<NonNullable<TextareaProps['size']>, string> = {
  sm: 'px-2 py-1.5 text-xs',
  md: 'px-3 py-2 text-sm',
  lg: 'px-4 py-2.5 text-base',
  auto: 'px-d-pad-x py-d-pad-y text-d-base',
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({
    className,
    label,
    help,
    error,
    hint,
    size = 'md',
    id,
    required,
    'aria-describedby': ariaDescribedBy,
    ...props
  }, ref) => {
    const { t } = useTranslation();
    // Labels can repeat or change with locale; useId keeps implicit field
    // and feedback identities stable without replacing an explicit caller id.
    const reactId = useId();
    const textareaId = id ?? reactId;
    const errorId = `${textareaId}-error`;
    const hintId = `${textareaId}-hint`;
    const feedbackId = error ? errorId : hint ? hintId : undefined;
    const describedBy = [ariaDescribedBy, feedbackId].filter(Boolean).join(' ') || undefined;
    return (
      <div className="min-w-0">
        {label && (
          <div className="mb-1 flex flex-wrap items-start gap-1">
            <Label
              htmlFor={textareaId}
              required={required}
              className="block min-w-0 break-words text-xs font-medium text-[var(--text-secondary)]"
            >
              {label}
            </Label>
            {help && (
              <HelpIcon
                {...help}
                for={help.for ?? textareaId}
                ariaLabel={help.ariaLabel ?? (id == null && help.for == null && label
                  ? t('a11y.helpFor', { field: label, defaultValue: `Help for ${label}` })
                  : undefined)}
              />
            )}
          </div>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          required={required}
          aria-required={required ? 'true' : undefined}
          className={cn(
            'min-h-11 w-full min-w-0 max-w-full rounded-shape-sm border border-[var(--control-border)] bg-[var(--control-bg)] md:min-h-0',
            // Colour base MUST precede sizeClasses: tailwind-merge classifies
            // the custom density utility `text-d-base` in the same group as
            // the arbitrary colour `text-[var(--text-primary)]`, so whichever
            // comes last wins. Ordering the colour first lets the size utility
            // survive (matching Input/Select) — otherwise size="auto" would
            // silently drop its density font-size.
            'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
            sizeClasses[size],
            'focus-visible:border-[var(--focus-ring)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
            'resize-y transition-colors duration-fast ease-standard motion-reduce:transition-none disabled:cursor-not-allowed disabled:border-[var(--border-default)] disabled:bg-[var(--surface-2)] disabled:text-[var(--text-secondary)] disabled:opacity-100',
            error && 'border-[var(--semantic-danger)] focus-visible:border-[var(--semantic-danger)]',
            className,
          )}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          {...props}
        />
        {error && (
          <p id={errorId} role="alert" className="mt-1 break-words text-xs text-[var(--semantic-danger)]">
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={hintId} className="mt-1 break-words text-xs text-[var(--text-muted)]">
            {hint}
          </p>
        )}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
