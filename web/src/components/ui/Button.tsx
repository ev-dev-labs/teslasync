import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const variants = {
  primary: 'bg-[var(--theme-primary)] text-[var(--theme-on-primary)] hover:brightness-110 focus-visible:ring-[var(--theme-primary)] forced-colors:border forced-colors:border-[ButtonBorder]',
  secondary: 'bg-gray-100 text-[var(--text-primary)] hover:bg-gray-200 dark:bg-gray-700 forced-colors:border forced-colors:border-[ButtonBorder]',
  outline: 'border border-gray-300 bg-transparent hover:bg-gray-50 dark:border-gray-600 forced-colors:border-[ButtonBorder]',
  danger: 'bg-red-600 text-[var(--text-on-accent)] hover:bg-red-700 focus-visible:ring-red-500 forced-colors:border forced-colors:border-[ButtonBorder]',
  ghost: 'bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 forced-colors:border forced-colors:border-[ButtonBorder]',
} as const;

const sizes = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
  // Density-aware sizing follows the user's `ui_density` setting via the
  // density Tailwind utilities (`min-h-d-row px-d-pad-x text-d-base`).
  auto: 'min-h-d-row px-d-pad-x text-d-base',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:border-[var(--border-default)] disabled:bg-[var(--surface-2)] disabled:text-[var(--text-secondary)] disabled:shadow-none disabled:opacity-100',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        // Decorative spinner: the loading state is already announced to
        // assistive tech via the button's aria-busy, so the SVG itself must
        // stay out of the accessibility tree.
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : icon}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
