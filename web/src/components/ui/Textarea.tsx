import { forwardRef, useId } from 'react';
import { cn } from '@/lib/cn';
import { Label } from './Label';
import { HelpIcon, type HelpIconProps } from './HelpIcon';

export interface TextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> {
  label?: string;
  /**
 * Optional `<HelpIcon>` rendered immediately after the label. The
 * HelpIcon's `for` defaults to the textarea's resolved id so screen
 * readers announce "Help for {{id}}" when the trigger is focused.
 */
  help?: Omit<HelpIconProps, 'for'> & { for?: string };
  error?: string;
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
  ({ className, label, help, error, size = 'md', id, required, ...props }, ref) => {
    // Stable fallback id so the error message is always programmatically
    // associated via aria-describedby — even for aria-label-only textareas
    // that supply neither `id` nor `label`. useId is SSR-safe and unique
    // per instance, so two such textareas on one page never collide.
    const reactId = useId();
    const textareaId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : reactId);
    const errorId = `${textareaId}-error`;
    return (
      <div>
        {label && (
          <div className="mb-1 flex items-center gap-1">
            <Label
              htmlFor={textareaId}
              required={required}
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              {label}
            </Label>
            {help && <HelpIcon {...help} for={help.for ?? textareaId} />}
          </div>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          required={required}
          aria-required={required ? 'true' : undefined}
          className={cn(
            'w-full rounded-lg border border-[var(--glass-border)] bg-[var(--surface-1)]',
            // Colour base MUST precede sizeClasses: tailwind-merge classifies
            // the custom density utility `text-d-base` in the same group as
            // the arbitrary colour `text-[var(--text-primary)]`, so whichever
            // comes last wins. Ordering the colour first lets the size utility
            // survive (matching Input/Select) — otherwise size="auto" would
            // silently drop its density font-size.
            'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
            sizeClasses[size],
            'focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/30',
            'resize-y transition-colors disabled:cursor-not-allowed disabled:border-[var(--border-default)] disabled:bg-[var(--surface-2)] disabled:text-[var(--text-secondary)] disabled:opacity-100',
            error && 'border-red-500/50',
            className,
          )}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
          {...props}
        />
        {error && (
          <p id={errorId} className="mt-1 text-xs text-red-400">
            {error}
          </p>
        )}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
