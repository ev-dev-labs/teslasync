import {
  formatDurationMs,
  formatDurationMsLong,
  formatDurationMsCompact,
  formatDurationClock,
} from '@/lib/dateFormat';

export type DurationVariant = 'short' | 'long' | 'compact' | 'clock';

/**
 * Universal placeholder shared with the `formatDuration*` helpers in
 * `@/lib/dateFormat`. Every helper collapses nullish, non-finite, and
 * variant-specific out-of-range input to this em-dash, so the component can
 * detect an unrenderable value by comparing against it rather than
 * re-implementing each helper's guard.
 */
const FALLBACK = '—';

interface DurationProps {
  ms: number | null | undefined;
  variant?: DurationVariant;
  className?: string;
}

/**
 * Duration renderer that wraps the existing `formatDuration*` helpers and
 * exposes the raw millisecond value via `title`.
 *
 * The shared helpers are the single source of truth for empty handling: they
 * already return the em-dash placeholder for null/undefined/NaN/±Infinity and
 * for variant-specific out-of-range values (e.g. `long`/`clock` reject
 * non-positive durations). When the chosen helper yields that placeholder we
 * render it exactly like the empty state — crucially WITHOUT the `title`, so a
 * "no data" em-dash never carries a misleading "0 ms"/"-100 ms" hover tooltip.
 */
export function Duration({ ms, variant = 'short', className }: DurationProps) {
  let display: string;
  switch (variant) {
    case 'long':
      display = formatDurationMsLong(ms);
      break;
    case 'compact':
      display = formatDurationMsCompact(ms);
      break;
    case 'clock':
      display = formatDurationClock(ms);
      break;
    case 'short':
    default:
      display = formatDurationMs(ms);
      break;
  }

  if (display === FALLBACK) {
    return <span className={className}>{FALLBACK}</span>;
  }

  return (
    <span className={className} title={`${ms} ms`}>
      {display}
    </span>
  );
}
