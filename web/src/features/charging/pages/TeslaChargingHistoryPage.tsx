import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Zap, RefreshCw, MapPin, Receipt, Download, Clock,
} from 'lucide-react';
import { PageLayout, LayoutCard } from '@/components/layout';
import { Button, BUTTON_BASE, Select, DataTable, Caption, Text, Icon, type Column, type MobileDataTablePresentation } from '@/components/ui';
import { MetricBar, type StatMetric } from '@/components/data-display';
import { ChargingSummaryBrief } from '../components/operationalbrief-all/ChargingSummaryBrief';
import { FadeIn } from '@/components/motion';
import {
  ChartTooltip, chartGrid, axisTickSm,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, EmbeddedChart,
} from '@/components/charts';
import { DataStateNotice, Skeleton, EmptyState, QueryError, StaleRefreshWarning, SectionErrorBoundary, OperationalWriteNotice } from '@/components/feedback';
import { SearchInput, FilterBar, ActiveFilterChips, type FilterChipDescriptor } from '@/components/forms';
import { useFilteredList } from '@/hooks/useFilteredList';
import { SitePriceRadar } from '../components/SitePriceRadar';
import { useRangeState } from '@/hooks/useRangeState';
import { useUrlEnum, useUrlString } from '@/hooks/useUrlState';
import {
  useTeslaChargingHistory,
  useRefreshTeslaChargingHistory,
  getTeslaChargingInvoiceURL,
  type TeslaChargingHistoryEntry,
} from '@/api/hooks/useCharging';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import {
  ALL_VEHICLES_VIN,
  useVehicleVinFilter,
} from '@/hooks/useVehicleVinFilter';
import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';

import { formatCurrencyValue } from '@/lib/currencyFormat';
import { chartTokens, neonColorMap, typography } from '@/lib/tokens';
import { cn } from '@/lib/cn';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { downloadJSON } from '@/lib/csvExport';
import { fmtNumber as formatNumber } from '@/lib/numberFormat';

// Export schema is independent of displayed/hidden table columns and display units.
function chargingExportRow(row: TeslaChargingHistoryEntry) {
  return {
    date: row.charge_start_datetime,
    location: row.site_location_name ?? '',
    duration_minutes: durationMinutes(row.charge_start_datetime, row.charge_stop_datetime),
    energy_wh: recordedNumber(row.usage_wh),
    cost: recordedNumber(row.total_due),
    currency: row.currency_code ?? '',
    rate_base: recordedNumber(row.rate_base),
    pricing_type: row.pricing_type ?? '',
    invoice_id: row.invoice_content_id ?? '',
  };
}

/** Compute duration in minutes between two ISO timestamps. */
export function durationMinutes(start: string, stop: string | null): number | null {
  if (!stop) return null;
  const ms = new Date(stop).getTime() - new Date(start).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms / 60_000 : null;
}

function recordedNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sourceCurrency(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

interface RecordedAggregate {
  total: number | null;
  recordedTotal: number | null;
  missingCount: number;
}

function aggregateRecorded(values: (number | null)[]): RecordedAggregate {
  const known = values.filter((value): value is number => value !== null);
  const sum = known.reduce((total, value) => total + value, 0);
  const recordedTotal = known.length > 0 ? recordedNumber(sum) : null;
  return {
    total: known.length === values.length ? recordedTotal : null,
    recordedTotal,
    missingCount: values.length - known.length,
  };
}

/** Format duration in minutes to "Xh Ym". */
export function formatDurationMinutes(minutes: number | null, t?: TFunction, locale?: string): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = Number((minutes % 60).toFixed(2));
  const hours = formatNumber(h, 0, locale);
  const minuteDigits = String(m).split('.')[1]?.length ?? 0;
  const mins = formatNumber(m, minuteDigits, locale);
  if (h > 0) return t
    ? t('tesla_charging.durationHoursMinutes', '{{hours}}h {{minutes}}m', { hours, minutes: mins })
    : `${hours}h ${mins}m`;
  return t
    ? t('tesla_charging.durationMinutes', '{{minutes}}m', { minutes: mins })
    : `${mins}m`;
}

