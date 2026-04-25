import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sun, Battery, Home, Zap, ShieldAlert, RefreshCw,
  ArrowDown, ArrowUp, Activity,
} from 'lucide-react';

import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Badge, Button, Select } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import {
  ChartContainer, ChartGradient, ChartTooltip,
  chartGrid, axisTick, chartMarginLabeled, CHART_COLORS,
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line,
  AREA_DEFAULTS,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime, formatDateShort } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';

import {
  useTeslaEnergyLiveStatus,
  useTeslaEnergyLiveStatusHistory,
  useRefreshTeslaEnergyLiveStatus,
} from '@/api/hooks/useEnergy';

import type { TeslaEnergyLiveStatus } from '@/types/energy';

/* ───────── Helpers ───────── */

function fmtWatts(watts: number | null | undefined): string {
  if (watts == null) return '—';
  const abs = Math.abs(watts);
  if (abs >= 1000) return `${fmtNumber(watts / 1000, 1)} kW`;
  return `${fmtNumber(watts, 0)} W`;
}

function fmtWh(wh: number | null | undefined): string {
  if (wh == null) return '—';
  if (Math.abs(wh) >= 1000) return `${fmtNumber(wh / 1000, 1)} kWh`;
  return `${fmtNumber(wh, 0)} Wh`;
}

const RANGE_OPTIONS = [
  { value: '1', label: '24 Hours' },
  { value: '7', label: '7 Days' },
  { value: '30', label: '30 Days' },
] as const;

/* ───────── Power Flow Arrows ───────── */

interface FlowArrowProps {
  from: string;
  to: string;
  power: number | null;
  active: boolean;
}

function FlowArrow({ from, to, power, active }: FlowArrowProps) {
  return (
    <div className={cn(
      'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
      active ? 'bg-cyan-500/10 text-cyan-400' : 'bg-white/[0.02] text-white/30',
    )}>
      <span>{from}</span>
      {(power ?? 0) >= 0 ? (
        <ArrowDown className="h-3.5 w-3.5" />
      ) : (
        <ArrowUp className="h-3.5 w-3.5" />
      )}
      <span>{to}</span>
      <span className="ml-auto tabular-nums">{fmtWatts(power)}</span>
    </div>
  );
}

/* ───────── Main Page ───────── */

// Use a fixed energy_site_id input for now; a future picker can select from multiple sites.
const DEFAULT_SITE_ID = 1;

