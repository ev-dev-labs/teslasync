import { useState, useMemo, useCallback, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Zap, DollarSign, RefreshCw, MapPin, TrendingUp, Gauge, Clock,
  Building2, Info, Download,
} from 'lucide-react';
import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Button, Select, DataTable, type Column } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import {
  ChartContainer, ChartTooltip, ChartGradient, chartGrid, axisTickSm,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { EmptyState, Spinner } from '@/components/feedback';
import {
  useTeslaChargingSessions,
  useRefreshTeslaChargingSessions,
  type TeslaChargingSession,
} from '@/api/hooks/useCharging';
import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';

const LazyMap = lazy(() => import('./TeslaChargingSessionsMap'));

/** Format seconds to "Xh Ym" */
function formatDurationSeconds(seconds: number | null): string {
  if (seconds == null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Aggregate sessions by month for the cost chart */
function buildMonthlyCost(sessions: TeslaChargingSession[]): { month: string; total: number }[] {
  const map = new Map<string, number>();
  for (const s of sessions) {
    const d = new Date(s.charge_start_datetime);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    map.set(key, (map.get(key) ?? 0) + (s.total_cost ?? 0));
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, total }));
}

const gridCols = { default: 1, sm: 2, lg: 5 } as const;

export default function TeslaChargingSessionsPage() {
  const { t } = useTranslation();
  usePageTitle(t('tesla_sessions.title', 'Fleet Charging Sessions'));

  const { data: vehicles } = useVehicles();
  const [selectedVin, setSelectedVin] = useState<string>('');
  const { data: response, isLoading, error } = useTeslaChargingSessions(selectedVin || undefined);
  const refreshMutation = useRefreshTeslaChargingSessions();

  const sessions = response?.sessions ?? [];
  const summary = response?.summary ?? {
    total_sessions: 0, total_kwh: null, total_cost: null, avg_cost_per_kwh: null, peak_power_kw: null,
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
        <span className="text-sm text-[var(--text-primary)]">{formatDateTime(row.charge_start_datetime)}</span>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'location',
      header: t('tesla_sessions.col.location', 'Location'),
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
          <span className="text-sm text-[var(--text-primary)] truncate max-w-[200px]">
            {row.site_location_name || '—'}
          </span>
        </div>
      ),
      visibleOnMobile: true,
    },
    {
      key: 'vin',
      header: t('tesla_sessions.col.vin', 'VIN'),
      render: (row) => (
        <span className="text-sm text-[var(--text-secondary)] font-mono">
          {row.vin ? `…${row.vin.slice(-6)}` : '—'}
        </span>
      ),
      defaultVisible: false,
    },
    {
      key: 'energy',
      header: t('tesla_sessions.col.energy', 'Energy (kWh)'),
      render: (row) => (
        <span className="text-sm font-medium text-cyan-400">
          {row.energy_added_kwh != null ? fmtNumber(row.energy_added_kwh, 1) : '—'}
        </span>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'peakPower',
      header: t('tesla_sessions.col.peakPower', 'Peak (kW)'),
      render: (row) => (
        <span className="text-sm text-yellow-400">
          {row.peak_power_kw != null ? fmtNumber(row.peak_power_kw, 0) : '—'}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'duration',
      header: t('tesla_sessions.col.duration', 'Duration'),
      render: (row) => (
        <span className="text-sm text-[var(--text-primary)]">
          {formatDurationSeconds(row.charge_duration_s)}
        </span>
      ),
    },
    {
      key: 'cost',
      header: t('tesla_sessions.col.cost', 'Cost'),
      render: (row) => (
        <span className="text-sm font-medium text-emerald-400">
          {row.total_cost != null
            ? `${row.currency_code ?? '$'}${fmtNumber(row.total_cost, 2)}`
            : '—'}
        </span>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'rate',
      header: t('tesla_sessions.col.rate', 'Rate/kWh'),
      render: (row) => (
        <span className="text-sm text-[var(--text-secondary)]">
          {row.per_kwh_rate != null ? `$${fmtNumber(row.per_kwh_rate, 3)}` : '—'}
        </span>
      ),
      defaultVisible: false,
    },
    {
      key: 'type',
      header: t('tesla_sessions.col.type', 'Type'),
      render: (row) => (
        <span className="text-xs text-[var(--text-secondary)] uppercase tracking-wide">
          {row.charger_type ?? '—'}
        </span>
      ),
    },
  ], [t]);

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
          cmp = (a.energy_added_kwh ?? 0) - (b.energy_added_kwh ?? 0);
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
        'date', 'location', 'vin', 'energy_kwh', 'peak_power_kw',
        'duration_seconds', 'cost', 'currency', 'per_kwh_rate', 'charger_type',
      ];
      const lines = [header.join(',')];
      for (const r of rows) {
        const fields = [
          r.charge_start_datetime,
          (r.site_location_name ?? '').replace(/[",\n]/g, ' '),
          r.vin ?? '',
          r.energy_added_kwh != null ? String(r.energy_added_kwh) : '',
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

  return (
    <PageContainer
      title={t('tesla_sessions.title', 'Fleet Charging Sessions')}
      subtitle={t('tesla_sessions.subtitle', 'Detailed charging session data from Tesla (business accounts only)')}
      loading={isLoading}
      error={error as Error | null}
    >
      {/* Info banner */}
      <FadeIn>
        <GlassPanel className="p-4">
          <div className="flex items-start gap-3">
            <Building2 className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-sm text-[var(--text-secondary)]">
              {t(
                'tesla_sessions.businessNote',
                'Fleet charging session data is only available for Tesla business accounts. Personal accounts will receive a 403 error when syncing.',
              )}
            </p>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Controls bar */}
      <FadeIn delay={0.03}>
        <GlassPanel className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              options={vehicleOptions}
              value={selectedVin}
              onChange={(e) => setSelectedVin(e.target.value)}
              className="w-56"
            />
            <Button
              onClick={handleRefresh}
              disabled={refreshMutation.isPending}
              className="flex items-center gap-2"
            >
              <RefreshCw className={cn('h-4 w-4', refreshMutation.isPending && 'animate-spin')} />
              {refreshMutation.isPending
                ? t('tesla_sessions.refreshing', 'Syncing...')
                : t('tesla_sessions.refresh', 'Refresh from Tesla')}
            </Button>
            {is403 && (
              <span className="text-sm text-amber-400">
                {t('tesla_sessions.businessOnly', 'Business account required')}
              </span>
            )}
            {response && sessions.length > 0 && (
              <span className="ml-auto text-xs text-[var(--text-muted)]">
                {t('tesla_sessions.lastSync', 'Last synced')}: {formatDateTime(sessions[0]?.fetched_at)}
              </span>
            )}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Summary stats */}
      <FadeIn delay={0.05}>
        <StaggerContainer>
          <Grid cols={gridCols} gap={4}>
            <StaggerItem>
              <StatCard
                label={t('tesla_sessions.stats.sessions', 'Total Sessions')}
                value={fmtInt(summary.total_sessions)}
                icon={<Zap className="h-5 w-5 text-cyan-400" />}
                loading={isLoading}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('tesla_sessions.stats.energy', 'Total Energy')}
                value={summary.total_kwh != null ? fmtNumber(summary.total_kwh, 1) : '—'}
                unit="kWh"
                icon={<Gauge className="h-5 w-5 text-yellow-400" />}
                loading={isLoading}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('tesla_sessions.stats.cost', 'Total Cost')}
                value={summary.total_cost != null ? `$${fmtNumber(summary.total_cost, 2)}` : '—'}
                icon={<DollarSign className="h-5 w-5 text-emerald-400" />}
                loading={isLoading}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('tesla_sessions.stats.avgCost', 'Avg Cost/kWh')}
                value={summary.avg_cost_per_kwh != null ? `$${fmtNumber(summary.avg_cost_per_kwh, 3)}` : '—'}
                icon={<TrendingUp className="h-5 w-5 text-purple-400" />}
                loading={isLoading}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('tesla_sessions.stats.peakPower', 'Peak Power')}
                value={summary.peak_power_kw != null ? fmtNumber(summary.peak_power_kw, 0) : '—'}
                unit="kW"
                icon={<Clock className="h-5 w-5 text-orange-400" />}
                loading={isLoading}
              />
            </StaggerItem>
          </Grid>
        </StaggerContainer>
      </FadeIn>

      {/* Monthly cost chart */}
      <FadeIn delay={0.08}>
        <ChartContainer
          title={t('tesla_sessions.monthlyCost', 'Monthly Charging Cost')}
          ariaLabel={t('tesla_sessions.monthlyCost.aria', 'Monthly Tesla charging cost bar chart')}
          data={monthlyData.map((m) => ({ month: m.month, total: m.total }))}
          dataColumns={[
            { key: 'month', label: t('tesla_sessions.col.month', 'Month') },
            { key: 'total', label: t('tesla_sessions.col.total', 'Total ($)') },
          ]}
          height={280}
        >
          {monthlyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthlyData}>
                <defs>
                  <ChartGradient id="sessionCostGrad" color="#22d3ee" opacity={0.6} />
                </defs>
                {chartGrid}
                <XAxis dataKey="month" tick={axisTickSm} />
                <YAxis tick={axisTickSm} tickFormatter={(v: number) => `$${v}`} />
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
      </FadeIn>

      {/* Charging session map */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
            {t('tesla_sessions.map', 'Session Locations')}
          </h3>
          {mapPoints.length > 0 ? (
            <Suspense fallback={<div className="flex items-center justify-center h-[350px]"><Spinner /></div>}>
              <LazyMap sessions={mapPoints} />
            </Suspense>
          ) : (
            <EmptyState
              icon={<MapPin className="h-10 w-10" />}
              message={t('tesla_sessions.noMapData', 'No location data available yet.')}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Data table */}
      <FadeIn delay={0.12}>
        <GlassPanel className="p-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
            {t('tesla_sessions.table', 'Charging Sessions')}
          </h3>
          {sessions.length > 0 ? (
            <DataTable
              columns={columns}
              data={sortedSessions}
              keyExtractor={(row) => row.session_id}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
              pagination={{ defaultPageSize: 25, pageSizeOptions: [25, 50, 100] }}
              tableId="tesla-charging-sessions"
              showColumnsMenu
              stickyHeader
              maxHeight={600}
              selectable="multi"
              selectedKeys={selectedKeys}
              onSelectionChange={setSelectedKeys}
              bulkActions={(rows) => (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Download className="h-3.5 w-3.5" />}
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
      </FadeIn>
    </PageContainer>
  );
}
