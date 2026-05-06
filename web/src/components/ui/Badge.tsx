import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const variants = {
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  success: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  danger: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  neutral: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
} as const;

const badgeSizes = {
  sm: 'px-1.5 py-0.5 text-xs',
  md: 'px-2 py-0.5 text-xs',
  lg: 'px-2.5 py-1 text-sm',
  // Density-aware sizing follows the user's `ui_density` setting.
  // (Phase 40 / Prompt 44.) Uses tighter padding multipliers than
  // Button — a Badge sits inline with text, so the body size token is
  // scaled down via text-xs for legibility.
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
        // Phase-46 / Prompt 11 — forced-colors mode: badge backgrounds
        // (e.g. `bg-emerald-100`) are remapped to the OS Canvas colour
        // and the visual chip vanishes against panel surfaces. Add a
        // system-colour border so the chip outline survives, regardless
        // of variant. We do NOT use `forced-color-adjust: none` here —
        // the user's OS palette wins for body chips; the border alone
        // is enough to keep them perceivable.
        'forced-colors:border forced-colors:border-[CanvasText]',
        variants[variant],
        badgeSizes[size],
        className,
      )}
      {...props}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', `bg-current`)} />}
      {children}
    </span>
  ),
);
Badge.displayName = 'Badge';
