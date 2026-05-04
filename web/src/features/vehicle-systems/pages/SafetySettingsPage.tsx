import { type ReactNode, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { UserCheck, Armchair, Lock, Navigation, Cpu, AlertCircle } from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MetricCard } from '@/components/data-display/MetricCard';
import { TimeStamp } from '@/components/data-display';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { AlertBanner } from '@/components/feedback/AlertBanner';
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
  AREA_DEFAULTS,
} from '@/components/charts';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSecurityLatest } from '@/api/hooks/useVehicles';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { getErrorMessage } from '@/lib/errorMessage';
import { request } from '@/api/client';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SafetySnapshot {
  id?: number;
  vehicle_id?: number;
  automatic_emergency_braking_off?: boolean | null;
  automatic_blind_spot_camera?: boolean | null;
  blind_spot_collision_warning?: boolean | null;
  emergency_lane_departure_avoidance?: boolean | null;
  forward_collision_warning?: string | null;
  lane_departure_avoidance?: string | null;
  speed_limit_warning?: string | null;
  cruise_follow_distance?: string | null;
  pin_to_drive_enabled?: boolean | null;
  miles_since_reset?: number | null;
  self_driving_miles_since_reset?: number | null;
  created_at?: string;
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

/** Known enum prefixes from raw Tesla telemetry. Old rows may still have these. */
const ENUM_PREFIXES: Record<string, string> = {
  forward_collision_warning: 'ForwardCollisionSensitivity',
  lane_departure_avoidance: 'LaneAssistLevel',
  speed_limit_warning: 'SpeedAssistLevel',
  cruise_follow_distance: 'FollowDistance',
};

/** Strip Tesla enum prefix from a raw value, handling both old (raw) and new (clean) data. */
function cleanEnum(value: string, field: keyof typeof ENUM_PREFIXES): string {
  const prefix = ENUM_PREFIXES[field];
  if (prefix && value.startsWith(prefix)) {
    const stripped = value.slice(prefix.length);
    // SpeedAssistLevelNone → "Off" (special case)
    if (field === 'speed_limit_warning' && stripped === 'None') return 'Off';
    return stripped || value;
  }
  return value;
}

function boolFeatures(snap: SafetySnapshot): boolean[] {
  return [
    isAebEnabled(snap.automatic_emergency_braking_off ?? false),
    snap.automatic_blind_spot_camera ?? false,
    snap.blind_spot_collision_warning ?? false,
    snap.emergency_lane_departure_avoidance ?? false,
    snap.pin_to_drive_enabled ?? false,
    cleanEnum(snap.forward_collision_warning ?? 'Off', 'forward_collision_warning') !== 'Off',
    cleanEnum(snap.lane_departure_avoidance ?? 'Off', 'lane_departure_avoidance') !== 'Off',
    cleanEnum(snap.speed_limit_warning ?? 'Off', 'speed_limit_warning') !== 'Off',
    Number(cleanEnum(snap.cruise_follow_distance ?? '0', 'cruise_follow_distance')) > 0,
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
/*  SignalCard                                                          */
/* ------------------------------------------------------------------ */

function SignalCard({
  icon,
  value,
  label,
  positive,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  positive?: boolean | null;
}) {
  const color =
    positive === true
      ? 'text-green-400'
      : positive === false
        ? 'text-red-400'
        : 'text-[var(--text-secondary)]';
  return (
    <GlassPanel className="p-4 flex flex-col items-center gap-2 text-center">
      <span className={color}>{icon}</span>
      <span className={cn('text-sm font-bold', color)}>{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </span>
    </GlassPanel>
  );
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
            enabled ? 'bg-neon-green/10' : 'bg-[var(--surface-2)]',
          )}
        >
          <span
            className={cn(
              'block h-5 w-5 rounded-md',
              enabled ? 'bg-neon-green/40' : 'bg-[var(--surface-2)]',
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
            enabled ? 'bg-neon-green' : 'bg-[var(--surface-2)]',
          )}
        />
      </div>
      <span
        className={cn(
          'text-sm font-semibold block',
          enabled ? 'text-emerald-300' : 'text-[var(--text-muted)]',
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
    .sort((a, b) => new Date(a.created_at ?? '').getTime() - new Date(b.created_at ?? '').getTime())
    .map((s) => ({
      time: formatDateTime(s.created_at),
      aeb: isAebEnabled(s.automatic_emergency_braking_off ?? false) ? 1 : 0,
      bscw: (s.blind_spot_collision_warning ?? false) ? 1 : 0,
      elda: (s.emergency_lane_departure_avoidance ?? false) ? 1 : 0,
    }));
}

/* ------------------------------------------------------------------ */
/*  Feature card definitions                                           */
/* ------------------------------------------------------------------ */

function buildFeatureCards(
  snap: SafetySnapshot,
  t: (key: string) => string,
): FeatureCardDef[] {
  const aebOn = isAebEnabled(snap.automatic_emergency_braking_off ?? false);
  const fcwVal = cleanEnum(snap.forward_collision_warning ?? 'Off', 'forward_collision_warning');
  const ldaVal = cleanEnum(snap.lane_departure_avoidance ?? 'Off', 'lane_departure_avoidance');
  const slwVal = cleanEnum(snap.speed_limit_warning ?? 'Off', 'speed_limit_warning');
  const cfdVal = cleanEnum(snap.cruise_follow_distance ?? '0', 'cruise_follow_distance');
  const fcwOn = fcwVal !== 'Off';
  const ldaOn = ldaVal !== 'Off';
  const slwOn = slwVal !== 'Off';

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
      enabled: snap.automatic_blind_spot_camera ?? false,
      valueText: (snap.automatic_blind_spot_camera ?? false) ? t('Enabled') : t('Disabled'),
    },
    {
      key: 'fcw',
      label: t('Forward Collision Warning'),
      description: t('Warns of potential frontal collisions'),
      enabled: fcwOn,
      valueText: fcwVal,
    },
    {
      key: 'lda',
      label: t('Lane Departure Avoidance'),
      description: t('Prevents unintentional lane changes'),
      enabled: ldaOn,
      valueText: ldaVal,
    },
    {
      key: 'cfd',
      label: t('Cruise Follow Distance'),
      description: t('Adaptive cruise headway setting'),
      enabled: Number(cfdVal) > 0,
      valueText: cfdVal || '—',
    },
    {
      key: 'slw',
      label: t('Speed Limit Warning'),
      description: t('Alerts when exceeding speed limit'),
      enabled: slwOn,
      valueText: slwVal,
    },
    {
      key: 'ptd',
      label: t('Pin to Drive'),
      description: t('Requires PIN before driving'),
      enabled: snap.pin_to_drive_enabled ?? false,
      valueText: (snap.pin_to_drive_enabled ?? false) ? t('Enabled') : t('Disabled'),
    },
    {
      key: 'bscw',
      label: t('Blind Spot Collision Warning'),
      description: t('Alerts for blind-spot hazards'),
      enabled: snap.blind_spot_collision_warning ?? false,
      valueText: (snap.blind_spot_collision_warning ?? false) ? t('Enabled') : t('Disabled'),
    },
    {
      key: 'elda',
      label: t('Emergency Lane Departure Avoidance'),
      description: t('Steers back on unintentional departure'),
      enabled: snap.emergency_lane_departure_avoidance ?? false,
      valueText: (snap.emergency_lane_departure_avoidance ?? false) ? t('Enabled') : t('Disabled'),
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
        <TimeStamp value={row.created_at} className="text-[var(--text-muted)] whitespace-nowrap text-xs" />
      ),
    },
    {
      key: 'aeb',
      header: t('AEB'),
      render: (row) => boolCell(isAebEnabled(row.automatic_emergency_braking_off ?? false)),
    },
    {
      key: 'bsc',
      header: t('BSC'),
      render: (row) => boolCell(row.automatic_blind_spot_camera ?? false),
    },
    {
      key: 'bscw',
      header: t('BSCW'),
      render: (row) => boolCell(row.blind_spot_collision_warning ?? false),
    },
    {
      key: 'fcw',
      header: t('FCW'),
      render: (row) => (
        <span className="text-xs text-[var(--text-secondary)]">
          {cleanEnum(row.forward_collision_warning ?? '—', 'forward_collision_warning')}
        </span>
      ),
    },
    {
      key: 'lda',
      header: t('LDA'),
      render: (row) => (
        <span className="text-xs text-[var(--text-secondary)]">
          {cleanEnum(row.lane_departure_avoidance ?? '—', 'lane_departure_avoidance')}
        </span>
      ),
    },
    {
      key: 'elda',
      header: t('ELDA'),
      render: (row) => boolCell(row.emergency_lane_departure_avoidance ?? false),
    },
    {
      key: 'cfd',
      header: t('CFD'),
      render: (row) => (
        <span className="text-xs text-[var(--text-secondary)]">
          {cleanEnum(row.cruise_follow_distance ?? '—', 'cruise_follow_distance')}
        </span>
      ),
    },
    {
      key: 'slw',
      header: t('SLW'),
      render: (row) => (
        <span className="text-xs text-[var(--text-secondary)]">
          {cleanEnum(row.speed_limit_warning ?? '—', 'speed_limit_warning')}
        </span>
      ),
    },
    {
      key: 'pin',
      header: t('PIN'),
      render: (row) => boolCell(row.pin_to_drive_enabled ?? false),
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
  const { data: vehicles, error: vehiclesError } = useQuery<Vehicle[]>({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
    staleTime: 30_000,
  });
  const [vehicleId, setVehicleId] = useState<string>('');
  const activeId = vehicleId || String(vehicles?.[0]?.id ?? '');

  /* --- security data (live safety signals) --- */
  const { data: securityData } = useSecurityLatest(
    Number(activeId) || 0,
    15_000,
  );

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
    error: historyError,
  } = useQuery<SafetySnapshot[]>({
    queryKey: ['safety-history', activeId],
    queryFn: () => request<SafetySnapshot[]>(`/safety?vehicle_id=${activeId}&limit=100`),
    enabled: activeId !== '',
    staleTime: 30_000,
  });

  /* --- derived data --- */
  const anyError = [vehiclesError, latestError, historyError].find(Boolean);
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
              new Date(b.created_at ?? '').getTime() - new Date(a.created_at ?? '').getTime(),
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
      {/* Error banner */}
      {anyError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      )}

      {/* Loading skeleton */}
      {isLoading && <SafetyPageSkeleton />}

      {/* Empty state */}
      {!isLoading && !latest && (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('No safety data available for this vehicle.')} />
      )}

      {/* Content */}
      {!isLoading && latest && (
        <div className="space-y-6">
          {/* ---- Safety Score Gauge + Stat Cards ---- */}
          <FadeIn>
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-stretch">
              {/* RadialGauge */}
              <GlassPanel className="p-6 flex flex-col items-center justify-center lg:col-span-1">
                <RadialGauge
                  value={enabled}
                  max={TOTAL_FEATURES}
                  label={t('Safety Score')}
                  unit={`${fmtInt(scorePct)}%`}
                  color={scoreColor(scorePct)}
                  size={120}
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

          {/* ---- Live Safety Signals ---- */}
          <FadeIn delay={0.05}>
            <GlassPanel className="p-5">
              <p className="mb-4 text-sm font-semibold text-[var(--text-primary)]">
                {t('safety.liveSignals', 'Live Safety Signals')}
              </p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <SignalCard
                  icon={<UserCheck className="h-6 w-6" />}
                  value={
                    securityData?.driver_seat_belt == null
                      ? '—'
                      : securityData.driver_seat_belt
                        ? t('safety.buckled', 'Buckled')
                        : t('safety.unbuckled', 'Unbuckled')
                  }
                  label={t('safety.driverBelt', 'Driver Belt')}
                  positive={securityData?.driver_seat_belt ?? null}
                />
                <SignalCard
                  icon={<UserCheck className="h-6 w-6" />}
                  value={
                    securityData?.passenger_seat_belt == null
                      ? '—'
                      : securityData.passenger_seat_belt
                        ? t('safety.buckled', 'Buckled')
                        : t('safety.unbuckled', 'Unbuckled')
                  }
                  label={t('safety.passengerBelt', 'Passenger Belt')}
                  positive={securityData?.passenger_seat_belt ?? null}
                />
                <SignalCard
                  icon={<Armchair className="h-6 w-6" />}
                  value={
                    securityData?.driver_seat_occupied == null
                      ? '—'
                      : securityData.driver_seat_occupied
                        ? t('safety.occupied', 'Occupied')
                        : t('safety.empty', 'Empty')
                  }
                  label={t('safety.driverSeat', 'Driver Seat')}
                  positive={securityData?.driver_seat_occupied ?? null}
                />
                <SignalCard
                  icon={<Lock className="h-6 w-6" />}
                  value={
                    securityData?.locked == null
                      ? '—'
                      : securityData.locked
                        ? t('safety.locked', 'Locked')
                        : t('safety.unlocked', 'Unlocked')
                  }
                  label={t('safety.vehicleLock', 'Vehicle Lock')}
                  positive={securityData?.locked ?? null}
                />
              </div>
            </GlassPanel>
          </FadeIn>

          {/* ---- Driving Statistics ---- */}
          <FadeIn delay={0.1}>
            <GlassPanel className="p-5">
              <p className="mb-4 text-sm font-semibold text-[var(--text-primary)]">
                {t('safety.drivingStats', 'Driving Statistics')}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <MetricCard
                  icon={<Navigation className="h-5 w-5" />}
                  label={t('safety.milesSinceReset', 'Miles Since Reset')}
                  value={
                    latest.miles_since_reset != null
                      ? fmtNumber(latest.miles_since_reset)
                      : '—'
                  }
                  subtitle={t('safety.miles', 'miles')}
                />
                <MetricCard
                  icon={<Cpu className="h-5 w-5" />}
                  label={t('safety.selfDrivingMiles', 'Self-Driving Miles')}
                  value={
                    latest.self_driving_miles_since_reset != null
                      ? fmtNumber(latest.self_driving_miles_since_reset)
                      : '—'
                  }
                  subtitle={t('safety.milesAutopilot', 'miles (autopilot)')}
                />
              </div>
            </GlassPanel>
          </FadeIn>

          {/* ---- Safety Feature Cards (3-col grid) ---- */}
          <FadeIn delay={0.15}>
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
          <FadeIn delay={0.2}>
            <GlassPanel className="p-5">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
                {t('Safety States Over Time')}
              </h2>
              {chartData.length > 0 ? (
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
                      {...AREA_DEFAULTS}
                      type="stepAfter"
                      dataKey="aeb"
                      name={t('AEB')}
                      stroke={CHART_COLORS[0]}
                      isAnimationActive={false}
                    />
                    <Line
                      {...AREA_DEFAULTS}
                      type="stepAfter"
                      dataKey="bscw"
                      name={t('BSCW')}
                      stroke={CHART_COLORS[1]}
                      isAnimationActive={false}
                    />
                    <Line
                      {...AREA_DEFAULTS}
                      type="stepAfter"
                      dataKey="elda"
                      name={t('ELDA')}
                      stroke={CHART_COLORS[2]}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('No safety state history to chart yet.')} />
              )}
            </GlassPanel>
          </FadeIn>

          {/* ---- History DataTable ---- */}
          <FadeIn delay={0.3}>
            <GlassPanel className="p-5">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
                {t('Safety Settings History')}
              </h2>
              {sortedHistory.length === 0 ? (
                <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('No history records found.')} />
              ) : (
                <DataTable<SafetySnapshot>
                  tableId="vehicle-systems:safety-history"
                  columns={historyColumns}
                  data={sortedHistory}
                  keyExtractor={(row) => row.id ?? 0}
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
