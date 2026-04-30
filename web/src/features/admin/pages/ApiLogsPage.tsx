import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  FileText, Clock, AlertTriangle, Activity, Download,
  ChevronLeft, ChevronRight, Search, Filter, ChevronDown, ChevronUp, X, AlertCircle,
} from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel, Button as UiButton, Select as UiSelect, Input as UiInput, Badge } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { Spinner, AlertBanner } from '@/components/feedback';
import { getErrorMessage } from '@/lib/errorMessage';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { getAPICallLogs, getAPICallLogStats } from '@/api/devtools';
import type { APICallLog, APICallLogStats } from '@/api/types';

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
  'teslasync-api':   { label: 'TeslaSync API',   variant: 'info' },
  'tesla-api':       { label: 'Tesla API',       variant: 'info' },
  'fleet-telemetry': { label: 'Fleet Telemetry', variant: 'success' },
  'geocoding':       { label: 'Geocoding',       variant: 'warning' },
  'webhook':         { label: 'Webhook',         variant: 'neutral' },
  'ntfy':            { label: 'Ntfy',            variant: 'neutral' },
  'eia':             { label: 'EIA',             variant: 'neutral' },
};

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

// localDateTimeToISO converts a `<input type="datetime-local">` value (local
// wall-clock, no offset, e.g. `2026-04-29T12:00`) to a UTC ISO string the
// backend can compare against api_call_logs.ts (timestamptz). Returns
// undefined for empty / unparseable input so the query param is omitted.
function localDateTimeToISO(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function JsonViewer({ data, label }: { data: string | null; label: string }) {
  const { t } = useTranslation();
  if (!data) return <p className="text-xs text-[var(--text-muted)] italic">{t('apiLogs.noData', { label: label.toLowerCase(), defaultValue: `No ${label.toLowerCase()}` })}</p>;
  let formatted = data;
  try { formatted = JSON.stringify(JSON.parse(data), null, 2); } catch { /* raw */ }
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)] mb-1">{label}</p>
      <GlassPanel className="!p-3 text-xs font-mono overflow-x-auto max-h-60 whitespace-pre-wrap break-all">
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

  const [page, setPage] = useState(0);
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [service, setService] = useState('');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  });
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const limit = 25;

  const { data: stats, error: statsError } = useQuery<APICallLogStats>({
    queryKey: ['api-log-stats'],
    queryFn: getAPICallLogStats,
    refetchInterval: 30_000,
  });

  const { data, isLoading, error: logsError } = useQuery({
    queryKey: ['api-logs', page, method, status, endpoint, service, startDate, endDate],
    queryFn: () => getAPICallLogs({
      limit,
      offset: page * limit,
      method: method || undefined,
      status: status || undefined,
      endpoint: endpoint || undefined,
      service: service || undefined,
      // datetime-local inputs are local-time (no offset); the backend stores
      // ts as UTC (timestamptz). Convert via Date() so the comparison window
      // matches what the user actually picked, not the same wall-clock time
      // re-interpreted as UTC.
      start: localDateTimeToISO(startDate),
      end: localDateTimeToISO(endDate),
    }),
    refetchInterval: 10_000,
  });

  const anyError = [statsError, logsError].find(Boolean);

  const logs = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);
  const hasFilters = !!(method || status || endpoint || service || startDate || endDate);

  const clearFilters = useCallback(() => {
    setMethod(''); setStatus(''); setEndpoint(''); setService(''); setStartDate(''); setEndDate(''); setPage(0);
  }, []);

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `teslasync-api-logs-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [logs]);

  return (
    <PageContainer
      title={t('apiLogs.title', 'API Logs')}
      subtitle={t('apiLogs.subtitle', 'Record of all API calls with request/response details')}
    >
      {anyError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      )}

      {/* Stats */}
      <FadeIn>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            icon={<FileText className="h-5 w-5" />}
            label={t('apiLogs.totalCalls', 'Total Calls')}
            value={stats?.total_calls != null ? fmtInt(stats.total_calls) : '—'}
          />
          <StatCard
            icon={<AlertTriangle className="h-5 w-5" />}
            label={t('apiLogs.errorRate', 'Error Rate')}
            value={stats ? `${fmtNumber(stats.error_rate)}%` : '—'}
            trend={stats && stats.error_rate > 5 ? { direction: 'up' as const, value: String(stats.error_count), positive: false } : undefined}
          />
          <StatCard
            icon={<Clock className="h-5 w-5" />}
            label={t('apiLogs.avgDuration', 'Avg Duration')}
            value={stats ? `${fmtInt(stats.avg_duration_ms)}ms` : '—'}
          />
          <StatCard
            icon={<Activity className="h-5 w-5" />}
            label={t('apiLogs.last24h', 'Last 24h')}
            value={stats?.last_24h != null ? fmtInt(stats.last_24h) : '—'}
          />
        </div>
        {stats?.by_service && Object.keys(stats.by_service).length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className="text-xs font-medium text-[var(--text-muted)]">
              {t('apiLogs.byService', 'By Service')}:
            </span>
            {Object.entries(stats.by_service).map(([svc, count]) => {
              const config = serviceBadgeConfig(svc);
              return (
                <UiButton
                  key={svc}
                  type="button"
                  variant="ghost"
                  onClick={() => { setService(svc); setPage(0); }}
                  className="!h-auto cursor-pointer gap-1.5 border-0 !bg-transparent !p-0"
                >
                  <Badge variant={config.variant} size="sm">{config.label}</Badge>
                  <span className="text-xs text-[var(--text-secondary)]">{fmtInt(count)}</span>
                </UiButton>
              );
            })}
          </div>
        )}
      </FadeIn>

      {/* Filters */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-[var(--text-muted)]" />
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
              {t('apiLogs.filters', 'Filters')}
            </span>
            {hasFilters && (
              <UiButton type="button" variant="ghost" size="sm" icon={<X className="h-3 w-3" />} onClick={clearFilters} className="ml-auto">
                {t('apiLogs.clear', 'Clear')}
              </UiButton>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <UiSelect
              value={service}
              onChange={(e) => { setService(e.target.value); setPage(0); }}
              options={[
                { value: '', label: t('apiLogs.allServices', 'All Services') },
                { value: 'teslasync-api', label: 'TeslaSync API' },
                { value: 'tesla-api', label: 'Tesla API' },
                { value: 'fleet-telemetry', label: 'Fleet Telemetry' },
                { value: 'geocoding', label: 'Geocoding' },
                { value: 'webhook', label: 'Webhook' },
                { value: 'ntfy', label: 'Ntfy' },
                { value: 'eia', label: 'EIA' },
              ]}
            />
            <UiSelect
              value={method}
              onChange={(e) => { setMethod(e.target.value); setPage(0); }}
              options={[
                { value: '', label: t('apiLogs.allMethods', 'All Methods') },
                { value: 'GET', label: 'GET' },
                { value: 'POST', label: 'POST' },
                { value: 'PUT', label: 'PUT' },
                { value: 'DELETE', label: 'DELETE' },
              ]}
            />
            <UiSelect
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(0); }}
              options={[
                { value: '', label: t('apiLogs.allStatus', 'All Status') },
                { value: '2xx', label: '2xx Success' },
                { value: '3xx', label: '3xx Redirect' },
                { value: '4xx', label: '4xx Client Error' },
                { value: '5xx', label: '5xx Server Error' },
              ]}
            />
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
              <UiInput
                type="text"
                placeholder={t('apiLogs.filterEndpoint', 'Filter by endpoint...')}
                value={endpoint}
                onChange={(e) => { setEndpoint(e.target.value); setPage(0); }}
                className="pl-8"
              />
            </div>
            <UiInput
              type="datetime-local"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(0); }}
              placeholder={t('apiLogs.startDate', 'Start date')}
            />
            <UiInput
              type="datetime-local"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(0); }}
              placeholder={t('apiLogs.endDate', 'End date')}
            />
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Table */}
      <FadeIn delay={0.1}>
        <GlassPanel className="overflow-hidden">
          {/* Header with export */}
          <div className="flex items-center justify-between p-4 border-b border-[var(--glass-border)]">
            <p className="text-sm text-[var(--text-secondary)]">
              {total > 0
                ? t('apiLogs.showing', { from: page * limit + 1, to: Math.min((page + 1) * limit, total), total: fmtInt(total), defaultValue: `Showing ${page * limit + 1}–${Math.min((page + 1) * limit, total)} of ${fmtInt(total)}` })
                : t('apiLogs.noLogs', 'No logs found')}
            </p>
            <UiButton
              type="button"
              variant="secondary"
              size="sm"
              icon={<Download className="h-3.5 w-3.5" />}
              onClick={handleExport}
              disabled={logs.length === 0}
            >
              {t('apiLogs.exportJson', 'Export JSON')}
            </UiButton>
          </div>

          {isLoading ? (
            <div className="p-8 flex flex-col items-center">
              <Spinner size="md" />
              <p className="text-sm text-[var(--text-muted)] mt-2">{t('apiLogs.loading', 'Loading logs...')}</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="h-10 w-10 text-[var(--text-muted)] mx-auto mb-3 opacity-40" />
              <p className="text-sm text-[var(--text-muted)]">{t('apiLogs.noLogsFound', 'No API call logs found')}</p>
              {hasFilters && <p className="text-xs text-[var(--text-muted)] mt-1">{t('apiLogs.adjustFilters', 'Try adjusting your filters')}</p>}
            </div>
          ) : (
            <>
              {/* Log entries */}
              <div className="divide-y divide-[var(--glass-border)]">
                {logs.map((log: APICallLog) => {
                  const serviceConfig = serviceBadgeConfig(log.service);
                  return (
                    <div key={log.id}>
                      <div
                        onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                        className="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
                      >
                        <span className="text-xs font-mono text-[var(--text-muted)] whitespace-nowrap w-36 shrink-0 hidden sm:block">
                          {formatDateTime(log.ts)}
                        </span>
                        <Badge variant={serviceConfig.variant} size="sm">{serviceConfig.label}</Badge>
                        <Badge variant={METHOD_VARIANTS[log.http_method] ?? 'neutral'} size="sm">
                          {log.http_method}
                        </Badge>
                        <span className="text-xs font-mono text-[var(--text-secondary)] line-clamp-1 break-all flex-1" title={log.endpoint}>
                          {log.endpoint ?? ''}
                        </span>
                        <Badge variant={statusBadgeVariant(log.status_code)} size="sm">
                          {log.status_code ?? 'N/A'}
                        </Badge>
                        <span className="text-xs font-mono text-[var(--text-secondary)] w-16 text-right shrink-0">
                          {log.duration_ms}ms
                        </span>
                        <span className="text-xs text-red-400 truncate max-w-[250px] hidden md:block">
                          {log.error_message || '—'}
                        </span>
                        {expandedId === log.id
                          ? <ChevronUp className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
                          : <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />}
                      </div>

                      {/* Mobile date + error (visible on small screens) */}
                      {expandedId !== log.id && (
                        <div className="px-4 pb-2 sm:hidden">
                          <p className="text-[10px] text-[var(--text-muted)]">{formatDateTime(log.ts)}</p>
                          {log.error_message && <p className="text-[10px] text-red-400 truncate mt-0.5">{log.error_message}</p>}
                        </div>
                      )}

                      {/* Expanded detail */}
                      {expandedId === log.id && (
                        <div className="p-4 space-y-3 bg-[var(--surface-2)]">
                          <div className="sm:hidden mb-2">
                            <p className="text-[10px] text-[var(--text-muted)]">{formatDateTime(log.ts)}</p>
                            {log.error_message && <p className="text-xs text-red-400 mt-1">{log.error_message}</p>}
                          </div>
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)] mb-1">{t('apiLogs.requestUrl', 'Request URL')}</p>
                            <GlassPanel className="!p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                              {log.http_method} {log.endpoint}
                            </GlassPanel>
                          </div>
                          {log.error_message && (
                            <div>
                              <p className="text-[10px] font-medium uppercase tracking-wider text-red-400 mb-1">{t('apiLogs.error', 'Error')}</p>
                              <GlassPanel className="!p-3 text-xs font-mono text-red-300 overflow-x-auto whitespace-pre-wrap break-all">
                                {log.error_message}
                              </GlassPanel>
                            </div>
                          )}
                          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                            <JsonViewer data={log.request_body} label={t('apiLogs.requestBody', 'Request Body')} />
                            <JsonViewer data={log.response_body} label={t('apiLogs.responseBody', 'Response Body')} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t border-[var(--glass-border)]">
              <UiButton
                type="button"
                variant="secondary"
                size="sm"
                icon={<ChevronLeft className="h-3.5 w-3.5" />}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                {t('apiLogs.previous', 'Previous')}
              </UiButton>
              <span className="text-xs text-[var(--text-muted)]">
                {t('apiLogs.pageOf', { page: page + 1, total: totalPages, defaultValue: `Page ${page + 1} of ${totalPages}` })}
              </span>
              <UiButton
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                {t('apiLogs.next', 'Next')} <ChevronRight className="h-3.5 w-3.5" />
              </UiButton>
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
