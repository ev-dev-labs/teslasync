import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  FileText, Clock, AlertTriangle, Activity, Download,
  ChevronLeft, ChevronRight, Search, Filter, ChevronDown, ChevronUp, X,
} from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel, Button, Select, Input, Badge } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { Spinner } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { getAPICallLogs, getAPICallLogStats } from '@/api/devtools';
import type { APICallLog, APICallLogStats } from '@/api/types';

/* ------------------------------------------------------------------ */
/*  Local helpers                                                      */
/* ------------------------------------------------------------------ */

function StatusBadge({ code }: { code: number | null }) {
  if (!code) return <Badge variant="neutral" size="sm">N/A</Badge>;
  const variant: 'success' | 'info' | 'warning' | 'danger' =
    code < 300 ? 'success' : code < 400 ? 'info' : code < 500 ? 'warning' : 'danger';
  return <Badge variant={variant} size="sm">{code}</Badge>;
}

function MethodBadge({ method }: { method: string }) {
  const variant: Record<string, 'success' | 'info' | 'warning' | 'danger'> = {
    GET: 'success', POST: 'info', PUT: 'warning', PATCH: 'warning', DELETE: 'danger',
  };
  return <Badge variant={variant[method] ?? 'neutral'} size="sm">{method}</Badge>;
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
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const limit = 25;

  const { data: stats } = useQuery<APICallLogStats>({
    queryKey: ['api-log-stats'],
    queryFn: getAPICallLogStats,
    refetchInterval: 30_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['api-logs', page, method, status, endpoint, startDate, endDate],
    queryFn: () => getAPICallLogs({
      limit,
      offset: page * limit,
      method: method || undefined,
      status: status || undefined,
      endpoint: endpoint || undefined,
      start: startDate || undefined,
      end: endDate || undefined,
    }),
    refetchInterval: 10_000,
  });

  const logs = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);
  const hasFilters = !!(method || status || endpoint || startDate || endDate);

  const clearFilters = useCallback(() => {
    setMethod(''); setStatus(''); setEndpoint(''); setStartDate(''); setEndDate(''); setPage(0);
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
      title={t('apiLogs.title', 'Tesla API Logs')}
      subtitle={t('apiLogs.subtitle', 'Record of all Tesla API calls with request/response details')}
    >
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
              <Button variant="ghost" size="sm" icon={<X className="h-3 w-3" />} onClick={clearFilters} className="ml-auto">
                {t('apiLogs.clear', 'Clear')}
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Select
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
            <Select
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
              <Input
                type="text"
                placeholder={t('apiLogs.filterEndpoint', 'Filter by endpoint...')}
                value={endpoint}
                onChange={(e) => { setEndpoint(e.target.value); setPage(0); }}
                className="pl-8"
              />
            </div>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(0); }}
              placeholder={t('apiLogs.startDate', 'Start date')}
            />
            <Input
              type="date"
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
            <Button
              variant="secondary"
              size="sm"
              icon={<Download className="h-3.5 w-3.5" />}
              onClick={handleExport}
              disabled={logs.length === 0}
            >
              {t('apiLogs.exportJson', 'Export JSON')}
            </Button>
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
                {logs.map((log: APICallLog) => (
                  <div key={log.id}>
                    <div
                      onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                      className="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
                    >
                      <span className="text-xs font-mono text-[var(--text-muted)] whitespace-nowrap w-36 shrink-0 hidden sm:block">
                        {formatDateTime(log.created_at)}
                      </span>
                      <MethodBadge method={log.method} />
                      <span className="text-xs font-mono text-[var(--text-secondary)] truncate flex-1" title={log.url}>
                        {(log.url ?? '').replace(/^https?:\/\/[^/]+/, '')}
                      </span>
                      <StatusBadge code={log.status_code} />
                      <span className="text-xs font-mono text-[var(--text-secondary)] w-16 text-right shrink-0">
                        {log.duration_ms}ms
                      </span>
                      <span className="text-xs text-red-400 truncate max-w-[150px] hidden md:block">
                        {log.error || '—'}
                      </span>
                      {expandedId === log.id
                        ? <ChevronUp className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
                        : <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />}
                    </div>

                    {/* Mobile date + error (visible on small screens) */}
                    {expandedId !== log.id && (
                      <div className="px-4 pb-2 sm:hidden">
                        <p className="text-[10px] text-[var(--text-muted)]">{formatDateTime(log.created_at)}</p>
                        {log.error && <p className="text-[10px] text-red-400 truncate mt-0.5">{log.error}</p>}
                      </div>
                    )}

                    {/* Expanded detail */}
                    {expandedId === log.id && (
                      <div className="p-4 space-y-3 bg-[var(--surface-2)]">
                        <div className="sm:hidden mb-2">
                          <p className="text-[10px] text-[var(--text-muted)]">{formatDateTime(log.created_at)}</p>
                          {log.error && <p className="text-xs text-red-400 mt-1">{log.error}</p>}
                        </div>
                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                          <JsonViewer data={log.request_body} label={t('apiLogs.requestBody', 'Request Body')} />
                          <JsonViewer data={log.response_body} label={t('apiLogs.responseBody', 'Response Body')} />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t border-[var(--glass-border)]">
              <Button
                variant="secondary"
                size="sm"
                icon={<ChevronLeft className="h-3.5 w-3.5" />}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                {t('apiLogs.previous', 'Previous')}
              </Button>
              <span className="text-xs text-[var(--text-muted)]">
                {t('apiLogs.pageOf', { page: page + 1, total: totalPages, defaultValue: `Page ${page + 1} of ${totalPages}` })}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                {t('apiLogs.next', 'Next')} <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
