import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Zap, DollarSign, RefreshCw, MapPin, Receipt, TrendingUp, Gauge,
  Download, Clock, Building2,
} from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Button, Select, DataTable, PanelTitle, Caption, Text, type Column } from '@/components/ui';
import { MetricCard, MetricBar } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import {
  ChartTooltip, ChartGradient, chartGrid, axisTickSm,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, EmbeddedChart,
} from '@/components/charts';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { SearchInput, FilterBar, ActiveFilterChips, RangePicker, type FilterChipDescriptor } from '@/components/forms';
import { useFilteredList } from '@/hooks/useFilteredList';
import { useRangeState } from '@/hooks/useRangeState';
import { useUrlEnum, useUrlString } from '@/hooks/useUrlState';
import {
  useTeslaChargingHistory,
  useRefreshTeslaChargingHistory,
  getTeslaChargingInvoiceURL,
  type TeslaChargingHistoryEntry,
} from '@/api/hooks/useCharging';
import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import {
  ALL_VEHICLES_VIN,
  useVehicleVinFilter,
} from '@/hooks/useVehicleVinFilter';
import { useUnits } from '@/hooks/useUnits';
import { useSettings } from '@/hooks/useSettings';
import { useFormatting } from '@/hooks/useFormatting';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { formatCurrencyValue, currencyCodeFromSymbol } from '@/lib/currencyFormat';
import { chartTokens } from '@/lib/tokens';
import { cn } from '@/lib/cn';

/** Compute duration in minutes between two ISO timestamps. */
export function durationMinutes(start: string, stop: string | null): number | null {
  if (!stop) return null;
  const ms = new Date(stop).getTime() - new Date(start).getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 60_000) : null;
}

/** Format duration in minutes to "Xh Ym". */
export function formatDurationMinutes(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Aggregate entries by month for the spending chart. */
export function buildMonthlySpending(entries: TeslaChargingHistoryEntry[]): { month: string; total: number }[] {
  const map = new Map<string, number>();
  for (const e of entries) {
    const d = new Date(e.charge_start_datetime);
    // Skip unparseable timestamps so a malformed row can't leak a bogus
    // "NaN-NaN" bucket onto the chart's X-axis.
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    map.set(key, (map.get(key) ?? 0) + (e.total_due ?? 0));
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, total }));
}

export interface LocationRollup {
  name: string;
  total: number;
  energyWh: number;
  count: number;
}