/** Keep monthly evidence in its source denomination; unknown is never a preferred currency. */
export function buildMonthlySpending(entries: TeslaChargingHistoryEntry[]): (RecordedAggregate & { month: string; currency: string | null; count: number })[] {
  const map = new Map<string, { month: string; currency: string | null; values: (number | null)[] }>();
  for (const e of entries) {
    const d = new Date(e.charge_start_datetime);
    // Skip unparseable timestamps so a malformed row can't leak a bogus
    // "NaN-NaN" bucket onto the chart's X-axis.
    if (Number.isNaN(d.getTime())) continue;
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const currency = sourceCurrency(e.currency_code);
    const key = JSON.stringify([month, currency]);
    const bucket = map.get(key) ?? { month, currency, values: [] };
    bucket.values.push(recordedNumber(e.total_due));
    map.set(key, bucket);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { month, currency, values }]) => ({ month, currency, count: values.length, ...aggregateRecorded(values) }));
}

export interface LocationRollup {
  name: string;
  currency: string | null;
  total: number | null;
  recordedTotal: number | null;
  missingCount: number;
  energyWh: number | null;
  recordedEnergyWh: number | null;
  missingEnergyCount: number;
  count: number;
}

/** Rank source-denominated spending within each denomination, never across currencies. */
export function buildTopLocations(entries: TeslaChargingHistoryEntry[]): LocationRollup[] {
  const map = new Map<string, TeslaChargingHistoryEntry[]>();
  for (const e of entries) {
    const name = e.site_location_name || '—';
    const key = JSON.stringify([name, sourceCurrency(e.currency_code)]);
    const rows = map.get(key) ?? [];
    rows.push(e);
    map.set(key, rows);
  }
  return Array.from(map, ([, rows]) => {
    const name = rows[0].site_location_name || '—';
    const currency = sourceCurrency(rows[0].currency_code);
    const spending = aggregateRecorded(rows.map(row => recordedNumber(row.total_due)));
    const energy = aggregateRecorded(rows.map(row => recordedNumber(row.usage_wh)));
    return { name, currency, ...spending, energyWh: energy.total, recordedEnergyWh: energy.recordedTotal,
      missingEnergyCount: energy.missingCount, count: rows.length };
  })
    .sort((a, b) => (a.currency ?? '').localeCompare(b.currency ?? '')
      || (a.recordedTotal === null ? (b.recordedTotal === null ? 0 : 1)
        : b.recordedTotal === null ? -1 : b.recordedTotal - a.recordedTotal));
}

