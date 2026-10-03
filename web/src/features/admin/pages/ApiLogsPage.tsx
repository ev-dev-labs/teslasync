import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText, Clock, AlertTriangle, Activity,
  Layers, RefreshCw,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel, Button, Badge, Pagination,
  PanelTitle, Caption, Text,
} from '@/components/ui';
import { StatCard, DateTime } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { FrontendErrorsCard } from '@/components/status';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { ListExportMenu } from '@/components/forms';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useRangeState } from '@/hooks/useRangeState';
import { useUrlNumber, useUrlString, useUrlBatch } from '@/hooks/useUrlState';

import { cn } from '@/lib/cn';
import { exportAsCSV, exportAsJSON } from '@/lib/export';
import { useAPICallLogs, useAPICallLogStats, useSystemErrorStats } from '@/api/hooks/useAdmin';
import type { APICallLog } from '@/api/types';
import { deriveServiceOptions } from '../lib/serviceOptions';
import {
  ApiLogsEvidenceTable, type ApiLogsServerFilterKey, type ApiLogsServerFilters,
} from '../components/ApiLogsEvidenceTable';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/* ------------------------------------------------------------------ */
/*  Local helpers                                                      */
/* ------------------------------------------------------------------ */

type LogBadgeVariant = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

const SERVICE_CONFIG: Record<string, { label: string; variant: LogBadgeVariant }> = {
  'teslasync-api':      { label: 'TeslaSync API',      variant: 'info'    },
  'tesla-api':          { label: 'Tesla API',          variant: 'info'    },
  'tesla-auth':         { label: 'Tesla auth',         variant: 'info'    },
  'geocoder-google':    { label: 'Geocoder (Google)',  variant: 'warning' },
  'geocoder-nominatim': { label: 'Geocoder (Nominatim)', variant: 'warning' },
  'geocoder-azure':     { label: 'Geocoder (Azure)',   variant: 'warning' },
  'geocoder-search':    { label: 'Geocoder (search)',  variant: 'warning' },
  'github-releases':    { label: 'GitHub releases',    variant: 'neutral' },
  'notify-generic':     { label: 'Notifications',      variant: 'neutral' },
  'system-dns-check':   { label: 'DNS health check',   variant: 'neutral' },
  'eia':                { label: 'EIA',                variant: 'neutral' },
};

/** Static catalog of services the frontend knows the backend can write.
 *  Stable identity → safe to pass to deriveServiceOptions / useMemo deps. */
const KNOWN_SERVICES = Object.freeze(Object.keys(SERVICE_CONFIG));
const APP_ID_PATTERN = /^(windows|macos|linux|desktop|android|ios|mobile):([0-9a-f]{8})-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function appInstallation(headers: APICallLog['request_headers']): { id: string; platform: string; shortId: string } | null {
  const id = headers?.['X-Teslasync-App'];
  const match = id?.match(APP_ID_PATTERN);
  return match && id ? { id, platform: match[1], shortId: match[2] } : null;
}

