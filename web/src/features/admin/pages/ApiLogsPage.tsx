import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  FileText, Clock, AlertTriangle, Activity,
  Search, Filter, Layers, ChevronDown, ChevronUp, X,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel, Button, Select, Input, Badge, Pagination,
  PanelTitle, Label, Caption, Text, CopyButton,
} from '@/components/ui';
import { StatCard, DateTime } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { ListExportMenu, RangePicker } from '@/components/forms';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useUrlNumber, useUrlString, useUrlBatch } from '@/hooks/useUrlState';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { exportAsCSV, exportAsJSON } from '@/lib/export';
import { getAPICallLogs, getAPICallLogStats } from '@/api/devtools';
import type { APICallLog, APICallLogStats } from '@/api/types';
import { deriveServiceOptions } from '../lib/serviceOptions';

/* ------------------------------------------------------------------ */
/*  Local helpers                                                      */
/* ------------------------------------------------------------------ */

type LogBadgeVariant = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

const METHOD_VARIANTS: Record<string, LogBadgeVariant> = {
  GET: 'success',
  POST: 'info',
  PUT: 'warning',
  PATCH: 'warning',
  DELETE: 'danger',
};

const SERVICE_CONFIG: Record<string, { label: string; variant: LogBadgeVariant }> = {
  'teslasync-api':      { label: 'TeslaSync API',      variant: 'info'    },
  'tesla-api':          { label: 'Tesla API',          variant: 'info'    },
  'tesla-auth':         { label: 'Tesla Auth',         variant: 'info'    },
  'geocoder-google':    { label: 'Geocoder (Google)',  variant: 'warning' },
  'geocoder-nominatim': { label: 'Geocoder (Nominatim)', variant: 'warning' },
  'geocoder-azure':     { label: 'Geocoder (Azure)',   variant: 'warning' },
  'geocoder-search':    { label: 'Geocoder (Search)',  variant: 'warning' },
  'github-releases':    { label: 'GitHub Releases',    variant: 'neutral' },
  'notify-generic':     { label: 'Notifications',      variant: 'neutral' },
  'system-dns-check':   { label: 'DNS Health Check',   variant: 'neutral' },
  'eia':                { label: 'EIA',                variant: 'neutral' },
};

/** Static catalog of services the frontend knows the backend can write.
 *  Stable identity → safe to pass to deriveServiceOptions / useMemo deps. */
const KNOWN_SERVICES = Object.freeze(Object.keys(SERVICE_CONFIG));

function statusBadgeVariant(code: number | null): LogBadgeVariant {
  if (!code) return 'neutral';
  if (code < 300) return 'success';
  if (code < 400) return 'info';
  if (code < 500) return 'warning';
  return 'danger';
}

function serviceBadgeConfig(service: string): { label: string; variant: LogBadgeVariant } {
  return SERVICE_CONFIG[service] ?? { label: service, variant: 'neutral' };
}

/** Pretty-prints a JSON payload inside a scrollable code surface, with a
 *  copy affordance. Falls back to the raw string when the body isn't JSON. */
