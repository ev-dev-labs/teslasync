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

function stateColor(state: string): string {
  return STATE_COLORS[state.toLowerCase()] ?? '#6b7280';
}

/* ── Duration formatter ─────────────────────────────────────────── */
function fmtDuration(totalMin: number, t: (k: string, d: string) => string): string {
  const hrs = Math.floor(totalMin / 60);
  const mins = Math.round(totalMin % 60);
  if (hrs === 0) return `${mins}${t('widget.stateTimeline.min', 'm')}`;
  return `${hrs}${t('widget.stateTimeline.hr', 'h')} ${mins}${t('widget.stateTimeline.min', 'm')}`;
}

/* ── Stacked bar data builder ───────────────────────────────────── */
interface StateSegment {
  state: string;
  pct: number;
  totalMin: number;
  count: number;
}

function buildSegments(
  data: Array<{ state: string; totalMin: number; count: number }>,
): StateSegment[] {
  const totalMin = data.reduce((sum, d) => sum + (d.totalMin ?? 0), 0);
  if (totalMin === 0) return [];
  return data.map((d) => ({
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
          className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-300"
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
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        {t('widget.stateTimeline.timeline', '24h Timeline')}
      </span>
      <div className="flex h-4 w-full rounded overflow-hidden">
        {transitions.map((tr, i) => {
          const pct = ((tr.durationMin ?? 0) / totalMin) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={`${tr.state}-${i}`}
              className="h-full transition-all duration-300"
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
        <Badge variant="neutral" className="text-[10px] tabular-nums">
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
                  <span className="text-[10px] text-[var(--text-secondary)] capitalize truncate">
                    {t(`widget.stateTimeline.state.${seg.state}`, seg.state)}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] tabular-nums">
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
        <EmptyState
          icon={<Clock className="h-5 w-5" />}
          message={t('widget.stateTimeline.noData', 'No state data available')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
