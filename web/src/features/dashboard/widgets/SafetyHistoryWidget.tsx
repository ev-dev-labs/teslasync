import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertOctagon, ShieldAlert, AlertTriangle, CarFront, Navigation } from 'lucide-react';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useSafetyHistory } from '@/api/hooks/useVehicleSystems';
import { useVehicles } from '@/api/hooks/useVehicles';
import { fmtInt } from '@/lib/numberFormat';
import { cleanSafetyEnum, isSafetyEnumActive } from '@/lib/safetyEnum';
import { WidgetShell } from './WidgetShell';
import { WidgetEventFeed } from './shared';
import type { EventFeedItem } from './shared';
import type { WidgetProps } from './types';

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
 *  highest-severity-first: AEB → FCW → lane departure → blind spot → emergency
 *  lane departure → generic state update. Pure and i18n-free. */
export function classifySnapshot(snap: Record<string, unknown>): SafetyClassification {
  if (snap.automatic_emergency_braking_off === true) {
    return { type: 'aeb', icon: <AlertOctagon className="h-3.5 w-3.5" />, color: '#ef4444', severity: 'critical' };
  }
  if (isSafetyEnumActive(snap.forward_collision_warning, 'forward_collision_warning')) {
    return { type: 'fcw', icon: <ShieldAlert className="h-3.5 w-3.5" />, color: '#f59e0b', severity: 'warning' };
  }
  if (isSafetyEnumActive(snap.lane_departure_avoidance, 'lane_departure_avoidance')) {
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
      return t('widget.safety.aeb', 'AEB Activation');
    case 'fcw':
      return `${t('widget.safety.fcw', 'FCW')}: ${cleanSafetyEnum(snap.forward_collision_warning, 'forward_collision_warning')}`;
    case 'lane':
      return `${t('widget.safety.lane', 'Lane Departure')}: ${cleanSafetyEnum(snap.lane_departure_avoidance, 'lane_departure_avoidance')}`;
    case 'bsw':
      return t('widget.safety.bsw', 'Blind Spot Warning');
    case 'elda':
      return t('widget.safety.elda', 'Emergency Lane Departure Avoidance');
    default:
      return t('widget.safety.general', 'Safety State Update');
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
      return t('widget.safety.laneShort', 'Lane Departure');
    case 'bsw':
      return t('widget.safety.bswShort', 'Blind Spot');
    case 'elda':
      return t('widget.safety.eldaShort', 'Emergency Lane');
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
    parts.push(`${t('widget.safety.speedLimit', 'Speed Limit')}: ${cleanSafetyEnum(snap.speed_limit_warning, 'speed_limit_warning')}`);
  }
  if (snap.cruise_follow_distance != null) {
    parts.push(`${t('widget.safety.follow', 'Follow')}: ${cleanSafetyEnum(snap.cruise_follow_distance, 'cruise_follow_distance')}`);
  }
  if (snap.pin_to_drive_enabled === true) {
    parts.push(t('widget.safety.pinToDrive', 'PIN to Drive'));
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
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 min-h-[44px]">
        <AlertOctagon className="h-4 w-4 flex-shrink-0 text-red-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-[var(--text-primary)] truncate">
            {totalEvents > 0
              ? `${fmtInt(totalEvents)} ${t('widget.safetyEvents', 'events')} (30d)`
              : t('widget.noSafetyEvents', 'No safety events')}
          </p>
          {totalEvents > 0 && (
            <p className="text-xs text-[var(--text-secondary)] truncate">
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
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vidStr = vid != null ? String(vid) : undefined;

  const {
    data: history,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useSafetyHistory(vidStr ?? '');

  const isCompact = size.cols <= 1;
  const list = useMemo(() => history ?? [], [history]);

  const feedItems = useMemo<EventFeedItem[]>(
    () =>
      list.map((snap, i) => {
        const rec = snap as unknown as Record<string, unknown>;
        const event = classifySnapshot(rec);
        return {
          // Stable index-derived key when the row has no id — never
          // Math.random(), which would remount every row on each refetch.
          id: snap.id ?? `safety-${i}`,
          icon: event.icon,
          title: safetyEventTitle(event.type, rec, t),
          subtitle: buildSubtitle(rec, t),
          timestamp: snap.created_at ?? new Date(0).toISOString(),
          color: event.color,
          severity: event.severity,
        };
      }),
    [list, t],
  );

  // Stats: 30-day total, most common type, trend
  const stats = useMemo(() => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const sixtyDaysAgo = now - 60 * 24 * 60 * 60 * 1000;

    const recent = list.filter(
      (s) => new Date(s.created_at ?? '').getTime() >= thirtyDaysAgo,
    );
    const prior = list.filter((s) => {
      const ts = new Date(s.created_at ?? '').getTime();
      return ts >= sixtyDaysAgo && ts < thirtyDaysAgo;
    });

    const typeCounts: Record<string, number> = {};
    for (const snap of recent) {
      const ev = classifySnapshot(snap as unknown as Record<string, unknown>);
      typeCounts[ev.type] = (typeCounts[ev.type] ?? 0) + 1;
    }

    const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    const mostCommonType = sorted[0]?.[0] as SafetyEventType | undefined;

    const recentCount = recent.length;
    const priorCount = prior.length;
    let trend = '—';
    if (priorCount > 0 && recentCount > priorCount) trend = '↑';
    else if (priorCount > 0 && recentCount < priorCount) trend = '↓';
    else if (priorCount > 0 && recentCount === priorCount) trend = '→';

    return {
      totalEvents: recentCount,
      mostCommon: mostCommonType ? safetyTypeLabel(mostCommonType, t) : '—',
      trend,
    };
  }, [list, t]);

  return (
    <WidgetShell
      title={t('widget.safetyHistory', 'Safety History')}
      icon={<AlertOctagon className="h-3.5 w-3.5 text-red-400" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {isCompact ? (
        list.length > 0 ? (
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
          {/* Stat cards row */}
          <div className="grid grid-cols-1 @xs:grid-cols-3 gap-2 flex-shrink-0">
            <StatCard
              label={t('widget.safetyTotal', 'Events (30d)')}
              value={fmtInt(stats.totalEvents)}
            />
            <StatCard
              label={t('widget.safetyMostCommon', 'Most Common')}
              value={stats.mostCommon}
            />
            <StatCard
              label={t('widget.safetyTrend', 'Trend')}
              value={stats.trend}
              sublabel={
                stats.trend === '↑'
                  ? t('widget.trendUp', 'Increasing')
                  : stats.trend === '↓'
                    ? t('widget.trendDown', 'Decreasing')
                    : t('widget.trendFlat', 'Stable')
              }
            />
          </div>

          {/* Event feed */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <WidgetEventFeed
              items={feedItems}
              maxItems={10}
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
