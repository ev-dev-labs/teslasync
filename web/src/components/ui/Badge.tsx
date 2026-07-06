import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const variants = {
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  success: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  danger: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  neutral: 'bg-gray-100 text-[var(--text-primary)] dark:bg-gray-700',
} as const;

const badgeSizes = {
  sm: 'px-1.5 py-0.5 text-xs',
  md: 'px-2 py-0.5 text-xs',
  lg: 'px-2.5 py-1 text-sm',
  // Density-aware sizing follows the user's `ui_density` setting. Badge uses
  // tighter padding than Button because it sits inline with text.
  auto: 'px-d-pad-x py-d-pad-y text-xs',
} as const;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof badgeSizes;
  dot?: boolean;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ variant = 'neutral', size = 'md', dot, className, children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium',
        // In forced-colors mode, badge backgrounds can collapse into the OS
        // Canvas colour. Add a system-colour border so the chip outline stays
        // visible while still respecting the user's OS palette.
        'forced-colors:border forced-colors:border-[CanvasText]',
        // Data-driven call sites forward API status strings through helpers
        // (e.g. `variant={statusVariant(status)}`). Should a value land outside
        // the union at runtime, `variants[variant]`/`badgeSizes[size]` is
        // undefined and the chip would render with no colour — effectively
        // invisible. Fall back to the neutral/md tokens so it stays perceivable.
        variants[variant] ?? variants.neutral,
        badgeSizes[size] ?? badgeSizes.md,
        className,
      )}
      {...props}
    >
      {dot && (
        // Purely decorative status dot — hidden from assistive tech, and
        // shrink-0 so it stays a circle next to long labels in the flex row.
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      )}
      {children}
    </span>
  ),
);
Badge.displayName = 'Badge';
