import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useStateSummary, useTimeline } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

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
function StackedBar({ segments }: { segments: StateSegment[] }) {
  return (
    <div className="flex h-5 w-full rounded-full overflow-hidden">
      {segments.map((seg) => (
        <div
          key={seg.state}
          className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-normal"
          style={{ width: `${seg.pct}%`, backgroundColor: stateColor(seg.state) }}
          title={`${seg.state}: ${fmtNumber(seg.pct, 1)}%`}
        />
      ))}
    </div>
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
  const totalMin = transitions.reduce((sum, tr) => sum + (tr.durationMin ?? 0), 0);
  if (totalMin === 0) return null;

  return (
    <div className="space-y-1.5">
      <span className="text-2xs uppercase tracking-wider text-[var(--text-muted)]">
        {t('widget.stateTimeline.timeline', '24h Timeline')}
      </span>
      <div className="flex h-4 w-full rounded overflow-hidden">
        {transitions.map((tr, i) => {
          const pct = ((tr.durationMin ?? 0) / totalMin) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={`${tr.state}-${i}`}
              className="h-full transition-all duration-normal"
              style={{ width: `${pct}%`, backgroundColor: stateColor(tr.state ?? '') }}
              title={`${tr.state}: ${fmtNumber(tr.durationMin ?? 0, 0)} min`}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ── State list row ─────────────────────────────────────────────── */
function StateRow({
  seg,
  t,
}: {
  seg: StateSegment;
  t: (k: string, d: string) => string;
}) {
  return (
    <div className="flex items-center justify-between min-h-[44px]">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: stateColor(seg.state) }}
        />
        <span className="text-xs text-[var(--text-primary)] capitalize truncate">
          {t(`widget.stateTimeline.state.${seg.state}`, seg.state)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--text-secondary)]">{fmtDuration(seg.totalMin, t)}</span>
        <Badge variant="neutral" className="text-2xs tabular-nums">
          {fmtNumber(seg.pct, 1)}%
        </Badge>
      </div>
    </div>
  );
}

/* ── Main widget ────────────────────────────────────────────────── */
export default function StateTimelineWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : '';

  const summary = useStateSummary(idStr);
  const timeline = useTimeline(idStr);

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

  const hasData = segments.length > 0;

  /* Freshness: merge from both queries */
  const updatedAt = Math.max(summary.dataUpdatedAt ?? 0, timeline.dataUpdatedAt ?? 0);
  const isFetching = summary.isFetching || timeline.isFetching;
  const isStale = summary.isStale || timeline.isStale;
  const isError = summary.isError || timeline.isError;
  const isLoading = summary.isLoading || timeline.isLoading;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.stateTimeline.title', 'State Timeline')}
      icon={isCompact ? undefined : <Clock className="h-3.5 w-3.5 text-cyan-400" />}
      loading={isLoading}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => {
        summary.refetch();
        timeline.refetch();
      }}
    >
      {hasData ? (
        <div className="flex flex-col gap-3 h-full">
          {/* Stacked bar (always shown) */}
          <StackedBar segments={segments} />

          {isCompact ? (
            /* Compact: legend dots + % */
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {segments.slice(0, 5).map((seg) => (
                <div key={seg.state} className="flex items-center gap-1 min-h-[44px]">
                  <span
                    className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: stateColor(seg.state) }}
                  />
                  <span className="text-2xs text-[var(--text-secondary)] capitalize truncate">
                    {t(`widget.stateTimeline.state.${seg.state}`, seg.state)}
                  </span>
                  <span className="text-2xs text-[var(--text-muted)] tabular-nums">
                    {fmtInt(seg.pct)}%
                  </span>
                </div>
              ))}
            </div>
          ) : (
            /* Standard + Wide: state list */
            <div className="flex flex-col gap-1 overflow-y-auto">
              {segments.map((seg) => (
                <StateRow key={seg.state} seg={seg} t={t} />
              ))}
            </div>
          )}

          {/* Wide: 24h timeline stripe */}
          {isWide && transitions.length > 0 && (
            <TimelineStripe transitions={transitions} t={t} />
          )}
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Clock className="h-5 w-5" />}
          message={t('widget.stateTimeline.noData', 'No state data available')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
