/**
 * SignalSparklinePreview — last-hour mini-trend for one signal.
 *
 * A parent (SignalCategoryTree) hands this to `TreeSelect` as a
 * `renderLeafRight` slot. To honour the rules-of-hooks ban on calling
 * hooks inside a render-prop callback — and to avoid firing 600+ history
 * requests on mount — the fetch lives in a private `SparklineFetcher`
 * child that is only MOUNTED once the leaf is `enabled` (its category is
 * expanded / the tree is searching) AND numeric. An unmounted child never
 * calls `useSignalHistory`, so the gating is real, not cosmetic — this is
 * the "TanStack Query short-circuits unmounted hooks" contract the parent
 * relies on.
 *
 * Numeric-kind signals (int / float / bool) render the Sparkline —
 * booleans collapse to a 1/0 step line. Non-numeric kinds
 * (string / time / unknown) show a compact `(kind)` chip instead, since
 * those series have no meaningful trend line. The fetcher owns its own
 * loading / error / empty / plotted states so a slow or failed query
 * never blanks the tree row.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkline } from '@/components/charts';
import { Caption } from '@/components/ui';
import { useSignalHistory } from '@/api/hooks/useSignals';
import { useDataState } from '@/hooks/useDataState';
import type { SignalKind, SignalEnvelope } from '@/api/types';
import { cn } from '@/lib/cn';

const SPARKLINE_LIMIT = 30;
const SPARKLINE_HOURS = 1;
/**
 * A polyline needs at least two points to describe a trend; a single sample
 * would also divide by zero on `data.length - 1` inside <Sparkline>.
 */
const MIN_POINTS = 2;

export interface SignalSparklinePreviewProps {
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

/**
 * Flatten a typed history series into the numeric samples a Sparkline can
 * plot: finite numbers pass through, booleans collapse to 1/0, and every
 * other value (string / time / null / non-finite) is dropped. Null-safe — a
 * missing series yields an empty array instead of throwing on iteration.
 */
export function envelopesToNumbers(
  data: readonly SignalEnvelope[] | null | undefined,
): number[] {
  const out: number[] = [];
  for (const e of data ?? []) {
    const v = e?.value;
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
  const { t } = useTranslation();
  const isNumeric = !NON_NUMERIC.has(valueKind);

  // Gate the fetch by MOUNTING the query-owning child only when the leaf is
  // both enabled and numeric. The previous shape called `useSignalHistory`
  // unconditionally above this early return, so it fetched even while
  // `enabled` was false (and for non-numeric leaves that never plot). A hook
  // in an unmounted child simply never runs — real gating, not a cosmetic
  // early return.
  if (!enabled) return null;

  if (!isNumeric) {
    return (
      <Caption
        className={cn(
          'inline-flex items-center rounded border border-[var(--glass-border)] px-1.5 py-0.5',
          className,
        )}
        title={t('telemetry.sparkline.nonNumeric', 'Non-numeric signal ({{kind}})', {
          kind: valueKind,
        })}
      >
        {valueKind}
      </Caption>
    );
  }

  return (
    <SparklineFetcher
      vehicleId={vehicleId}
      signal={signal}
      color={color}
      width={width}
      height={height}
      className={className}
    />
  );
}

interface SparklineFetcherProps {
  vehicleId: number;
  signal: string;
  color: string;
  width: number;
  height: number;
  className?: string;
}

/**
 * The fetch-owning half of the preview, mounted only for enabled + numeric
 * leaves so `useSignalHistory` runs exactly when a trend is needed. Owns the
 * loading / error / empty / plotted states so a slow or failed history query
 * never leaves a blank slot in the tree row.
 */
function SparklineFetcher({
  vehicleId,
  signal,
  color,
  width,
  height,
  className,
}: SparklineFetcherProps) {
  const { t } = useTranslation();
  const query = useSignalHistory(vehicleId, signal, {
    hours: SPARKLINE_HOURS,
    limit: SPARKLINE_LIMIT,
  });
  const historyState = useDataState(query, { provenance: 'historical' });

  const numericSeries = useMemo(
    () => envelopesToNumbers(query.data?.data),
    [query.data],
  );

  if (query.isLoading && !historyState.hasData) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'inline-block animate-pulse rounded bg-[var(--surface-2)] motion-reduce:animate-none',
          className,
        )}
        style={{ width, height }}
      />
    );
  }

  if (historyState.fatalError) {
    const label = t('telemetry.sparkline.error', 'Failed to load trend');
    return (
      <Caption
        role="img"
        aria-label={label}
        title={label}
        className={cn('text-rose-300', className)}
      >
        —
      </Caption>
    );
  }

  return (
    <span className={cn('inline-flex min-w-0 max-w-full flex-wrap items-center gap-1', className)}>
      {numericSeries.length < MIN_POINTS ? (
        <Caption title={t('telemetry.sparkline.empty', 'No samples in last hour')}>—</Caption>
      ) : (
        <span
          role="img"
          aria-label={t(
            'telemetry.sparkline.trend',
            '{{signal}} trend, {{count}} samples in the last hour',
            { signal, count: numericSeries.length },
          )}
          className="inline-block"
        >
          <Sparkline data={numericSeries} color={color} width={width} height={height} />
        </span>
      )}
      {historyState.status === 'stale' && (
        <Caption role="status" className="text-amber-300">
          {t('telemetry.sparkline.retained', 'Trend may be out of date')}
        </Caption>
      )}
    </span>
  );
}