export default function PowerFlowDashboardPage() {
  const { t } = useTranslation();
  usePageTitle(t('powerFlow.title', 'Power Flow'));

  const [siteId] = useState(DEFAULT_SITE_ID);
  const [rangeDays, setRangeDays] = useState('1');

  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - Number(rangeDays));
    return d.toISOString().slice(0, 10);
  }, [rangeDays]);
  const until = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const { data: liveStatus, isLoading: liveLoading } = useTeslaEnergyLiveStatus(siteId);
  const { data: history, isLoading: historyLoading } = useTeslaEnergyLiveStatusHistory(
    siteId, since, until, 1000,
  );
  const refreshMutation = useRefreshTeslaEnergyLiveStatus();

  // Safely handle the case where liveStatus is a "no data" message (not a real snapshot)
  const hasLiveData = liveStatus && 'id' in liveStatus;
  const live = hasLiveData ? (liveStatus as TeslaEnergyLiveStatus) : null;

  const chartData = useMemo(() => {
    return (history ?? []).map(s => ({
      time: new Date(s.timestamp).getTime(),
      label: formatDateTime(s.timestamp),
      solar: s.solar_power ?? 0,
      battery: s.battery_power ?? 0,
      grid: s.grid_power ?? 0,
      load: s.load_power ?? 0,
      soc: s.percentage_charged ?? 0,
    }));
  }, [history]);

  const isLoading = liveLoading;

  const solarW = live?.solar_power ?? null;
  const batteryW = live?.battery_power ?? null;
  const loadW = live?.load_power ?? null;
  const gridW = live?.grid_power ?? null;
  const soc = live?.percentage_charged ?? null;
  const gridStatus = live?.grid_status ?? null;
  const stormMode = live?.storm_mode_active ?? false;

  return (
    <PageContainer
      title={t('powerFlow.title', 'Power Flow')}
      subtitle={t('powerFlow.subtitle', 'Real-time power flow from your Tesla Energy system')}
      loading={isLoading}
    >
      {/* Refresh button */}
      <div className="flex justify-end mb-4">
        <Button
          onClick={() => refreshMutation.mutate(siteId)}
          loading={refreshMutation.isPending}
          disabled={refreshMutation.isPending}
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          {t('powerFlow.refresh', 'Refresh from Tesla')}
        </Button>
      </div>

      {/* Status Badges */}
      <FadeIn>
        <div className="flex flex-wrap gap-2 mb-6">
          <Badge variant={gridStatus === 'Active' ? 'success' : 'danger'}>
            <Zap className="h-3 w-3 mr-1" />
            {t('powerFlow.grid', 'Grid')}: {gridStatus ?? '—'}
          </Badge>
          {stormMode && (
            <Badge variant="warning">
              <ShieldAlert className="h-3 w-3 mr-1" />
              {t('powerFlow.stormMode', 'Storm Mode Active')}
            </Badge>
          )}
          {live?.backup_capable && (
            <Badge variant="info">
              <Battery className="h-3 w-3 mr-1" />
              {t('powerFlow.backupCapable', 'Backup Capable')}
            </Badge>
          )}
          {live && (
            <Badge variant="neutral">
              <Activity className="h-3 w-3 mr-1" />
              {t('powerFlow.lastUpdate', 'Updated')}: {formatDateTime(live.timestamp)}
            </Badge>
          )}
        </div>
      </FadeIn>

      {/* Stat Cards — current power */}
      <FadeIn delay={0.05}>
        <StaggerContainer>
          <Grid cols={{ default: 2, md: 4 }} gap={4}>
            <StaggerItem>
              <StatCard
                label={t('powerFlow.solarPower', 'Solar Production')}
                value={fmtWatts(solarW)}
                icon={<Sun className="h-5 w-5 text-amber-400" />}
                loading={isLoading}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('powerFlow.batteryPower', 'Battery')}
                value={fmtWatts(batteryW)}
                unit={(batteryW ?? 0) < 0 ? t('powerFlow.charging', 'Charging') : (batteryW ?? 0) > 0 ? t('powerFlow.discharging', 'Discharging') : undefined}
                icon={<Battery className="h-5 w-5 text-green-400" />}
                loading={isLoading}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('powerFlow.homeConsumption', 'Home Consumption')}
                value={fmtWatts(loadW)}
                icon={<Home className="h-5 w-5 text-blue-400" />}
                loading={isLoading}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('powerFlow.gridPower', 'Grid')}
                value={fmtWatts(gridW)}
                unit={(gridW ?? 0) > 0 ? t('powerFlow.importing', 'Importing') : (gridW ?? 0) < 0 ? t('powerFlow.exporting', 'Exporting') : undefined}
                icon={<Zap className="h-5 w-5 text-purple-400" />}
                loading={isLoading}
              />
            </StaggerItem>
          </Grid>
        </StaggerContainer>
      </FadeIn>

      {/* Battery SOC + Energy Left */}
      <FadeIn delay={0.1}>
        <Grid cols={{ default: 1, md: 2 }} gap={4} className="mt-4">
          <GlassPanel className="p-6">
            <h3 className="text-sm font-medium text-white/60 mb-3">
              {t('powerFlow.batteryState', 'Battery State')}
            </h3>
            {live ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-white/80">{t('powerFlow.stateOfCharge', 'State of Charge')}</span>
                  <span className="text-lg font-semibold text-white">
                    {soc != null ? `${fmtNumber(soc, 1)}%` : '—'}
                  </span>
                </div>
                {soc != null && (
                  <div className="w-full bg-white/[0.06] rounded-full h-3">
                    <div
                      className="h-3 rounded-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-700"
                      style={{ width: `${Math.min(soc, 100)}%` }}
                    />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-white/80">{t('powerFlow.energyLeft', 'Energy Remaining')}</span>
                  <span className="text-white">{fmtWh(live.energy_left)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/80">{t('powerFlow.totalCapacity', 'Total Capacity')}</span>
                  <span className="text-white">{fmtWh(live.total_pack_energy)}</span>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<Battery className="h-8 w-8" />}
                message={t('powerFlow.noBatteryData', 'No battery data — refresh to fetch')}
              />
            )}
          </GlassPanel>

          {/* Power Flow Diagram */}
          <GlassPanel className="p-6">
            <h3 className="text-sm font-medium text-white/60 mb-3">
              {t('powerFlow.flowDiagram', 'Power Flow')}
            </h3>
            {live ? (
              <div className="space-y-2">
                <FlowArrow
                  from={t('powerFlow.solar', 'Solar')}
                  to={t('powerFlow.home', 'Home')}
                  power={solarW}
                  active={(solarW ?? 0) > 0}
                />
                <FlowArrow
                  from={t('powerFlow.batteryLabel', 'Battery')}
                  to={t('powerFlow.home', 'Home')}
                  power={batteryW}
                  active={(batteryW ?? 0) !== 0}
                />
                <FlowArrow
                  from={t('powerFlow.grid', 'Grid')}
                  to={t('powerFlow.home', 'Home')}
                  power={gridW}
                  active={(gridW ?? 0) !== 0}
                />
                {(live.grid_services_power ?? 0) !== 0 && (
                  <FlowArrow
                    from={t('powerFlow.gridServices', 'Grid Services')}
                    to={t('powerFlow.grid', 'Grid')}
                    power={live.grid_services_power}
                    active
                  />
                )}
              </div>
            ) : (
              <EmptyState
                icon={<Activity className="h-8 w-8" />}
                message={t('powerFlow.noFlowData', 'No power flow data yet')}
              />
            )}
          </GlassPanel>
        </Grid>
      </FadeIn>

      {/* Historical Charts */}
      <FadeIn delay={0.15}>
        <div className="mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white/90">
              {t('powerFlow.history', 'Power History')}
            </h2>
            <Select
              value={rangeDays}
              onChange={(e) => setRangeDays(e.target.value)}
              options={RANGE_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
              className="w-36"
            />
          </div>

          {/* Stacked Power Area Chart */}
          <ChartContainer
            title={t('powerFlow.powerOverTime', 'Power Over Time')}
            subtitle={t('powerFlow.powerOverTimeDesc', 'Solar, battery, and grid power flow')}
            loading={historyLoading}
            empty={chartData.length === 0}
            height={350}
          >
            <ResponsiveContainer width="100%" height={350}>
              <AreaChart data={chartData} margin={chartMarginLabeled}>
                <defs>
                  <ChartGradient id="gradSolar" color="#f59e0b" />
                  <ChartGradient id="gradBattery" color="#22c55e" />
                  <ChartGradient id="gradGrid" color="#a855f7" />
                  <ChartGradient id="gradLoad" color="#3b82f6" />
                </defs>
                {chartGrid}
                <XAxis
                  dataKey="time"
                  tickFormatter={(v) => formatDateShort(new Date(v).toISOString())}
                  {...axisTick}
                />
                <YAxis
                  tickFormatter={(v: number) => fmtWatts(v)}
                  {...axisTick}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Area
                  {...AREA_DEFAULTS}
                  dataKey="solar"
                  name={t('powerFlow.solar', 'Solar')}
                  stroke="#f59e0b"
                  fill="url(#gradSolar)"
                />
                <Area
                  {...AREA_DEFAULTS}
                  dataKey="battery"
                  name={t('powerFlow.batteryLabel', 'Battery')}
                  stroke="#22c55e"
                  fill="url(#gradBattery)"
                />
                <Area
                  {...AREA_DEFAULTS}
                  dataKey="grid"
                  name={t('powerFlow.grid', 'Grid')}
                  stroke="#a855f7"
                  fill="url(#gradGrid)"
                />
                <Area
                  {...AREA_DEFAULTS}
                  dataKey="load"
                  name={t('powerFlow.home', 'Home')}
                  stroke="#3b82f6"
                  fill="url(#gradLoad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        </div>
      </FadeIn>

      {/* Battery SOC Over Time */}
      <FadeIn delay={0.2}>
        <div className="mt-6">
          <ChartContainer
            title={t('powerFlow.socOverTime', 'Battery State of Charge')}
            subtitle={t('powerFlow.socOverTimeDesc', 'Battery percentage over time')}
            loading={historyLoading}
            empty={chartData.length === 0}
            height={250}
          >
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData} margin={chartMarginLabeled}>
                {chartGrid}
                <XAxis
                  dataKey="time"
                  tickFormatter={(v) => formatDateShort(new Date(v).toISOString())}
                  {...axisTick}
                />
                <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} {...axisTick} />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  {...AREA_DEFAULTS}
                  dataKey="soc"
                  name={t('powerFlow.stateOfCharge', 'State of Charge')}
                  stroke={CHART_COLORS[1]}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        </div>
      </FadeIn>
    </PageContainer>
  );
}
