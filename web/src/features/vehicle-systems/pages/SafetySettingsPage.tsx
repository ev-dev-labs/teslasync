import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PrefetchLink } from '@/components/layout';
import { PageLayout, LayoutCard } from '@/components/layout/layout-reference';
import { StatStrip } from '@/components/data-display/stat-reference';
import { SafetyPanelGrid } from '../components/safety-settings-modernization/SafetyPanelGrid';
import { Icons } from '@/lib/icons';
import {
  GlassPanel,
  Badge,
  Button,
  DataTable,
  PanelTitle,
  Caption,
  Label,
  Text,
  Icon,
  type Column,
} from '@/components/ui';

import { MetricCard, TimeStamp, DataFreshnessAuto } from '@/components/data-display';
import {
  LinearGauge,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ChartLegend,
  ChartTooltip,
  chartGrid,
  axisTick,
  chartMargin,
  CHART_COLORS,
  AREA_DEFAULTS,
  EmbeddedChart,
} from '@/components/charts';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useSafety, useSafetyHistory } from '@/api/hooks/useVehicleSystems';
import { useSecurityLatest } from '@/api/hooks/useVehicles';
import { formatDateTime } from '@/lib/dateFormat';

import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import {
  cleanSafetyEnum,
  isSafetyEnumActive,
  type SafetyEnumField,
} from '@/lib/safetyEnum';
import type { SafetySnapshot } from '@/types/vehicle-systems';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface FeatureCardDef {
  key: string;
  label: string;
  description: string;
  enabled: boolean | null;
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

function enumState(value: unknown, field: SafetyEnumField): boolean | null {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return null;
  const cleaned = cleanEnum(value, field).trim().toLowerCase();
  if (['', '—', 'unknown', 'unavailable', 'invalid'].includes(cleaned)) return null;
  return isSafetyEnumActive(value, field);
}

export function boolFeatures(snap: SafetySnapshot): (boolean | null)[] {
  return [
    snap.automatic_emergency_braking_off == null ? null : isAebEnabled(snap.automatic_emergency_braking_off),
    snap.automatic_blind_spot_camera ?? null,
    snap.blind_spot_collision_warning ?? null,
    snap.emergency_lane_departure_avoidance ?? null,
    snap.pin_to_drive_enabled ?? null,
    enumState(snap.forward_collision_warning, 'forward_collision_warning'),
    enumState(snap.lane_departure_avoidance, 'lane_departure_avoidance'),
    enumState(snap.speed_limit_warning, 'speed_limit_warning'),
    enumState(snap.cruise_follow_distance, 'cruise_follow_distance'),
  ];
}

export function enabledCount(snap: SafetySnapshot): number {
  return boolFeatures(snap).filter(Boolean).length;
}

export function summarizeFeatures(snap: SafetySnapshot) {
  const states = boolFeatures(snap);
  const enabled = states.filter(value => value === true).length;
  const disabled = states.filter(value => value === false).length;
  const unknown = states.filter(value => value === null).length;
  return { enabled, disabled, unknown, percent: unknown === 0 ? enabled / TOTAL_FEATURES * 100 : null };
}

export const TOTAL_FEATURES = 9;

/** Semantic gauge color — kept as a computed value so it can drive the
 *  LinearGauge `color` prop directly (dynamic, not a static var style). */
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
  return (
    <GlassPanel className="flex flex-col items-center gap-2 p-4 text-center">
      <span className="text-[var(--text-secondary)]" aria-hidden="true">
        {icon}
      </span>
      <Badge variant={positive === true ? 'success' : positive === false ? 'warning' : 'neutral'}>
        {value}
      </Badge>
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
  enabled: boolean | null;
  valueText: string;
}) {
  return (
    <GlassPanel className="min-w-0 space-y-2 p-4">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'rounded-lg p-2',
            'bg-[var(--surface-2)]',
          )}
        >
          <span
            className={cn(
              'block h-5 w-5 rounded-md',
              'bg-[var(--border-default)]',
            )}
            aria-hidden="true"
          />
        </div>
        <div className="min-w-0 flex-1">
          <Text as="span" size="sm" weight="medium" color="primary" className="block break-words">
            {label}
          </Text>
          <Caption className="block">{description}</Caption>
        </div>
      </div>
      <Badge variant={enabled === true ? 'success' : 'neutral'}>
        {valueText}
      </Badge>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Chart data helpers                                                 */
