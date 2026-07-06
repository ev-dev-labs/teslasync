import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  UserCheck,
  Armchair,
  Lock,
  Navigation,
  Cpu,
  ShieldCheck,
  ShieldAlert,
  Car,
  RefreshCw,
} from 'lucide-react';
import { PageContainer } from '@/components/layout';
import {
  GlassPanel,
  Badge,
  Button,
  DataTable,
  PanelTitle,
  Caption,
  Label,
  Text,
  type Column,
} from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard, TimeStamp, DataFreshnessAuto } from '@/components/data-display';
import {
  RadialGauge,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ChartTooltip,
  chartGrid,
  axisTick,
  chartMargin,
  CHART_COLORS,
  AREA_DEFAULTS,
} from '@/components/charts';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useSafety, useSafetyHistory } from '@/api/hooks/useVehicleSystems';
import { useSecurityLatest } from '@/api/hooks/useVehicles';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import {
  cleanSafetyEnum,
  isSafetyEnumActive,
  type SafetyEnumField,
} from '@/lib/safetyEnum';
import type { SafetySnapshot } from '@/types/vehicle-systems';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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
export function isAebEnabled(off: boolean): boolean {
  return !off;
}

/** Wrapper kept so existing call sites read naturally. */
function cleanEnum(value: unknown, field: SafetyEnumField): string {
  return cleanSafetyEnum(value, field);
}

export function boolFeatures(snap: SafetySnapshot): boolean[] {
  return [
    isAebEnabled(snap.automatic_emergency_braking_off ?? false),
    snap.automatic_blind_spot_camera ?? false,
    snap.blind_spot_collision_warning ?? false,
    snap.emergency_lane_departure_avoidance ?? false,
    snap.pin_to_drive_enabled ?? false,
    isSafetyEnumActive(snap.forward_collision_warning, 'forward_collision_warning'),
    isSafetyEnumActive(snap.lane_departure_avoidance, 'lane_departure_avoidance'),
    isSafetyEnumActive(snap.speed_limit_warning, 'speed_limit_warning'),
    isSafetyEnumActive(snap.cruise_follow_distance, 'cruise_follow_distance'),
  ];
}

export function enabledCount(snap: SafetySnapshot): number {
  return boolFeatures(snap).filter(Boolean).length;
}

export const TOTAL_FEATURES = 9;

/** Semantic gauge color — kept as a computed value so it can drive the
 *  RadialGauge `color` prop directly (dynamic, not a static var style). */
export function scoreColor(pct: number): string {
  if (pct >= 80) return '#10b981';
  if (pct >= 50) return '#f59e0b';
  return '#ef4444';
}

/** Score → Badge variant. */
export function scoreBadgeVariant(pct: number): 'success' | 'warning' | 'danger' {
  if (pct >= 80) return 'success';
  if (pct >= 50) return 'warning';
  return 'danger';
}

/* ------------------------------------------------------------------ */
/*  SignalCard — a single live security/occupant signal tile          */
/* ------------------------------------------------------------------ */

function SignalCard({
  icon,
  value,
  label,
  positive,
}: {
  icon: ReactNode;
  value: string;
  label: string;
  positive?: boolean | null;
}) {
  // Toned 300-level accents for body text (never neon). Status is also
  // conveyed by the value text itself, so meaning is not color-dependent.
  const color =
    positive === true
      ? 'text-emerald-300'
      : positive === false
        ? 'text-rose-300'
        : 'text-[var(--text-secondary)]';
  return (
    <GlassPanel className="flex flex-col items-center gap-2 p-4 text-center">
      <span className={color} aria-hidden="true">
        {icon}
      </span>
      <Text as="span" size="sm" weight="bold" className={cn('block', color)}>
        {value}
      </Text>
      <Label className="block">{label}</Label>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  SafetyCard — a single ADAS feature tile                           */
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
    <GlassPanel className="space-y-2 p-4" hover glow={enabled ? 'green' : 'none'}>
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
            aria-hidden="true"
          />
        </div>
        <div className="min-w-0 flex-1">
          <Text as="span" size="sm" weight="medium" color="primary" className="block truncate">
            {label}
          </Text>
          <Caption className="block">{description}</Caption>
        </div>
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            enabled ? 'bg-neon-green' : 'bg-[var(--surface-2)]',
          )}
          aria-hidden="true"
        />
      </div>
      <Text
        as="span"
        size="sm"
        weight="semibold"
        className={cn('block', enabled ? 'text-emerald-300' : 'text-[var(--text-muted)]')}
      >
        {valueText}
      </Text>
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

