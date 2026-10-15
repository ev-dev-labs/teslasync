import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sun, Battery, Home, Zap, ShieldAlert, RefreshCw, Activity,
  ArrowDown, ArrowUp,
} from 'lucide-react';

import { PageLayout, LayoutCard } from '@/components/layout';
import { VisuallyHidden } from '@/components/a11y';
import { Badge, Button, Caption, Icon } from '@/components/ui';

import { KVList, Energy, type StatMetric } from '@/components/data-display';
import { BatteryEvidenceBrief } from '../components/operationalbrief-all/BatteryEvidenceBrief';
import { LinearGauge } from '@/components/charts';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning, SectionErrorBoundary } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useDataState } from '@/hooks/useDataState';
import { formatDateTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import { chartTokens, neonColorMap, typography } from '@/lib/tokens';
import { knownNumber } from '@/api/dataState';

import {
  useTeslaEnergyLiveStatus,
  useTeslaEnergyLiveStatusHistory,
  useRefreshTeslaEnergyLiveStatus,
} from '@/api/hooks/useEnergy';
import type { TeslaEnergyLiveStatus } from '@/types/energy';

import {
  PowerHistoryChart,
  BatterySocChart,
  SolarChargeAdviceStrip,
  fmtWatts,
  DEFAULT_SITE_ID,
  type PowerHistoryPoint,
} from '../components/power-flow';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/* ───────── Power Flow arrow row ───────── */

interface FlowArrowProps {
  from: string;
  to: string;
  power: number | null;
  active: boolean;
  direction?: string;
}

/** Single directional power-flow chip. Arrow direction encodes flow sign. */
function FlowArrow({ from, to, power, active, direction }: FlowArrowProps) {
  const inbound = (power ?? 0) >= 0;
  return (
    <div
      role="group"
      aria-label={fmtWatts(power)}
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-2 rounded-lg border bg-[var(--surface-2)] px-3 py-2 transition-colors duration-fast motion-reduce:transition-none',
        typography.size.xs,
        typography.weight.medium,
        active
          ? cn(neonColorMap.cyan.border, typography.color.primary)
          : cn(neonColorMap.neutral.border, typography.color.muted),
      )}
    >
      <span className="min-w-0 break-words">{from}</span>
      {power == null ? null : inbound ? (
        <Icon icon={ArrowDown} size="sm" />
      ) : (
        <Icon icon={ArrowUp} size="sm" />
      )}
      <span className="min-w-0 break-words">{to}</span>
      {/* The arrow already encodes flow direction (sign), so show the magnitude
          only — a signed "-2.0 kW" next to a direction arrow double-encodes the
          sign and reads as a nonsensical negative flow. */}
      <span className="ms-auto min-w-0 break-words tabular-nums" aria-hidden="true">
        {fmtWatts(power == null ? null : Math.abs(power))}
      </span>
      {direction ? <VisuallyHidden>{direction}</VisuallyHidden> : null}
    </div>
  );
}

/**
 * Grid-status → Badge variant. `Active` is healthy (green); any other known
 * status (e.g. an outage / islanded state) is a danger (red). A missing status
 * is *unknown*, not an error, so it renders neutral rather than a misleading
 * red danger chip.
 */
function gridStatusVariant(status: string | null): 'success' | 'danger' | 'neutral' {
  if (status == null) return 'neutral';
  return status === 'Active' ? 'success' : 'danger';
}

/* ───────── Page ───────── */

/**
 * Power Flow Dashboard — full-width, mobile-first bento of the live Tesla Energy
 * system: a status strip, a four-tile KPI band, a three-panel live overview
 * (battery / flow diagram / site details) and a history charts row. Every data
 * section owns its loading, empty and error states; the page fetches once and
 * fans the SI data out to inline sections and the two extracted chart cards.
 */
