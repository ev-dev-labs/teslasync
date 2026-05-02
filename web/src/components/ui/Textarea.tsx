import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

export interface TextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> {
  label?: string;
  error?: string;
  /**
   * Sizing scale. Defaults to `'md'` for back-compat. Pass `'auto'` to
   * follow the user's `ui_density` setting via density-aware Tailwind
   * utilities. (Phase 40 / Prompt 44.)
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
  ({ className, label, error, size = 'md', id, ...props }, ref) => {
    const textareaId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div>
        {label && (
          <label htmlFor={textareaId} className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={cn(
            'w-full rounded-lg border border-[var(--glass-border)] bg-[var(--surface-1)]',
            sizeClasses[size],
            'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
            'focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/30',
            'resize-y transition-colors',
            error && 'border-red-500/50',
            className,
          )}
          {...props}
        />
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