export function toChartData(history: SafetySnapshot[]): ChartPoint[] {
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

export function buildFeatureCards(
  snap: SafetySnapshot,
  t: (key: string) => string,
): FeatureCardDef[] {
  const aebOn = isAebEnabled(snap.automatic_emergency_braking_off ?? false);
  const fcwVal = cleanEnum(snap.forward_collision_warning, 'forward_collision_warning');
  const ldaVal = cleanEnum(snap.lane_departure_avoidance, 'lane_departure_avoidance');
  const slwVal = cleanEnum(snap.speed_limit_warning, 'speed_limit_warning');
  const cfdVal = cleanEnum(snap.cruise_follow_distance, 'cruise_follow_distance');
  const fcwOn = isSafetyEnumActive(snap.forward_collision_warning, 'forward_collision_warning');
  const ldaOn = isSafetyEnumActive(snap.lane_departure_avoidance, 'lane_departure_avoidance');
  const slwOn = isSafetyEnumActive(snap.speed_limit_warning, 'speed_limit_warning');

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
      enabled: isSafetyEnumActive(snap.cruise_follow_distance, 'cruise_follow_distance'),
      valueText: cfdVal,
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
      {val ? t('On') : t('Off')}
    </Badge>
  );

  const enumCell = (value: unknown, field: SafetyEnumField): ReactNode => (
    <Text as="span" variant="bodySm">
      {cleanEnum(value, field)}
    </Text>
  );

  return [
    {
      key: 'time',
      header: t('Time'),
      sortable: true,
      render: (row) => (
        <TimeStamp value={row.created_at} className={cn(typography.role.caption, 'whitespace-nowrap')} />
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
      render: (row) => enumCell(row.forward_collision_warning, 'forward_collision_warning'),
    },
    {
      key: 'lda',
      header: t('LDA'),
      render: (row) => enumCell(row.lane_departure_avoidance, 'lane_departure_avoidance'),
    },
    {
      key: 'elda',
      header: t('ELDA'),
      render: (row) => boolCell(row.emergency_lane_departure_avoidance ?? false),
    },
    {
      key: 'cfd',
      header: t('CFD'),
      render: (row) => enumCell(row.cruise_follow_distance, 'cruise_follow_distance'),
    },
    {
      key: 'slw',
      header: t('SLW'),
      render: (row) => enumCell(row.speed_limit_warning, 'speed_limit_warning'),
    },
    {
      key: 'pin',
      header: t('PIN'),
      render: (row) => boolCell(row.pin_to_drive_enabled ?? false),
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  KPI skeleton tile                                                  */
/* ------------------------------------------------------------------ */

function KpiSkeleton() {
  return <Skeleton height={84} />;
}

/* ------------------------------------------------------------------ */
/*  Main page component                                                */
/* ------------------------------------------------------------------ */

export default function SafetySettingsPage() {
  const { t } = useTranslation();
  usePageTitle(t('Safety Settings'));
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;

  /* --- vehicle selector (global) --- */
  const { vehicleId: selectedId } = useSelectedVehicle();
  const activeId = selectedId != null ? String(selectedId) : '';
  const noVehicle = activeId === '';

  /* --- data hooks (TanStack Query, snake_case params, no /api/v1 prefix) --- */
  const latestQuery = useSafety(activeId);
  const historyQuery = useSafetyHistory(activeId);
  const securityQuery = useSecurityLatest(Number(activeId) || 0, 15_000);

  const latest = latestQuery.data ?? null;
  const history = historyQuery.data ?? [];
  const securityData = securityQuery.data ?? null;

  /* --- derived data (null-safe) --- */
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

  const chartData = useMemo(() => toChartData(history), [history]);

  const historyColumns = useMemo(() => buildHistoryColumns(t), [t]);

  const sortedHistory = useMemo(
    () =>
      [...history].sort(
        (a, b) =>
          new Date(b.created_at ?? '').getTime() - new Date(a.created_at ?? '').getTime(),
      ),
    [history],
  );

  const selectVehicleMsg = t('safety.selectVehicle', 'Select a vehicle to view its safety settings.');

  const refreshAll = () => {
    latestQuery.refetch();
    historyQuery.refetch();
    securityQuery.refetch();
  };

  const actions = (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <VehicleSelect />
      <DataFreshnessAuto query={latestQuery} />
      <Button
        variant="ghost"
        onClick={refreshAll}
        aria-label={t('common.refresh', 'Refresh')}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  /* --- render --- */
  return (
    <PageContainer
      title={t('Safety Settings')}
      subtitle={t('safety.subtitle', 'ADAS features, safety score, and driving stats')}
      actions={actions}
    >
      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section
          aria-label={t('safety.kpis', 'Safety summary')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          {noVehicle ? (
            <div className="col-span-full">
              <GlassPanel className="p-4 sm:p-5">
                <EmptyState icon={<Car className="h-8 w-8" aria-hidden="true" />} message={selectVehicleMsg} />
              </GlassPanel>
            </div>
          ) : latestQuery.isLoading && !latest ? (
            Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)
          ) : latestQuery.isError ? (
            <div className="col-span-full">
              <GlassPanel className="p-4 sm:p-5">
                <QueryError error={latestQuery.error} onRetry={latestQuery.refetch} />
              </GlassPanel>
            </div>
          ) : !latest ? (
            <div className="col-span-full">
              <GlassPanel className="p-4 sm:p-5">
                <EmptyState
                  icon={<ShieldAlert className="h-8 w-8" aria-hidden="true" />}
                  message={t('safety.noData', 'No safety data available for this vehicle.')}
                />
              </GlassPanel>
            </div>
          ) : (
            <>
              <MetricCard
                label={t('Safety Score')}
                value={`${fmtInt(scorePct)}%`}
                icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
                color={scorePct >= 80 ? 'green' : scorePct >= 50 ? 'amber' : 'red'}
              />
              <MetricCard label={t('Total Features')} value={TOTAL_FEATURES} color="cyan" />
              <MetricCard label={t('Enabled')} value={enabled} color="green" />
              <MetricCard
                label={t('Disabled')}
                value={disabled}
                color={disabled > 0 ? 'red' : 'green'}
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Hero bento: safety score gauge + live signals */}
      <FadeIn delay={0.05}>
        <section
          aria-label={t('safety.overview', 'Safety overview')}
          className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-3"
        >
          {/* Safety score gauge */}
          <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-3">{t('safety.scoreTitle', 'Safety Score')}</PanelTitle>
            {noVehicle ? (
              <EmptyState icon={<Car className="h-8 w-8" aria-hidden="true" />} message={selectVehicleMsg} />
            ) : latestQuery.isLoading && !latest ? (
              <Skeleton height={220} />
            ) : latestQuery.isError ? (
              <QueryError error={latestQuery.error} onRetry={latestQuery.refetch} />
            ) : !latest ? (
              <EmptyState
                icon={<ShieldAlert className="h-8 w-8" aria-hidden="true" />}
                message={t('safety.noData', 'No safety data available for this vehicle.')}
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-4">
                <RadialGauge
                  value={enabled}
                  max={TOTAL_FEATURES}
                  label={t('Safety Score')}
                  unit={`${fmtInt(scorePct)}%`}
                  color={scoreColor(scorePct)}
                  size={140}
                />
                <Badge variant={scoreBadgeVariant(scorePct)}>
                  {enabled}/{TOTAL_FEATURES} {t('enabled')}
                </Badge>
              </div>
            )}
          </GlassPanel>

          {/* Live safety signals */}
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3">{t('safety.liveSignals', 'Live Safety Signals')}</PanelTitle>
            {noVehicle ? (
              <EmptyState icon={<Car className="h-8 w-8" aria-hidden="true" />} message={selectVehicleMsg} />
            ) : securityQuery.isLoading && !securityData ? (
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} height={112} />
                ))}
              </div>
            ) : securityQuery.isError ? (
              <QueryError error={securityQuery.error} onRetry={securityQuery.refetch} />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
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
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Secondary bento: ADAS features (hero span) + driving stats */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('safety.features', 'ADAS features and driving statistics')}
          className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-3"
        >
          {/* ADAS feature grid — spans the wide column */}
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3">{t('ADAS Features')}</PanelTitle>
            {noVehicle ? (
              <EmptyState icon={<Car className="h-8 w-8" aria-hidden="true" />} message={selectVehicleMsg} />
            ) : latestQuery.isLoading && !latest ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} height={96} />
                ))}
              </div>
            ) : latestQuery.isError ? (
              <QueryError error={latestQuery.error} onRetry={latestQuery.refetch} />
            ) : featureCards.length === 0 ? (
              <EmptyState
                icon={<ShieldAlert className="h-8 w-8" aria-hidden="true" />}
                message={t('safety.noFeatures', 'No ADAS feature data available for this vehicle.')}
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
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
            )}
          </GlassPanel>

          {/* Driving statistics */}
          <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-3">{t('safety.drivingStats', 'Driving Statistics')}</PanelTitle>
            {noVehicle ? (
              <EmptyState icon={<Car className="h-8 w-8" aria-hidden="true" />} message={selectVehicleMsg} />
            ) : latestQuery.isLoading && !latest ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} height={84} />
                ))}
              </div>
            ) : latestQuery.isError ? (
              <QueryError error={latestQuery.error} onRetry={latestQuery.refetch} />
            ) : !latest ? (
              <EmptyState
                icon={<ShieldAlert className="h-8 w-8" aria-hidden="true" />}
                message={t('safety.noStats', 'No driving statistics available for this vehicle.')}
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <MetricCard
                  icon={<Navigation className="h-5 w-5" aria-hidden="true" />}
                  label={t('safety.distanceSinceReset', 'Distance Since Reset')}
                  value={
                    latest.miles_since_reset != null
                      ? fmtNumber(convertDistanceFromSI(latest.miles_since_reset, distanceUnit))
                      : '—'
                  }
                  subtitle={distanceUnit}
                />
                <MetricCard
                  icon={<Cpu className="h-5 w-5" aria-hidden="true" />}
                  label={t('safety.selfDrivingDistance', 'Self-Driving Distance')}
                  value={
                    latest.self_driving_miles_since_reset != null
                      ? fmtNumber(
                          convertDistanceFromSI(latest.self_driving_miles_since_reset, distanceUnit),
                        )
                      : '—'
                  }
                  subtitle={t('safety.distanceAutopilot', '{{unit}} (autopilot)', { unit: distanceUnit })}
                />
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 4 — Detail band: safety states over time */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3">{t('Safety States Over Time')}</PanelTitle>
          {noVehicle ? (
            <EmptyState icon={<Car className="h-8 w-8" aria-hidden="true" />} message={selectVehicleMsg} />
          ) : historyQuery.isLoading && history.length === 0 ? (
            <Skeleton height={300} />
          ) : historyQuery.isError ? (
            <QueryError error={historyQuery.error} onRetry={historyQuery.refetch} />
          ) : chartData.length === 0 ? (
            <EmptyState
              icon={<ShieldAlert className="h-8 w-8" aria-hidden="true" />}
              message={t('safety.noChart', 'No safety state history to chart yet.')}
            />
          ) : (
            <div
              className="h-64 sm:h-72 xl:h-80"
              role="img"
              aria-label={t('safety.chartAria', 'Safety feature states over time')}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={chartMargin}>
                  {chartGrid}
                  <XAxis dataKey="time" tick={axisTick} interval="preserveStartEnd" />
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
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* 5 — Detail band: full history table */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3">{t('Safety Settings History')}</PanelTitle>
          {noVehicle ? (
            <EmptyState icon={<Car className="h-8 w-8" aria-hidden="true" />} message={selectVehicleMsg} />
          ) : historyQuery.isLoading && history.length === 0 ? (
            <Skeleton height={280} />
          ) : historyQuery.isError ? (
            <QueryError error={historyQuery.error} onRetry={historyQuery.refetch} />
          ) : sortedHistory.length === 0 ? (
            <EmptyState
              icon={<ShieldAlert className="h-8 w-8" aria-hidden="true" />}
              message={t('safety.noHistory', 'No history records found.')}
            />
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
    </PageContainer>
  );
}
