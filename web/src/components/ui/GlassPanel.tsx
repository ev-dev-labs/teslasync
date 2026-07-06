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

const glowClasses = {
  cyan: 'hover:border-cyan-400/30 hover:shadow-[0_0_15px_rgba(34,211,238,0.1)]',
  green: 'hover:border-green-400/30 hover:shadow-[0_0_15px_rgba(74,222,128,0.1)]',
  purple: 'hover:border-purple-400/30 hover:shadow-[0_0_15px_rgba(192,132,252,0.1)]',
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
        'bg-[var(--surface-2)] backdrop-blur-sm border border-[var(--border-subtle)] rounded-xl',
        // Windows High Contrast / forced-colors mode.
        // The `--border-subtle` rgba alpha collapses to near-transparent
        // under forced-colors, making panels invisible against the OS
        // Canvas background. Force a system-color border + Canvas bg so
        // the surface is always perceivable for low-vision users.
        'forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
        padding ? (paddingClasses[padding] ?? null) : null,
        hover && 'transition-all duration-normal',
        // `glow` is frequently data-driven (`glow={HEALTH_GLOW[status]}`,
        // `glow={glowMap[color] ?? 'none'}`, `glow={active ? 'green' : 'none'}`).
        // Should a value land outside the union at runtime, `glowClasses[glow]`
        // is undefined; fall back to the no-glow tokens so the hover affordance
        // degrades cleanly instead of leaking `undefined` into the class list.
        // Mirrors Badge's variant/size null-safety.
        hover && (glowClasses[glow] ?? glowClasses.none),
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
);
GlassPanel.displayName = 'GlassPanel';