export default function TeslaChargingHistoryPage() {
  const { formatDateTime } = useDateFormat();
  const { fmtNumber, fmtInt, precision, locale } = useNumberFormatting();
  const { t } = useTranslation();
  const formatChargingDuration = useCallback(
    (minutes: number | null) => formatDurationMinutes(minutes, t, locale),
    [t, locale],
  );
  const { canWrite, writeBlockReason } = useOperationalMode();
  const { formatEnergy } = useUnits();
  const formatSourceAmount = useCallback((amount: number | null, currency: string | null) => {
    if (amount === null) return '—';
    return currency === null
      ? `${fmtNumber(amount)} · —`
      : formatCurrencyValue(amount, currency, locale, precision, { useGrouping: true });
  }, [fmtNumber, locale, precision]);
  usePageTitle(t('tesla_charging.title', 'Tesla charging history'));

  const {
    queryVin,
    allVehicles,
    scopeReady,
    isResolving: vehiclesLoading,
    vehiclesState,
    selectedVin,
    setSelectedVin,
    vehicles,
  } = useVehicleVinFilter();
  const scopeEnabled = scopeReady && (allVehicles || !vehiclesState.isRefreshBlocked);
  const historyQuery = useTeslaChargingHistory(queryVin, { enabled: scopeEnabled });
  const {
    isLoading: historyLoading,
    refetch,
  } = historyQuery;
  const response = scopeReady ? historyQuery.data : undefined;
  const historyState = useDataState(scopeReady ? historyQuery : {}, { provenance: 'historical' });
  const error = historyState.fatalError;
  const isLoading = (!scopeReady && vehiclesLoading) || (scopeEnabled && historyLoading);
  const refreshMutation = useRefreshTeslaChargingHistory();

  const allEntries = useMemo(() => response?.entries ?? [], [response?.entries]);
  // The read hook still lacks server bounds; retain its lifetime summary
  // while using the workspace's precise window for the loaded-record view.
  const { startInstant, endInstantExclusive, setPreset } = useRangeState({
    persistKey: 'tesla-charging-history.range',
    defaultPresetId: 'all',
  });
  const entries = useMemo(() => {
    if (!allEntries.length) return allEntries;
    const startMs = new Date(startInstant).getTime();
    const endMs = new Date(endInstantExclusive).getTime();
    return allEntries.filter((e) => {
      if (!e.charge_start_datetime) return false;
      const ts = new Date(e.charge_start_datetime).getTime();
      return ts >= startMs && ts < endMs;
    });
  }, [allEntries, startInstant, endInstantExclusive]);
  const summary = response?.summary ?? { total_sessions: 0, total_wh: null, total_spend: null, avg_cost_per_kwh: null };

  // Derived all-time KPIs (match the server summary's all-time scope).
  const durationAggregate = useMemo(
    () => aggregateRecorded(allEntries.map(e => durationMinutes(e.charge_start_datetime, e.charge_stop_datetime))),
    [allEntries],
  );
  const sitesVisited = useMemo(
    () => new Set(allEntries.map((e) => e.site_location_name).filter(Boolean)).size,
    [allEntries],
  );

  const vehicleOptions = useMemo(() => {
    const opts = [{
      value: ALL_VEHICLES_VIN,
      label: t('tesla_charging.allVehicles', 'All vehicles'),
    }];
    for (const v of vehicles) {
      opts.push({ value: v.vin, label: `${v.display_name} (${v.vin.slice(-6)})` });
    }
    return opts;
  }, [vehicles, t]);

  const monthlyData = useMemo(() => buildMonthlySpending(entries).map(bucket => ({
    ...bucket, label: `${bucket.month} · ${bucket.currency ?? '—'}`,
  })), [entries]);
  const spendingEvidence = useMemo(() => buildTopLocations(allEntries), [allEntries]);
  const topLocations = useMemo(() => buildTopLocations(entries), [entries]);

  const handleRefresh = () => {
    if (!canWrite || !scopeEnabled || historyState.isRefreshBlocked || refreshMutation.isPending) return;
    refreshMutation.mutate(queryVin ? { vin: queryVin } : undefined);
  };

  const columns: Column<TeslaChargingHistoryEntry>[] = useMemo(() => [
    {
      key: 'date',
      filterValue: (row) => row.charge_start_datetime ?? null,
      filterValueLabel: (_, row) => formatDateTime(row.charge_start_datetime),
      header: t('tesla_charging.col.date', 'Date'),
      render: (row) => (
        <Text variant="body">{formatDateTime(row.charge_start_datetime)}</Text>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'location',
      filterValue: (row) => row.site_location_name || null,
      header: t('tesla_charging.col.location', 'Location'),
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <Icon icon={MapPin} size="sm" className={typography.color.muted} />
          <Text variant="body" className="min-w-0 break-words">
            {row.site_location_name || '—'}
          </Text>
        </div>
      ),
      visibleOnMobile: true,
    },
    {
      key: 'duration',
      align: 'right',
      header: t('tesla_charging.col.duration', 'Duration'),
      render: (row) => (
        <Text variant="body">
          {formatChargingDuration(durationMinutes(row.charge_start_datetime, row.charge_stop_datetime))}
        </Text>
      ),
    },
    {
      key: 'energy',
      align: 'right',
      filterValue: (row) => recordedNumber(row.usage_wh),
      filterValueLabel: (_, row) => recordedNumber(row.usage_wh) != null ? formatEnergy(row.usage_wh!) : '—',
      header: t('tesla_charging.col.energy', 'Energy'),
      render: (row) => (
        <Text variant="body" className="tabular-nums">
          {recordedNumber(row.usage_wh) != null ? formatEnergy(row.usage_wh!) : '—'}
        </Text>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'cost',
      align: 'right',
      filterValue: (row) => recordedNumber(row.total_due) == null ? null : JSON.stringify([sourceCurrency(row.currency_code), row.total_due]),
      filterValueLabel: (_, row) => formatSourceAmount(recordedNumber(row.total_due), sourceCurrency(row.currency_code)),
      header: t('tesla_charging.col.cost_decimal', 'Cost'),
      render: (row) => (
        <Text variant="body" className="tabular-nums">
          {formatSourceAmount(recordedNumber(row.total_due), sourceCurrency(row.currency_code))}
        </Text>
      ),
      sortable: true,
      visibleOnMobile: true,
    },
    {
      key: 'rate',
      align: 'right',
      header: t('tesla_charging.col.rate', 'Rate'),
      render: (row) => (
        <Text size="sm" color="secondary">
          {recordedNumber(row.rate_base) != null
            ? `${fmtNumber(row.rate_base!)}/${row.pricing_type ?? 'kWh'}`
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
              className={cn(BUTTON_BASE, 'min-h-11 min-w-11 px-2 hover:underline', neonColorMap.cyan.text)}
              aria-label={t('tesla_charging.downloadInvoice', 'Download invoice')}
            >
              <Icon icon={Download} size="sm" />
              <Text as="span" variant="bodySm" className="text-inherit">{t('charging.invoice', 'Invoice')}</Text>
            </a>
          ) : (
            <Text color="muted">—</Text>
          )}
        </Text>
      ),
    },
  ], [formatDateTime, formatEnergy, t, formatSourceAmount, fmtNumber, formatChargingDuration]);

  const mobilePresentation = useMemo<MobileDataTablePresentation<TeslaChargingHistoryEntry>>(() => ({
    roles: { location: 'title', cost: 'primary', date: 'meta', energy: 'meta', duration: 'meta' },
    displayValue: (row, key) => {
      switch (key) {
        case 'location': return row.site_location_name || '—';
        case 'date': return formatDateTime(row.charge_start_datetime);
        case 'duration': return formatChargingDuration(durationMinutes(row.charge_start_datetime, row.charge_stop_datetime));
        case 'energy': return recordedNumber(row.usage_wh) == null ? null : formatEnergy(row.usage_wh!);
        case 'cost': return recordedNumber(row.total_due) == null ? null : formatSourceAmount(recordedNumber(row.total_due), sourceCurrency(row.currency_code));
        case 'rate': return recordedNumber(row.rate_base) == null ? null : `${fmtNumber(row.rate_base!)}/${row.pricing_type ?? 'kWh'}`;
        default: return null;
      }
    },
  }), [formatDateTime, formatEnergy, formatSourceAmount, fmtNumber, formatChargingDuration]);

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
      if (sortKey !== 'date') {
        if (sortKey === 'cost') {
          const currencyOrder = (sourceCurrency(a.currency_code) ?? '').localeCompare(sourceCurrency(b.currency_code) ?? '');
          if (currencyOrder !== 0) return currencyOrder;
        }
        const left = recordedNumber(sortKey === 'energy' ? a.usage_wh : a.total_due);
        const right = recordedNumber(sortKey === 'energy' ? b.usage_wh : b.total_due);
        if (left === null) return right === null ? 0 : 1;
        if (right === null) return -1;
        return sortDir === 'desc' ? right - left : left - right;
      }
      let cmp = 0;
      switch (sortKey) {
        case 'date':
          cmp = a.charge_start_datetime.localeCompare(b.charge_start_datetime);
          break;
        default:
          cmp = a.charge_start_datetime.localeCompare(b.charge_start_datetime);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return sorted;
  }, [filteredEntries, sortKey, sortDir]);

  const handleSort = (key: string) => {
    if (key !== 'date' && key !== 'energy' && key !== 'cost') return;
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const exportSelectedCsv = useCallback(
    (rows: readonly TeslaChargingHistoryEntry[], filename = `tesla-charging-${new Date().toISOString().slice(0, 10)}.csv`) => {
      if (rows.length === 0) return;
      const mappedRows = rows.map(chargingExportRow);
      const header = Object.keys(mappedRows[0]);
      const csvLines = [header.join(',')];
      for (const row of mappedRows) {
        csvLines.push(Object.values(row).map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','));
      }
      const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    [],
  );

  const lastSyncedAt = entries[0]?.fetched_at ?? null;
  const firstLoading = isLoading && !historyState.hasData;
  const unavailableMessage = t('tesla_charging.sourceUnavailable', 'Tesla charging history has not loaded. Retry this source or reconnect to continue.');
  const prerequisiteMessage = vehiclesState.isRefreshBlocked
    ? t('dataSources.status.paused', 'Refresh paused')
    : t('tesla_charging.selectVehicle', 'Select vehicle');
  const lifetimeEmpty = scopeEnabled && historyState.status === 'ok'
    && Array.isArray(response?.entries)
    && allEntries.length === 0 && response?.summary?.total_sessions === 0;
  const rangeEmpty = allEntries.length > 0 && entries.length === 0;
  const emptyMessage = !scopeEnabled
    ? prerequisiteMessage
    : lifetimeEmpty
    ? t('charging.list.empty', 'No charging sessions yet')
    : rangeEmpty
      ? t('charging.curve.modernization.noSessionsTitle', 'No sessions in this range')
      : unavailableMessage;
  const scopeRecovery = !scopeEnabled
    ? vehiclesState.retry && !vehiclesState.isRefreshBlocked
      ? { label: t('common.retry', 'Retry'), onClick: vehiclesState.retry }
      : undefined
    : rangeEmpty
    ? { label: t('common.allTime', 'All time'), onClick: () => setPreset('all') }
    : lifetimeEmpty && queryVin
      ? { label: t('tesla_charging.allVehicles', 'All vehicles'), onClick: () => setSelectedVin(ALL_VEHICLES_VIN) }
      : !lifetimeEmpty
        ? { label: t('common.retry', 'Retry'), onClick: () => { void refetch(); } }
        : undefined;
  const summaryMetrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'sessions', label: t('tesla_charging.stats.sessions', 'Total sessions'),
      rawValue: response?.summary?.total_sessions ?? null,
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
    { metricId: 'energy', occurrenceId: 'energy', label: t('tesla_charging.stats.energy', 'Total energy'),
      rawValue: summary.total_wh,
      display: { formatter: raw => ({ value: formatEnergy(raw), unit: '' }) } },
    { metricId: 'currency', occurrenceId: 'spend', label: t('tesla_charging.stats.spend', 'Total spend'),
      rawValue: summary.total_spend,
      context: spendingEvidence.map(loc => `${loc.name} · ${loc.currency ?? '—'}: ${t('tesla_charging.partialSubtotal',
        'Recorded subtotal: {{subtotal}} · {{missing}} missing · {{sessions}}×', {
          subtotal: formatSourceAmount(loc.recordedTotal, loc.currency), missing: loc.missingCount, count: loc.count,
        })}`).join('; '),
      display: { formatter: raw => ({ value: formatSourceAmount(raw, null), unit: '' }) } },
    { metricId: 'currency', occurrenceId: 'average-cost', label: t('tesla_charging.stats.avgCost', 'Avg cost/kWh'),
      rawValue: summary.avg_cost_per_kwh,
      display: { formatter: raw => ({ value: formatSourceAmount(raw, null), unit: '' }) } },
    { metricId: 'duration', occurrenceId: 'duration', label: t('tesla_charging.stats.duration', 'Total duration'),
      rawValue: durationAggregate.total == null ? null : durationAggregate.total * 60,
      context: durationAggregate.missingCount > 0 ? t('tesla_charging.recordedDuration',
        'Recorded subtotal: {{subtotal}} · {{missing}} missing', {
          subtotal: formatChargingDuration(durationAggregate.recordedTotal), missing: durationAggregate.missingCount,
        }) : undefined,
      display: { formatter: raw => ({ value: formatChargingDuration(raw / 60), unit: '' }) } },
    { metricId: 'count', occurrenceId: 'sites', label: t('tesla_charging.stats.sites', 'Sites visited'),
      rawValue: historyState.hasData ? sitesVisited : null,
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
  ];

  return (
    <PageLayout
      title={t('tesla_charging.title', 'Tesla charging history')}
      subtitle={t('tesla_charging.subtitle', 'Supercharger & DC fast charging billing records from Tesla')}
      query={scopeReady ? historyQuery : undefined}
      copyLink
      contextActions={
        <Select
          options={vehicleOptions}
          value={selectedVin}
          onChange={(e) => setSelectedVin(e.target.value)}
          aria-label={t('tesla_charging.selectVehicle', 'Select vehicle')}
          className="w-full min-w-0 sm:w-44"
        />
      }
      primaryAction={
        <Button
          wrapLabel
          onClick={handleRefresh}
          disabled={!canWrite || !scopeEnabled || refreshMutation.isPending || historyState.isRefreshBlocked}
          title={writeBlockReason ?? undefined}
          aria-busy={refreshMutation.isPending || undefined}
          className="min-h-11 md:min-h-10"
          variant="primary"
          icon={<Icon icon={RefreshCw} className={refreshMutation.isPending ? 'animate-spin motion-reduce:animate-none' : undefined} />}
        >
          {refreshMutation.isPending
            ? t('tesla_charging.refreshing', 'Syncing...')
            : t('tesla_charging.refresh', 'Refresh from Tesla')}
        </Button>
      }
    >
      <OperationalWriteNotice />
      <StaleRefreshWarning state={vehiclesState} label={t('tesla_charging.selectVehicle', 'Select vehicle')} />
      {vehiclesState.fatalError ? (
        <QueryError error={vehiclesState.fatalError} onRetry={vehiclesState.retry ?? undefined} />
      ) : !scopeReady ? (
        vehiclesLoading ? (
          <Text role="status">{t('dataSources.status.loading', 'Loading')}</Text>
        ) : (
          <DataStateNotice state="unavailable" title={t('tesla_charging.selectVehicle', 'Select vehicle')} role="status">
            {prerequisiteMessage}
          </DataStateNotice>
        )
      ) : null}
      <StaleRefreshWarning state={historyState} label={t('tesla_charging.title', 'Tesla charging history')} />
      {!historyState.hasData && historyState.isRefreshBlocked ? (
        <DataStateNotice state="unavailable" title={t('tesla_charging.title', 'Tesla charging history')} role="status">
          {unavailableMessage}
        </DataStateNotice>
      ) : null}
      {/* Last-sync line — shows when data is present so users know freshness. */}
      {lastSyncedAt && (
        <FadeIn>
          <Caption className="flex items-center gap-1.5">
            <Icon icon={Clock} size="sm" />
            {t('tesla_charging.lastSync', 'Last synced')}: {formatDateTime(lastSyncedAt)}
          </Caption>
        </FadeIn>
      )}

      {/* 1 — KPI band: full-width responsive metric grid. */}
      <FadeIn>
        <section aria-label={t('tesla_charging.kpis', 'Charging summary metrics')}>
          <SectionErrorBoundary name="tesla-charging-history-summary">
          <ChargingSummaryBrief id="tesla-charging-history-summary" metrics={summaryMetrics}
            loading={firstLoading} retained={historyState.hasData && (historyState.refreshError != null || historyState.isRefreshBlocked)}
            period={{
              kind: 'unknown', label: t('tesla_charging.kpis', 'Charging summary metrics'),
              reason: t('tesla_charging.summaryScope', 'Tesla lifetime summary; duration and sites use all loaded records. The analysis window filters charts and the session table separately.'),
            }}
            footer={error ? <QueryError error={error} onRetry={() => refetch()} /> : undefined}
          />
          </SectionErrorBoundary>
        </section>
      </FadeIn>

      {/* Keep the sessions beside Price Radar on wide screens so its height
          does not leave an empty two-column row beneath the spending chart. */}
      <section className="grid min-w-0 grid-cols-1 gap-3 sm:gap-4 2xl:grid-cols-3 2xl:items-start">
        <FadeIn delay={0.1} className="min-w-0 2xl:col-span-2">
          <SectionErrorBoundary name="tesla-charging-history-spending">
          <LayoutCard title={t('tesla_charging.monthlySpending', 'Monthly spending')}
            actions={<Icon icon={Receipt} className={typography.color.muted} />}>
            {firstLoading ? (
              <Skeleton height={288} />
            ) : error ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : monthlyData.length === 0 ? (
              <EmptyState
                icon={<Icon icon={Receipt} size="xl" />}
                message={emptyMessage}
                action={scopeRecovery}
                variant={!scopeRecovery ? 'informational' : undefined}
                description={!scopeRecovery ? t('tesla_charging.sessionsAppear', 'Sessions appear after Tesla charging history syncs; a selected date range can also exclude older sessions.') : undefined}
              />
            ) : (
              <>
              {monthlyData.map(month => (
                <Caption key={month.label}>
                  {month.label}: {t('tesla_charging.partialSubtotal', 'Recorded subtotal: {{subtotal}} · {{missing}} missing · {{sessions}}×', {
                    subtotal: formatSourceAmount(month.recordedTotal, month.currency),
                    missing: month.missingCount,
                    count: month.count,
                  })}
                </Caption>
              ))}
              <EmbeddedChart
                title={t('tesla_charging.monthlySpending', 'Monthly spending')}
                ariaLabel={t('tesla_charging.monthlySpendingAria', 'Monthly Tesla charging spending bar chart')}
                data={monthlyData}
                exportData={monthlyData}
                exportable
                fullscreen
                dataColumns={[
                  { key: 'month', label: t('tesla_charging.month', 'Month') },
                  { key: 'currency', label: t('charging.detail.currency', 'Currency') },
                  { key: 'total', label: t('tesla_charging.spending', 'Spending') },
                  { key: 'recordedTotal', label: t('tesla_charging.recordedSubtotal', 'Recorded subtotal') },
                  { key: 'missingCount', label: t('tesla_charging.missingCount', 'Missing count') },
                ]}
                fluid={false}
                mobileHeight={224}
                height={288}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData}>
                    {chartGrid}
                    <XAxis dataKey="label" tick={axisTickSm} />
                    <YAxis tick={axisTickSm} tickFormatter={(v: number) => fmtNumber(v)} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar name={t('tesla_charging.recordedSubtotal', 'Recorded subtotal')} dataKey="recordedTotal" fill={chartTokens.series[0]} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </EmbeddedChart>
              </>
            )}
          </LayoutCard>
          </SectionErrorBoundary>
        </FadeIn>
        <FadeIn delay={0.1} className="min-w-0 2xl:col-start-3 2xl:row-start-1">
          <SectionErrorBoundary name="tesla-charging-history-locations">
          <LayoutCard title={t('tesla_charging.topLocations', 'Top locations')}
            actions={<Icon icon={MapPin} className={typography.color.muted} />}>
            {firstLoading ? (
              <Skeleton height={220} />
            ) : error ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : topLocations.length === 0 ? (
              <EmptyState
                icon={<Icon icon={MapPin} size="xl" />}
                message={emptyMessage}
                action={scopeRecovery}
                variant={!scopeRecovery ? 'informational' : undefined}
                description={!scopeRecovery ? t('tesla_charging.locationsAppear', 'Charging locations appear when synced sessions include location evidence.') : undefined}
              />
            ) : (
              <div className="space-y-3">
                {topLocations.map((loc) => (
                  <div key={JSON.stringify([loc.name, loc.currency])}>
                  {loc.recordedTotal != null && loc.recordedTotal < 0 ? (
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <Text size="sm" color="secondary">{loc.name}</Text>
                      <Text mono size="sm">
                        {formatSourceAmount(loc.recordedTotal, loc.currency)} · {fmtInt(loc.count)}×
                      </Text>
                    </div>
                  ) : (
                  <MetricBar
                    label={loc.name}
                    value={loc.recordedTotal}
                    max={Math.max(0, ...topLocations.filter(other => other.currency === loc.currency).map(other => other.recordedTotal ?? 0))}
                    color={chartTokens.series[0]}
                    fill="solid"
                    sublabel={loc.missingCount > 0
                      ? t('tesla_charging.partialSubtotal', 'Recorded subtotal: {{subtotal}} · {{missing}} missing · {{sessions}}×', {
                        subtotal: formatSourceAmount(loc.recordedTotal, loc.currency),
                        missing: loc.missingCount, sessions: fmtInt(loc.count),
                      })
                      : `${formatSourceAmount(loc.total, loc.currency)} · ${fmtInt(loc.count)}×`}
                  />
                  )}
                  {loc.recordedTotal != null && loc.recordedTotal < 0 && loc.missingCount > 0 && (
                    <Caption>{t('tesla_charging.partialSubtotal', 'Recorded subtotal: {{subtotal}} · {{missing}} missing · {{sessions}}×', {
                      subtotal: formatSourceAmount(loc.recordedTotal, loc.currency), missing: loc.missingCount, sessions: fmtInt(loc.count),
                    })}</Caption>
                  )}
                  {loc.missingEnergyCount > 0 && (
                    <Caption>
                      {t('tesla_charging.col.energy', 'Energy')}: {t('tesla_charging.partialSubtotal', 'Recorded subtotal: {{subtotal}} · {{missing}} missing · {{sessions}}×', {
                        subtotal: loc.recordedEnergyWh == null ? '—' : formatEnergy(loc.recordedEnergyWh),
                        missing: loc.missingEnergyCount, sessions: fmtInt(loc.count),
                      })}
                    </Caption>
                  )}
                  </div>
                ))}
              </div>
            )}
          </LayoutCard>
          </SectionErrorBoundary>
        </FadeIn>

        <FadeIn delay={0.12} className="min-w-0 2xl:col-start-3 2xl:row-start-2">
          <SectionErrorBoundary name="tesla-charging-history-price-radar">
          {scopeReady ? (
            <SitePriceRadar vin={queryVin} enabled={scopeEnabled} />
          ) : (
            <LayoutCard title={t('tesla_charging.priceRadar', 'Price Radar')}>
              {firstLoading ? <Skeleton height={220} /> : <EmptyState message={prerequisiteMessage} action={scopeRecovery}
                variant={!scopeRecovery ? 'informational' : undefined}
                description={!scopeRecovery ? t('tesla_charging.selectVehicleHelp', 'Choose a vehicle or wait for fleet sync to finish before the price radar can load.') : undefined} />}
            </LayoutCard>
          )}
          </SectionErrorBoundary>
        </FadeIn>

      {/* Sessions use the space below the chart at wide widths. */}
      <FadeIn delay={0.15} className="min-w-0 2xl:col-span-2 2xl:row-start-2">
        <SectionErrorBoundary name="tesla-charging-history-sessions">
        <LayoutCard title={t('tesla_charging.sessions', 'Charging sessions')}>
          {firstLoading ? (
            <Skeleton height={400} />
          ) : error ? (
            <QueryError error={error} onRetry={() => refetch()} />
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
                    : [])
                }
                onClearAll={() => setSearch('')}
              />
              {sortedEntries.length > 0 ? (
                <DataTable
                  enableValueFilters
                  columns={columns}
                  name={t('tesla_charging.sessions', 'Charging sessions')}
                  mobilePresentation={mobilePresentation}
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
                  onExport={(format, rows) => {
                    const filename = `tesla-charging-history-${new Date().toISOString().slice(0, 10)}`;
                    if (format === 'csv') exportSelectedCsv(rows, `${filename}.csv`);
                    else downloadJSON(filename, rows.map(chargingExportRow));
                  }}
                  selectable="multi"
                  // A11Y: the first column is a bare date, which many
                  // rows share. Pair it with the site so each checkbox
                  // names the session it toggles.
                  rowLabel={(row) =>
                    t('tesla_charging.rowLabel', '{{site}}, {{date}}', {
                      site:
                        row.site_location_name ||
                        t('tesla_charging.unknownSite', 'Unknown site'),
                      date: formatDateTime(row.charge_start_datetime),
                    })
                  }
                  selectedKeys={selectedKeys}
                  onSelectionChange={setSelectedKeys}
                  bulkActions={(rows) => (
                    <Button
                      size="sm"
                      wrapLabel
                      className="min-h-11 md:min-h-9"
                      variant="secondary"
                      icon={<Icon icon={Download} size="sm" />}
                      onClick={() => exportSelectedCsv(rows)}
                    >
                      {t('table.bulkActions.exportCsv', 'Export CSV')}
                    </Button>
                  )}
                />
              ) : (
                <EmptyState
                  icon={<Icon icon={Zap} size="xl" />}
                  message={entries.length > 0
                    ? t('tesla_charging.noMatches', 'No sessions match your search.')
                    : emptyMessage}
                  action={entries.length > 0
                    ? { label: t('common.clearSearch', 'Clear search'), onClick: () => setSearch('') }
                    : scopeRecovery}
                />
              )}
            </>
          )}
        </LayoutCard>
        </SectionErrorBoundary>
      </FadeIn>
      </section>
    </PageLayout>
  );
}