function JsonViewer({ data, label }: { data: string | null; label: string }) {
  const { t } = useTranslation();

  if (!data) {
    return (
      <div className="space-y-1">
        <Label>{label}</Label>
        <Text as="p" variant="caption" className="italic">
          {t('apiLogs.noData', { label: label.toLowerCase(), defaultValue: `No ${label.toLowerCase()}` })}
        </Text>
      </div>
    );
  }

  let formatted = data;
  try { formatted = JSON.stringify(JSON.parse(data), null, 2); } catch { /* leave raw */ }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <CopyButton
          text={formatted}
          iconOnly
          size="sm"
          ariaLabel={t('apiLogs.copyBody', 'Copy {{label}}', { label })}
        />
      </div>
      <GlassPanel className={cn('max-h-60 overflow-x-auto whitespace-pre-wrap break-all !p-3', typography.role.code)}>
        {formatted}
      </GlassPanel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ApiLogsPage() {
  const { t } = useTranslation();
  usePageTitle(t('apiLogs.title', 'API Logs'));

  const [page, setPage] = useUrlNumber('page', 0);
  const [method] = useUrlString('method', '');
  const [status] = useUrlString('status', '');
  const [endpoint] = useUrlString('endpoint', '');
  const [service] = useUrlString('service', '');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const limit = 25;

  // Unified date range — no hardcoded windows. Picker drives the
  // `from`/`to` URL params; absence of bounds = full history.
  const { start, end, setRange } = useRangeState({
    persistKey: 'api-logs.range',
    defaultPresetId: 'all',
  });

  // Multi-key URL writer — react-router-dom v6's setSearchParams uses a
  // ref that doesn't refresh between two synchronous calls, so chaining
  // setFilter(...) + setPage(0) silently drops the first write. Every
  // filter change (method, status, endpoint, service, from, to, etc.)
  // resets `page` AND writes its own key, so all of them MUST go through
  // useUrlBatch. See useUrlState.ts §useUrlBatch JSDoc.
  const setUrl = useUrlBatch();

  type FilterKey = 'method' | 'status' | 'endpoint' | 'service';
  const setFilter = useCallback(
    (key: FilterKey, value: string) => {
      setUrl({ [key]: value, page: '' });
    },
    [setUrl],
  );

  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
    refetch: refetchStats,
  } = useQuery<APICallLogStats>({
    queryKey: ['api-log-stats'],
    queryFn: getAPICallLogStats,
    refetchInterval: 30_000,
  });

  const logsQuery = useQuery({
    queryKey: ['api-logs', page, method, status, endpoint, service, start, end],
    queryFn: () => getAPICallLogs({
      limit,
      offset: page * limit,
      method: method || undefined,
      status: status || undefined,
      endpoint: endpoint || undefined,
      service: service || undefined,
      // RangePicker emits `YYYY-MM-DD`; backend stores ts as UTC timestamptz.
      // Send local-day boundaries so the comparison window matches the user's
      // picked dates (start of day .. end of day in their local zone).
      start: start ? new Date(`${start}T00:00:00`).toISOString() : undefined,
      end: end ? new Date(`${end}T23:59:59.999`).toISOString() : undefined,
    }),
    refetchInterval: 10_000,
  });
  const { data, isLoading: logsLoading, error: logsError, refetch: refetchLogs } = logsQuery;

  const logs = data?.data ?? [];
  const total = data?.total ?? 0;
  const hasFilters = !!(method || status || endpoint || service);

  const clearFilters = useCallback(() => {
    setUrl({ method: '', status: '', endpoint: '', service: '', page: '' });
  }, [setUrl]);

  const selectService = useCallback(
    (svc: string) => setFilter('service', svc),
    [setFilter],
  );

  const serviceOptions = useMemo(
    () =>
      deriveServiceOptions({
        byService: stats?.by_service,
        activeService: service,
        labelFor: (svc) => serviceBadgeConfig(svc).label,
        allLabel: t('apiLogs.allServices', 'All Services'),
        knownServices: KNOWN_SERVICES,
      }),
    [stats?.by_service, service, t],
  );

  // Busiest-first list for the "By Service" rail — quick-pick filter chips
  // that also surface per-service call counts.
  const serviceRows = useMemo(
    () =>
      Object.entries(stats?.by_service ?? {})
        .map(([svc, count]) => ({ svc, count }))
        .sort((a, b) => b.count - a.count),
    [stats?.by_service],
  );

  const methodOptions = useMemo(
    () => [
      { value: '', label: t('apiLogs.allMethods', 'All Methods') },
      { value: 'GET', label: 'GET' },
      { value: 'POST', label: 'POST' },
      { value: 'PUT', label: 'PUT' },
      { value: 'DELETE', label: 'DELETE' },
    ],
    [t],
  );

  const statusOptions = useMemo(
    () => [
      { value: '', label: t('apiLogs.allStatus', 'All Status') },
      { value: '2xx', label: '2xx Success' },
      { value: '3xx', label: '3xx Redirect' },
      { value: '4xx', label: '4xx Client Error' },
      { value: '5xx', label: '5xx Server Error' },
    ],
    [t],
  );

  const trackedCount = stats?.by_service ? Object.keys(stats.by_service).length : 0;

  const exportFilename = `teslasync-api-logs-${new Date().toISOString().slice(0, 10)}`;
  const exportRows = useMemo(
    () =>
      logs.map((log) => ({
        id: log.id,
        timestamp: log.ts,
        vehicle_id: log.vehicle_id,
        service: log.service,
        method: log.http_method,
        endpoint: log.endpoint,
        status_code: log.status_code,
        duration_ms: log.duration_ms,
        rate_limited: log.rate_limited,
        error: log.error_message,
        request_body: log.request_body,
        response_body: log.response_body,
      })),
    [logs],
  );
  const handleExportCsv = useCallback(() => {
    exportAsCSV(exportRows, `${exportFilename}.csv`);
  }, [exportFilename, exportRows]);
  const handleExportJson = useCallback(() => {
    exportAsJSON(logs, `${exportFilename}.json`);
  }, [exportFilename, logs]);

  return (
    <PageContainer
      title={t('apiLogs.title', 'API Logs')}
      subtitle={t('apiLogs.subtitle', 'Record of all API calls with request/response details')}
      query={logsQuery}
      actions={
        <RangePicker
          value={{ start, end }}
          onChange={(r) => {
            setRange(r);
            if (page !== 0) setPage(0);
          }}
          align="end"
          triggerTestId="api-logs-range"
        />
      }
    >
      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section
          aria-label={t('apiLogs.title', 'API Logs')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          <StatCard
            loading={statsLoading && !stats}
            icon={<FileText className="h-5 w-5" aria-hidden="true" />}
            label={t('apiLogs.totalCalls', 'Total Calls')}
            value={stats?.total_calls != null ? fmtInt(stats.total_calls) : '—'}
          />
          <StatCard
            loading={statsLoading && !stats}
            icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
            label={t('apiLogs.errorRate', 'Error Rate')}
            value={stats ? `${fmtNumber(stats.error_rate)}%` : '—'}
            trend={stats && stats.error_rate > 5
              ? { direction: 'up' as const, value: String(stats.error_count ?? 0), positive: false }
              : undefined}
          />
          <StatCard
            loading={statsLoading && !stats}
            icon={<Clock className="h-5 w-5" aria-hidden="true" />}
            label={t('apiLogs.avgDuration', 'Avg Duration')}
            value={stats ? `${fmtInt(stats.avg_duration_ms ?? 0)}ms` : '—'}
          />
          <StatCard
            loading={statsLoading && !stats}
            icon={<Activity className="h-5 w-5" aria-hidden="true" />}
            label={t('apiLogs.last24h', 'Last 24h')}
            value={stats?.last_24h != null ? fmtInt(stats.last_24h) : '—'}
          />
        </section>
      </FadeIn>

      {/* 2 — Bento: filter/service rail + hero log table. More width ⇒ more
             room for the table, never a centered strip on wide monitors. */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('apiLogs.logTitle', 'API Call Log')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5 3xl:grid-cols-4"
        >
          {/* Left rail — service breakdown + filters (1 col at every width) */}
          <div className="space-y-4 xl:space-y-5">
            {/* By Service — quick-pick filter list with counts */}
            <GlassPanel className="p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <Layers className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                <PanelTitle>{t('apiLogs.byService', 'By Service')}</PanelTitle>
              </div>
              {statsLoading && !stats ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={32} />)}
                </div>
              ) : statsError ? (
                <QueryError error={statsError} onRetry={() => refetchStats()} />
              ) : serviceRows.length === 0 ? (
                // no-action: getAPICallLogStats() is a global all-time
                // aggregate ignoring filters here; self-resolves once traffic occurs (30s poll).
                <EmptyState
                  icon={<Layers className="h-8 w-8" aria-hidden="true" />}
                  message={t('apiLogs.noServices', 'No service activity yet')}
                />
              ) : (
                <ul className="space-y-1">
                  {serviceRows.map(({ svc, count }) => {
                    const cfg = serviceBadgeConfig(svc);
                    const active = service === svc;
                    return (
                      <li key={svc}>
                        <Button
                          type="button"
                          variant="ghost"
                          aria-pressed={active}
                          onClick={() => selectService(active ? '' : svc)}
                          className={cn(
                            'w-full !h-auto !justify-between gap-2 rounded-lg !px-2.5 !py-2 !font-normal',
                            active && 'bg-white/[0.06] ring-1 ring-inset ring-cyan-400/30',
                          )}
                        >
                          <Badge variant={cfg.variant} size="sm">{cfg.label}</Badge>
                          <Text as="span" size="xs" mono color="secondary" className="tabular-nums">
                            {fmtInt(count)}
                          </Text>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {stats?.by_service && (
                <Caption className="mt-3 block">
                  {t('apiLogs.serviceCount', '{{tracked}} with data · {{known}} known', {
                    tracked: trackedCount,
                    known: KNOWN_SERVICES.length,
                  })}
                </Caption>
              )}
            </GlassPanel>

            {/* Filters */}
            <GlassPanel className="p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <Filter className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                <PanelTitle>{t('apiLogs.filters', 'Filters')}</PanelTitle>
                {hasFilters && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon={<X className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={clearFilters}
                    className="ml-auto"
                  >
                    {t('apiLogs.clear', 'Clear')}
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <Select
                  label={t('apiLogs.service', 'Service')}
                  value={service}
                  onChange={(e) => selectService(e.target.value)}
                  options={serviceOptions}
                  size="sm"
                />
                <Select
                  label={t('apiLogs.method', 'Method')}
                  value={method}
                  onChange={(e) => setFilter('method', e.target.value)}
                  options={methodOptions}
                  size="sm"
                />
                <Select
                  label={t('apiLogs.status', 'Status')}
                  value={status}
                  onChange={(e) => setFilter('status', e.target.value)}
                  options={statusOptions}
                  size="sm"
                />
                <Input
                  label={t('apiLogs.endpoint', 'Endpoint')}
                  type="text"
                  icon={<Search className="h-4 w-4" aria-hidden="true" />}
                  placeholder={t('apiLogs.filterEndpoint', 'Filter by endpoint...')}
                  value={endpoint}
                  onChange={(e) => setFilter('endpoint', e.target.value)}
                  size="sm"
                />
              </div>
            </GlassPanel>
          </div>

          {/* Hero — API call log table (grows with the viewport) */}
          <GlassPanel className="overflow-hidden xl:col-span-2 3xl:col-span-3">
            {/* Header with export */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--glass-border)] p-4">
              <div className="min-w-0">
                <PanelTitle>{t('apiLogs.logTitle', 'API Call Log')}</PanelTitle>
                <Caption className="mt-0.5 block">
                  {total > 0
                    ? t('apiLogs.showing', {
                        from: page * limit + 1,
                        to: Math.min((page + 1) * limit, total),
                        total: fmtInt(total),
                        defaultValue: `Showing ${page * limit + 1}–${Math.min((page + 1) * limit, total)} of ${fmtInt(total)}`,
                      })
                    : t('apiLogs.totalCount', '{{count}} total', { count: 0 })}
                </Caption>
              </div>
              <ListExportMenu
                onExportCsv={handleExportCsv}
                onExportJson={handleExportJson}
                visibleCount={logs.length}
                disabled={logs.length === 0}
                testId="api-logs-export"
              />
            </div>

            {logsLoading && logs.length === 0 ? (
              <div className="divide-y divide-[var(--glass-border)]">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="px-4 py-3"><Skeleton height={20} /></div>
                ))}
              </div>
            ) : logsError ? (
              <div className="p-6">
                <QueryError error={logsError} onRetry={() => refetchLogs()} />
              </div>
            ) : logs.length === 0 ? (
              <EmptyState
                icon={<FileText className="h-10 w-10" aria-hidden="true" />}
                title={t('apiLogs.noLogsTitle', 'No API call logs')}
                message={hasFilters
                  ? t('apiLogs.adjustFilters', 'Try adjusting your filters')
                  : t('apiLogs.noLogsFound', 'No API call logs found')}
                action={hasFilters ? { label: t('apiLogs.clear', 'Clear'), onClick: clearFilters } : undefined}
              />
            ) : (
              <ul aria-label={t('apiLogs.logTitle', 'API Call Log')} className="divide-y divide-[var(--glass-border)]">
                {logs.map((log: APICallLog) => {
                  const svc = serviceBadgeConfig(log.service);
                  const open = expandedId === log.id;
                  const detailId = `api-log-${log.id}`;
                  return (
                    <li key={log.id}>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setExpandedId(open ? null : log.id)}
                        aria-expanded={open}
                        aria-controls={detailId}
                        className="w-full !h-auto !justify-start rounded-none !px-4 !py-3 text-left !font-normal hover:bg-white/[0.02]"
                      >
                        <Text as="span" size="xs" mono color="muted" className="hidden w-36 shrink-0 sm:block">
                          <DateTime value={log.ts} in="utc" />
                        </Text>
                        <Badge variant={svc.variant} size="sm">{svc.label}</Badge>
                        <Badge variant={METHOD_VARIANTS[log.http_method] ?? 'neutral'} size="sm">
                          {log.http_method}
                        </Badge>
                        <Text
                          as="span"
                          size="xs"
                          mono
                          color="secondary"
                          className="min-w-0 flex-1 truncate"
                          title={log.endpoint ?? ''}
                        >
                          {log.endpoint ?? '—'}
                        </Text>
                        <Badge variant={statusBadgeVariant(log.status_code)} size="sm">
                          {log.status_code ?? t('apiLogs.na', 'N/A')}
                        </Badge>
                        <Text as="span" size="xs" mono color="secondary" className="w-16 shrink-0 text-right tabular-nums">
                          {fmtInt(log.duration_ms ?? 0)}ms
                        </Text>
                        <Text as="span" variant="error" className="hidden max-w-[240px] truncate lg:block">
                          {log.error_message || '—'}
                        </Text>
                        {open
                          ? <ChevronUp className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                          : <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />}
                      </Button>

                      {/* Mobile date + error (visible on small screens when collapsed) */}
                      {!open && (
                        <div className="px-4 pb-2 sm:hidden">
                          <DateTime value={log.ts} in="utc" className="text-2xs text-[var(--text-muted)]" />
                          {log.error_message && (
                            <Text as="p" size="2xs" className="mt-0.5 truncate text-rose-300">{log.error_message}</Text>
                          )}
                        </div>
                      )}

                      {/* Expanded detail */}
                      {open && (
                        <div id={detailId} className="space-y-3 bg-[var(--surface-2)] p-4">
                          <div className="sm:hidden">
                            <DateTime value={log.ts} in="utc" className="text-2xs text-[var(--text-muted)]" />
                            {log.error_message && (
                              <Text as="p" variant="error" className="mt-1">{log.error_message}</Text>
                            )}
                          </div>
                          <div className="space-y-1">
                            <Label>{t('apiLogs.requestUrl', 'Request URL')}</Label>
                            <GlassPanel className={cn('overflow-x-auto whitespace-pre-wrap break-all !p-3', typography.role.code)}>
                              {log.http_method} {log.endpoint}
                            </GlassPanel>
                          </div>
                          {log.error_message && (
                            <div className="space-y-1">
                              <Text as="span" size="xs" weight="medium" className="uppercase tracking-wider text-rose-300">
                                {t('apiLogs.error', 'Error')}
                              </Text>
                              <GlassPanel className={cn('overflow-x-auto whitespace-pre-wrap break-all !p-3', typography.role.error, typography.family.mono)}>
                                {log.error_message}
                              </GlassPanel>
                            </div>
                          )}
                          <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                            <JsonViewer data={log.request_body} label={t('apiLogs.requestBody', 'Request Body')} />
                            <JsonViewer data={log.response_body} label={t('apiLogs.responseBody', 'Response Body')} />
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Pagination */}
            {total > limit && (
              <div className="border-t border-[var(--glass-border)] px-4 pb-2">
                <Pagination
                  page={page + 1}
                  pageSize={limit}
                  total={total}
                  onPageChange={(p) => setPage(p - 1)}
                />
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
