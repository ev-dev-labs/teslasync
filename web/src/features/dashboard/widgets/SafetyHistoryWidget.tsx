import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertOctagon, ShieldAlert, AlertTriangle, CarFront, Navigation } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { dashboardTokens } from '../lib/dashboardTokens';
import { useSafetyHistory } from '@/api/hooks/useVehicleSystems';
import { useVehicles } from '@/api/hooks/useVehicles';

import { cleanSafetyEnum, isSafetyEnumActive } from '@/lib/safetyEnum';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useRangeState } from '@/hooks/useRangeState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetDetailCard, WidgetStatGrid, type DetailEntry, type StatGridItem } from './shared';

export type Severity = 'info' | 'warning' | 'critical';

/** Stable machine key for the dominant safety event in a snapshot. Drives both
 *  the feed styling and the stats rollup, so it must stay i18n-free. */
export type SafetyEventType = 'aeb' | 'fcw' | 'lane' | 'bsw' | 'elda' | 'general';

/** Minimal translator surface these helpers need — the `(key, defaultValue)`
 *  overload of react-i18next's `t`, narrowed so the pure helpers don't carry
 *  the full `TFunction` generics. */
type Translate = (key: string, fallback: string) => string;

export interface SafetyClassification {
  type: SafetyEventType;
  icon: ReactNode;
  color: string;
  severity: Severity;
}

/** Classify a raw safety snapshot into its dominant event. Precedence is
 *  highest-severity-first: AEB disabled → FCW → lane departure → blind spot → emergency
 *  lane departure → generic state update. Pure and i18n-free. */
export function classifySnapshot(snap: Record<string, unknown>): SafetyClassification {
  if (snap.automatic_emergency_braking_off === true) {
    return { type: 'aeb', icon: <AlertOctagon className="h-3.5 w-3.5" />, color: '#ef4444', severity: 'critical' };
  }
  if (!/unknown$/i.test(cleanSafetyEnum(snap.forward_collision_warning, 'forward_collision_warning')) &&
    isSafetyEnumActive(snap.forward_collision_warning, 'forward_collision_warning')) {
    return { type: 'fcw', icon: <ShieldAlert className="h-3.5 w-3.5" />, color: '#f59e0b', severity: 'warning' };
  }
  if (!/unknown$/i.test(cleanSafetyEnum(snap.lane_departure_avoidance, 'lane_departure_avoidance')) &&
    isSafetyEnumActive(snap.lane_departure_avoidance, 'lane_departure_avoidance')) {
    return { type: 'lane', icon: <Navigation className="h-3.5 w-3.5" />, color: '#3b82f6', severity: 'warning' };
  }
  if (snap.blind_spot_collision_warning === true) {
    return { type: 'bsw', icon: <CarFront className="h-3.5 w-3.5" />, color: '#f59e0b', severity: 'warning' };
  }
  if (snap.emergency_lane_departure_avoidance === true) {
    return { type: 'elda', icon: <AlertTriangle className="h-3.5 w-3.5" />, color: '#ef4444', severity: 'critical' };
  }
  return { type: 'general', icon: <AlertOctagon className="h-3.5 w-3.5" />, color: '#6b7280', severity: 'info' };
}

/** i18n title for a classified event. FCW / lane events append the cleaned enum
 *  detail — funnelled through `cleanSafetyEnum` so a raw
 *  `ForwardCollisionSensitivity…` / `LaneAssistLevel…` string never leaks. */
export function safetyEventTitle(
  type: SafetyEventType,
  snap: Record<string, unknown>,
  t: Translate,
): string {
  switch (type) {
    case 'aeb':
      return t('widget.safety.aebDisabled', 'Automatic emergency braking disabled');
    case 'fcw':
      return `${t('widget.safety.historyFcw', 'FCW')}: ${cleanSafetyEnum(snap.forward_collision_warning, 'forward_collision_warning')}`;
    case 'lane':
      return `${t('widget.safety.lane', 'Lane departure')}: ${cleanSafetyEnum(snap.lane_departure_avoidance, 'lane_departure_avoidance')}`;
    case 'bsw':
      return t('widget.safety.bsw', 'Blind spot warning');
    case 'elda':
      return t('widget.safety.historyElda', 'Emergency lane departure avoidance');
    default:
      return t('widget.safety.general', 'Safety state update');
  }
}