/** Roll up entries by charging site, ranked by spend (top 6). */
export function buildTopLocations(entries: TeslaChargingHistoryEntry[]): LocationRollup[] {
  const map = new Map<string, LocationRollup>();
  for (const e of entries) {
    const name = e.site_location_name || '—';
    const cur = map.get(name) ?? { name, total: 0, energyWh: 0, count: 0 };
    cur.total += e.total_due ?? 0;
    cur.energyWh += e.usage_wh ?? 0;
    cur.count += 1;
    map.set(name, cur);
  }
  return Array.from(map.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
}

const KPI_GRID = 'grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 xl:grid-cols-6';

export default function TeslaChargingHistoryPage() {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();
  const { settings, locale } = useSettings();
  const { formatCurrency } = useFormatting();
  const userCurrency = currencyCodeFromSymbol(settings.currency_symbol);
  usePageTitle(t('tesla_charging.title', 'Tesla Charging History'));

  const { isLoading: vehiclesLoading } = useVehicles();
  const {
    queryVin,
    selectedVin,
    setSelectedVin,
    vehicles,
  } = useVehicleVinFilter();
  const historyQuery = useTeslaChargingHistory(queryVin, { enabled: !vehiclesLoading });
  const {
    data: response,
    isLoading: historyLoading,
    error,
    refetch,
  } = historyQuery;
  const isLoading = vehiclesLoading || historyLoading;
  const refreshMutation = useRefreshTeslaChargingHistory();

  const allEntries = response?.entries ?? [];
  // Range filter (client-side) on charge_start_datetime.
  const { start, end, setRange } = useRangeState({
    persistKey: 'tesla-charging-history.range',
    defaultPresetId: 'all',
  });
  const entries = useMemo(() => {
    if (!allEntries.length) return allEntries;
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return allEntries.filter((e) => {
      if (!e.charge_start_datetime) return false;
      const ts = new Date(e.charge_start_datetime).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [allEntries, start, end]);
  const summary = response?.summary ?? { total_sessions: 0, total_wh: null, total_spend: null, avg_cost_per_kwh: null };

  // Derived all-time KPIs (match the server summary's all-time scope).
  const totalDurationMin = useMemo(
    () => allEntries.reduce((s, e) => s + (durationMinutes(e.charge_start_datetime, e.charge_stop_datetime) ?? 0), 0),
    [allEntries],
  );
  const sitesVisited = useMemo(
    () => new Set(allEntries.map((e) => e.site_location_name).filter(Boolean)).size,
    [allEntries],
  );

  const vehicleOptions = useMemo(() => {
    const opts = [{
      value: ALL_VEHICLES_VIN,
      label: t('tesla_charging.allVehicles', 'All Vehicles'),
    }];
    for (const v of vehicles) {
      opts.push({ value: v.vin, label: `${v.display_name} (${v.vin.slice(-6)})` });
    }
    return opts;
  }, [vehicles, t]);

  const monthlyData = useMemo(() => buildMonthlySpending(entries), [entries]);
  const topLocations = useMemo(() => buildTopLocations(entries), [entries]);
  const topLocationsMax = topLocations.length > 0 ? topLocations[0].total : 0;

  const handleRefresh = () => {
    refreshMutation.mutate(queryVin ? { vin: queryVin } : undefined);
  };

  const columns: Column<TeslaChargingHistoryEntry>[] = useMemo(() => [
    {
      key: 'date',
      header: t('tesla_charging.col.date', 'Date'),
      render: (row) => (
        <Text variant="body">{formatDateTime(row.charge_start_datetime)}</Text>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'location',
      header: t('tesla_charging.col.location', 'Location'),
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" aria-hidden="true" />
          <Text variant="body" className="max-w-[200px] truncate">
            {row.site_location_name || '—'}
          </Text>
        </div>
      ),
      visibleOnMobile: true,
    },
    {
      key: 'duration',
      header: t('tesla_charging.col.duration', 'Duration'),
      render: (row) => (
        <Text variant="body">
          {formatDurationMinutes(durationMinutes(row.charge_start_datetime, row.charge_stop_datetime))}
        </Text>
      ),
    },
    {
      key: 'energy',
      header: t('tesla_charging.col.energy', 'Energy'),
      render: (row) => (
        <Text size="sm" weight="medium" className="text-cyan-300">
          {row.usage_wh != null ? formatEnergy(row.usage_wh, { precision: 1 }) : '—'}
        </Text>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'cost',
      header: t('tesla_charging.col.cost_decimal', 'Cost'),
      render: (row) => (
        <Text size="sm" weight="medium" className="text-emerald-300">
          {row.total_due != null
            ? formatCurrencyValue(row.total_due, row.currency_code ?? userCurrency, locale, 2, { useGrouping: true })
            : '—'}
        </Text>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'rate',
      header: t('tesla_charging.col.rate', 'Rate'),
      render: (row) => (
        <Text size="sm" color="secondary">
          {row.rate_base != null
            ? `${fmtNumber(row.rate_base, 3)}/${row.pricing_type ?? 'kWh'}`
            : '—'}
        </Text>
      ),
      defaultVisible: false,
    },
    {
      key: 'invoice',
      header: t('tesla_charging.col.invoice', 'Invoice'),
      render: (row) => (
        <Text size="sm">
          {row.has_invoice && row.invoice_content_id ? (
            <a
              href={getTeslaChargingInvoiceURL(row.invoice_content_id)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-cyan-300 transition-colors hover:underline"
              aria-label={t('tesla_charging.downloadInvoice', 'Download invoice')}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <Text size="xs">{t('charging.invoice', 'Invoice')}</Text>
            </a>
          ) : (
            <Text color="muted">—</Text>
          )}
        </Text>
      ),
    },
  ], [formatEnergy, t, userCurrency, locale]);

  const [sortKey, setSortKey] = useUrlEnum<'date' | 'energy' | 'cost'>(
    'sort',
    ['date', 'energy', 'cost'] as const,
    'date',
  );
  const [sortDir, setSortDir] = useUrlEnum<'asc' | 'desc'>('dir', ['asc', 'desc'] as const, 'desc');
  const [search, setSearch] = useUrlString('q', '');
  const [selectedKeys, setSelectedKeys] = useState<(string | number)[]>([]);

  const entrySearchFields = useMemo(
    () => ['site_location_name'] as const satisfies ReadonlyArray<keyof TeslaChargingHistoryEntry>,
    [],
  );
  const filteredEntries = useFilteredList(entries, search, entrySearchFields);

  const sortedEntries = useMemo(() => {
    const sorted = [...filteredEntries];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'date':
          cmp = a.charge_start_datetime.localeCompare(b.charge_start_datetime);
          break;
        case 'energy':
          cmp = (a.usage_wh ?? 0) - (b.usage_wh ?? 0);
          break;
        case 'cost':
          cmp = (a.total_due ?? 0) - (b.total_due ?? 0);
          break;
        default:
          cmp = a.charge_start_datetime.localeCompare(b.charge_start_datetime);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return sorted;
  }, [filteredEntries, sortKey, sortDir]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      // Cast safely — DataTable column keys map 1:1 to our allowed sort keys.
      setSortKey(key as 'date' | 'energy' | 'cost');
      setSortDir('desc');
    }
  };

  // CSV export of selected charging sessions. We pick the same fields the
  // DataTable shows so users get a self-explanatory file.
  const exportSelectedCsv = useCallback(
    (rows: TeslaChargingHistoryEntry[]) => {
      if (rows.length === 0) return;
      const header = [
        'date', 'location', 'duration_minutes', 'energy_wh',
        'cost', 'currency', 'rate_base', 'pricing_type', 'invoice_id',
      ];
      const csvLines = [header.join(',')];
      for (const r of rows) {
        const dur = durationMinutes(r.charge_start_datetime, r.charge_stop_datetime);
        const fields = [
          r.charge_start_datetime,
          (r.site_location_name ?? '').replace(/[",\n]/g, ' '),
          dur != null ? String(dur) : '',
          r.usage_wh != null ? String(r.usage_wh) : '',
          r.total_due != null ? String(r.total_due) : '',
          r.currency_code ?? '',
          r.rate_base != null ? String(r.rate_base) : '',
          r.pricing_type ?? '',
          r.invoice_content_id ?? '',
        ];
        csvLines.push(fields.map(f => `"${String(f).replace(/"/g, '""')}"`).join(','));
      }
      const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tesla-charging-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [],
  );

  const lastSyncedAt = entries[0]?.fetched_at ?? null;
  const firstLoading = isLoading && allEntries.length === 0;

  return (
    <PageContainer
      title={t('tesla_charging.title', 'Tesla Charging History')}
      subtitle={t('tesla_charging.subtitle', 'Supercharger & DC fast charging billing records from Tesla')}
      query={historyQuery}
      copyLink
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <Select
            options={vehicleOptions}
            value={selectedVin}
            onChange={(e) => setSelectedVin(e.target.value)}
            aria-label={t('tesla_charging.selectVehicle', 'Select vehicle')}
            className="w-full min-w-0 sm:w-44"
          />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="tesla-charging-history-range"
          />
          <Button
            onClick={handleRefresh}
            disabled={refreshMutation.isPending}
            variant="primary"
            icon={<RefreshCw className={cn('h-4 w-4', refreshMutation.isPending && 'animate-spin')} aria-hidden="true" />}
          >
            {refreshMutation.isPending
              ? t('tesla_charging.refreshing', 'Syncing...')
              : t('tesla_charging.refresh', 'Refresh from Tesla')}
          </Button>
        </div>
      }
    >
      {/* Last-sync line — shows when data is present so users know freshness. */}
      {lastSyncedAt && (
        <FadeIn>
          <Caption className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {t('tesla_charging.lastSync', 'Last synced')}: {formatDateTime(lastSyncedAt)}
          </Caption>
        </FadeIn>
      )}

      {/* 1 — KPI band: full-width responsive metric grid. */}
      <FadeIn>
        <section aria-label={t('tesla_charging.kpis', 'Charging summary metrics')}>
          {error ? (
            <GlassPanel className="p-4 sm:p-5">
              <QueryError error={error} onRetry={() => refetch()} />
            </GlassPanel>
          ) : firstLoading ? (
            <div className={KPI_GRID} aria-hidden="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <GlassPanel key={i} className="p-4">
                  <Skeleton height={12} width="60%" />
                  <Skeleton height={24} width="80%" className="mt-2" />
                  <Skeleton height={10} width="40%" className="mt-2" />
                </GlassPanel>
              ))}
            </div>
          ) : (
            <div className={KPI_GRID}>
              <MetricCard
                color="cyan"
                icon={<Zap className="h-5 w-5" aria-hidden="true" />}
                label={t('tesla_charging.stats.sessions', 'Total Sessions')}
                value={fmtInt(summary.total_sessions)}
              />
              <MetricCard
                color="amber"
                icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
                label={t('tesla_charging.stats.energy', 'Total Energy')}
                value={summary.total_wh != null ? formatEnergy(summary.total_wh, { precision: 1 }) : '—'}
              />
              <MetricCard
                color="green"
                icon={<DollarSign className="h-5 w-5" aria-hidden="true" />}
                label={t('tesla_charging.stats.spend', 'Total Spend')}
                value={summary.total_spend != null ? formatCurrency(summary.total_spend, 2) : '—'}
              />
              <MetricCard
                color="purple"
                icon={<TrendingUp className="h-5 w-5" aria-hidden="true" />}
                label={t('tesla_charging.stats.avgCost', 'Avg Cost/kWh')}
                value={summary.avg_cost_per_kwh != null ? formatCurrency(summary.avg_cost_per_kwh, 3) : '—'}
              />
              <MetricCard
                color="blue"
                icon={<Clock className="h-5 w-5" aria-hidden="true" />}
                label={t('tesla_charging.stats.duration', 'Total Duration')}
                value={totalDurationMin > 0 ? formatDurationMinutes(totalDurationMin) : '—'}
              />
              <MetricCard
                color="cyan"
                icon={<Building2 className="h-5 w-5" aria-hidden="true" />}
                label={t('tesla_charging.stats.sites', 'Sites Visited')}
                value={fmtInt(sitesVisited)}
              />
            </div>
          )}
        </section>
      </FadeIn>

      {/* 2 — Bento middle: hero spending chart + top-locations context panel. */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-3">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Receipt className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('tesla_charging.monthlySpending', 'Monthly Spending')}
            </PanelTitle>
            {firstLoading ? (
              <Skeleton height={288} />
            ) : error ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : monthlyData.length === 0 ? (
              <EmptyState
                icon={<Receipt className="h-10 w-10" aria-hidden="true" />}
                message={t('tesla_charging.noChartData', 'No spending data yet. Click "Refresh from Tesla" to sync.')}
              />
            ) : (
              <EmbeddedChart
                title={t('tesla_charging.monthlySpending', 'Monthly Spending')}
                ariaLabel={t('tesla_charging.monthlySpending.aria', 'Monthly Tesla charging spending bar chart')}
                data={monthlyData}
                dataColumns={[
                  { key: 'month', label: t('tesla_charging.month', 'Month') },
                  { key: 'total', label: t('tesla_charging.spending', 'Spending') },
                ]}
                fluid={false}
                mobileHeight={224}
                height={288}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData}>
                    <defs>
                      <ChartGradient id="spendGrad" color={chartTokens.series[5]} opacity={0.6} />
                    </defs>
                    {chartGrid}
                    <XAxis dataKey="month" tick={axisTickSm} />
                    <YAxis tick={axisTickSm} tickFormatter={(v: number) => formatCurrency(v, 0)} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="total" fill="url(#spendGrad)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </EmbeddedChart>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('tesla_charging.topLocations', 'Top Locations')}
            </PanelTitle>
            {firstLoading ? (
              <Skeleton height={220} />
            ) : error ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : topLocations.length === 0 ? (
              <EmptyState
                icon={<MapPin className="h-10 w-10" aria-hidden="true" />}
                message={t('tesla_charging.noLocationData', 'No charging locations in this range yet.')}
              />
            ) : (
              <div className="space-y-3">
                {topLocations.map((loc, i) => (
                  <MetricBar
                    key={loc.name}
                    label={loc.name}
                    value={loc.total}
                    max={topLocationsMax || loc.total}
                    color={chartTokens.series[i % chartTokens.series.length]}
                    sublabel={`${formatCurrency(loc.total, 2)} · ${fmtInt(loc.count)}×`}
                  />
                ))}
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Detail band: full-width sessions table with search + bulk export. */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-4">
            {t('tesla_charging.sessions', 'Charging Sessions')}
          </PanelTitle>
          {firstLoading ? (
            <Skeleton height={400} />
          ) : error ? (
            <QueryError error={error} onRetry={() => refetch()} />
          ) : entries.length === 0 ? (
            <EmptyState
              icon={<Zap className="h-10 w-10" aria-hidden="true" />}
              message={t('tesla_charging.noData', 'No Tesla charging history yet. Click "Refresh from Tesla" to import your Supercharger sessions.')}
            />
          ) : (
            <>
              <FilterBar className="mb-3">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder={t('tesla_charging.searchPlaceholder', 'Search by location…')}
                  className="w-full sm:w-72"
                  historyScope="charging"
                />
              </FilterBar>
              <ActiveFilterChips
                className="mb-3"
                filters={
                  (search
                    ? [
                        {
                          key: 'q',
                          label: t('tesla_charging.filterLabel.search', 'Search'),
                          value: search,
                          onRemove: () => setSearch(''),
                        } satisfies FilterChipDescriptor,
                      ]
                    : []) as readonly FilterChipDescriptor[]
                }
                onClearAll={() => setSearch('')}
              />
              {sortedEntries.length > 0 ? (
                <DataTable
                  columns={columns}
                  data={sortedEntries}
                  keyExtractor={(row) => row.session_id}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  pagination={{ defaultPageSize: 25, pageSizeOptions: [25, 50, 100] }}
                  tableId="tesla-charging-history"
                  columnVisibility
                  columnReorder
                  stickyHeader
                  maxHeight={600}
                  virtualized
                  rowHeight={56}
                  exportable
                  exportFilename={`tesla-charging-history-${new Date().toISOString().slice(0, 10)}`}
                  exportRow={(row) => ({
                    date: row.charge_start_datetime,
                    location: row.site_location_name ?? '',
                    duration: durationMinutes(row.charge_start_datetime, row.charge_stop_datetime) ?? null,
                    energy: row.usage_wh ?? null,
                    cost: row.total_due ?? null,
                    currency: row.currency_code ?? '',
                    rate: row.rate_base ?? null,
                    pricing_type: row.pricing_type ?? '',
                    invoice: row.invoice_content_id ?? '',
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
                  icon={<Zap className="h-10 w-10" aria-hidden="true" />}
                  message={t('tesla_charging.noMatches', 'No sessions match your search.')}
                />
              )}
            </>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
