import {
  formatDurationMs,
  formatDurationMsLong,
  formatDurationMsCompact,
  formatDurationClock,
} from '@/lib/dateFormat';

export type DurationVariant = 'short' | 'long' | 'compact' | 'clock';

interface DurationProps {
  ms: number | null | undefined;
  variant?: DurationVariant;
  className?: string;
}

/**
 * Duration renderer that wraps the existing `formatDuration*` helpers and
 * exposes the raw millisecond value via `title`.
 */
export function Duration({ ms, variant = 'short', className }: DurationProps) {
  if (ms == null || !Number.isFinite(ms)) {
    return <span className={className}>—</span>;
  }

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

  return (
    <span className={className} title={`${ms} ms`}>
      {display}
    </span>
  );
}
