import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Zap, DollarSign, RefreshCw,
  MapPin, Receipt, TrendingUp, Gauge, Download,
} from 'lucide-react';
import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Button, Select, DataTable, type Column } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import {
  ChartContainer, ChartTooltip, ChartGradient, chartGrid, axisTickSm,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { SearchInput, FilterBar, ActiveFilterChips, type FilterChipDescriptor } from '@/components/forms';
import { useFilteredList } from '@/hooks/useFilteredList';
import { useUrlEnum, useUrlString } from '@/hooks/useUrlState';
import {
  useTeslaChargingHistory,
  useRefreshTeslaChargingHistory,
  getTeslaChargingInvoiceURL,
  type TeslaChargingHistoryEntry,
} from '@/api/hooks/useCharging';
import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';

/** Compute duration in minutes between two ISO timestamps */
function durationMinutes(start: string, stop: string | null): number | null {
  if (!stop) return null;
  const ms = new Date(stop).getTime() - new Date(start).getTime();
  return ms > 0 ? Math.round(ms / 60_000) : null;
}

/** Format duration in minutes to "Xh Ym" */
function formatDurationMinutes(minutes: number | null): string {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Aggregate entries by month for the spending chart */
function buildMonthlySpending(entries: TeslaChargingHistoryEntry[]): { month: string; total: number }[] {
  const map = new Map<string, number>();
  for (const e of entries) {
    const d = new Date(e.charge_start_datetime);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    map.set(key, (map.get(key) ?? 0) + (e.total_due ?? 0));
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, total }));
}

const gridCols = { default: 1, sm: 2, lg: 4 } as const;

