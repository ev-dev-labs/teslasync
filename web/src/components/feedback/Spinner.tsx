import { cn } from '@/lib/cn';
import { useMotionPreference } from '@/hooks/useMotionPreference';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
}

const sizeMap = {
  sm: { box: 'h-6 w-6',   pixels: 24, stroke: 22 },
  md: { box: 'h-12 w-12', pixels: 48, stroke: 14 },
  lg: { box: 'h-20 w-20', pixels: 80, stroke: 10 },
};

/**
 * Brand loading mark — a lightning bolt that draws itself like a strike,
 * fills to solid, holds, then fades and redraws. The cyan/emerald
 * electrical glow comes from a CSS drop-shadow stack (`.spinner-bolt-glow`)
 * that tracks the active theme via `--theme-primary` / `--theme-accent`.
 *
 * No spinning ring, no background tile — just the bolt. The SVG uses
 * `overflow-visible` so the glow can spill outside its box without being
 * clipped at small sizes.
 *
 * Honors `prefers-reduced-motion` via {@link useMotionPreference}: when
 * the OS reports reduced motion, the bolt renders fully filled with the
 * same glow (no draw cycle, no fade). The global CSS reduced-motion
 * safety net cannot land the draw animation on a meaningful idle frame,
 * so we short-circuit here instead.
 */
export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  const { box, pixels, stroke } = sizeMap[size];
  const { reduce } = useMotionPreference();

  return (
    <div
      className={cn('flex flex-col items-center gap-3', className)}
      role="status"
      aria-label={label ?? 'Loading'}
    >
      <div className={cn('relative flex items-center justify-center', box)}>
        <svg
          width={pixels}
          height={pixels}
          viewBox="0 0 200 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="overflow-visible text-white spinner-bolt-glow"
        >
          <path
            d="M112 30L62 108h34L78 170l58-82h-34z"
            pathLength={100}
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="currentColor"
            fillOpacity={reduce ? 1 : 0}
            strokeDasharray={reduce ? 'none' : 100}
            strokeDashoffset={reduce ? 0 : 100}
            className={reduce ? undefined : 'spinner-bolt-draw'}
          />
        </svg>
      </div>
      {label && <span className="text-sm text-[var(--text-secondary)]">{label}</span>}
    </div>
  );
}
