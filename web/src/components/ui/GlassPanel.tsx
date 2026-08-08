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
 * Hover accent classes per `glow` value.
 *
 * Exported so tests and any consumer that needs to reason about the panel's
 * hover treatment resolve it from here instead of duplicating the literal
 * class strings. Four separate suites previously hardcoded these, so changing
 * the accent required touching every one of them.
 *
 * Depth itself comes from the neutral elevation ladder (`shadow-panel-hover`);
 * these only tint the border, which keeps the effect legible on all 140 theme
 * presets instead of assuming a dark cyan-tinted background.
 */
export const GLOW_CLASSES = {
  cyan: 'hover:border-cyan-400/40',
  green: 'hover:border-emerald-400/40',
  purple: 'hover:border-purple-400/40',
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
        // Panel surface contract (index.css → PANEL SURFACE). Shared verbatim
        // with Card so the two primitives finally agree on background, border,
        // radius and elevation. Depth now comes from the neutral elevation
        // ladder instead of a cyan bloom, so panels read correctly on all 140
        // presets rather than only the cyan ones. `--panel-blur` is 0 by
        // default; raise that one variable to bring frosted glass back
        // globally without touching a component.
        'bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-panel shadow-panel',
        'backdrop-blur-[var(--panel-blur)]',
        // Windows High Contrast / forced-colors mode.
        // The `--panel-border` rgba alpha collapses to near-transparent
        // under forced-colors, making panels invisible against the OS
        // Canvas background. Force a system-color border + Canvas bg so
        // the surface is always perceivable for low-vision users.
        'forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
        padding ? (paddingClasses[padding] ?? null) : null,
        hover && 'transition-all duration-normal hover:border-[var(--panel-border-hover)] hover:shadow-panel-hover',
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