function serviceBadgeConfig(service: string): { label: string; variant: LogBadgeVariant } {
  return SERVICE_CONFIG[service] ?? { label: service, variant: 'neutral' };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ApiLogsPage() {
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('apiLogs.title', 'API logs'));
  const serviceConfig = useCallback((svc: string) => {
    const config = serviceBadgeConfig(svc);
    return SERVICE_CONFIG[svc]
      ? { ...config, label: t(`apiLogs.services.${svc}`, config.label) }
      : config;
  }, [t]);

  const [page, setPage] = useUrlNumber('page', 0);
  const [method] = useUrlString('method', '');
  const [status] = useUrlString('status', '');
  const [endpoint] = useUrlString('endpoint', '');
  const [service] = useUrlString('service', '');
  const [client] = useUrlString('client', '');
  const [key] = useUrlString('key', '');
  const limit = 25;

  // The header owns the `from`/`to` window for both KPIs and request rows.
  const { startInstant, endInstantExclusive } = useRangeState({
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
  const previousRange = useRef(`${startInstant}:${endInstantExclusive}`);
  useEffect(() => {
    const currentRange = `${startInstant}:${endInstantExclusive}`;
    if (previousRange.current === currentRange) return;
    previousRange.current = currentRange;
    if (page !== 0) setUrl({ page: null });
  }, [startInstant, endInstantExclusive, page, setUrl]);

  const setFilter = useCallback(
    (key: ApiLogsServerFilterKey, value: string) => {
      setUrl({ [key]: value, page: '' });
    },
    [setUrl],
  );

  const statsQuery = useAPICallLogStats(startInstant, endInstantExclusive);
  const {
    data: stats,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = statsQuery;
  const statsState = useDataState(statsQuery);

  const logsQuery = useAPICallLogs(page, {
    method: method || undefined,
    status: status || undefined,
    endpoint: endpoint || undefined,
    service: service || undefined,
    client: client || undefined,
    key: key || undefined,
    start: startInstant,
    endExclusive: endInstantExclusive,
  });
  const { data, isLoading: logsLoading, refetch: refetchLogs } = logsQuery;
  const logsState = useDataState(logsQuery);
  const runtimeQuery = useSystemErrorStats();
  const {
    data: runtimeErrors,
    isLoading: runtimeLoading,
    refetch: refetchRuntime,
  } = runtimeQuery;
  const runtimeState = useDataState(runtimeQuery);

  const logs = data?.data ?? [];
  const total = data?.total ?? 0;
  const hasFilters = !!(method || status || endpoint || service || client || key);
  const serverFilters = useMemo<ApiLogsServerFilters>(
    () => ({ method, status, endpoint, service, client, key }),
    [method, status, endpoint, service, client, key],
  );

  const clearFilters = useCallback(() => {
    setUrl({ method: '', status: '', endpoint: '', service: '', client: '', key: '', page: '' });
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
        labelFor: (svc) => serviceConfig(svc).label,
        allLabel: t('apiLogs.allServices', 'All services'),
        knownServices: KNOWN_SERVICES,
      }),
    [stats?.by_service, service, t, serviceConfig],
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
      { value: '', label: t('apiLogs.allMethods', 'All methods') },
      { value: 'GET', label: 'GET' },
      { value: 'POST', label: 'POST' },
      { value: 'PUT', label: 'PUT' },
      { value: 'PATCH', label: 'PATCH' },
      { value: 'DELETE', label: 'DELETE' },
    ],
    [t],
  );

  const statusOptions = useMemo(
    () => [
      { value: '', label: t('apiLogs.allStatus', 'All status') },
      { value: '2xx', label: t('apiLogs.statusSuccess', '2xx success') },
      { value: '3xx', label: t('apiLogs.statusRedirect', '3xx redirect') },
      { value: '4xx', label: t('apiLogs.statusClientError', '4xx client error') },
      { value: '5xx', label: t('apiLogs.statusServerError', '5xx server error') },
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
        app_installation: appInstallation(log.request_headers)?.id ?? '',
        app_key_id: log.request_headers?.['App-Key-ID'] ?? '',
        app_key_name: log.request_headers?.['App-Key-Name'] ?? '',
        method: log.http_method,
        endpoint: log.endpoint,
        status_code: log.status_code,
        duration_ms: log.duration_ms,
        rate_limited: log.rate_limited,
        error: log.error_message,
        request_body: log.request_body,
        response_body: log.response_body,
        request_headers: log.request_headers,
        response_headers: log.response_headers,
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
      title={t('apiLogs.title', 'API logs')}
      subtitle={t('apiLogs.subtitle', 'Record of all API calls with request/response details')}
      query={logsQuery}
      busy={logsQuery.isFetching}
      secondaryActions={
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
          disabled={logsQuery.isFetching || statsQuery.isFetching || runtimeQuery.isFetching}
          onClick={() => { void refetchLogs(); void refetchStats(); void refetchRuntime(); }}
        >
          {t('common.refresh', 'Refresh')}
        </Button>
      }
    >
      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section
          aria-label={t('apiLogs.title', 'API logs')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          <StatCard
            className="!min-h-0 !gap-1 !p-3"
            loading={statsLoading && !stats}
            icon={<FileText className="h-5 w-5" aria-hidden="true" />}
            label={t('apiLogs.totalCalls', 'Total calls')}
            value={stats?.total_calls != null ? fmtInt(stats.total_calls) : '—'}
          />
          <StatCard
            className="!min-h-0 !gap-1 !p-3"
            loading={statsLoading && !stats}
            icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
            label={t('apiLogs.errorRate', 'Error rate')}
            value={stats?.error_rate != null ? `${fmtNumber(stats.error_rate)}%` : '—'}
            trend={stats && stats.error_rate > 5 && stats.error_count != null
              ? { direction: 'up' as const, value: String(stats.error_count), positive: false }
              : undefined}
          />
          <StatCard
            className="!min-h-0 !gap-1 !p-3"
            loading={statsLoading && !stats}
            icon={<Clock className="h-5 w-5" aria-hidden="true" />}
            label={t('apiLogs.avgDuration', 'Avg duration')}
            value={stats?.avg_duration_ms != null ? `${fmtInt(stats.avg_duration_ms)}ms` : '—'}
          />
          <StatCard
            className="!min-h-0 !gap-1 !p-3"
            loading={statsLoading && !stats}
            icon={<Activity className="h-5 w-5" aria-hidden="true" />}
            label={t('apiLogs.last24h', 'Last 24h')}
            value={stats?.last_24h != null ? fmtInt(stats.last_24h) : '—'}
          />
        </section>
      </FadeIn>

      <FadeIn delay={0.05}>
        <Caption className="block">
          {t('apiLogs.statsScope', 'API call totals and service counts use the View settings range. Service, method, status, endpoint, app key, and installation filters apply only to the request list.')}
        </Caption>
      </FadeIn>

      {/* Full-width evidence workspace; server predicates stay separate from column layout. */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('apiLogs.logTitle', 'API call log')}
          className="min-w-0 space-y-3"
        >
          {/* Service quick-picks complement the server-owned column filters. */}
          <div className="space-y-3">
            {/* By Service — quick-pick filter list with counts */}
            <GlassPanel className="p-3 sm:p-4">
              <div className="mb-2 flex items-center gap-2">
                <Layers className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                <PanelTitle>{t('apiLogs.byService', 'By service')}</PanelTitle>
              </div>
              <StaleRefreshWarning state={statsState} label={t('apiLogs.byService', 'By service')} hideRetry />
              {statsLoading && !stats ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={32} />)}
                </div>
              ) : statsState.fatalError ? (
                <QueryError error={statsState.fatalError} onRetry={() => refetchStats()} />
              ) : serviceRows.length === 0 ? (
                // no-action: the header's View settings controls this window; no service rows exist yet.
                <EmptyState
                  icon={<Layers className="h-8 w-8" aria-hidden="true" />}
                  message={t('apiLogs.noServices', 'No service activity yet')}
                />
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {serviceRows.map(({ svc, count }) => {
                    const cfg = serviceConfig(svc);
                    const active = service === svc;
                    return (
                      <li key={svc}>
                        <Button
                          type="button"
                          variant="ghost"
                          aria-pressed={active}
                          onClick={() => selectService(active ? '' : svc)}
                          className={cn(
                            '!h-auto !justify-between gap-2 rounded-lg !px-2.5 !py-1.5 !font-normal',
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

          </div>

          {/* Hero — API call log table (grows with the viewport) */}
          <GlassPanel className="min-w-0">
            {/* Header with export */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--glass-border)] p-3">
              <div className="min-w-0">
                <PanelTitle>{t('apiLogs.logTitle', 'API call log')}</PanelTitle>
                <Caption className="mt-0.5 block">
                  {total > 0
                    ? t('apiLogs.showing', {
                        from: page * limit + 1,
                        to: Math.min((page + 1) * limit, total),
                        total: fmtInt(total),
                        defaultValue: `Showing ${page * limit + 1}–${Math.min((page + 1) * limit, total)} of ${fmtInt(total)}`,
                      })
                    : data ? t('apiLogs.totalCount', '{{count}} total', { count: 0 }) : '—'}
                </Caption>
                <Caption className="mt-1 block">
                  {t('apiLogs.loadedPageScope', 'Newest first. Filters query all matching requests; exports include only this loaded page.')}
                </Caption>
              </div>
            </div>

            <StaleRefreshWarning state={logsState} label={t('apiLogs.logTitle', 'API call log')} hideRetry />
            <ApiLogsEvidenceTable
              logs={logs}
              serviceConfig={serviceConfig}
              installationFor={appInstallation}
              filters={serverFilters}
              onFilterChange={setFilter}
              onFiltersClear={clearFilters}
              methodOptions={methodOptions}
              statusOptions={statusOptions}
              serviceOptions={serviceOptions}
              toolbarHeading={
                <Caption>{t('apiLogs.inspectHint', 'Expand a request to inspect headers, bodies, and metadata.')}</Caption>
              }
              toolbarActions={
                <ListExportMenu
                  onExportCsv={handleExportCsv}
                  onExportJson={handleExportJson}
                  visibleCount={logs.length}
                  disabled={logs.length === 0}
                  testId="api-logs-export"
                />
              }
            />
            {logsLoading && logs.length === 0 ? (
              <div className="divide-y divide-[var(--glass-border)]">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="px-4 py-3"><Skeleton height={20} /></div>
                ))}
              </div>
            ) : logsState.fatalError ? (
              <div className="p-6">
                <QueryError error={logsState.fatalError} onRetry={() => refetchLogs()} />
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
            ) : null}

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
      <FadeIn delay={0.15}>
        <section
          aria-label={t('apiLogs.errorDiagnostics', 'Error diagnostics')}
          className="grid gap-3 lg:grid-cols-2"
        >
          <GlassPanel className="p-3 sm:p-4">
            <PanelTitle>{t('apiLogs.backendErrors', 'Backend runtime errors')}</PanelTitle>
            <Caption className="mt-1 block">
              {t('apiLogs.backendScope', 'Since the current API process started; independent of API call filters.')}
            </Caption>
            <StaleRefreshWarning state={runtimeState} label={t('apiLogs.backendErrors', 'Backend runtime errors')} hideRetry />
            {runtimeLoading && !runtimeErrors ? (
              <Skeleton className="mt-4 h-16" />
            ) : runtimeState.fatalError ? (
              <QueryError error={runtimeState.fatalError} onRetry={() => refetchRuntime()} />
            ) : runtimeErrors ? (
              <>
                <Text as="p" className="mt-3">
                  {runtimeErrors.total_errors != null ? t('apiLogs.runtimeTotal', '{{count}} errors · uptime {{uptime}}', {
                    count: runtimeErrors.total_errors,
                    uptime: runtimeErrors.uptime || '—',
                  }) : t('apiLogs.runtimeTotalUnknown', '— errors · uptime {{uptime}}', { uptime: runtimeErrors.uptime || '—' })}
                </Text>
                {Object.keys(runtimeErrors.by_code ?? {}).length ? (
                  <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                    {Object.entries(runtimeErrors.by_code ?? {})
                      .sort((a, b) => b[1].count - a[1].count)
                      .map(([code, entry]) => (
                        <li key={code} className="flex items-start justify-between gap-3 border-t border-[var(--glass-border)] pt-2">
                          <div className="min-w-0">
                            <Text as="p" variant="bodySm" weight="medium">{code}</Text>
                            <Caption className="block break-words">{entry.last_message || '—'}</Caption>
                            {entry.last_seen && <Caption className="block"><DateTime value={entry.last_seen} in="utc" /></Caption>}
                          </div>
                          <Badge variant="warning" size="sm">{fmtInt(entry.count)}</Badge>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <Caption className="mt-3 block">{t('apiLogs.noRuntimeErrors', 'No backend runtime errors in this process.')}</Caption>
                )}
              </>
            ) : (
              <Caption className="mt-3 block">{t('apiLogs.runtimeUnavailable', 'Backend runtime error summary unavailable.')}</Caption>
            )}
          </GlassPanel>
          <GlassPanel className="p-3 sm:p-4">
            <FrontendErrorsCard />
          </GlassPanel>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
