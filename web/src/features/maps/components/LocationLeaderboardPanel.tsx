import { useCallback, useMemo, type ReactNode } from 'react';

import { LayoutCard } from '@/components/layout';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ChartTooltip, EmbeddedChart, type ChartDataColumn, chartGrid, axisTickSm,
} from '@/components/charts';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { isFiniteNumber } from '@/lib/numberFormat';

/** A single leaderboard datum — a labelled bar value. */
export interface LeaderboardDatum {
  name: string;
  value?: number | null;
}

export interface LocationLeaderboardPanelProps {
  /** Panel heading, already translated by the caller. */
  title: string;
  /** Optional icon rendered before the title. */
  icon?: ReactNode;
  /** Bar series name surfaced in the tooltip, already translated. */
  seriesLabel: string;
  /** Bar fill colour (dynamic value — chart series colour). */
  color: string;
  /** Ordered rows to plot. Null-safe: undefined is treated as empty. */
  data?: ReadonlyArray<LeaderboardDatum>;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Empty-state message, already translated. */
  emptyMessage: string;
  /**
   * Optional CTA label for the empty state, already translated by the
   * caller (e.g. "Reset date range"). Paired with `onResetFilters` — the
   * button only renders when both are supplied.
   */
  emptyActionLabel?: string;
  /** Clears whatever filter is scoping `data` to empty (e.g. the page's date range). */
  onResetFilters?: () => void;
  /** Accessible description of the chart for screen readers. */
  ariaLabel: string;
}

// Static chart geometry hoisted to module scope: recreating identical object /
// array literals inline every render hands Recharts a fresh prop reference and
// defeats its child memoisation, so keep them stable here.
const BAR_MARGIN = { left: 8, right: 12, top: 4, bottom: 4 } as const;
const BAR_RADIUS: [number, number, number, number] = [0, 4, 4, 0];
const TOOLTIP_CURSOR = { fill: 'var(--surface-2)', opacity: 0.4 } as const;

/**
 * Reusable horizontal-bar leaderboard panel. Shared by the "Top Locations by
 * Visits" and "Top Locations by Time" sections so the chart markup, axis
 * tokens, and self-sufficient loading / error / empty states live in one place
 * (DRY — the two charts differ only in data, colour, and labels).
 */
export function LocationLeaderboardPanel({
  title,
  icon,
  seriesLabel,
  color,
  data,
  loading = false,
  error,
  onRetry,
  emptyMessage,
  emptyActionLabel,
  onResetFilters,
  ariaLabel,
}: LocationLeaderboardPanelProps) {
  const { fmtNumber } = useNumberFormatting();
  const formatValue = useCallback(
    (value: unknown) => isFiniteNumber(value) && value >= 0 ? fmtNumber(value) : '—',
    [fmtNumber],
  );
  // Unknown visits/durations remain gaps, not measured zero. Normalise only
  // this chart copy; the caller's raw values and ordering stay untouched.
  const rows = useMemo<LeaderboardDatum[]>(
    () =>
      (data ?? []).map((d) => ({
        name: d.name ?? '—',
        value: isFiniteNumber(d.value) && d.value >= 0 ? d.value : null,
      })),
    [data],
  );
  // Horizontal bars need vertical room per entry; grow with the row count but
  // keep a sensible floor so a short list still fills the panel.
  const chartHeight = Math.max(240, Math.min(rows.length, 15) * 34);
  const chartRows = useMemo(
    () => rows.map(({ name, value }) => ({ name, value })),
    [rows],
  );

  const dataColumns = useMemo<ChartDataColumn[]>(
    () => [
      { key: 'name', label: title },
      { key: 'value', label: seriesLabel, format: formatValue },
    ],
    [title, seriesLabel, formatValue],
  );

  return (
    <LayoutCard title={title} actions={icon}>
      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : rows.length === 0 ? (
        <EmptyState
          message={emptyMessage}
          action={
            emptyActionLabel && onResetFilters
              ? { label: emptyActionLabel, onClick: onResetFilters }
              : undefined
          }
        />
      ) : (
        // chart-a11y:no-table accessible fallback table provided via EmbeddedChart data/dataColumns
        <EmbeddedChart
          title={title}
          ariaLabel={ariaLabel}
          height={chartHeight}
          fluid={false}
          data={chartRows}
          dataColumns={dataColumns}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={BAR_MARGIN}>
              {chartGrid}
              <XAxis type="number" tick={axisTickSm} allowDecimals={false} tickFormatter={formatValue} />
              <YAxis dataKey="name" type="category" tick={axisTickSm} width={112} />
              <Tooltip content={<ChartTooltip valueFormatter={formatValue} />} cursor={TOOLTIP_CURSOR} filterNull={false} />
              <Bar dataKey="value" name={seriesLabel} fill={color} radius={BAR_RADIUS} />
            </BarChart>
          </ResponsiveContainer>
        </EmbeddedChart>
      )}
    </LayoutCard>
  );
}
