import { useState, useMemo, useCallback, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Zap, DollarSign, RefreshCw, MapPin, TrendingUp, Gauge, Clock,
  Building2, Info, Download, AlertCircle, Plug,
} from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Button, Select, DataTable, PanelTitle, Text, type Column } from '@/components/ui';
import { StatCard, MetricBar } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import {
  ChartContainer, ChartTooltip, ChartGradient, chartGrid, axisTickSm,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CHART_COLORS,
} from '@/components/charts';
import { EmptyState, Spinner, Skeleton, AlertBanner } from '@/components/feedback';
import { RangePicker } from '@/components/forms';
import {
  useTeslaChargingSessions,
  useRefreshTeslaChargingSessions,
  type TeslaChargingSession,
} from '@/api/hooks/useCharging';
import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useUnits } from '@/hooks/useUnits';
import { useSettings } from '@/hooks/useSettings';
import { useFormatting } from '@/hooks/useFormatting';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { convertEnergyFromSI } from '@/lib/unitConversion';
import { formatCurrencyValue, currencyCodeFromSymbol } from '@/lib/currencyFormat';
import { getErrorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';

const LazyMap = lazy(() => import('./TeslaChargingSessionsMap'));

/**
 * Format an SI-seconds duration to "Xh Ym".
 * Guards null / undefined / NaN / Infinity / negative input by returning an
 * em dash so malformed telemetry can never render "NaNm" or "-2m".
 */
export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Aggregate sessions by month for the cost chart. Rows whose
 * `charge_start_datetime` is missing or unparseable are skipped so a single
 * malformed timestamp can't pollute the chart with a "NaN-NaN" bucket.
 */
export function buildMonthlyCost(sessions: TeslaChargingSession[]): { month: string; total: number }[] {
  const map = new Map<string, number>();
  for (const s of sessions) {
    if (!s.charge_start_datetime) continue;
    const d = new Date(s.charge_start_datetime);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    map.set(key, (map.get(key) ?? 0) + (s.total_cost ?? 0));
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, total }));
}

export interface GroupBucket {
  key: string;
  count: number;
  energyWh: number;
  cost: number;
}

/** Roll sessions up by a string key, summing count / energy / cost (all null-safe). */
export function groupSessions(
  sessions: TeslaChargingSession[],
  keyOf: (s: TeslaChargingSession) => string,
): GroupBucket[] {
  const map = new Map<string, GroupBucket>();
  for (const s of sessions) {
    const key = keyOf(s);
    const cur = map.get(key) ?? { key, count: 0, energyWh: 0, cost: 0 };
    cur.count += 1;
    cur.energyWh += s.total_energy_added_wh ?? 0;
    cur.cost += s.total_cost ?? 0;
    map.set(key, cur);
  }
  return Array.from(map.values());
}