export default function TeslaChargingHistoryPage() {
  const { t } = useTranslation();
  usePageTitle(t('tesla_charging.title', 'Tesla Charging History'));

  const { data: vehicles } = useVehicles();
  // Phase 40 / Prompt 33 — VIN filter, sort, and search persist in the URL.
  const [selectedVin, setSelectedVin] = useUrlString('vin', '');
  const { data: response, isLoading, error } = useTeslaChargingHistory(selectedVin || undefined);
  const refreshMutation = useRefreshTeslaChargingHistory();

  const entries = response?.entries ?? [];
  const summary = response?.summary ?? { total_sessions: 0, total_kwh: null, total_spend: null, avg_cost_per_kwh: null };

  const vehicleOptions = useMemo(() => {
    const opts = [{ value: '', label: t('tesla_charging.allVehicles', 'All Vehicles') }];
    for (const v of vehicles ?? []) {
      opts.push({ value: v.vin, label: `${v.display_name} (${v.vin.slice(-6)})` });
    }
    return opts;
  }, [vehicles, t]);

  const monthlyData = useMemo(() => buildMonthlySpending(entries), [entries]);

  const handleRefresh = () => {
    refreshMutation.mutate(selectedVin ? { vin: selectedVin } : undefined);
  };

  const columns: Column<TeslaChargingHistoryEntry>[] = useMemo(() => [
    {
      key: 'date',
      header: t('tesla_charging.col.date', 'Date'),
      render: (row) => (
        <span className="text-sm text-[var(--text-primary)]">{formatDateTime(row.charge_start_datetime)}</span>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'location',
      header: t('tesla_charging.col.location', 'Location'),
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
      key: 'duration',
      header: t('tesla_charging.col.duration', 'Duration'),
      render: (row) => (
        <span className="text-sm text-[var(--text-primary)]">
          {formatDurationMinutes(durationMinutes(row.charge_start_datetime, row.charge_stop_datetime))}
        </span>
      ),
    },
    {
      key: 'energy',
      header: t('tesla_charging.col.energy', 'Energy (kWh)'),
      render: (row) => (
        <span className="text-sm font-medium text-cyan-400">
          {row.usage_kwh != null ? fmtNumber(row.usage_kwh, 1) : '—'}
        </span>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'cost',
      header: t('tesla_charging.col.cost', 'Cost'),
      render: (row) => (
        <span className="text-sm font-medium text-emerald-400">
          {row.total_due != null
            ? `${row.currency_code ?? '$'}${fmtNumber(row.total_due, 2)}`
            : '—'}
        </span>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'rate',
      header: t('tesla_charging.col.rate', 'Rate'),
      render: (row) => (
        <span className="text-sm text-[var(--text-secondary)]">
          {row.rate_base != null
            ? `${fmtNumber(row.rate_base, 3)}/${row.pricing_type ?? 'kWh'}`
            : '—'}
        </span>
      ),
      defaultVisible: false,
    },
    {
      key: 'invoice',
      header: t('tesla_charging.col.invoice', 'Invoice'),
      render: (row) => (
        <span className="text-sm">
          {row.has_invoice && row.invoice_content_id ? (
            <a
              href={getTeslaChargingInvoiceURL(row.invoice_content_id)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 transition-colors"
              title={t('tesla_charging.downloadInvoice', 'Download invoice')}
            >
              <Download className="h-3.5 w-3.5" />
              <span className="text-xs">{t('charging.invoice', 'Invoice')}</span>
            </a>
          ) : (
            <span className="text-[var(--text-muted)]">—</span>
          )}
        </span>
      ),
    },
  ], [t]);

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
          cmp = (a.usage_kwh ?? 0) - (b.usage_kwh ?? 0);
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
        'date', 'location', 'duration_minutes', 'energy_kwh',
        'cost', 'currency', 'rate_base', 'pricing_type', 'invoice_id',
      ];
      const csvLines = [header.join(',')];
      for (const r of rows) {
        const dur = durationMinutes(r.charge_start_datetime, r.charge_stop_datetime);
        const fields = [
          r.charge_start_datetime,
          (r.site_location_name ?? '').replace(/[",\n]/g, ' '),
          dur != null ? String(dur) : '',
          r.usage_kwh != null ? String(r.usage_kwh) : '',
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

  return (
    <PageContainer
      title={t('tesla_charging.title', 'Tesla Charging History')}
      subtitle={t('tesla_charging.subtitle', 'Supercharger & DC fast charging billing records from Tesla')}
      loading={isLoading}
      error={error as Error | null}
      copyLink
    >
      {/* Controls bar */}
      <FadeIn>
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
                ? t('tesla_charging.refreshing', 'Syncing...')
                : t('tesla_charging.refresh', 'Refresh from Tesla')}
            </Button>
            {response && entries.length > 0 && (
              <span className="ml-auto text-xs text-[var(--text-muted)]">
                {t('tesla_charging.lastSync', 'Last synced')}: {formatDateTime(entries[0]?.fetched_at)}
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
                label={t('tesla_charging.stats.sessions', 'Total Sessions')}
                value={fmtInt(summary.total_sessions)}
                icon={<Zap className="h-5 w-5 text-cyan-400" />}
                loading={isLoading}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('tesla_charging.stats.energy', 'Total Energy')}
                value={summary.total_kwh != null ? fmtNumber(summary.total_kwh, 1) : '—'}
                unit="kWh"
                icon={<Gauge className="h-5 w-5 text-yellow-400" />}
                loading={isLoading}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('tesla_charging.stats.spend', 'Total Spend')}
                value={summary.total_spend != null ? `$${fmtNumber(summary.total_spend, 2)}` : '—'}
                icon={<DollarSign className="h-5 w-5 text-emerald-400" />}
                loading={isLoading}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('tesla_charging.stats.avgCost', 'Avg Cost/kWh')}
                value={summary.avg_cost_per_kwh != null ? `$${fmtNumber(summary.avg_cost_per_kwh, 3)}` : '—'}
                icon={<TrendingUp className="h-5 w-5 text-purple-400" />}
                loading={isLoading}
              />
            </StaggerItem>
          </Grid>
        </StaggerContainer>
      </FadeIn>

      {/* Monthly spending chart */}
      <FadeIn delay={0.1}>
        <ChartContainer
          title={t('tesla_charging.monthlySpending', 'Monthly Spending')}
          ariaLabel={t('tesla_charging.monthlySpending.aria', 'Monthly Tesla charging spending bar chart')}
          data={monthlyData.map((m) => ({ month: m.month, total: m.total }))}
          dataColumns={[
            { key: 'month', label: t('tesla_charging.col.month', 'Month') },
            { key: 'total', label: t('tesla_charging.col.total', 'Total ($)') },
          ]}
          height={280}
        >
          {monthlyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthlyData}>
                <defs>
                  <ChartGradient id="spendGrad" color="#22d3ee" opacity={0.6} />
                </defs>
                {chartGrid}
                <XAxis dataKey="month" tick={axisTickSm} />
                <YAxis tick={axisTickSm} tickFormatter={(v: number) => `$${v}`} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="total" fill="url(#spendGrad)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState
              icon={<Receipt className="h-10 w-10" />}
              message={t('tesla_charging.noChartData', 'No spending data yet. Click "Refresh from Tesla" to sync.')}
            />
          )}
        </ChartContainer>
      </FadeIn>

      {/* Data table */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
            {t('tesla_charging.sessions', 'Charging Sessions')}
          </h3>
          {entries.length > 0 ? (
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
                  icon={<Zap className="h-10 w-10" />}
                  message={t('tesla_charging.noMatches', 'No sessions match your search.')}
                />
              )}
            </>
          ) : (
            <EmptyState
              icon={<Zap className="h-10 w-10" />}
              message={t('tesla_charging.noData', 'No Tesla charging history yet. Click "Refresh from Tesla" to import your Supercharger sessions.')}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
