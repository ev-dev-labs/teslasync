import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sun, Battery, Home, Zap, ShieldAlert, RefreshCw, Activity,
  ArrowDown, ArrowUp,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Button, PanelTitle, Caption } from '@/components/ui';
import { RangePicker } from '@/components/forms';
import { StatCard, KVList, Energy } from '@/components/data-display';
import { LinearGauge } from '@/components/charts';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { formatDateTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';

import {
  useTeslaEnergyLiveStatus,
  useTeslaEnergyLiveStatusHistory,
  useRefreshTeslaEnergyLiveStatus,
} from '@/api/hooks/useEnergy';
import type { TeslaEnergyLiveStatus } from '@/types/energy';

import {
  PowerHistoryChart,
  BatterySocChart,
  fmtWatts,
  DEFAULT_SITE_ID,
  PRESET_IDS,
  FLOW_COLORS,
  type PowerHistoryPoint,
} from '../components/power-flow';

/* ───────── Power Flow arrow row ───────── */

interface FlowArrowProps {
  from: string;
  to: string;
  power: number | null;
  active: boolean;
}

/** Single directional power-flow chip. Arrow direction encodes flow sign. */
function FlowArrow({ from, to, power, active }: FlowArrowProps) {
  const inbound = (power ?? 0) >= 0;
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors',
        typography.size.xs,
        typography.weight.medium,
        active
          ? 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300'
          : 'border-white/[0.04] bg-white/[0.02] text-[var(--text-muted)]',
      )}
    >
      <span>{from}</span>
      {inbound ? (
        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      <span>{to}</span>
      {/* The arrow already encodes flow direction (sign), so show the magnitude
          only — a signed "-2.0 kW" next to a direction arrow double-encodes the
          sign and reads as a nonsensical negative flow. */}
      <span className="ml-auto tabular-nums">{fmtWatts(power == null ? null : Math.abs(power))}</span>
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
  const { t } = useTranslation();
  usePageTitle(t('powerFlow.title', 'Power Flow'));

  // Fixed energy_site_id for now; a future picker can select from multiple sites.
  const [siteId] = useState(DEFAULT_SITE_ID);
  const { start: since, end: until, setRange } = useRangeState({
    persistKey: 'power-flow.range',
    defaultPresetId: '7d',
  });

  const liveQuery = useTeslaEnergyLiveStatus(siteId);
  const historyQuery = useTeslaEnergyLiveStatusHistory(siteId, since, until, 1000);
  const refreshMutation = useRefreshTeslaEnergyLiveStatus();

  const {
    data: liveStatus,
    isLoading: liveLoading,
    isError: liveIsError,
    error: liveError,
    refetch: refetchLive,
  } = liveQuery;
  const {
    data: history,
    isLoading: historyLoading,
    isError: historyIsError,
    error: historyError,
    refetch: refetchHistory,
  } = historyQuery;
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
    liveStatus && 'id' in liveStatus ? (liveStatus as TeslaEnergyLiveStatus) : null;

  const chartData = useMemo<PowerHistoryPoint[]>(
    () =>
      (history ?? []).map((s) => ({
        time: new Date(s.timestamp).getTime(),
        label: formatDateTime(s.timestamp),
        solar: s.solar_power ?? 0,
        battery: s.battery_power ?? 0,
        grid: s.grid_power ?? 0,
        load: s.load_power ?? 0,
        soc: s.percentage_charged ?? 0,
      })),
    [history],
  );

  // Live scalar readings (SI watts / Wh / percent), null-safe.
  const solarW = live?.solar_power ?? null;
  const batteryW = live?.battery_power ?? null;
  const loadW = live?.load_power ?? null;
  const gridW = live?.grid_power ?? null;
  const gridServicesW = live?.grid_services_power ?? null;
  const soc = live?.percentage_charged ?? null;
  const gridStatus = live?.grid_status ?? null;

  const kpi = (w: number | null) => (liveIsError ? '—' : fmtWatts(w));
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

  const actions = (
    <>
      <RangePicker
        value={{ start: since, end: until }}
        onChange={(r) => setRange(r)}
        presetIds={PRESET_IDS}
        align="end"
        triggerTestId="power-flow-range"
      />
      <Button
        variant="secondary"
        onClick={() => refreshMutation.mutate(siteId)}
        loading={refreshMutation.isPending}
        icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
      >
        {t('powerFlow.refresh', 'Refresh from Tesla')}
      </Button>
    </>
  );

  return (
    <PageContainer
      title={t('powerFlow.title', 'Power Flow')}
      subtitle={t('powerFlow.subtitle', 'Real-time power flow from your Tesla Energy system')}
      actions={actions}
      query={[liveQuery, historyQuery]}
      dataSources={dataSources}
    >
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
          ) : liveIsError || !live ? (
            <Caption>{t('powerFlow.statusUnavailable', 'Live status unavailable — refresh to fetch')}</Caption>
          ) : (
            <>
              <Badge variant={gridStatusVariant(gridStatus)}>
                <Zap className="h-3 w-3" aria-hidden="true" />
                {t('powerFlow.grid', 'Grid')}: {gridStatus ?? t('powerFlow.unknown', 'Unknown')}
              </Badge>
              {live.storm_mode_active && (
                <Badge variant="warning">
                  <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                  {t('powerFlow.stormMode', 'Storm Mode Active')}
                </Badge>
              )}
              {live.backup_capable && (
                <Badge variant="info">
                  <Battery className="h-3 w-3" aria-hidden="true" />
                  {t('powerFlow.backupCapable', 'Backup Capable')}
                </Badge>
              )}
              <Badge variant="neutral">
                <Activity className="h-3 w-3" aria-hidden="true" />
                {t('powerFlow.lastUpdate', 'Updated')}: {formatDateTime(live.timestamp)}
              </Badge>
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Instantaneous power KPI band */}
      <FadeIn delay={0.05}>
        <section
          aria-label={t('powerFlow.currentPower', 'Current power')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          <StatCard
            label={t('powerFlow.solarPower', 'Solar Production')}
            value={kpi(solarW)}
            icon={<Sun className="h-5 w-5 text-amber-300" aria-hidden="true" />}
            loading={liveLoading}
          />
          <StatCard
            label={t('powerFlow.batteryPower', 'Battery')}
            value={kpi(batteryW)}
            unit={batteryDir}
            icon={<Battery className="h-5 w-5 text-emerald-300" aria-hidden="true" />}
            loading={liveLoading}
          />
          <StatCard
            label={t('powerFlow.homeConsumption', 'Home Consumption')}
            value={kpi(loadW)}
            icon={<Home className="h-5 w-5 text-indigo-300" aria-hidden="true" />}
            loading={liveLoading}
          />
          <StatCard
            label={t('powerFlow.gridPower', 'Grid')}
            value={kpi(gridW)}
            unit={gridDir}
            icon={<Zap className="h-5 w-5 text-purple-300" aria-hidden="true" />}
            loading={liveLoading}
          />
        </section>
      </FadeIn>

      {/* 3 — Live overview bento: battery | flow | site details */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('powerFlow.liveOverview', 'Live system overview')}
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {/* Battery state */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3">{t('powerFlow.batteryState', 'Battery State')}</PanelTitle>
            {liveLoading ? (
              <Skeleton height={200} />
            ) : liveIsError ? (
              <QueryError error={liveError} onRetry={onRetryLive} />
            ) : !live ? (
              <EmptyState
                icon={<Battery className="h-8 w-8" />}
                message={t('powerFlow.noBatteryData', 'No battery data — refresh to fetch')}
                action={{ label: t('powerFlow.refresh', 'Refresh from Tesla'), onClick: () => refreshMutation.mutate(siteId) }}
              />
            ) : (
              <div className="flex flex-col items-center gap-5">
                <LinearGauge
                  value={soc ?? 0}
                  max={100}
                  label={t('powerFlow.stateOfCharge', 'State of Charge')}
                  unit="%"
                  color={FLOW_COLORS.soc}
                  size={140}
                  decimals={1}
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
          </GlassPanel>

          {/* Power flow diagram */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3">{t('powerFlow.flowDiagram', 'Power Flow')}</PanelTitle>
            {liveLoading ? (
              <Skeleton height={180} />
            ) : liveIsError ? (
              <QueryError error={liveError} onRetry={onRetryLive} />
            ) : !live ? (
              <EmptyState
                icon={<Activity className="h-8 w-8" />}
                message={t('powerFlow.noFlowData', 'No power flow data yet')}
                action={{ label: t('powerFlow.refresh', 'Refresh from Tesla'), onClick: () => refreshMutation.mutate(siteId) }}
              />
            ) : (
              <div className="space-y-2">
                <FlowArrow from={t('powerFlow.solar', 'Solar')} to={t('powerFlow.home', 'Home')} power={solarW} active={(solarW ?? 0) > 0} />
                <FlowArrow from={t('powerFlow.batteryLabel', 'Battery')} to={t('powerFlow.home', 'Home')} power={batteryW} active={(batteryW ?? 0) !== 0} />
                <FlowArrow from={t('powerFlow.grid', 'Grid')} to={t('powerFlow.home', 'Home')} power={gridW} active={(gridW ?? 0) !== 0} />
                {(gridServicesW ?? 0) !== 0 && (
                  <FlowArrow from={t('powerFlow.gridServices', 'Grid Services')} to={t('powerFlow.grid', 'Grid')} power={gridServicesW} active />
                )}
              </div>
            )}
          </GlassPanel>

          {/* Site details */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3">{t('powerFlow.siteDetails', 'Site Details')}</PanelTitle>
            {liveLoading ? (
              <Skeleton height={180} />
            ) : liveIsError ? (
              <QueryError error={liveError} onRetry={onRetryLive} />
            ) : !live ? (
              <EmptyState
                icon={<Zap className="h-8 w-8" />}
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
                        {live.storm_mode_active ? t('powerFlow.on', 'On') : t('powerFlow.off', 'Off')}
                      </Badge>
                    ),
                  },
                  {
                    label: t('powerFlow.backupCapableLabel', 'Backup Capable'),
                    value: (
                      <Badge variant={live.backup_capable ? 'info' : 'neutral'} size="sm">
                        {live.backup_capable ? t('powerFlow.yes', 'Yes') : t('powerFlow.no', 'No')}
                      </Badge>
                    ),
                  },
                  { label: t('powerFlow.lastUpdate', 'Updated'), value: formatDateTime(live.timestamp) },
                ]}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 4 — History charts row: power hero (2fr) + SOC (1fr) */}
      <FadeIn delay={0.15}>
        <section
          aria-label={t('powerFlow.history', 'Power History')}
          className="grid grid-cols-1 gap-4 2xl:grid-cols-3"
        >
          <PowerHistoryChart
            className="2xl:col-span-2"
            data={chartData}
            loading={historyLoading}
            error={historyIsError ? historyError : null}
            onRetry={onRetryHistory}
          />
          <BatterySocChart
            className="2xl:col-span-1"
            data={chartData}
            loading={historyLoading}
            error={historyIsError ? historyError : null}
            onRetry={onRetryHistory}
          />
        </section>
      </FadeIn>
    </PageContainer>
  );
}