/* ------------------------------------------------------------------ */

interface ChartPoint {
  time: string;
  aeb: number | null;
  bscw: number | null;
  elda: number | null;
}

export function toChartData(history: SafetySnapshot[]): ChartPoint[] {
  return [...history]
    .sort((a, b) => new Date(a.created_at ?? '').getTime() - new Date(b.created_at ?? '').getTime())
    .map((s) => ({
      time: formatDateTime(s.created_at),
      aeb: s.automatic_emergency_braking_off == null ? null : isAebEnabled(s.automatic_emergency_braking_off) ? 1 : 0,
      bscw: s.blind_spot_collision_warning == null ? null : s.blind_spot_collision_warning ? 1 : 0,
      elda: s.emergency_lane_departure_avoidance == null ? null : s.emergency_lane_departure_avoidance ? 1 : 0,
    }));
}

/* ------------------------------------------------------------------ */
/*  Feature card definitions                                           */
/* ------------------------------------------------------------------ */

export function buildFeatureCards(
  snap: SafetySnapshot,
  t: (key: string, fallback: string) => string,
): FeatureCardDef[] {
  const aebOn = snap.automatic_emergency_braking_off == null ? null : isAebEnabled(snap.automatic_emergency_braking_off);
  const boolText = (value: boolean | null | undefined) => value == null
    ? t('safety.settings.unknown', 'Unknown')
    : value ? t('common.enabled', 'Enabled') : t('common.disabled', 'Disabled');
  const enumText = (value: unknown, field: SafetyEnumField) => {
    if (enumState(value, field) == null) return t('safety.settings.unknown', 'Unknown');
    const cleaned = cleanEnum(value, field);
    if (cleaned === 'On') return t('common.on', 'On');
    if (cleaned === 'Off') return t('common.off', 'Off');
    return cleaned;
  };
  const fcwVal = enumText(snap.forward_collision_warning, 'forward_collision_warning');
  const ldaVal = enumText(snap.lane_departure_avoidance, 'lane_departure_avoidance');
  const slwVal = enumText(snap.speed_limit_warning, 'speed_limit_warning');
  const cfdVal = enumText(snap.cruise_follow_distance, 'cruise_follow_distance');
  const fcwOn = enumState(snap.forward_collision_warning, 'forward_collision_warning');
  const ldaOn = enumState(snap.lane_departure_avoidance, 'lane_departure_avoidance');
  const slwOn = enumState(snap.speed_limit_warning, 'speed_limit_warning');

  return [
    {
      key: 'aeb',
      label: t('safety.aeb', 'Auto emergency braking'),
      description: t('safety.aebDesc', 'Automatic collision mitigation'),
      enabled: aebOn,
      valueText: boolText(aebOn),
    },
    {
      key: 'bsc',
      label: t('safety.blindSpotCamera', 'Blind spot camera'),
      description: t('safety.blindSpotCameraDesc', 'Camera view when signaling'),
      enabled: snap.automatic_blind_spot_camera ?? null,
      valueText: boolText(snap.automatic_blind_spot_camera),
    },
    {
      key: 'fcw',
      label: t('safety.fcw', 'Forward collision warning'),
      description: t('safety.fcwDesc', 'Warns of potential frontal collisions'),
      enabled: fcwOn,
      valueText: fcwVal,
    },
    {
      key: 'lda',
      label: t('safety.lda', 'Lane departure avoidance'),
      description: t('safety.ldaDesc', 'Prevents unintentional lane changes'),
      enabled: ldaOn,
      valueText: ldaVal,
    },
    {
      key: 'cfd',
      label: t('safety.cfd', 'Cruise follow distance'),
      description: t('safety.cfdDesc', 'Adaptive cruise headway setting'),
      enabled: enumState(snap.cruise_follow_distance, 'cruise_follow_distance'),
      valueText: cfdVal,
    },
    {
      key: 'slw',
      label: t('safety.slw', 'Speed limit warning'),
      description: t('safety.slwDesc', 'Alerts when exceeding speed limit'),
      enabled: slwOn,
      valueText: slwVal,
    },
    {
      key: 'ptd',
      label: t('safety.pinToDrive', 'Pin to drive'),
      description: t('safety.pinToDriveDesc', 'Requires PIN before driving'),
      enabled: snap.pin_to_drive_enabled ?? null,
      valueText: boolText(snap.pin_to_drive_enabled),
    },
    {
      key: 'bscw',
      label: t('safety.bscw', 'Blind spot collision warning'),
      description: t('safety.bscwDesc', 'Alerts for blind-spot hazards'),
      enabled: snap.blind_spot_collision_warning ?? null,
      valueText: boolText(snap.blind_spot_collision_warning),
    },
    {
      key: 'elda',
      label: t('safety.elda', 'Emergency lane departure avoidance'),
      description: t('safety.eldaDesc', 'Steers back on unintentional departure'),
      enabled: snap.emergency_lane_departure_avoidance ?? null,
      valueText: boolText(snap.emergency_lane_departure_avoidance),
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Table columns                                                      */
/* ------------------------------------------------------------------ */

function buildHistoryColumns(t: (k: string, fallback: string) => string): Column<SafetySnapshot>[] {
  const boolLabel = (val: boolean | null | undefined) => val == null ? '—' : val ? t('common.on', 'On') : t('common.off', 'Off');
  const boolCell = (val: boolean | null | undefined): ReactNode => (
    <Badge variant={val == null ? 'neutral' : val ? 'success' : 'danger'} size="sm">
      {boolLabel(val)}
    </Badge>
  );

  const enumCell = (value: unknown, field: SafetyEnumField): ReactNode => {
    const cleaned = cleanEnum(value, field);
    return <Text as="span" variant="bodySm">
      {cleaned === 'On' ? t('common.on', 'On') : cleaned === 'Off' ? t('common.off', 'Off') : cleaned}
    </Text>;
  };

  return [
    {
      key: 'time',
      header: t('safety.hdrTime', 'Time'),
      sortable: true,
      render: (row) => (
        <TimeStamp value={row.created_at} className={cn(typography.role.caption, 'whitespace-nowrap')} />
      ),
    },
    {
      key: 'aeb',
      header: t('safety.hdrAeb', 'AEB'),
      filterValue: (row) => row.automatic_emergency_braking_off == null ? null : isAebEnabled(row.automatic_emergency_braking_off),
      filterValueLabel: (_value, row) => boolLabel(row.automatic_emergency_braking_off == null ? null : isAebEnabled(row.automatic_emergency_braking_off)),
      render: (row) => boolCell(row.automatic_emergency_braking_off == null ? null : isAebEnabled(row.automatic_emergency_braking_off)),
    },
    {
      key: 'bsc',
      header: t('safety.hdrBsc', 'BSC'),
      filterValue: (row) => row.automatic_blind_spot_camera ?? null,
      filterValueLabel: (_value, row) => boolLabel(row.automatic_blind_spot_camera),
      render: (row) => boolCell(row.automatic_blind_spot_camera),
    },
    {
      key: 'bscw',
      header: t('safety.hdrBscw', 'BSCW'),
      filterValue: (row) => row.blind_spot_collision_warning ?? null,
      filterValueLabel: (_value, row) => boolLabel(row.blind_spot_collision_warning),
      render: (row) => boolCell(row.blind_spot_collision_warning),
    },
    {
      key: 'fcw',
      header: t('safety.hdrFcw', 'FCW'),
      filterValue: (row) => row.forward_collision_warning ?? null,
      filterValueLabel: (_value, row) => cleanEnum(row.forward_collision_warning, 'forward_collision_warning'),
      render: (row) => enumCell(row.forward_collision_warning, 'forward_collision_warning'),
    },
    {
      key: 'lda',
      header: t('safety.hdrLda', 'LDA'),
      filterValue: (row) => row.lane_departure_avoidance ?? null,
      filterValueLabel: (_value, row) => cleanEnum(row.lane_departure_avoidance, 'lane_departure_avoidance'),
      render: (row) => enumCell(row.lane_departure_avoidance, 'lane_departure_avoidance'),
    },
    {
      key: 'elda',
      header: t('safety.hdrElda', 'ELDA'),
      filterValue: (row) => row.emergency_lane_departure_avoidance ?? null,
      filterValueLabel: (_value, row) => boolLabel(row.emergency_lane_departure_avoidance),
      render: (row) => boolCell(row.emergency_lane_departure_avoidance),
    },
    {
      key: 'cfd',
      header: t('safety.hdrCfd', 'CFD'),
      align: 'right',
      filterValue: (row) => row.cruise_follow_distance ?? null,
      filterValueLabel: (_value, row) => cleanEnum(row.cruise_follow_distance, 'cruise_follow_distance'),
      render: (row) => enumCell(row.cruise_follow_distance, 'cruise_follow_distance'),
    },
    {
      key: 'slw',
      header: t('safety.hdrSlw', 'SLW'),
      filterValue: (row) => row.speed_limit_warning ?? null,
      filterValueLabel: (_value, row) => cleanEnum(row.speed_limit_warning, 'speed_limit_warning'),
      render: (row) => enumCell(row.speed_limit_warning, 'speed_limit_warning'),
    },
    {
      key: 'pin',
      header: t('safety.hdrPin', 'PIN'),
      filterValue: (row) => row.pin_to_drive_enabled ?? null,
      filterValueLabel: (_value, row) => boolLabel(row.pin_to_drive_enabled),
      render: (row) => boolCell(row.pin_to_drive_enabled),
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
  const { fmtInt, precision } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('safety.title', 'Safety settings'));
  const { formatDistance, unitPrefs } = useUnits();

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
  const summary = useMemo(() => latest ? summarizeFeatures(latest) : null, [latest]);
  const enabled = summary?.enabled ?? null;
  const disabled = summary?.disabled ?? null;
  const scorePct = summary?.percent ?? null;

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
  const selectVehicleAction = { label: t('safety.selectVehicleCta', 'Go to vehicles'), to: '/vehicles' };

  const refreshAll = () => {
    latestQuery.refetch();
    historyQuery.refetch();
    securityQuery.refetch();
  };

  const actions = (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <Button
        variant="ghost"
        onClick={refreshAll}
        aria-label={t('common.refresh', 'Refresh')}
        aria-busy={latestQuery.isFetching || historyQuery.isFetching || securityQuery.isFetching}
        className="min-h-11 min-w-11"
      >
        <Icon icon={Icons.refresh} />
      </Button>
    </div>
  );

  /* --- render --- */
  return (
    <PageLayout
      title={t('safety.title', 'Safety settings')}
      subtitle={t('safety.subtitle', 'ADAS features, safety score, and driving stats')}
      metadataActions={<DataFreshnessAuto query={latestQuery} />}
      busy={latestQuery.isFetching || historyQuery.isFetching || securityQuery.isFetching}
      dataSources={[
        { id: 'safety', label: t('safety.adasFeatures', 'ADAS features'), query: latestQuery, enabled: !noVehicle },
        { id: 'security', label: t('safety.liveSignals', 'Live safety signals'), query: securityQuery, enabled: !noVehicle },
        { id: 'history', label: t('safety.historyTitle', 'Safety settings history'), query: historyQuery, enabled: !noVehicle },
      ]}
      secondaryActions={actions}
    >
      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section
          aria-label={t('safety.kpis', 'Safety summary')}
          className="min-w-0"
        >
          {noVehicle ? (
            <div className="col-span-full">
              <GlassPanel className="p-4 sm:p-5">
                <EmptyState
                  icon={<Icon icon={Icons.vehicle} size="xl" />}
                  message={selectVehicleMsg}
                  actionTo={selectVehicleAction}
                />
              </GlassPanel>
            </div>
          ) : latestQuery.isLoading && !latest ? (
            <GlassPanel className="grid grid-cols-1 gap-3 p-4 @sm:grid-cols-2 @4xl:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)}
            </GlassPanel>
          ) : latestQuery.isError && !latest ? (
            <div className="col-span-full">
              <GlassPanel className="p-4 sm:p-5">
                <QueryError error={latestQuery.error} onRetry={latestQuery.refetch} />
              </GlassPanel>
            </div>
          ) : !latest ? (
            <div className="col-span-full">
              <GlassPanel className="p-4 sm:p-5">
                <EmptyState
                  icon={<Icon icon={Icons.securityAlert} size="xl" />}
                  /* no-action: transient — this KPI band fills once useSafety() returns its first payload for the selected vehicle; the header Refresh action (refreshAll) already covers a manual retry. */
                  message={t('safety.noData', 'No safety data available for this vehicle.')}
                />
              </GlassPanel>
            </div>
          ) : (
            <>
              <StatStrip
                id="safety-configuration-summary"
                title={t('safety.kpis', 'Safety summary')}
                retained={latestQuery.isError}
                period={{
                  kind: 'snapshot',
                  label: t('safety.settings.reportedSnapshot', 'Reported configuration snapshot'),
                  observedAt: latest.created_at ?? null,
                  provenance: t('safety.settings.coverageExplanation', 'Enabled feature share is a configuration count, not a driving safety rating or verification that assistance is active.'),
                }}
                metrics={[
                  {
                    metricId: 'percent',
                    occurrenceId: 'enabled-feature-share',
                    label: t('safety.settings.enabledShare', 'Enabled feature share'),
                    description: t('safety.settings.shareDescription', 'Enabled settings divided by nine tracked settings. Unavailable when any setting is unknown.'),
                    rawValue: scorePct,
                    display: { precision: 0 },
                  },
                  { metricId: 'count', occurrenceId: 'total', label: t('safety.totalFeatures', 'Total features'), rawValue: TOTAL_FEATURES },
                  { metricId: 'count', occurrenceId: 'enabled', label: t('common.enabled', 'Enabled'), rawValue: enabled },
                  { metricId: 'count', occurrenceId: 'disabled', label: t('common.disabled', 'Disabled'), rawValue: disabled },
                  { metricId: 'count', occurrenceId: 'unknown', label: t('safety.settings.unknown', 'Unknown'), rawValue: summary?.unknown },
                ]}
                footer={<TimeStamp value={latest.created_at} />}
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Hero bento: safety score gauge + live signals */}
      <FadeIn delay={0.05}>
        <SafetyPanelGrid
          label={t('safety.overview', 'Safety overview')}
          primary={
          <LayoutCard title={t('safety.settings.configurationCoverage', 'Configuration coverage')}>
            <PanelTitle className="mb-3">{t('safety.scoreTitle', 'Safety score')}</PanelTitle>
            <Text variant="bodySm">
              {t('safety.settings.coverageExplanation', 'Enabled feature share is a configuration count, not a driving safety rating or verification that assistance is active.')}
            </Text>
            {noVehicle ? (
              <EmptyState
                icon={<Icon icon={Icons.vehicle} size="xl" />}
                message={selectVehicleMsg}
                actionTo={selectVehicleAction}
              />
            ) : latestQuery.isLoading && !latest ? (
              <Skeleton height={220} />
            ) : latestQuery.isError && !latest ? (
              <QueryError error={latestQuery.error} onRetry={latestQuery.refetch} />
            ) : !latest ? (
              <EmptyState
                icon={<Icon icon={Icons.securityAlert} size="xl" />}
                /* no-action: transient — the gauge renders once the safety payload arrives; recovery is the page header's Refresh action (refreshAll), not a control local to this panel. */
                message={t('safety.noData', 'No safety data available for this vehicle.')}
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-4">
                {scorePct != null && enabled != null ? <LinearGauge
                  value={enabled}
                  max={TOTAL_FEATURES}
                  label={t('safety.settings.enabledShare', 'Enabled feature share')}
                  color={scoreColor(scorePct)}
                  size={140}
                /> : <Text role="status">{t('safety.settings.incomplete', 'Feature share unavailable: some settings are unknown.')}</Text>}
                <Badge variant={scorePct != null ? scoreBadgeVariant(scorePct) : 'neutral'}>
                  {enabled}/{TOTAL_FEATURES} {t('common.enabled', 'Enabled')} · {scorePct != null ? `${fmtInt(scorePct)}%` : '—'}
                </Badge>
                <Caption>
                  {t('safety.settings.unknownCount', '{{count}} unknown settings', { count: summary?.unknown })}
                </Caption>
              </div>
            )}
          </LayoutCard>
          }
          secondary={

          <LayoutCard title={t('safety.liveSignals', 'Live safety signals')}>
            <Text variant="bodySm">
              {t('safety.settings.signalExplanation', 'Last reported security and occupant state; separate from configuration settings. No live verification command is sent.')}
            </Text>
            <DataFreshnessAuto query={securityQuery} />
            <TimeStamp value={securityData?.ts} />
            {noVehicle ? (
              <EmptyState
                icon={<Icon icon={Icons.vehicle} size="xl" />}
                message={selectVehicleMsg}
                actionTo={selectVehicleAction}
              />
            ) : securityQuery.isLoading && !securityData ? (
              <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2 @4xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} height={112} />
                ))}
              </div>
            ) : securityQuery.isError && !securityData ? (
              <QueryError error={securityQuery.error} onRetry={securityQuery.refetch} />
            ) : (
              <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2 @4xl:grid-cols-4">
                <SignalCard
                  icon={<Icon icon={Icons.userCheck} size="xl" />}
                  value={
                    securityData?.driver_seat_belt == null
                      ? '—'
                      : securityData.driver_seat_belt
                        ? t('safety.buckled', 'Buckled')
                        : t('safety.unbuckled', 'Unbuckled')
                  }
                  label={t('safety.driverBelt', 'Driver belt')}
                  positive={securityData?.driver_seat_belt ?? null}
                />
                <SignalCard
                  icon={<Icon icon={Icons.userCheck} size="xl" />}
                  value={
                    securityData?.passenger_seat_belt == null
                      ? '—'
                      : securityData.passenger_seat_belt
                        ? t('safety.buckled', 'Buckled')
                        : t('safety.unbuckled', 'Unbuckled')
                  }
                  label={t('safety.passengerBelt', 'Passenger belt')}
                  positive={securityData?.passenger_seat_belt ?? null}
                />
                <SignalCard
                  icon={<Icon icon={Icons.cabin} size="xl" />}
                  value={
                    securityData?.driver_seat_occupied == null
                      ? '—'
                      : securityData.driver_seat_occupied
                        ? t('safety.occupied', 'Occupied')
                        : t('safety.empty', 'Empty')
                  }
                  label={t('safety.driverSeat', 'Driver seat')}
                  positive={securityData?.driver_seat_occupied ?? null}
                />
                <SignalCard
                  icon={<Icon icon={Icons.locked} size="xl" />}
                  value={
                    securityData?.locked == null
                      ? '—'
                      : securityData.locked
                        ? t('safety.locked', 'Locked')
                        : t('safety.unlocked', 'Unlocked')
                  }
                  label={t('safety.vehicleLock', 'Vehicle lock')}
                  positive={securityData?.locked ?? null}
                />
              </div>
            )}
          </LayoutCard>
          }
        />
      </FadeIn>

      {/* 3 — Secondary bento: ADAS features (hero span) + driving stats */}
      <FadeIn delay={0.1}>
        <SafetyPanelGrid
          label={t('safety.features', 'ADAS features and driving statistics')}
          widePrimary
          primary={
          <LayoutCard title={t('safety.adasFeatures', 'ADAS features')}>
            <Text variant="bodySm">
              {t('safety.settings.readOnly', 'Reported vehicle settings only. This page does not edit or save settings, and configured assistance does not establish current intervention or availability.')}
            </Text>
            {noVehicle ? (
              <EmptyState
                icon={<Icon icon={Icons.vehicle} size="xl" />}
                message={selectVehicleMsg}
                actionTo={selectVehicleAction}
              />
            ) : latestQuery.isLoading && !latest ? (
              <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @4xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} height={96} />
                ))}
              </div>
            ) : latestQuery.isError && !latest ? (
              <QueryError error={latestQuery.error} onRetry={latestQuery.refetch} />
            ) : featureCards.length === 0 ? (
              <EmptyState
                icon={<Icon icon={Icons.securityAlert} size="xl" />}
                /* no-action: transient — this grid populates once buildFeatureCards() has data from the same useSafety() payload as the KPI band above; the header Refresh button already provides manual retry. */
                message={t('safety.noFeatures', 'No ADAS feature data available for this vehicle.')}
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @4xl:grid-cols-3">
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
          </LayoutCard>
          }
          secondary={

          <LayoutCard title={t('safety.drivingStats', 'Driving statistics')}>
            {noVehicle ? (
              <EmptyState
                icon={<Icon icon={Icons.vehicle} size="xl" />}
                message={selectVehicleMsg}
                actionTo={selectVehicleAction}
              />
            ) : latestQuery.isLoading && !latest ? (
              <div className="grid grid-cols-1 gap-3">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} height={84} />
                ))}
              </div>
            ) : latestQuery.isError && !latest ? (
              <QueryError error={latestQuery.error} onRetry={latestQuery.refetch} />
            ) : !latest ? (
              <EmptyState
                icon={<Icon icon={Icons.securityAlert} size="xl" />}
                /* no-action: transient — driving-stat metrics come from the same useSafety() payload as the KPI band above; nothing distinct to trigger from this card, the header Refresh button covers retry. */
                message={t('safety.noStats', 'No driving statistics available for this vehicle.')}
              />
            ) : (
              <div className="grid grid-cols-1 gap-3">
                <MetricCard
                  icon={<Icon icon={Icons.navigation} size="lg" />}
                  label={t('safety.distanceSinceReset', 'Distance since reset')}
                  value={
                    latest.miles_since_reset != null
                      ? formatDistance(latest.miles_since_reset, { precision })
                      : '—'
                  }
                  subtitle={latest.miles_since_reset == null ? unitPrefs.distance : undefined}
                />
                <MetricCard
                  icon={<Icon icon={Icons.cpu} size="lg" />}
                  label={t('safety.selfDrivingDistance', 'Self-driving distance')}
                  value={
                    latest.self_driving_miles_since_reset != null
                      ? formatDistance(latest.self_driving_miles_since_reset, { precision })
                      : '—'
                  }
                  subtitle={t('safety.distanceAutopilot', '{{unit}} (autopilot)', {
                    unit: latest.self_driving_miles_since_reset == null ? unitPrefs.distance : '',
                  })}
                />
                {/* Contextual drill-through: this card shows the CURRENT
                    counter reading; FSD Insights turns the same signal into a
                    per-day trend with explicit data-confidence metadata. */}
                <PrefetchLink
                  to="/fsd"
                  className="flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-2 rounded-shape-md border border-[var(--border-default)] bg-[var(--surface-2)] px-3 py-2 transition-colors hover:bg-[var(--control-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                >
                  <Text as="span" size="sm" weight="medium">
                    {t('safety.openFsdInsights', 'Open FSD insights')}
                  </Text>
                  <Caption className="shrink-0">
                    {t('safety.openFsdInsightsHint', 'Daily trend & data confidence')}
                  </Caption>
                </PrefetchLink>
              </div>
            )}
          </LayoutCard>
          }
        />
      </FadeIn>

      {/* 4 — Detail band: safety states over time */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3">{t('safety.statesOverTime', 'Safety states over time')}</PanelTitle>
          <DataFreshnessAuto query={historyQuery} />
          <Caption className="mb-3 block">
            {t('safety.settings.historyExplanation', 'Recorded configuration snapshots, not intervention events. Gaps represent unknown states; the full history table follows below.')}
          </Caption>
          {noVehicle ? (
            <EmptyState
              icon={<Icon icon={Icons.vehicle} size="xl" />}
              message={selectVehicleMsg}
              actionTo={selectVehicleAction}
            />
          ) : historyQuery.isLoading && history.length === 0 ? (
            <Skeleton height={300} />
          ) : historyQuery.isError && history.length === 0 ? (
            <QueryError error={historyQuery.error} onRetry={historyQuery.refetch} />
          ) : chartData.length === 0 ? (
            <EmptyState
              icon={<Icon icon={Icons.securityAlert} size="xl" />}
              /* no-action: transient — this trend chart fills once useSafetyHistory() has accumulated snapshots for the vehicle; the header Refresh button already re-triggers the query. */
              message={t('safety.noChart', 'No safety state history to chart yet.')}
            />
          ) : (
            <div className="h-64 sm:h-72 xl:h-80">
              {/* The complete snapshot table directly below is the chart's data alternative. */}
              <EmbeddedChart
                chartKey="safety-states-history"
                title={t('safety.chartTitle', 'Safety states')}
                ariaLabel={t('safety.chartAria', 'Safety feature states over time')}
                fluid
              >
                {({ hiddenSeries }) => (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={chartMargin}>
                      {chartGrid}
                      <XAxis dataKey="time" tick={axisTick} interval="preserveStartEnd" />
                      <YAxis
                        tick={axisTick}
                        domain={[0, 1]}
                        ticks={[0, 1]}
                        tickFormatter={(v: number) => (v === 1 ? t('common.on', 'On') : t('common.off', 'Off'))}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <ChartLegend />
                      <Line
                        {...AREA_DEFAULTS}
                        connectNulls={false}
                        type="stepAfter"
                        dataKey="aeb"
                        name={t('safety.hdrAeb', 'AEB')}
                        stroke={CHART_COLORS[0]}
                        isAnimationActive={false}
                        hide={hiddenSeries?.isHidden('aeb') ?? false}
                      />
                      <Line
                        {...AREA_DEFAULTS}
                        connectNulls={false}
                        type="stepAfter"
                        dataKey="bscw"
                        name={t('safety.hdrBscw', 'BSCW')}
                        stroke={CHART_COLORS[1]}
                        isAnimationActive={false}
                        hide={hiddenSeries?.isHidden('bscw') ?? false}
                      />
                      <Line
                        {...AREA_DEFAULTS}
                        connectNulls={false}
                        type="stepAfter"
                        dataKey="elda"
                        name={t('safety.hdrElda', 'ELDA')}
                        stroke={CHART_COLORS[2]}
                        isAnimationActive={false}
                        hide={hiddenSeries?.isHidden('elda') ?? false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </EmbeddedChart>
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* 5 — Detail band: full history table */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3">{t('safety.historyTitle', 'Safety settings history')}</PanelTitle>
          <DataFreshnessAuto query={historyQuery} />
          {noVehicle ? (
            <EmptyState
              icon={<Icon icon={Icons.vehicle} size="xl" />}
              message={selectVehicleMsg}
              actionTo={selectVehicleAction}
            />
          ) : historyQuery.isLoading && history.length === 0 ? (
            <Skeleton height={280} />
          ) : historyQuery.isError && history.length === 0 ? (
            <QueryError error={historyQuery.error} onRetry={historyQuery.refetch} />
          ) : sortedHistory.length === 0 ? (
            <EmptyState
              icon={<Icon icon={Icons.securityAlert} size="xl" />}
              /* no-action: transient — this table lists the same safety-history snapshots as the chart above; the header Refresh button covers a manual retry while telemetry is still producing rows. */
              message={t('safety.noHistory', 'No safety settings history has been recorded.')}
              description={t(
                'safety.noHistoryDescription',
                'Snapshots appear after the selected vehicle reports driver-assistance and safety configuration telemetry.',
              )}
            />
          ) : (
            <DataTable<SafetySnapshot>
              tableId="vehicle-systems:safety-history"
              enableValueFilters
              columns={historyColumns}
              mobileColumns={['time', 'aeb', 'fcw']}
              data={sortedHistory}
              keyExtractor={(row) => row.id ?? 0}
              compact
              pagination
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageLayout>
  );
}