/** Short i18n label for a safety event type — used by the "Most Common" stat
 *  and the compact tile. */
export function safetyTypeLabel(type: SafetyEventType, t: Translate): string {
  switch (type) {
    case 'aeb':
      return t('widget.safety.aebShort', 'AEB');
    case 'fcw':
      return t('widget.safety.fcwShort', 'FCW');
    case 'lane':
      return t('widget.safety.laneShort', 'Lane departure');
    case 'bsw':
      return t('widget.safety.bswShort', 'Blind spot');
    case 'elda':
      return t('widget.safety.eldaShort', 'Emergency lane');
    default:
      return t('widget.safety.generalShort', 'General');
  }
}

/** Build the feed-row subtitle from a snapshot's advisory fields. Enum fields
 *  are funnelled through `cleanSafetyEnum` per the safetyEnum contract, so raw
 *  `SpeedAssistLevel…` / `FollowDistance…` values never reach the UI and a
 *  boolean advisory renders as "On"/"Off" rather than "true"/"false". */
export function buildSubtitle(snap: Record<string, unknown>, t: Translate): string {
  const parts: string[] = [];
  if (snap.speed_limit_warning != null) {
    parts.push(`${t('widget.safety.speedLimit', 'Speed limit')}: ${cleanSafetyEnum(snap.speed_limit_warning, 'speed_limit_warning')}`);
  }
  if (snap.cruise_follow_distance != null) {
    parts.push(`${t('widget.safety.follow', 'Follow')}: ${cleanSafetyEnum(snap.cruise_follow_distance, 'cruise_follow_distance')}`);
  }
  if (snap.pin_to_drive_enabled === true) {
    parts.push(t('widget.safety.pinToDrive', 'PIN to drive'));
  }
  return parts.filter(Boolean).join(' · ') || '—';
}

// ── Compact layout ─────────────────────────────────────────────

