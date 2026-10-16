import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { PanelTitle, Text } from './Typography';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'standalone' | 'embedded';
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
  ({ padding = 'md', hover, className, children, variant = 'standalone', ...props }, ref) => {
    const { reduce } = useMotionPreference();
    return (
      <div
        ref={ref}
        // Card and GlassPanel now render the identical panel surface, so they
        // must also print identically. `[data-print-card]` is the print-stylesheet
        // opt-in marker (index.css) that gives a surface a visible border on
        // white and keeps it off a page break; without it a Card printed
        // borderless next to a bordered GlassPanel of the same visual weight.
        data-surface-variant={variant}
        data-print-card={variant === 'standalone' ? '' : undefined}
        className={cn(
          // Identical panel surface contract to GlassPanel (index.css → PANEL
          // SURFACE). Previously Card and GlassPanel disagreed on all four
          // decisions — surface-1 vs surface-2, glass-border vs border-subtle,
          // rounded-lg vs rounded-xl, shadow-sm vs none — so adjacent panels
          // visibly failed to line up. One contract now drives both.
          variant === 'embedded'
            ? 'min-w-0 bg-transparent border-0 rounded-none text-[var(--text-primary)] shadow-none'
            : 'min-w-0 rounded-panel border border-[var(--panel-border)] bg-[var(--panel-bg)] text-[var(--text-primary)] shadow-panel',
          // In forced-colors mode, the panel border
          // alpha collapses to invisible against OS Canvas, and box-shadow
          // is suppressed entirely. Pin the boundary to a system color so
          // cards remain perceivable in Windows High Contrast.
          variant === 'standalone' && 'forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
          // Fall back to the default `md` scale if an out-of-union value
          // is passed at runtime, so a card never renders edge-to-edge.
          PADDINGS[padding] ?? PADDINGS.md,
          variant === 'standalone' && hover &&
            'cursor-pointer transition-colors duration-fast ease-standard motion-reduce:transition-none hover:border-[var(--panel-border-hover)] hover:shadow-panel-hover',
          variant === 'standalone' && hover && reduce && 'transition-none',
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
    <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 max-w-full flex-auto">
        <PanelTitle className="break-words">{title}</PanelTitle>
        {subtitle && <Text as="p" variant="bodySm" className="break-words">{subtitle}</Text>}
      </div>
      {action != null && (
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{action}</div>
      )}
    </div>
  );
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mt-4 flex min-w-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--panel-border)] pt-4 forced-colors:border-[CanvasText]', className)}>
      {children}
    </div>
  );
}
