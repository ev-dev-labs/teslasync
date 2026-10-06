import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { Caption } from '@/components/ui';
import { TimeStamp } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { combineDataStates } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useStateSummary, useTimeline } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';

import { WidgetShell } from './WidgetShell';
import { WidgetStatusGrid } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { StateComposition } from '../components/continuation-dashboard-1/StateComposition';

/* ── State colors ───────────────────────────────────────────────── */
const STATE_COLORS: Record<string, string> = {
  driving: '#22d3ee',   // cyan-400
  charging: '#22c55e',  // green-500
  asleep: '#a855f7',    // purple-500
  idle: '#f59e0b',      // amber-500
  offline: '#ef4444',   // red-500
};

export function stateColor(state: string | null | undefined): string {
  // Null-safe: an absent/empty state falls through to the neutral grey rather
  // than throwing on `undefined.toLowerCase()` at a mis-mapped call site.
  return STATE_COLORS[(state ?? '').toLowerCase()] ?? '#6b7280';
}

/* ── Duration formatter ─────────────────────────────────────────── */
export function fmtDuration(totalMin: number, t: (k: string, d: string) => string): string {
  // Round to whole minutes *before* splitting into hours + minutes so a value
  // like 59.6 rolls over to "1h 0m" instead of the buggy "60m" (and 119.6 →
  // "2h 0m" rather than "1h 60m") that per-part rounding produced. Non-finite
  // or negative inputs coalesce to zero.
  const safe = Number.isFinite(totalMin) && totalMin > 0 ? Math.round(totalMin) : 0;
  const hrs = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hrs === 0) return `${mins}${t('widget.stateTimeline.min', 'm')}`;
  return `${hrs}${t('widget.stateTimeline.hr', 'h')} ${mins}${t('widget.stateTimeline.min', 'm')}`;
}

/* ── Stacked bar data builder ───────────────────────────────────── */
export interface StateSegment {
  state: string;
  pct: number;
  totalMin: number;
  count: number;
}

export function buildSegments(
  data:
    | Array<{ state?: string | null; totalMin?: number | null; count?: number | null }>
    | null
    | undefined,
): StateSegment[] {
  const items = data ?? [];
  const totalMin = items.reduce((sum, d) => sum + (d.totalMin ?? 0), 0);
  // Guard an empty payload *and* nonsensical non-positive totals so we never
  // divide by zero (or a negative) when computing per-state percentages.
  if (totalMin <= 0) return [];
  return items.map((d) => ({
    state: d.state ?? '—',
    pct: ((d.totalMin ?? 0) / totalMin) * 100,
    totalMin: d.totalMin ?? 0,
    count: d.count ?? 0,
  }));
}

/* ── Compact stacked bar (pure CSS) ─────────────────────────────── */
function StackedBar({ segments, t, compact }: { segments: StateSegment[]; t: (k: string, d: string) => string; compact: boolean }) {
  const { fmtNumber } = useNumberFormatting();
  const summary = segments.map(seg => `${t(`widget.stateTimeline.state.${seg.state}`, seg.state)}: ${fmtDuration(seg.totalMin, t)}, ${fmtNumber(seg.pct)}%`).join('; ');

  // Compact widgets retain their five-cell status grid; the rail's mandatory
  // complete legend would duplicate it and change that caller-owned limit.
  if (compact) {
    return (
      <div role="img" aria-label={summary} className="flex h-5 w-full rounded-full overflow-hidden forced-colors:outline forced-colors:outline-1 forced-colors:outline-[CanvasText]">
        {segments.map((seg, index) => (
          <div
            key={`${seg.state}-${index}`}
            aria-hidden="true"
            className="h-full first:rounded-s-full last:rounded-e-full motion-reduce:transition-none forced-colors:outline forced-colors:outline-1 forced-colors:outline-[CanvasText]"
            style={{ width: `${seg.pct}%`, backgroundColor: stateColor(seg.state) }}
            title={`${seg.state}: ${fmtNumber(seg.pct)}%`}
          />
        ))}
      </div>
    );
  }
  return (
    <StateComposition
      summary={summary}
      segments={segments.map((seg, index) => ({
        id: `summary-${index}`,
        label: t(`widget.stateTimeline.state.${seg.state}`, seg.state),
        widthPercent: seg.pct,
        color: stateColor(seg.state),
        detail: <><span>{fmtDuration(seg.totalMin, t)}</span> · <span>{fmtNumber(seg.pct)}%</span></>,
      }))}
    />
  );
}

/* ── Timeline stripe (24h state transitions) ────────────────────── */
function TimelineStripe({
  transitions,
  t,
}: {
  transitions: Array<{ state: string; startDate: string; durationMin: number }>;
  t: (k: string, d: string) => string;
}) {
  const { fmtNumber } = useNumberFormatting();
  const totalMin = transitions.reduce((sum, tr) => sum + (tr.durationMin ?? 0), 0);
  if (totalMin === 0) return null;

  return (
    <div className="space-y-1.5">
      <Caption>
        {t('widget.stateTimeline.timeline', '24h timeline')}
      </Caption>
      <StateComposition
        summary={transitions.map(tr => `${t(`widget.stateTimeline.state.${tr.state}`, tr.state)}: ${fmtNumber(tr.durationMin ?? 0)} ${t('widget.driveTelemetry.min', 'min')}`).join('; ')}
        segments={transitions.map((tr, index) => {
          const pct = ((tr.durationMin ?? 0) / totalMin) * 100;
          return {
            id: `transition-${index}`,
            label: t(`widget.stateTimeline.state.${tr.state}`, tr.state),
            widthPercent: pct,
            color: stateColor(tr.state),
            hideFromTrack: pct < 0.5,
            detail: <><TimeStamp value={tr.startDate || null} /> · {fmtNumber(tr.durationMin ?? 0)} {t('widget.driveTelemetry.min', 'min')}</>,
          };
        })}
      />
    </div>
  );
}

