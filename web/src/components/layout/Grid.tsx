import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Breakpoint = 'default' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';

interface GridProps {
  cols?: {
    default?: number;
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
    '2xl'?: number;
    '3xl'?: number;
  };
  /**
   * Container-aware auto-fit layout. Prefer this for metric cards nested
   * inside panels; viewport breakpoints cannot know how wide the panel is.
   */
  minItemWidth?: 'compact' | 'standard' | 'wide';
  gap?: number;
  children: ReactNode;
  className?: string;
}

// Full, static per-breakpoint column utilities. Tailwind's JIT scanner only
// picks up class names that appear as literals in source — a dynamically
// concatenated variant such as `sm:${map[n]}` is never emitted into the
// compiled CSS, so responsive columns silently did nothing. Listing every
// breakpoint × count as a literal here guarantees the CSS exists and lets us
// drop unsupported counts cleanly instead of injecting a garbage
// `sm:undefined` token into the DOM.
const COL_CLASSES: Record<Breakpoint, Record<number, string>> = {
  default: { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5', 6: 'grid-cols-6' },
  sm: { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4', 5: 'sm:grid-cols-5', 6: 'sm:grid-cols-6' },
  md: { 1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4', 5: 'md:grid-cols-5', 6: 'md:grid-cols-6' },
  lg: { 1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6' },
  xl: { 1: 'xl:grid-cols-1', 2: 'xl:grid-cols-2', 3: 'xl:grid-cols-3', 4: 'xl:grid-cols-4', 5: 'xl:grid-cols-5', 6: 'xl:grid-cols-6' },
  '2xl': { 1: '2xl:grid-cols-1', 2: '2xl:grid-cols-2', 3: '2xl:grid-cols-3', 4: '2xl:grid-cols-4', 5: '2xl:grid-cols-5', 6: '2xl:grid-cols-6' },
  '3xl': { 1: '3xl:grid-cols-1', 2: '3xl:grid-cols-2', 3: '3xl:grid-cols-3', 4: '3xl:grid-cols-4', 5: '3xl:grid-cols-5', 6: '3xl:grid-cols-6' },
};

const AUTO_FIT_CLASSES = {
  compact: '[grid-template-columns:repeat(auto-fit,minmax(min(100%,8rem),1fr))]',
  standard: '[grid-template-columns:repeat(auto-fit,minmax(min(100%,10rem),1fr))]',
  wide: '[grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr))]',
} as const;

const GAP_CLASSES: Record<number, string> = {
  0: 'gap-0', 1: 'gap-1', 2: 'gap-2', 3: 'gap-3', 4: 'gap-4', 5: 'gap-5',
  6: 'gap-6', 7: 'gap-7', 8: 'gap-8', 9: 'gap-9', 10: 'gap-10', 11: 'gap-11', 12: 'gap-12',
};

// Resolve a requested column count to a supported (1–6) static utility.
// Non-numeric or `< 1` values are treated as "unset" (matching the previous
// `n && …` semantics); counts above 6 clamp down so a dynamic
// `cols={{ md: items.length }}` degrades gracefully instead of emitting an
// invalid class.
function colClass(bp: Breakpoint, n: number | undefined): string | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) return undefined;
  return COL_CLASSES[bp][Math.min(6, Math.round(n))];
}

export function Grid({
  cols = { default: 1 },
  minItemWidth,
  gap = 4,
  children,
  className,
}: GridProps) {
  return (
    <div
      data-layout={minItemWidth ? 'auto-fit' : 'responsive-columns'}
      className={cn(
        'grid',
        minItemWidth
          ? AUTO_FIT_CLASSES[minItemWidth]
          : [
              colClass('default', cols.default),
              colClass('sm', cols.sm),
              colClass('md', cols.md),
              colClass('lg', cols.lg),
              colClass('xl', cols.xl),
              colClass('2xl', cols['2xl']),
              colClass('3xl', cols['3xl']),
            ],
        GAP_CLASSES[gap] ?? 'gap-4',
        className,
      )}
    >
      {children}
    </div>
  );
}