export default function TeslaChargingSessionsPage() {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();
  const { settings, locale } = useSettings();
  const { formatCurrency } = useFormatting();
  const userCurrency = currencyCodeFromSymbol(settings.currency_symbol);
  usePageTitle(t('tesla_sessions.title', 'Fleet Charging Sessions'));

  const { data: vehicles } = useVehicles();
  const [selectedVin, setSelectedVin] = useState<string>('');
  const { data: response, isLoading, error } = useTeslaChargingSessions(selectedVin || undefined);
  const refreshMutation = useRefreshTeslaChargingSessions();

  const allSessions = response?.sessions ?? [];
  // Range filter (client-side) on charge_start_datetime.
  const { start, end, setRange } = useRangeState({
    persistKey: 'tesla-charging-sessions.range',
    defaultPresetId: 'all',
  });
  const sessions = useMemo(() => {
    if (!allSessions.length) return allSessions;
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return allSessions.filter((s) => {
      if (!s.charge_start_datetime) return false;
      const ts = new Date(s.charge_start_datetime).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [allSessions, start, end]);
  const summary = response?.summary ?? {
    total_sessions: 0, total_wh: null, total_cost: null, avg_cost_per_kwh: null, peak_power_kw: null,
  };

  const vehicleOptions = useMemo(() => {
    const opts = [{ value: '', label: t('tesla_sessions.allVehicles', 'All Vehicles') }];
    for (const v of vehicles ?? []) {
      opts.push({ value: v.vin, label: `${v.display_name} (${v.vin.slice(-6)})` });
    }
    return opts;
  }, [vehicles, t]);

  const monthlyData = useMemo(() => buildMonthlyCost(sessions), [sessions]);

  const mapPoints = useMemo(() =>
    sessions.filter((s) => s.latitude != null && s.longitude != null),
    [sessions],
  );

  // Derived breakdown: energy grouped by charger type (Supercharger / DC / etc.).
  const chargerTypeBreakdown = useMemo(() => {
    const unknown = t('tesla_sessions.unknownType', 'Unknown');
    return groupSessions(sessions, (s) => s.charger_type || unknown)
      .sort((a, b) => b.energyWh - a.energyWh || b.cost - a.cost);
  }, [sessions, t]);
  const maxChargerEnergy = useMemo(
    () => chargerTypeBreakdown.reduce((m, c) => Math.max(m, c.energyWh), 0),
    [chargerTypeBreakdown],
  );

  // Derived breakdown: top charging sites ranked by total spend.
  const topLocations = useMemo(() => {
    const unknown = t('tesla_sessions.unknown', 'Unknown');
    return groupSessions(sessions, (s) => s.site_location_name || unknown)
      .sort((a, b) => b.cost - a.cost || b.energyWh - a.energyWh)
      .slice(0, 6);
  }, [sessions, t]);
  const maxLocationCost = useMemo(
    () => topLocations.reduce((m, l) => Math.max(m, l.cost), 0),
    [topLocations],
  );

  const lastSync = response && sessions.length > 0 ? sessions[0]?.fetched_at : null;

  const handleRefresh = () => {
    refreshMutation.mutate(selectedVin ? { vin: selectedVin } : undefined);
  };

  const is403 = refreshMutation.error
    && typeof refreshMutation.error === 'object'
    && 'status' in (refreshMutation.error as unknown as Record<string, unknown>)
    && (refreshMutation.error as unknown as Record<string, unknown>).status === 403;

  const columns: Column<TeslaChargingSession>[] = useMemo(() => [
    {
      key: 'date',
      header: t('tesla_sessions.col.date', 'Date'),
      render: (row) => (
        <Text variant="body">{formatDateTime(row.charge_start_datetime)}</Text>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'location',
      header: t('tesla_sessions.col.location', 'Location'),
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" aria-hidden="true" />
          <Text variant="body" className="truncate max-w-[200px]">
            {row.site_location_name || '—'}
          </Text>
        </div>
      ),
      visibleOnMobile: true,
    },
    {
      key: 'vin',
      header: t('tesla_sessions.col.vin', 'VIN'),
      render: (row) => (
        <Text size="sm" color="secondary" mono>
          {row.vin ? `…${row.vin.slice(-6)}` : '—'}
        </Text>
      ),
      defaultVisible: false,
    },
    {
      key: 'energy',
      header: t('tesla_sessions.col.energy', 'Energy (kWh)'),
      render: (row) => (
        <Text size="sm" weight="medium" className="text-cyan-300">
          {row.total_energy_added_wh != null ? fmtNumber(convertEnergyFromSI(row.total_energy_added_wh, 'kWh'), 1) : '—'}
        </Text>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'peakPower',
      header: t('tesla_sessions.col.peakPower', 'Peak (kW)'),
      render: (row) => (
        <Text size="sm" className="text-amber-300">
          {row.peak_power_kw != null ? fmtNumber(row.peak_power_kw, 0) : '—'}
        </Text>
      ),
      sortable: true,
    },
    {
      key: 'duration',
      header: t('tesla_sessions.col.duration', 'Duration'),
      render: (row) => (
        <Text variant="body">
          {formatDurationSeconds(row.charge_duration_s)}
        </Text>
      ),
    },
    {
      key: 'cost',
      header: t('tesla_sessions.col.cost_decimal', 'Cost'),
      render: (row) => (
        <Text size="sm" weight="medium" className="text-emerald-300">
          {row.total_cost != null
            ? formatCurrencyValue(row.total_cost, row.currency_code ?? userCurrency, locale, 2, { useGrouping: true })
            : '—'}
        </Text>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'rate',
      header: t('tesla_sessions.col.rate', 'Rate/kWh'),
      render: (row) => (
        <Text size="sm" color="secondary">
          {row.per_kwh_rate != null
            ? formatCurrencyValue(row.per_kwh_rate, row.currency_code ?? userCurrency, locale, 3, { useGrouping: true })
            : '—'}
        </Text>
      ),
      defaultVisible: false,
    },
    {
      key: 'type',
      header: t('tesla_sessions.col.type', 'Type'),
      render: (row) => (
        <Text size="xs" color="secondary" className="uppercase tracking-wide">
          {row.charger_type ?? '—'}
        </Text>
      ),
    },
  ], [t, userCurrency, locale]);

  const [sortKey, setSortKey] = useState<string>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedKeys, setSelectedKeys] = useState<(string | number)[]>([]);

  const sortedSessions = useMemo(() => {
    const sorted = [...sessions];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'date':
          cmp = a.charge_start_datetime.localeCompare(b.charge_start_datetime);
          break;
        case 'energy':
          cmp = (a.total_energy_added_wh ?? 0) - (b.total_energy_added_wh ?? 0);
          break;
        case 'peakPower':
          cmp = (a.peak_power_kw ?? 0) - (b.peak_power_kw ?? 0);
          break;
        case 'cost':
          cmp = (a.total_cost ?? 0) - (b.total_cost ?? 0);
          break;
        default:
          cmp = a.charge_start_datetime.localeCompare(b.charge_start_datetime);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return sorted;
  }, [sessions, sortKey, sortDir]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  // CSV export of selected sessions for client-side analysis / Tesla audit.
  const exportSelectedCsv = useCallback(
    (rows: TeslaChargingSession[]) => {
      if (rows.length === 0) return;
      const header = [
        'date', 'location', 'vin', 'energy_wh', 'peak_power_kw',
        'duration_seconds', 'cost', 'currency', 'per_kwh_rate', 'charger_type',
      ];
      const lines = [header.join(',')];
      for (const r of rows) {
        const fields = [
          r.charge_start_datetime,
          (r.site_location_name ?? '').replace(/[",\n]/g, ' '),
          r.vin ?? '',
          r.total_energy_added_wh != null ? String(r.total_energy_added_wh) : '',
          r.peak_power_kw != null ? String(r.peak_power_kw) : '',
          r.charge_duration_s != null ? String(r.charge_duration_s) : '',
          r.total_cost != null ? String(r.total_cost) : '',
          r.currency_code ?? '',
          r.per_kwh_rate != null ? String(r.per_kwh_rate) : '',
          r.charger_type ?? '',
        ];
        lines.push(fields.map(f => `"${String(f).replace(/"/g, '""')}"`).join(','));
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tesla-fleet-sessions-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [],
  );

  const actions = (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
      <Select
        options={vehicleOptions}
        value={selectedVin}
        onChange={(e) => setSelectedVin(e.target.value)}
        className="w-full min-w-0 sm:w-56"
        aria-label={t('tesla_sessions.selectVehicle', 'Select vehicle')}
      />
      <RangePicker
        value={{ start, end }}
        onChange={setRange}
        align="end"
        triggerTestId="tesla-charging-sessions-range"
      />
      <Button
        onClick={handleRefresh}
        disabled={refreshMutation.isPending}
        className="flex min-h-11 items-center gap-2"
      >
        <RefreshCw className={cn('h-4 w-4', refreshMutation.isPending && 'animate-spin')} aria-hidden="true" />
        {refreshMutation.isPending
          ? t('tesla_sessions.refreshing', 'Syncing...')
          : t('tesla_sessions.refresh', 'Refresh from Tesla')}
      </Button>
    </div>
  );

  return (
    <PageContainer
      title={t('tesla_sessions.title', 'Fleet Charging Sessions')}
      subtitle={t('tesla_sessions.subtitle', 'Detailed charging session data from Tesla (business accounts only)')}
      actions={actions}
    >
      {error && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(error)}
        </AlertBanner>
      )}

      {/* Business-account note + sync status */}
      <FadeIn>
        <section aria-label={t('tesla_sessions.infoSection', 'Fleet charging info')}>
          <GlassPanel className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
                <Text as="p" size="sm" color="secondary">
                  {t(
                    'tesla_sessions.businessNote',
                    'Fleet charging session data is only available for Tesla business accounts. Personal accounts will receive a 403 error when syncing.',
                  )}
                </Text>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:shrink-0 sm:justify-end">
                {is403 && (
                  <Text as="span" size="sm" className="inline-flex items-center gap-1.5 text-amber-300">
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    {t('tesla_sessions.businessOnly', 'Business account required')}
                  </Text>
                )}
                {lastSync && (
                  <Text as="span" size="xs" color="muted">
                    {t('tesla_sessions.lastSync', 'Last synced')}: {formatDateTime(lastSync)}
                  </Text>
                )}
              </div>
            </div>
          </GlassPanel>
        </section>
      </FadeIn>

      {/* KPI band — full-width responsive metric grid */}
      <FadeIn delay={0.06}>
        <section
          aria-label={t('tesla_sessions.kpis', 'Summary metrics')}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5"
        >
          <StatCard
            label={t('tesla_sessions.stats.sessions', 'Total Sessions')}
            value={fmtInt(summary.total_sessions)}
            icon={<Zap className="h-5 w-5 text-cyan-300" aria-hidden="true" />}
            loading={isLoading}
          />
          <StatCard
            label={t('tesla_sessions.stats.energy', 'Total Energy')}
            value={summary.total_wh != null ? formatEnergy(summary.total_wh, { precision: 1 }) : '—'}
            icon={<Gauge className="h-5 w-5 text-amber-300" aria-hidden="true" />}
            loading={isLoading}
          />
          <StatCard
            label={t('tesla_sessions.stats.cost_decimal', 'Total Cost')}
            value={summary.total_cost != null ? formatCurrency(summary.total_cost, 2) : '—'}
            icon={<DollarSign className="h-5 w-5 text-emerald-300" aria-hidden="true" />}
            loading={isLoading}
          />
          <StatCard
            label={t('tesla_sessions.stats.avgCost', 'Avg Cost/kWh')}
            value={summary.avg_cost_per_kwh != null ? formatCurrency(summary.avg_cost_per_kwh, 3) : '—'}
            icon={<TrendingUp className="h-5 w-5 text-purple-300" aria-hidden="true" />}
            loading={isLoading}
          />
          <StatCard
            label={t('tesla_sessions.stats.peakPower', 'Peak Power')}
            value={summary.peak_power_kw != null ? fmtNumber(summary.peak_power_kw, 0) : '—'}
            unit="kW"
            icon={<Clock className="h-5 w-5 text-orange-300" aria-hidden="true" />}
            loading={isLoading}
          />
        </section>
      </FadeIn>

      {/* Cost analysis bento — monthly cost hero + charger-type breakdown */}
      <FadeIn delay={0.12}>
        <section
          aria-label={t('tesla_sessions.costSection', 'Cost analysis')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <div className="xl:col-span-2">
            <ChartContainer
              title={t('tesla_sessions.monthlyCost', 'Monthly Charging Cost')}
              ariaLabel={t('tesla_sessions.monthlyCost.aria', 'Monthly Tesla charging cost bar chart')}
              data={monthlyData.map((m) => ({ month: m.month, total: m.total }))}
              dataColumns={[
                { key: 'month', label: t('tesla_sessions.col.month', 'Month') },
                { key: 'total', label: t('tesla_sessions.col.total', 'Total ($)') },
              ]}
              height={280}
              exportFilename={`tesla-monthly-cost-${new Date().toISOString().slice(0, 10)}`}
            >
              {isLoading ? (
                <div className="flex h-[280px] items-center justify-center"><Spinner /></div>
              ) : monthlyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={monthlyData}>
                    <defs>
                      <ChartGradient id="sessionCostGrad" color="#22d3ee" opacity={0.6} />
                    </defs>
                    {chartGrid}
                    <XAxis dataKey="month" tick={axisTickSm} />
                    <YAxis tick={axisTickSm} tickFormatter={(v: number) => formatCurrency(v, 0)} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="total" fill="url(#sessionCostGrad)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState
                  icon={<DollarSign className="h-10 w-10" />}
                  message={t('tesla_sessions.noChartData', 'No cost data yet. Click "Refresh from Tesla" to sync.')}
                />
              )}
            </ChartContainer>
          </div>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Plug className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('tesla_sessions.chargerType', 'Energy by Charger Type')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={220} />
            ) : chargerTypeBreakdown.length > 0 ? (
              <div className="space-y-3">
                {chargerTypeBreakdown.map((c, i) => (
                  <MetricBar
                    key={c.key}
                    label={c.key.toUpperCase()}
                    value={c.energyWh}
                    max={maxChargerEnergy || 1}
                    color={CHART_COLORS[i % CHART_COLORS.length]}
                    sublabel={`${formatEnergy(c.energyWh, { precision: 1 })} · ${fmtInt(c.count)}×`}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Plug className="h-8 w-8" />}
                message={t('tesla_sessions.noChargerData', 'No charger breakdown yet.')}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* Locations bento — session map hero + top locations by spend */}
      <FadeIn delay={0.16}>
        <section
          aria-label={t('tesla_sessions.locationsSection', 'Session locations')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('tesla_sessions.map', 'Session Locations')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={350} />
            ) : mapPoints.length > 0 ? (
              <Suspense fallback={<div className="flex h-[350px] items-center justify-center"><Spinner /></div>}>
                <LazyMap sessions={mapPoints} />
              </Suspense>
            ) : (
              <EmptyState
                icon={<MapPin className="h-10 w-10" />}
                message={t('tesla_sessions.noMapData', 'No location data available yet.')}
              />
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('tesla_sessions.topLocations', 'Top Locations by Cost')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={220} />
            ) : topLocations.length > 0 ? (
              <div className="space-y-3">
                {topLocations.map((l, i) => (
                  <MetricBar
                    key={l.key}
                    label={l.key}
                    value={l.cost}
                    max={maxLocationCost || 1}
                    color={CHART_COLORS[i % CHART_COLORS.length]}
                    sublabel={`${formatCurrency(l.cost, 0)} · ${fmtInt(l.count)}×`}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<MapPin className="h-8 w-8" />}
                message={t('tesla_sessions.noLocationData', 'No location breakdown yet.')}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* Full-width detail band — sessions table */}
      <FadeIn delay={0.2}>
        <section aria-label={t('tesla_sessions.tableSection', 'Charging sessions table')}>
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3">
              {t('tesla_sessions.table', 'Charging Sessions')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={400} />
            ) : sessions.length > 0 ? (
              <DataTable
                columns={columns}
                data={sortedSessions}
                keyExtractor={(row) => row.session_id}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                pagination={{ defaultPageSize: 25, pageSizeOptions: [25, 50, 100] }}
                tableId="tesla-charging-sessions"
                columnVisibility
                columnReorder
                stickyHeader
                maxHeight={600}
                virtualized
                rowHeight={56}
                exportable
                exportFilename={`tesla-fleet-sessions-${new Date().toISOString().slice(0, 10)}`}
                exportRow={(row) => ({
                  date: row.charge_start_datetime,
                  location: row.site_location_name ?? '',
                  vin: row.vin ?? '',
                  energy: row.total_energy_added_wh ?? null,
                  peakPower: row.peak_power_kw ?? null,
                  duration: row.charge_duration_s ?? null,
                  cost: row.total_cost ?? null,
                  rate: row.per_kwh_rate ?? null,
                  type: row.charger_type ?? '',
                })}
                selectable="multi"
                selectedKeys={selectedKeys}
                onSelectionChange={setSelectedKeys}
                bulkActions={(rows) => (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Download className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => exportSelectedCsv(rows)}
                  >
                    {t('table.bulkActions.exportCsv', 'Export CSV')}
                  </Button>
                )}
              />
            ) : (
              <EmptyState
                icon={<Info className="h-10 w-10" />}
                message={t('tesla_sessions.noData', 'No fleet charging sessions yet. Click "Refresh from Tesla" to import data.')}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