/* ── Main widget ────────────────────────────────────────────────── */
export default function StateTimelineWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = Number.isSafeInteger(id) && Number(id) > 0 ? String(id) : '';

  const summary = useStateSummary(idStr);
  const timeline = useTimeline(idStr);
  const summaryState = useDataState(summary, { provenance: 'historical' });
  const timelineState = useDataState(timeline, { provenance: 'historical' });

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const segments = useMemo(
    () => buildSegments(summary.data ?? []),
    [summary.data],
  );

  const transitions = useMemo(
    () => (timeline.data ?? []).map((tr) => ({
      state: tr.state ?? '',
      startDate: tr.startDate ?? '',
      durationMin: tr.durationMin ?? 0,
    })),
    [timeline.data],
  );

  const hasData = segments.length > 0 || (isWide && transitions.length > 0);
  const retained = summaryState.hasData || timelineState.hasData;
  const refresh = () => {
    void summary.refetch();
    void timeline.refetch();
  };
  const state = isWide ? {
    ...combineDataStates([summaryState, timelineState]),
    hasData: retained,
    data: retained ? { summary: summary.data, timeline: timeline.data } : undefined,
    retry: refresh,
  } : summaryState;

  /* Freshness: merge from both queries */
  const updatedAt = state.updatedAt ?? 0;
  const isFetching = summary.isFetching || timeline.isFetching;
  const isStale = summary.isStale || timeline.isStale;
  const isError = summary.isError || timeline.isError;
  const isLoading = summary.isLoading && summary.data === undefined;

  return (
    <WidgetShell
      dataState={state.hasData || isLoading || state.fatalError ? state : undefined}
      title={t('widget.stateTimeline.title', 'State timeline')}
      icon={isCompact ? undefined : <Clock className="h-3.5 w-3.5 text-cyan-400" />}
      loading={isLoading}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={refresh}
    >
      {hasData || (isWide && (summaryState.fatalError || timelineState.fatalError || timeline.isLoading)) ? (
        <div className="flex flex-col gap-3 h-full">
          {summaryState.fatalError ? (
            <QueryError error={summaryState.fatalError} onRetry={() => { void summary.refetch(); }} />
          ) : segments.length === 0 ? (
            <EmptyState
              message={t('widget.stateTimeline.noData', 'No state data available')}
              className="py-2"
              action={idStr ? { label: t('common.refresh', 'Refresh'), onClick: () => { void summary.refetch(); } } : undefined}
              actionTo={!idStr ? { label: t('nav.vehicles', 'Fleet'), to: '/vehicles' } : undefined}
            />
          ) : (
            <>
              <StackedBar segments={segments} t={t} compact={isCompact} />
              {isCompact ? (
                <WidgetStatusGrid
                  compact
                  cells={segments.slice(0, 5).map((seg) => ({
                    id: seg.state,
                    label: t(`widget.stateTimeline.state.${seg.state}`, seg.state),
                    status: 'inactive',
                    statusLabel: `${fmtNumber(seg.pct)}%`,
                    icon: <span className="mt-1.5 block size-2 shrink-0 rounded-full" style={{ backgroundColor: stateColor(seg.state) }} />,
                  }))}
                />
              ) : null}
            </>
          )}

          {/* Wide: 24h timeline stripe */}
          {isWide && (
            <div className="min-w-0">
              {timelineState.fatalError ? (
                <QueryError error={timelineState.fatalError} onRetry={() => { void timeline.refetch(); }} />
              ) : timeline.isLoading && timeline.data === undefined ? (
                <Skeleton className="h-8 rounded" />
              ) : transitions.length > 0 ? (
                <TimelineStripe transitions={transitions} t={t} />
              ) : (
                <EmptyState
                  message={t('widget.stateTimeline.noData', 'No state data available')}
                  className="py-2"
                  action={idStr ? { label: t('common.refresh', 'Refresh'), onClick: () => { void timeline.refetch(); } } : undefined}
                  actionTo={!idStr ? { label: t('nav.vehicles', 'Fleet'), to: '/vehicles' } : undefined}
                />
              )}
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          icon={<Clock className="h-5 w-5" />}
          message={t('widget.stateTimeline.noData', 'No state data available')}
          className="py-4"
          action={idStr ? { label: t('common.refresh', 'Refresh'), onClick: refresh } : undefined}
          actionTo={!idStr ? { label: t('nav.vehicles', 'Fleet'), to: '/vehicles' } : undefined}
        />
      )}
    </WidgetShell>
  );
}
