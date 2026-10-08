import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  glow?: 'cyan' | 'green' | 'purple' | 'none';
  hover?: boolean;
  /**
   * Optional padding scale. Omitted by default (callers usually pass a
   * `className="p-4"` etc. inline). Pass `'auto'` to follow the user's
   * `ui_density` setting via the density-aware Tailwind utilities
   * (`px-d-pad-x py-d-pad-y`); see `useDensitySync` and `index.css`.
   *
   */
  padding?: 'none' | 'sm' | 'md' | 'lg' | 'auto';
  children: ReactNode;
  className?: string;
}

/**
 * Restrained hover accents under the existing persisted `glow` IDs.
 *
 * Exported so tests and any consumer that needs to reason about the panel's
 * hover treatment resolve it from here instead of duplicating the literal
 * class strings. Four separate suites previously hardcoded these, so changing
 * the accent required touching every one of them.
 *
 * These only tint the border; data-driven color identities stay distinct
 * without colored shadows or decorative motion.
 */
export const GLOW_CLASSES = {
  cyan: 'hover:border-[var(--semantic-info-border)]',
  green: 'hover:border-[var(--semantic-success-border)]',
  purple: 'hover:border-[var(--semantic-purple-border)]',
  none: '',
} as const;

const paddingClasses: Record<NonNullable<GlassPanelProps['padding']>, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
  auto: 'px-d-pad-x py-d-pad-y',
};

export const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(
  ({ glow = 'none', hover = false, padding, className, children, ...props }, ref) => (
    <div
      ref={ref}
      data-print-card
      className={cn(
        // Card and GlassPanel share the neutral panel surface contract.
        'bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-panel shadow-panel',
        // Windows High Contrast / forced-colors mode.
        // The `--panel-border` rgba alpha collapses to near-transparent
        // under forced-colors, making panels invisible against the OS
        // Canvas background. Force a system-color border + Canvas bg so
        // the surface is always perceivable for low-vision users.
        'forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
        padding ? (paddingClasses[padding] ?? null) : null,
        hover && 'hover:border-[var(--panel-border-hover)] forced-colors:hover:border-[CanvasText]',
        // `glow` is frequently data-driven (`glow={HEALTH_GLOW[status]}`,
        // `glow={glowMap[color] ?? 'none'}`, `glow={active ? 'green' : 'none'}`).
        // Should a value land outside the union at runtime, `GLOW_CLASSES[glow]`
        // is undefined; fall back to the no-glow tokens so the hover affordance
        // degrades cleanly instead of leaking `undefined` into the class list.
        // Mirrors Badge's variant/size null-safety.
        hover && (GLOW_CLASSES[glow] ?? GLOW_CLASSES.none),
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
);
GlassPanel.displayName = 'GlassPanel';
