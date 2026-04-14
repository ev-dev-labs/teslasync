import { type ReactNode, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MetricCard } from '@/components/data-display/MetricCard';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FadeIn } from '@/components/motion/FadeIn';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  chartGrid,
  axisTick,
  chartMargin,
  CHART_COLORS,
} from '@/components/charts';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SafetySnapshot {
  id: number;
  vehicle_id: number;
  automatic_emergency_braking_off: boolean;
  automatic_blind_spot_camera: boolean;
  blind_spot_collision_warning: boolean;
  emergency_lane_departure_avoidance: boolean;
  forward_collision_warning: string;
  lane_departure_avoidance: string;
  speed_limit_warning: string;
  cruise_follow_distance: string;
  pin_to_drive_enabled: boolean;
  created_at: string;
}

interface Vehicle {
  id: number;
  vin: string;
  display_name: string;
}

interface FeatureCardDef {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  valueText: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** AEB uses inverted logic: `off = false` means the feature IS enabled. */
function isAebEnabled(off: boolean): boolean {
  return !off;
}

function boolFeatures(snap: SafetySnapshot): boolean[] {
  return [
    isAebEnabled(snap.automatic_emergency_braking_off),
    snap.automatic_blind_spot_camera,
    snap.blind_spot_collision_warning,
    snap.emergency_lane_departure_avoidance,
    snap.pin_to_drive_enabled,
    snap.forward_collision_warning !== 'Off',
    snap.lane_departure_avoidance !== 'Off',
    snap.speed_limit_warning !== 'Off',
  ];
}

function enabledCount(snap: SafetySnapshot): number {
  return boolFeatures(snap).filter(Boolean).length;
}

const TOTAL_FEATURES = 9;

function scoreColor(pct: number): string {
  if (pct >= 80) return '#10b981';
  if (pct >= 50) return '#f59e0b';
  return '#ef4444';
}

/* ------------------------------------------------------------------ */
/*  SafetyCard                                                         */
/* ------------------------------------------------------------------ */

function SafetyCard({
  label,
  description,
  enabled,
  valueText,
}: {
  label: string;
  description: string;
  enabled: boolean;
  valueText: string;
}) {
  return (
    <GlassPanel className="p-4 space-y-2" hover glow={enabled ? 'green' : 'none'}>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'rounded-lg p-2',
            enabled ? 'bg-neon-green/10' : 'bg-white/5',
          )}
        >
          <span
            className={cn(
              'block h-5 w-5 rounded-md',
              enabled ? 'bg-neon-green/40' : 'bg-white/10',
            )}
          />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-[var(--text-primary)] block truncate">
            {label}
          </span>
          <span className="text-[10px] text-[var(--text-muted)] block">
            {description}
          </span>
        </div>
        <span
          className={cn(
            'h-2 w-2 rounded-full shrink-0',
            enabled ? 'bg-neon-green' : 'bg-white/20',
          )}
        />
      </div>
      <span
        className={cn(
          'text-sm font-semibold block',
          enabled ? 'text-neon-green' : 'text-[var(--text-muted)]',
        )}
      >
        {valueText}
      </span>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Chart data helpers                                                 */
/* ------------------------------------------------------------------ */

interface ChartPoint {
  time: string;
  aeb: number;
  bscw: number;
  elda: number;
}

function toChartData(history: SafetySnapshot[]): ChartPoint[] {
  return [...history]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((s) => ({
      time: formatDateTime(s.created_at),
      aeb: isAebEnabled(s.automatic_emergency_braking_off) ? 1 : 0,
      bscw: s.blind_spot_collision_warning ? 1 : 0,
      elda: s.emergency_lane_departure_avoidance ? 1 : 0,
    }));
}

/* ------------------------------------------------------------------ */
/*  Feature card definitions                                           */
/* ------------------------------------------------------------------ */

function buildFeatureCards(
  snap: SafetySnapshot,
  t: (key: string) => string,
): FeatureCardDef[] {
  const aebOn = isAebEnabled(snap.automatic_emergency_braking_off);
  const fcwOn = snap.forward_collision_warning !== 'Off';
  const ldaOn = snap.lane_departure_avoidance !== 'Off';
  const slwOn = snap.speed_limit_warning !== 'Off';

  return [
    {
      key: 'aeb',
      label: t('Auto Emergency Braking'),
      description: t('Automatic collision mitigation'),
      enabled: aebOn,
      valueText: aebOn ? t('Enabled') : t('Disabled'),
    },
    {
      key: 'bsc',
      label: t('Blind Spot Camera'),
      description: t('Camera view when signaling'),
      enabled: snap.automatic_blind_spot_camera,
      valueText: snap.automatic_blind_spot_camera ? t('Enabled') : t('Disabled'),
    },
    {
      key: 'fcw',
      label: t('Forward Collision Warning'),
      description: t('Warns of potential frontal collisions'),
      enabled: fcwOn,
      valueText: snap.forward_collision_warning,
    },
    {
      key: 'lda',
      label: t('Lane Departure Avoidance'),
      description: t('Prevents unintentional lane changes'),
      enabled: ldaOn,
      valueText: snap.lane_departure_avoidance,
    },
    {
      key: 'cfd',
      label: t('Cruise Follow Distance'),
      description: t('Adaptive cruise headway setting'),
      enabled: Number(snap.cruise_follow_distance) > 0,
      valueText: snap.cruise_follow_distance,
    },
    {
      key: 'slw',
      label: t('Speed Limit Warning'),
      description: t('Alerts when exceeding speed limit'),
      enabled: slwOn,
      valueText: snap.speed_limit_warning,
    },
    {
      key: 'ptd',
      label: t('Pin to Drive'),
      description: t('Requires PIN before driving'),
      enabled: snap.pin_to_drive_enabled,
      valueText: snap.pin_to_drive_enabled ? t('Enabled') : t('Disabled'),
    },
    {
      key: 'bscw',
      label: t('Blind Spot Collision Warning'),
      description: t('Alerts for blind-spot hazards'),
      enabled: snap.blind_spot_collision_warning,
      valueText: snap.blind_spot_collision_warning ? t('Enabled') : t('Disabled'),
    },
    {
      key: 'elda',
      label: t('Emergency Lane Departure Avoidance'),
      description: t('Steers back on unintentional departure'),
      enabled: snap.emergency_lane_departure_avoidance,
      valueText: snap.emergency_lane_departure_avoidance ? t('Enabled') : t('Disabled'),
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Table columns                                                      */
/* ------------------------------------------------------------------ */

function buildHistoryColumns(t: (k: string) => string): Column<SafetySnapshot>[] {
  const boolCell = (val: boolean): ReactNode => (
    <Badge variant={val ? 'success' : 'danger'} size="sm">
      {val ? 'On' : 'Off'}
    </Badge>
  );

  return [
    {
      key: 'time',
      header: t('Time'),
      sortable: true,
      render: (row) => (
        <span className="text-[var(--text-muted)] whitespace-nowrap text-xs">
          {formatDateTime(row.created_at)}
        </span>
      ),
    },
    {
      key: 'aeb',
      header: t('AEB'),
      render: (row) => boolCell(isAebEnabled(row.automatic_emergency_braking_off)),
    },
    {
      key: 'bsc',
      header: t('BSC'),
      render: (row) => boolCell(row.automatic_blind_spot_camera),
    },
    {
      key: 'bscw',
      header: t('BSCW'),
      render: (row) => boolCell(row.blind_spot_collision_warning),
    },
    {
      key: 'fcw',
      header: t('FCW'),
      render: (row) => (
        <span className="text-xs text-[var(--text-secondary)]">
          {row.forward_collision_warning}
        </span>
      ),
    },
    {
      key: 'lda',
      header: t('LDA'),
      render: (row) => (
        <span className="text-xs text-[var(--text-secondary)]">
          {row.lane_departure_avoidance}
        </span>
      ),
    },
    {
      key: 'elda',
      header: t('ELDA'),
      render: (row) => boolCell(row.emergency_lane_departure_avoidance),
    },
    {
      key: 'slw',
      header: t('SLW'),
      render: (row) => (
        <span className="text-xs text-[var(--text-secondary)]">
          {row.speed_limit_warning}
        </span>
      ),
    },
    {
      key: 'pin',
      header: t('PIN'),
      render: (row) => boolCell(row.pin_to_drive_enabled),
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Loading skeleton                                                   */
/* ------------------------------------------------------------------ */

function SafetyPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={80} />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 9 }).map((_, i) => (
          <Skeleton key={i} height={96} />
        ))}
      </div>
      <Skeleton height={300} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page component                                                */
/* ------------------------------------------------------------------ */

export default function SafetySettingsPage() {
  const { t } = useTranslation();
  usePageTitle(t('Safety Settings'));

  /* --- vehicle selector --- */
  const { data: vehicles } = useQuery<Vehicle[]>({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
    staleTime: 30_000,
  });
  const [vehicleId, setVehicleId] = useState<string>('');
  const activeId = vehicleId || String(vehicles?.[0]?.id ?? '');

  /* --- safety data --- */
  const {
    data: latest,
    isLoading: latestLoading,
    error: latestError,
  } = useQuery<SafetySnapshot>({
    queryKey: ['safety-latest', activeId],
    queryFn: () => request<SafetySnapshot>(`/safety/latest?vehicle_id=${activeId}`),
    enabled: activeId !== '',
    staleTime: 15_000,
  });

  const {
    data: history,
    isLoading: historyLoading,
  } = useQuery<SafetySnapshot[]>({
    queryKey: ['safety-history', activeId],
    queryFn: () => request<SafetySnapshot[]>(`/safety?vehicle_id=${activeId}&limit=100`),
    enabled: activeId !== '',
    staleTime: 30_000,
  });

  /* --- derived data --- */
  const isLoading = latestLoading || historyLoading;

  const enabled = useMemo(() => (latest ? enabledCount(latest) : 0), [latest]);
  const disabled = TOTAL_FEATURES - enabled;
  const scorePct = useMemo(
    () => (latest ? (enabled / TOTAL_FEATURES) * 100 : 0),
    [latest, enabled],
  );

  const featureCards = useMemo(
    () => (latest ? buildFeatureCards(latest, t) : []),
    [latest, t],
  );

  const chartData = useMemo(
    () => (history ? toChartData(history) : []),
    [history],
  );

  const historyColumns = useMemo(() => buildHistoryColumns(t), [t]);

  const sortedHistory = useMemo(
    () =>
      history
        ? [...history].sort(
            (a, b) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          )
        : [],
    [history],
  );

  /* --- render --- */
  return (
    <PageContainer
      title={t('Safety Settings')}
      subtitle={t('ADAS features, safety score, and driving stats')}
      loading={false}
      error={latestError as Error | null}
      actions={
        vehicles && vehicles.length > 1 ? (
          <Select
            options={vehicles.map((v) => ({
              value: String(v.id),
              label: v.display_name || v.vin,
            }))}
            value={activeId}
            onChange={(e) => setVehicleId(e.target.value)}
          />
        ) : undefined
      }
    >
      {/* Loading skeleton */}
      {isLoading && <SafetyPageSkeleton />}

      {/* Empty state */}
      {!isLoading && !latest && (
        <EmptyState message={t('No safety data available for this vehicle.')} />
      )}

      {/* Content */}
      {!isLoading && latest && (
        <div className="space-y-6">
          {/* ---- Safety Score Gauge + Stat Cards ---- */}
          <FadeIn>
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
              {/* RadialGauge */}
              <GlassPanel className="p-6 flex flex-col items-center justify-center lg:col-span-1">
                <RadialGauge
                  value={enabled}
                  max={TOTAL_FEATURES}
                  label={t('Safety Score')}
                  unit={`${fmtInt(scorePct)}%`}
                  color={scoreColor(scorePct)}
                  size={140}
                />
                <Badge
                  variant={scorePct >= 80 ? 'success' : scorePct >= 50 ? 'warning' : 'danger'}
                  className="mt-3"
                >
                  {enabled}/{TOTAL_FEATURES} {t('enabled')}
                </Badge>
              </GlassPanel>

              {/* Stat MetricCards */}
              <div className="lg:col-span-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                  label={t('Safety Score')}
                  value={`${fmtInt(scorePct)}%`}
                  color={scorePct >= 80 ? 'green' : scorePct >= 50 ? 'amber' : 'red'}
                />
                <MetricCard
                  label={t('Total Features')}
                  value={TOTAL_FEATURES}
                  color="cyan"
                />
                <MetricCard
                  label={t('Enabled')}
                  value={enabled}
                  color="green"
                />
                <MetricCard
                  label={t('Disabled')}
                  value={disabled}
                  color={disabled > 0 ? 'red' : 'green'}
                />
              </div>
            </div>
          </FadeIn>

          {/* ---- Safety Feature Cards (3-col grid) ---- */}
          <FadeIn delay={0.1}>
            <GlassPanel className="p-5">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
                {t('ADAS Features')}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {featureCards.map((card) => (
                  <SafetyCard
                    key={card.key}
                    label={card.label}
                    description={card.description}
                    enabled={card.enabled}
                    valueText={card.valueText}
                  />
                ))}
              </div>
            </GlassPanel>
          </FadeIn>

          {/* ---- Safety States Chart ---- */}
          {chartData.length > 1 && (
            <FadeIn delay={0.2}>
              <GlassPanel className="p-5">
                <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
                  {t('Safety States Over Time')}
                </h2>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData} margin={chartMargin}>
                    {chartGrid}
                    <XAxis
                      dataKey="time"
                      tick={axisTick}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={axisTick}
                      domain={[0, 1]}
                      ticks={[0, 1]}
                      tickFormatter={(v: number) => (v === 1 ? t('On') : t('Off'))}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Line
                      type="stepAfter"
                      dataKey="aeb"
                      name={t('AEB')}
                      stroke={CHART_COLORS[0]}
                      dot={false}
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                    <Line
                      type="stepAfter"
                      dataKey="bscw"
                      name={t('BSCW')}
                      stroke={CHART_COLORS[1]}
                      dot={false}
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                    <Line
                      type="stepAfter"
                      dataKey="elda"
                      name={t('ELDA')}
                      stroke={CHART_COLORS[2]}
                      dot={false}
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </GlassPanel>
            </FadeIn>
          )}

          {/* ---- History DataTable ---- */}
          <FadeIn delay={0.3}>
            <GlassPanel className="p-5">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
                {t('Safety Settings History')}
              </h2>
              {sortedHistory.length === 0 ? (
                <EmptyState message={t('No history records found.')} />
              ) : (
                <DataTable<SafetySnapshot>
                  columns={historyColumns}
                  data={sortedHistory}
                  keyExtractor={(row) => row.id}
                  compact
                  pagination
                />
              )}
            </GlassPanel>
          </FadeIn>
        </div>
      )}
    </PageContainer>
  );
}
