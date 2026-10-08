import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Badge palette — exported as the single source of truth.
 *
 * Semantic roles preserve status meaning while the shared variables supply
 * restrained, theme-aware foregrounds, tints and borders.
 * Keep the variant IDs stable for data-driven consumers.
 */
export const BADGE_VARIANTS = {
  info: 'border border-[var(--semantic-info-border)] bg-[var(--semantic-info-bg)] text-[var(--semantic-info)]',
  success: 'border border-[var(--semantic-success-border)] bg-[var(--semantic-success-bg)] text-[var(--semantic-success)]',
  warning: 'border border-[var(--semantic-warning-border)] bg-[var(--semantic-warning-bg)] text-[var(--semantic-warning)]',
  danger: 'border border-[var(--semantic-danger-border)] bg-[var(--semantic-danger-bg)] text-[var(--semantic-danger)]',
  neutral: 'border border-[var(--border-default)] bg-[var(--surface-2)] text-[var(--text-secondary)]',
} as const;

const variants = BADGE_VARIANTS;

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
        'inline-flex min-w-0 max-w-full items-center gap-1 rounded-full whitespace-normal break-words font-medium',
        // In forced-colors mode, badge backgrounds can collapse into the OS
        // Canvas colour. Add a system-colour border so the chip outline stays
        // visible while still respecting the user's OS palette.
        'forced-colors:border forced-colors:border-[CanvasText]',
        // Data-driven call sites forward API status strings through helpers
        // (e.g. `variant={statusVariant(status)}`). Should a value land outside
        // the union at runtime, fall back to neutral/md tokens. Own-key checks
        // also reject inherited object keys such as `constructor`.
        Object.hasOwn(variants, variant) ? variants[variant] : variants.neutral,
        Object.hasOwn(badgeSizes, size) ? badgeSizes[size] : badgeSizes.md,
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
