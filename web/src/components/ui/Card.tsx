import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Padding scale. Defaults to `'md'`. Pass `'auto'` to follow the user's
   * `ui_density` setting via the density-aware Tailwind utilities
   * (`px-d-pad-x py-d-pad-y`); see `useDensitySync` and `index.css`.
   */
  padding?: 'none' | 'sm' | 'md' | 'lg' | 'auto';
  hover?: boolean;
}

// Hoisted to module scope so the padding map is allocated once instead of
// on every render (mirrors the `sizes` map in Checkbox.tsx). Keeping it a
// stable reference also keeps the class list deterministic per `padding`.
const PADDINGS: Record<NonNullable<CardProps['padding']>, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
  auto: 'px-d-pad-x py-d-pad-y',
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ padding = 'md', hover, className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        // Card and GlassPanel now render the identical panel surface, so they
        // must also print identically. `[data-print-card]` is the print-stylesheet
        // opt-in marker (index.css) that gives a surface a visible border on
        // white and keeps it off a page break; without it a Card printed
        // borderless next to a bordered GlassPanel of the same visual weight.
        data-print-card=""
        className={cn(
          // Identical panel surface contract to GlassPanel (index.css → PANEL
          // SURFACE). Previously Card and GlassPanel disagreed on all four
          // decisions — surface-1 vs surface-2, glass-border vs border-subtle,
          // rounded-lg vs rounded-xl, shadow-sm vs none — so adjacent panels
          // visibly failed to line up. One contract now drives both.
          'rounded-panel border border-[var(--panel-border)] bg-[var(--panel-bg)] text-[var(--text-primary)] shadow-panel',
          // In forced-colors mode, the panel border
          // alpha collapses to invisible against OS Canvas, and box-shadow
          // is suppressed entirely. Pin the boundary to a system color so
          // cards remain perceivable in Windows High Contrast.
          'forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
          // Fall back to the default `md` scale if an out-of-union value
          // is passed at runtime, so a card never renders edge-to-edge.
          PADDINGS[padding] ?? PADDINGS.md,
          hover &&
            'cursor-pointer transition-all duration-normal hover:border-[var(--panel-border-hover)] hover:shadow-panel-hover',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);
Card.displayName = 'Card';

export interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function CardHeader({ title, subtitle, action }: CardHeaderProps) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        {subtitle && <p className="text-sm text-[var(--text-muted)]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mt-4 flex items-center justify-end gap-2 border-t border-[var(--panel-border)] pt-4', className)}>
      {children}
    </div>
  );
}
