import { useState, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, RefreshCw } from 'lucide-react';
import yaml from 'js-yaml';
import { cn } from '@/lib/cn';
import { PageLayout, LayoutCard } from '@/components/layout';
import { Card, Button, Text } from '@/components/ui';
import type { StatMetric } from '@/components/data-display';
import { AdminSummary } from '../components/operationalbrief-a-g/AdminSummary';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { apiUrl, request } from '@/api/client';
import { deriveDataState } from '@/api/dataState';
import EndpointSidebar, { type ParsedEndpoint } from '../components/EndpointSidebar';
import RequestBuilder from '../components/RequestBuilder';
import ResponseViewer, { SnippetPanel, type ApiResponse, type HistoryEntry } from '../components/ResponseViewer';
import { parseSpec, type OpenAPISpec } from '../components/continuation-admin-1/playgroundSpec';
import { executeRequest } from '../components/continuation-admin-1/playgroundRequest';
import { findReplayEndpoint, loadHistory, saveHistory, MAX_HISTORY } from '../components/continuation-admin-1/playgroundHistory';

export { findReplayEndpoint } from '../components/continuation-admin-1/playgroundHistory';

export default function ApiPlaygroundPage() {
  const { t } = useTranslation();
  usePageTitle(t('playground.title', 'API playground'));
  const [selected, setSelected] = useState<ParsedEndpoint | null>(null);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const lastRequestRef = useRef<{ method: string; url: string; body?: string }>({ method: 'GET', url: '' });

  const specQuery = useQuery<ParsedEndpoint[]>({
    queryKey: ['openapi-spec'],
    queryFn: async () => {
      const text = await request<string>('/system/openapi', {
        responseType: 'text', credentials: 'same-origin', headers: { Accept: 'text/yaml' },
      });
      return parseSpec(yaml.load(text) as OpenAPISpec);
    },
    staleTime: Infinity,
  });
  const { data: endpoints, isLoading: specLoading, refetch: refetchSpec } = specQuery;
  const specState = deriveDataState(specQuery);

  const handleSelect = useCallback((endpoint: ParsedEndpoint) => {
    setSelected(endpoint);
    setResponse(null);
  }, []);
  const handleSend = useCallback(async (url: string, method: string, body?: string, headers?: Record<string, string>) => {
    setLoading(true);
    lastRequestRef.current = { method, url, body };
    try {
      const result = await executeRequest(url, method, body, headers);
      setResponse(result);
      const entry: HistoryEntry = {
        method, path: url.split('?')[0], status: result.status,
        duration: result.duration, timestamp: new Date().toISOString(),
      };
      setHistory(previous => {
        const next = [entry, ...previous].slice(0, MAX_HISTORY);
        saveHistory(next);
        return next;
      });
    } catch (error) {
      const failMessage = error instanceof Error ? error.message : t('playground.requestFailed', 'Request failed');
      setResponse({
        status: 0, statusText: t('playground.networkError', 'Network error'),
        headers: {}, body: { error: failMessage }, bodyText: failMessage,
        duration: 0, size: 0, contentType: 'text/plain',
      });
    } finally {
      setLoading(false);
    }
  }, [t]);
  const handleReplay = useCallback((entry: HistoryEntry) => {
    const endpoint = findReplayEndpoint(endpoints ?? [], entry);
    if (endpoint) {
      setSelected(endpoint);
      setResponse(null);
    }
  }, [endpoints]);
  const allEndpoints = endpoints ?? [];
  const stats = useMemo(() => {
    const list = endpoints ?? [];
    const total = list.length;
    const read = list.filter(endpoint => endpoint.method === 'GET').length;
    const groups = new Set(list.map(endpoint => endpoint.tag || 'Other')).size;
    return { total, read, write: total - read, groups };
  }, [endpoints]);
  const historyStats = useMemo(() => {
    if (history.length === 0) return { count: 0, avgMs: 0 };
    const sum = history.reduce((total, entry) => total + (entry.duration ?? 0), 0);
    return { count: history.length, avgMs: Math.round(sum / history.length) };
  }, [history]);
  const kpis = useMemo<StatMetric[]>(() => [
    { metricId: 'count', occurrenceId: 'total', label: t('playground.kpi.total', 'Total endpoints'), rawValue: specState.hasData ? stats.total : undefined },
    { metricId: 'count', occurrenceId: 'read', label: t('playground.kpi.read', 'Read (GET)'), rawValue: specState.hasData ? stats.read : undefined },
    { metricId: 'count', occurrenceId: 'write', label: t('playground.kpi.write', 'Write ops'), rawValue: specState.hasData ? stats.write : undefined },
    { metricId: 'count', occurrenceId: 'groups', label: t('playground.kpi.groups', 'API groups'), rawValue: specState.hasData ? stats.groups : undefined },
    { metricId: 'count', occurrenceId: 'recent', label: t('playground.kpi.recent', 'Recent requests'), rawValue: historyStats.count },
    { metricId: 'latency', occurrenceId: 'latency', label: t('playground.kpi.latency', 'Avg latency'),
      rawValue: historyStats.count > 0 ? historyStats.avgMs / 1000 : undefined, display: { precision: 0, latencyStyle: 'milliseconds' } },
  ], [t, stats, historyStats, specState.hasData]);

  return (
    <PageLayout title={t('playground.title', 'API playground')}
      subtitle={t('playground.subtitle', 'Explore and test TeslaSync API endpoints')}
      secondaryActions={
        <Button variant="ghost" onClick={() => refetchSpec()} disabled={specLoading}
          aria-label={t('playground.refresh', 'Reload API spec')}>
          <RefreshCw className={cn('h-4 w-4', specLoading && 'animate-spin')} aria-hidden />
        </Button>
      }
      query={specQuery}
      dataSources={[{ id: 'openapi-spec', label: t('playground.spec', 'API spec'), query: specQuery }]}
    >
      <FadeIn>
        <section aria-label={t('playground.kpis', 'API overview metrics')} className="space-y-3">
          <AdminSummary testId="api-playground-spec-summary" metrics={kpis.slice(0, 4)}
            eyebrow={t('playground.title', 'API playground')} title={t('playground.summary.specTitle', 'API specification')}
            description={t('playground.summary.specSource', 'Endpoint, read-operation, write-operation and group counts use the loaded API specification.')}
            scope={t('playground.summary.specScope', 'Specification snapshot; no observation time is supplied.')}
            sourceStatus={specState.status === 'stale' ? 'stale' : specState.isRefreshing ? 'refreshing' : specState.status}
            loading={specLoading && !specState.hasData} />
          <AdminSummary testId="api-playground-history-summary" metrics={kpis.slice(4)}
            eyebrow={t('playground.title', 'API playground')} title={t('playground.summary.historyTitle', 'Recent local requests')}
            description={t('playground.summary.historySource', 'Request count and average latency use this browser’s saved request history, independently of specification availability.')}
            scope={t('playground.summary.historyScope', 'Bounded local request history, not server-wide traffic or a fixed analysis window.')}
            sourceStatus="ready" />
        </section>
      </FadeIn>
      <FadeIn delay={0.1}>
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[20rem_minmax(0,1fr)] xl:gap-5">
          <aside aria-label={t('playground.explorer', 'Endpoint explorer')} className="min-w-0 xl:sticky xl:top-4 xl:self-start">
            <Card padding="none" className="flex h-[26rem] min-w-0 flex-col overflow-hidden xl:h-[calc(100vh-13rem)]">
              {specState.status === 'initial' ? (
                <div className="space-y-2 p-4">{Array.from({ length: 12 }).map((_, index) => <Skeleton key={index} height={24} className="rounded" />)}</div>
              ) : specState.fatalError ? (
                <div className="p-4"><QueryError error={specState.fatalError} onRetry={() => refetchSpec()} resourceName={t('playground.spec', 'API spec')} /></div>
              ) : allEndpoints.length === 0 ? (
                <EmptyState icon={<BookOpen className="h-8 w-8" aria-hidden />}
                  action={{ label: t('playground.refresh', 'Reload API spec'), onClick: () => { void refetchSpec(); } }}
                  message={t('playground.noEndpoints', 'No endpoints found in the API spec')} />
              ) : <EndpointSidebar endpoints={allEndpoints} selected={selected} onSelect={handleSelect} />}
            </Card>
          </aside>
          <section aria-label={t('playground.workspace', 'Request workspace')} className="min-w-0 space-y-4">
            {!selected ? (
              <LayoutCard title={t('playground.workspace', 'Request workspace')}>
                {/* no-action: the adjacent endpoint explorer owns selection; do not auto-select or execute an arbitrary endpoint. */}
                <EmptyState icon={<BookOpen className="h-8 w-8" aria-hidden />}
                  message={t('playground.selectEndpoint', 'Select an endpoint from the explorer to start testing')} />
                {allEndpoints.length > 0 && <Text as="p" variant="caption" className="mt-2 text-center">
                  {t('playground.endpointCount', '{{count}} endpoints available', { count: allEndpoints.length })}
                </Text>}
              </LayoutCard>
            ) : (
              <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2 2xl:gap-5">
                <section aria-label={t('playground.request', 'Request')} className="min-w-0 space-y-4">
                  <RequestBuilder
                    endpoint={selected}
                    onSend={handleSend}
                    loading={loading}
                  />
                  {response && (
                    <SnippetPanel
                      method={lastRequestRef.current.method}
                      url={apiUrl(lastRequestRef.current.url)}
                      body={lastRequestRef.current.body}
                    />
                  )}
                </section>
                <section aria-label={t('playground.responseSection', 'Response')} className="min-w-0">
                  <ResponseViewer
                    response={response}
                    loading={loading}
                    history={history}
                    onReplay={handleReplay}
                  />
                </section>
              </div>
            )}
          </section>
        </div>
      </FadeIn>
    </PageLayout>
  );
}