export default function PowerFlowDashboardPage() {
  const { precision: displayPrecision } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('powerFlow.title', 'Power Flow'));

  // Fixed energy_site_id for now; a future picker can select from multiple sites.
  const [siteId] = useState(DEFAULT_SITE_ID);
  const { start: since, end: until } = useRangeState({
    persistKey: 'power-flow.range',
    defaultPresetId: '7d',
  });

  const liveQuery = useTeslaEnergyLiveStatus(siteId);
  const historyQuery = useTeslaEnergyLiveStatusHistory(siteId, since, until, 1000);
  const refreshMutation = useRefreshTeslaEnergyLiveStatus();
  const liveState = useDataState(liveQuery, { provenance: 'live' });
  const historyState = useDataState(historyQuery, { provenance: 'historical' });

  const {
    data: liveStatus,
    refetch: refetchLive,
  } = liveQuery;
  const {
    data: history,
    refetch: refetchHistory,
  } = historyQuery;
  const liveLoading = !liveState.hasData && !liveState.isRefreshBlocked
    && (liveQuery.isLoading || liveQuery.isFetching || liveQuery.fetchStatus === 'fetching');
  const historyLoading = !historyState.hasData && !historyState.isRefreshBlocked
    && (historyQuery.isLoading || historyQuery.isFetching || historyQuery.fetchStatus === 'fetching');
  const liveUnresolved = liveState.status === 'initial';
  const historyUnresolved = historyState.status === 'initial';
  const sourcePending = (label: string, paused: boolean) => (
    <Caption role="status">
      {label}: {paused
        ? t('dataSources.status.paused', 'Refresh paused')
        : t('dataSources.status.pending', 'Pending')}
    </Caption>
  );
  const livePending = sourcePending(
    t('dataSources.labels.liveEnergyStatus', 'Live energy status'), liveState.isRefreshBlocked,
  );
  const historyPending = sourcePending(
    t('dataSources.labels.energyStatusHistory', 'Energy status history'), historyState.isRefreshBlocked,
  );
  const liveIsError = liveState.fatalError != null;
  const liveError = liveState.fatalError;
  const historyError = historyState.fatalError;
  const dataSources = useMemo(
    () => [
      {
        id: 'live-energy-status',
        label: t('dataSources.labels.liveEnergyStatus', 'Live energy status'),
        query: liveQuery,
      },
      {
        id: 'energy-status-history',
        label: t('dataSources.labels.energyStatusHistory', 'Energy status history'),
        query: historyQuery,
      },
    ],
    [historyQuery, liveQuery, t],
  );

  // liveStatus may be a "no data" envelope rather than a real snapshot; only
  // treat it as live data when it carries a record id.
  const live: TeslaEnergyLiveStatus | null =
    liveStatus && 'id' in liveStatus ? liveStatus : null;

  const chartData = useMemo<PowerHistoryPoint[]>(
    () =>
      (history ?? []).map((s) => ({
        time: new Date(s.timestamp).getTime(),
        label: formatDateTime(s.timestamp),
        solar: s.solar_power ?? null,
        battery: s.battery_power ?? null,
        grid: s.grid_power ?? null,
        load: s.load_power ?? null,
        soc: s.percentage_charged ?? null,
      })),
    [history],
  );

  // Live scalar readings (SI watts / Wh / percent), null-safe.
  const solarW = knownNumber(live?.solar_power);
  const batteryW = knownNumber(live?.battery_power);
  const loadW = knownNumber(live?.load_power);
  const gridW = knownNumber(live?.grid_power);
  const gridServicesW = knownNumber(live?.grid_services_power);
  const soc = knownNumber(live?.percentage_charged);
  const gridStatus = live?.grid_status ?? null;

  const kpi = (w: number | null) => (liveIsError ? null : w);
  const powerDisplay = { formatter: (raw: number) => ({ value: fmtWatts(raw), unit: '' }) };
  const batteryDir =
    liveIsError || batteryW == null || batteryW === 0
      ? undefined
      : batteryW < 0
        ? t('powerFlow.charging', 'Charging')
        : t('powerFlow.discharging', 'Discharging');
  const gridDir =
    liveIsError || gridW == null || gridW === 0
      ? undefined
      : gridW > 0
        ? t('powerFlow.importing', 'Importing')
        : t('powerFlow.exporting', 'Exporting');

  const onRetryLive = () => { void refetchLive(); };
  const onRetryHistory = () => { void refetchHistory(); };
  const powerMetrics: StatMetric[] = [
    { metricId: 'power', display: powerDisplay, occurrenceId: 'power-flow-solar',
      label: t('powerFlow.solarPower', 'Solar Production'), rawValue: kpi(solarW),
      context: <Icon icon={Sun} size="lg" className={typography.color.secondary} /> },
    { metricId: 'power', display: powerDisplay, occurrenceId: 'power-flow-battery',
      label: t('powerFlow.batteryPower', 'Battery'), rawValue: kpi(batteryW),
      context: <><Icon icon={Battery} size="lg" className={typography.color.secondary} />{batteryDir}</> },
    { metricId: 'power', display: powerDisplay, occurrenceId: 'power-flow-load',
      label: t('powerFlow.homeConsumption', 'Home Consumption'), rawValue: kpi(loadW),
      context: <Icon icon={Home} size="lg" className={typography.color.secondary} /> },
    { metricId: 'power', display: powerDisplay, occurrenceId: 'power-flow-grid',
      label: t('powerFlow.gridPower', 'Grid'), rawValue: kpi(gridW),
      context: <><Icon icon={Zap} size="lg" className={typography.color.secondary} />{gridDir}</> },
  ];

  const actions = (
    <>
      <Button
        wrapLabel
        variant="secondary"
        className="min-h-11 min-w-11 md:min-h-10"
        onClick={() => refreshMutation.mutate(siteId)}
        loading={refreshMutation.isPending}
        icon={<Icon icon={RefreshCw} />}
      >
        {t('powerFlow.refresh', 'Refresh from Tesla')}
      </Button>
    </>
  );

  return (
    <PageLayout
      title={t('powerFlow.title', 'Power Flow')}
      subtitle={t('powerFlow.subtitle', 'Real-time power flow from your Tesla Energy system')}
      secondaryActions={actions}
      query={[liveQuery, historyQuery]}
      dataSources={dataSources}
    >
      <StaleRefreshWarning state={liveState} label={t('dataSources.labels.liveEnergyStatus', 'Live energy status')} />
      <StaleRefreshWarning state={historyState} label={t('dataSources.labels.energyStatusHistory', 'Energy status history')} />
      {/* 1 — Live status strip */}
      <FadeIn>
        <section
          aria-label={t('powerFlow.systemStatus', 'System status')}
          className="flex flex-wrap items-center gap-2"
        >
          {liveLoading ? (
            <>
              <Skeleton width="140px" height={24} />
              <Skeleton width="110px" height={24} />
              <Skeleton width="160px" height={24} />
            </>
          ) : liveUnresolved ? (
            livePending
          ) : liveIsError || !live ? (
            <Caption>{t('powerFlow.statusUnavailable', 'Live status unavailable — refresh to fetch')}</Caption>
          ) : (
            <>
              <Badge variant={gridStatusVariant(gridStatus)}>
                <Icon icon={Zap} size="xs" />
                {t('powerFlow.grid', 'Grid')}: {gridStatus ?? t('powerFlow.unknown', 'Unknown')}
              </Badge>
              {live.storm_mode_active && (
                <Badge variant="warning">
                  <Icon icon={ShieldAlert} size="xs" />
                  {t('powerFlow.stormMode', 'Storm Mode Active')}
                </Badge>
              )}
              {live.backup_capable && (
                <Badge variant="info">
                  <Icon icon={Battery} size="xs" />
                  {t('powerFlow.backupCapable', 'Backup Capable')}
                </Badge>
              )}
              <Badge variant="neutral">
                <Icon icon={Activity} size="xs" />
                {t('powerFlow.lastUpdate', 'Updated')}: {formatDateTime(live.timestamp)}
              </Badge>
            </>
          )}
        </section>
      </FadeIn>

      {/* 1b — Solar car-charging advice */}
      <SectionErrorBoundary name="PowerFlowSolarAdvice">
        <SolarChargeAdviceStrip siteId={siteId} />
      </SectionErrorBoundary>

      {/* 2 — Instantaneous power KPI band */}
      <FadeIn delay={0.05}>
        <section>
        <SectionErrorBoundary name="PowerFlowCurrentPower">
        {liveUnresolved && !liveLoading ? livePending : null}
        <BatteryEvidenceBrief title={t('powerFlow.currentPower', 'Current power')} metrics={powerMetrics}
          loading={liveLoading} retained={liveState.status === 'stale'}
          period={{ kind: 'snapshot', label: live ? formatDateTime(live.timestamp) : liveUnresolved
            ? t('dataSources.status.pending', 'Pending')
            : t('powerFlow.statusUnavailable', 'Live status unavailable — refresh to fetch'),
            observedAt: live?.timestamp ?? null,
            provenance: t('dataSources.labels.liveEnergyStatus', 'Live energy status') }} />
        </SectionErrorBoundary>
        </section>
      </FadeIn>

      {/* 3 — Live overview bento: battery | flow | site details */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('powerFlow.liveOverview', 'Live system overview')}
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {/* Battery state */}
          <LayoutCard title={t('powerFlow.batteryState', 'Battery State')}>
            <SectionErrorBoundary name="PowerFlowBatteryState">
            {liveLoading ? (
              <Skeleton height={200} />
            ) : liveIsError ? (
              <QueryError error={liveError} onRetry={onRetryLive} />
            ) : liveUnresolved ? (
              livePending
            ) : !live ? (
              <EmptyState
                icon={<Icon icon={Battery} size="xl" />}
                message={t('powerFlow.noBatteryData', 'No battery data — refresh to fetch')}
                action={{ label: t('powerFlow.refresh', 'Refresh from Tesla'), onClick: () => refreshMutation.mutate(siteId) }}
              />
            ) : (
              <div className="flex flex-col items-center gap-5">
                <LinearGauge
                  value={soc}
                  max={100}
                  label={t('powerFlow.stateOfCharge', 'State of Charge')}
                  unit="%"
                  color={chartTokens.series[1]}
                  size={140}
                  decimals={displayPrecision}
                />
                <KVList
                  className="w-full"
                  items={[
                    { label: t('powerFlow.energyLeft', 'Energy Remaining'), value: <Energy wh={live.energy_left} /> },
                    { label: t('powerFlow.totalCapacity', 'Total Capacity'), value: <Energy wh={live.total_pack_energy} /> },
                  ]}
                />
              </div>
            )}
            </SectionErrorBoundary>
          </LayoutCard>

          {/* Power flow diagram */}
          <LayoutCard title={t('powerFlow.flowDiagram', 'Power Flow')}>
            <SectionErrorBoundary name="PowerFlowDiagram">
            {liveLoading ? (
              <Skeleton height={180} />
            ) : liveIsError ? (
              <QueryError error={liveError} onRetry={onRetryLive} />
            ) : liveUnresolved ? (
              livePending
            ) : !live ? (
              <EmptyState
                icon={<Icon icon={Activity} size="xl" />}
                message={t('powerFlow.noFlowData', 'No power flow data yet')}
                action={{ label: t('powerFlow.refresh', 'Refresh from Tesla'), onClick: () => refreshMutation.mutate(siteId) }}
              />
            ) : (
              <div className="space-y-2">
                <FlowArrow from={t('powerFlow.solar', 'Solar')} to={t('powerFlow.home', 'Home')} power={solarW} active={(solarW ?? 0) > 0} />
                <FlowArrow from={t('powerFlow.batteryLabel', 'Battery')} to={t('powerFlow.home', 'Home')} power={batteryW} active={(batteryW ?? 0) !== 0} direction={batteryDir} />
                <FlowArrow from={t('powerFlow.grid', 'Grid')} to={t('powerFlow.home', 'Home')} power={gridW} active={(gridW ?? 0) !== 0} direction={gridDir} />
                {(gridServicesW ?? 0) !== 0 && (
                  <FlowArrow from={t('powerFlow.gridServices', 'Grid Services')} to={t('powerFlow.grid', 'Grid')} power={gridServicesW} active />
                )}
              </div>
            )}
            </SectionErrorBoundary>
          </LayoutCard>

          {/* Site details */}
          <LayoutCard title={t('powerFlow.siteDetails', 'Site Details')}>
            <SectionErrorBoundary name="PowerFlowSiteDetails">
            {liveLoading ? (
              <Skeleton height={180} />
            ) : liveIsError ? (
              <QueryError error={liveError} onRetry={onRetryLive} />
            ) : liveUnresolved ? (
              livePending
            ) : !live ? (
              <EmptyState
                icon={<Icon icon={Zap} size="xl" />}
                message={t('powerFlow.noSiteData', 'No site data — refresh to fetch')}
                action={{ label: t('powerFlow.refresh', 'Refresh from Tesla'), onClick: () => refreshMutation.mutate(siteId) }}
              />
            ) : (
              <KVList
                items={[
                  {
                    label: t('powerFlow.gridStatus', 'Grid Status'),
                    value: (
                      <Badge variant={gridStatusVariant(gridStatus)} size="sm">
                        {gridStatus ?? t('powerFlow.unknown', 'Unknown')}
                      </Badge>
                    ),
                  },
                  {
                    label: t('powerFlow.stormModeLabel', 'Storm Mode'),
                    value: (
                      <Badge variant={live.storm_mode_active ? 'warning' : 'neutral'} size="sm">
                        {live.storm_mode_active == null
                          ? t('powerFlow.unknown', 'Unknown')
                          : live.storm_mode_active ? t('powerFlow.on', 'On') : t('powerFlow.off', 'Off')}
                      </Badge>
                    ),
                  },
                  {
                    label: t('powerFlow.backupCapableLabel', 'Backup Capable'),
                    value: (
                      <Badge variant={live.backup_capable ? 'info' : 'neutral'} size="sm">
                        {live.backup_capable == null
                          ? t('powerFlow.unknown', 'Unknown')
                          : live.backup_capable ? t('powerFlow.yes', 'Yes') : t('powerFlow.no', 'No')}
                      </Badge>
                    ),
                  },
                  { label: t('powerFlow.lastUpdate', 'Updated'), value: formatDateTime(live.timestamp) },
                ]}
              />
            )}
            </SectionErrorBoundary>
          </LayoutCard>
        </section>
      </FadeIn>

      {/* 4 — History charts row: power hero (2fr) + SOC (1fr) */}
      <FadeIn delay={0.15}>
        <section
          aria-label={t('powerFlow.history', 'Power History')}
          className="grid grid-cols-1 gap-4 2xl:grid-cols-3"
        >
          <SectionErrorBoundary name="PowerFlowPowerHistory">
          {historyUnresolved && !historyLoading ? (
            <div className="min-w-0 2xl:col-span-2">
              <LayoutCard title={t('powerFlow.powerOverTime', 'Power Over Time')}>
                {historyPending}
              </LayoutCard>
            </div>
          ) : <PowerHistoryChart
            className="2xl:col-span-2"
            data={chartData}
            loading={historyLoading}
            error={historyError}
            onRetry={onRetryHistory}
          />}
          </SectionErrorBoundary>
          <SectionErrorBoundary name="PowerFlowSocHistory">
          {historyUnresolved && !historyLoading ? (
            <div className="min-w-0 2xl:col-span-1">
              <LayoutCard title={t('powerFlow.socOverTime', 'Battery State of Charge')}>
                {historyPending}
              </LayoutCard>
            </div>
          ) : <BatterySocChart
            className="2xl:col-span-1"
            data={chartData}
            loading={historyLoading}
            error={historyError}
            onRetry={onRetryHistory}
          />}
          </SectionErrorBoundary>
        </section>
      </FadeIn>
    </PageLayout>
  );
}
