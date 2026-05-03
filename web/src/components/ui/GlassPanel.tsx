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
   * (Phase 40 / Prompt 44.)
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
        padding ? paddingClasses[padding] : null,
        hover && 'transition-all duration-normal',
        hover && glowClasses[glow],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
);
GlassPanel.displayName = 'GlassPanel';