function CompactView({
  totalEvents,
  mostCommon,
  trend,
  t,
}: {
  totalEvents: number;
  mostCommon: string;
  trend: string;
  t: (key: string, fallback: string) => string;
}) {
  const { fmtInt } = useNumberFormatting();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 min-h-[44px]">
        <AlertOctagon className="h-4 w-4 flex-shrink-0 text-red-400" />
        <div className="min-w-0 flex-1">
          <p className={dashboardTokens.metricLabel}>
            {totalEvents > 0
              ? `${fmtInt(totalEvents)} ${t('widget.safetyEvents', 'events')} (30d)`
              : t('widget.noSafetyEvents', 'No safety events')}
          </p>
          {totalEvents > 0 && (
            <p className={dashboardTokens.metricLabel}>
              {mostCommon} {trend}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main widget ────────────────────────────────────────────────

export default function SafetyHistoryWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { fmtInt } = useNumberFormatting();
  const { formatDateTime } = useDateFormat();
  const { startInstant, endInstantExclusive } = useRangeState({ defaultPresetId: '30d' });
  const vehicleQuery = useVehicles();
  const { data: vehicles } = vehicleQuery;
  const vehicleState = useDataState(vehicleQuery);
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vidStr = vid != null ? String(vid) : undefined;

  const query = useSafetyHistory(vidStr ?? '');
  const {
    data: history,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;
  const state = useDataState(query, { provenance: 'historical' });
  const displayState = vid === undefined && (vehicleState.fatalError || vehicleQuery.isLoading) ? vehicleState : state;

  const isCompact = size.cols <= 1;
  const list = useMemo(() => history ?? [], [history]);

  const { windowRows, priorRows } = useMemo(() => {
    const startMs = Date.parse(startInstant);
    const endMs = Date.parse(endInstantExclusive);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return { windowRows: [] as typeof list, priorRows: [] as typeof list };
    }
    const durationMs = endMs - startMs;
    const priorStartMs = startMs - durationMs;
    const current: typeof list = [];
    const prior: typeof list = [];
    for (const row of list) {
      const ts = Date.parse(row.created_at ?? '');
      if (!Number.isFinite(ts)) continue;
      if (ts >= startMs && ts < endMs) current.push(row);
      else if (ts >= priorStartMs && ts < startMs) prior.push(row);
    }
    return { windowRows: current, priorRows: prior };
  }, [list, startInstant, endInstantExclusive]);

  const stats = useMemo(() => {
    const typeCounts: Record<string, number> = {};
    for (const snap of windowRows) {
      const ev = classifySnapshot(snap as unknown as Record<string, unknown>);
      typeCounts[ev.type] = (typeCounts[ev.type] ?? 0) + 1;
    }
    const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    const mostCommonType = sorted[0]?.[0] as SafetyEventType | undefined;
    const recentCount = windowRows.length;
    const priorCount = priorRows.length;
    let trend = '—';
    if (priorCount > 0 && recentCount > priorCount) trend = '↑';
    else if (priorCount > 0 && recentCount < priorCount) trend = '↓';
    else if (priorCount > 0 && recentCount === priorCount) trend = '→';

    return {
      totalEvents: recentCount,
      priorCount,
      mostCommon: mostCommonType ? safetyTypeLabel(mostCommonType, t) : '—',
      trend,
    };
  }, [windowRows, priorRows, t]);

  const entries = useMemo<DetailEntry[]>(() => {
    return [...windowRows].sort((a, b) => {
      const ta = Date.parse(a.created_at ?? '');
      const tb = Date.parse(b.created_at ?? '');
      return (Number.isFinite(tb) ? tb : Number.NEGATIVE_INFINITY) -
        (Number.isFinite(ta) ? ta : Number.NEGATIVE_INFINITY);
    }).map((snap, i) => {
      const rec = snap as unknown as Record<string, unknown>;
      const event = classifySnapshot(rec);
      const status = event.severity === 'critical' ? 'error'
        : event.severity === 'warning' ? 'warning' : 'info';
      const timestamp = snap.created_at;
      const dateLabel = timestamp && Number.isFinite(Date.parse(timestamp))
        ? formatDateTime(timestamp)
        : '—';
      return {
        id: snap.id ?? `safety-${i}`,
        label: safetyEventTitle(event.type, rec, t),
        sublabel: `${dateLabel}${buildSubtitle(rec, t) !== '—' ? ` · ${buildSubtitle(rec, t)}` : ''}`,
        value: '',
        status,
      };
    });
  }, [windowRows, formatDateTime, t]);

  const gridStats = useMemo<StatGridItem[]>(() => [
    {
      label: t('widget.safetyTotal', 'Events'),
      value: fmtInt(stats.totalEvents),
      sublabel: stats.totalEvents === 1
        ? t('widget.safety.snapshotSingular', 'snapshot')
        : t('widget.safety.snapshotPlural', 'snapshots'),
    },
    {
      label: t('widget.safetyMostCommon', 'Most common'),
      value: stats.mostCommon,
    },
    {
      label: t('widget.safetyTrend', 'Trend'),
      value: stats.trend === '—' ? null : stats.trend,
      sublabel: stats.trend === '↑' ? t('widget.trendUp', 'Increasing')
        : stats.trend === '↓' ? t('widget.trendDown', 'Decreasing')
          : stats.trend === '→' ? t('widget.trendFlat', 'Stable') : undefined,
    },
  ], [fmtInt, stats, t]);

  return (
    <WidgetShell
      title={t('widget.safetyHistory', 'Safety history')}
      description={t('widget.safety.historyScope', 'Summary of returned safety snapshots, not activation counts')}
      icon={<AlertOctagon className="h-3.5 w-3.5" aria-hidden="true" />}
      loading={isLoading}
      dataState={{ ...displayState, status: displayState.status === 'initial' && !isLoading && !vehicleQuery.isLoading ? 'unavailable' : displayState.status }}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {isCompact ? (
        windowRows.length > 0 ? (
          <CompactView
            totalEvents={stats.totalEvents}
            mostCommon={stats.mostCommon}
            trend={stats.trend}
            t={t}
          />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<AlertOctagon className="h-5 w-5" />}
            message={t('widget.noSafetyEvents', 'No safety events recorded')}
            className="py-4"
          />
        )
      ) : (
        <div className="flex flex-col gap-3 h-full min-h-0">
          <WidgetStatGrid stats={gridStats} cols={3} />
          <div className="flex-1 min-h-0 overflow-y-auto">
            <WidgetDetailCard
              entries={entries.slice(0, 10)}
              compact={false}
              emptyMessage={t('widget.noSafetyEvents', 'No safety events recorded')}
              emptyIcon={<AlertOctagon className="h-5 w-5" />}
            />
          </div>
        </div>
      )}
    </WidgetShell>
  );
}
