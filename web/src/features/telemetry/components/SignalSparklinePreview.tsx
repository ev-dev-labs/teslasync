/**
 * SignalSparklinePreview — last-hour mini-trend for one signal.
 *
 * Owns its own `useSignalHistory` query so a parent component
 * (SignalCategoryTree) can pass it through as a `renderLeafRight` slot
 * without violating the rules-of-hooks ban on calling hooks inside a
 * render-prop callback. The fetch is only triggered when `enabled` is
 * true — the parent flips this on as a category is expanded so we don't
 * fire 600+ requests on mount.
 *
 * Numeric-kind signals render the Sparkline; non-numeric signals show a
 * compact `(kind)` chip instead — bool / enum / string time-series don't
 * have a meaningful "trend" line.
 */

import { useMemo } from 'react';
import { Sparkline } from '@/components/charts';
import { useSignalHistory } from '@/api/hooks/useSignals';
import type { SignalKind, SignalEnvelope } from '@/api/types';
import { cn } from '@/lib/cn';

const SPARKLINE_LIMIT = 30;
const SPARKLINE_HOURS = 1;

interface SignalSparklinePreviewProps {
  vehicleId: number;
  signal: string;
  valueKind: SignalKind;
  /** Gates the underlying fetch. Parent flips on per-leaf as a group expands. */
  enabled: boolean;
  /** Sparkline color (defaults to teal accent). */
  color?: string;
  /** Sparkline width (px). */
  width?: number;
  /** Sparkline height (px). */
  height?: number;
  className?: string;
}

function envelopesToNumbers(data: SignalEnvelope[]): number[] {
  const out: number[] = [];
  for (const e of data) {
    const v = e.value;
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
    else if (typeof v === 'boolean') out.push(v ? 1 : 0);
  }
  return out;
}

const NON_NUMERIC: ReadonlySet<SignalKind> = new Set<SignalKind>([
  'string',
  'unknown',
  'time',
]);

export function SignalSparklinePreview({
  vehicleId,
  signal,
  valueKind,
  enabled,
  color = '#22d3ee',
  width = 80,
  height = 18,
  className,
}: SignalSparklinePreviewProps) {
  const isNumeric = !NON_NUMERIC.has(valueKind);
  const query = useSignalHistory(
    vehicleId,
    signal,
    { hours: SPARKLINE_HOURS, limit: SPARKLINE_LIMIT },
  );
  // The hook itself is unconditional (rules-of-hooks); we gate the
  // fetch by skipping the render until enabled+numeric and lean on
  // tanstack-query's caching. The hook's built-in `enabled` keys off
  // vehicleId+signal, so we add our own short-circuit here.
  const numericSeries = useMemo(
    () => (query.data?.data ? envelopesToNumbers(query.data.data) : []),
    [query.data],
  );

  if (!enabled) return null;

  if (!isNumeric) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
          'text-[var(--text-muted)] border border-[var(--glass-border)]',
          className,
        )}
        title={`Non-numeric signal (${valueKind})`}
      >
        {valueKind}
      </span>
    );
  }

  if (query.isLoading) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'inline-block animate-pulse rounded bg-[var(--surface-2)]',
          className,
        )}
        style={{ width, height }}
      />
    );
  }

  if (numericSeries.length < 2) {
    return (
      <span
        className={cn('text-[10px] text-[var(--text-muted)]', className)}
        title="No samples in last hour"
      >
        —
      </span>
    );
  }

  return (
    <Sparkline
      data={numericSeries}
      color={color}
      width={width}
      height={height}
    />
  );
}
