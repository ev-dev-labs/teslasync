import { useState, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen, RefreshCw, Boxes, ArrowDownToLine, ArrowUpToLine, Tags, History, Timer,
} from 'lucide-react';
import yaml from 'js-yaml';
import { cn } from '@/lib/cn';
import { type NeonColor } from '@/lib/tokens';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Button, Text } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { apiUrl, request } from '@/api/client';
import EndpointSidebar, { type ParsedEndpoint, type ParsedParam, type ParsedBody } from '../components/EndpointSidebar';
import RequestBuilder from '../components/RequestBuilder';
import ResponseViewer, { SnippetPanel, type ApiResponse, type HistoryEntry } from '../components/ResponseViewer';

/* ─── constants ───────────────────────────────────────────────────────── */

const HISTORY_KEY = 'teslasync-api-playground-history';
const MAX_HISTORY = 20;

/* ─── OpenAPI spec parser ─────────────────────────────────────────────── */

interface OpenAPISpec {
  paths?: Record<string, Record<string, Record<string, unknown>>>;
  components?: {
    parameters?: Record<string, Record<string, unknown>>;
    schemas?: Record<string, unknown>;
  };
  tags?: Array<{ name: string; description?: string }>;
}

function resolveRef(spec: OpenAPISpec, ref: unknown): Record<string, unknown> | null {
  if (typeof ref !== 'object' || ref === null) return null;
  const obj = ref as Record<string, unknown>;
  const refStr = obj['$ref'];
  if (typeof refStr !== 'string') return obj;

  // Parse $ref like "#/components/parameters/vehicleID"
  const parts = refStr.replace('#/', '').split('/');
  let current: unknown = spec;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return (typeof current === 'object' && current !== null)
    ? current as Record<string, unknown>
    : null;
}

function parseParameter(spec: OpenAPISpec, raw: unknown): ParsedParam | null {
  const resolved = resolveRef(spec, raw);
  if (!resolved) return null;

  const schema = (resolved.schema ?? {}) as Record<string, unknown>;
  return {
    name: String(resolved.name ?? ''),
    in: String(resolved.in ?? 'query') as 'path' | 'query',
    required: Boolean(resolved.required),
    type: String(schema.type ?? 'string'),
    description: String(resolved.description ?? ''),
    default: schema.default != null ? String(schema.default) : undefined,
  };
}

function parseRequestBody(spec: OpenAPISpec, raw: unknown): ParsedBody | undefined {
  const resolved = resolveRef(spec, raw);
  if (!resolved) return undefined;

  const content = resolved.content as Record<string, Record<string, unknown>> | undefined;
  if (!content) return undefined;

  const jsonContent = content['application/json'];
  if (!jsonContent) {
    // Check for other content types
    const firstKey = Object.keys(content)[0];
    if (firstKey) {
      return { contentType: firstKey };
    }
    return undefined;
  }

  const schema = resolveRef(spec, jsonContent.schema);
  let example = jsonContent.example;
  if (!example && schema) {
    example = schema.example;
  }

  return {
    contentType: 'application/json',
    example: example ?? undefined,
    schema: schema ?? undefined,
  };
}

function parseSpec(spec: OpenAPISpec): ParsedEndpoint[] {
  const endpoints: ParsedEndpoint[] = [];
  const paths = spec.paths ?? {};

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue;

      const op = operation as Record<string, unknown>;
      const tags = (op.tags as string[]) ?? ['Other'];
      const params = (op.parameters as unknown[]) ?? [];

      endpoints.push({
        method: method.toUpperCase() as ParsedEndpoint['method'],
        path,
        tag: tags[0] ?? 'Other',
        summary: String(op.summary ?? ''),
        description: String(op.description ?? ''),
        operationId: String(op.operationId ?? ''),
        parameters: params
          .map(p => parseParameter(spec, p))
          .filter((p): p is ParsedParam => p !== null),
        requestBody: parseRequestBody(spec, op.requestBody),
        responses: Object.fromEntries(
          Object.entries((op.responses ?? {}) as Record<string, Record<string, unknown>>)
            .map(([code, resp]) => {
              const resolved = resolveRef(spec, resp);
              return [code, { description: String(resolved?.description ?? '') }];
            }),
        ),
      });
    }
  }

  // Sort by tag, then method weight, then path
  const methodWeight: Record<string, number> = { GET: 0, POST: 1, PUT: 2, PATCH: 3, DELETE: 4 };
  endpoints.sort((a, b) => {
    const tagCmp = a.tag.localeCompare(b.tag);
    if (tagCmp !== 0) return tagCmp;
    const mCmp = (methodWeight[a.method] ?? 9) - (methodWeight[b.method] ?? 9);
    if (mCmp !== 0) return mCmp;
    return a.path.localeCompare(b.path);
  });

  return endpoints;
}

/* ─── request execution ───────────────────────────────────────────────── */

async function executeRequest(
  url: string,
  method: string,
  body?: string,
  headers?: Record<string, string>,
): Promise<ApiResponse> {
  const start = performance.now();
  const fullUrl = apiUrl(url);

  const options: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body && method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
  };

  if (body && method !== 'GET') {
    options.body = body;
  }

  const resp = await fetch(fullUrl, options);
  const duration = Math.round(performance.now() - start);
  const contentType = resp.headers.get('content-type') ?? '';
  const text = await resp.text();
  const size = new Blob([text]).size;

  let parsed: unknown = text;
  if (contentType.includes('json')) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // keep as text
    }
  }

  const responseHeaders: Record<string, string> = {};
  resp.headers.forEach((v, k) => {
    responseHeaders[k] = v;
  });

  return {
    status: resp.status,
    statusText: resp.statusText,
    headers: responseHeaders,
    body: parsed,
    bodyText: text,
    duration,
    size,
    contentType,
  };
}

/* ─── history helpers ─────────────────────────────────────────────────── */

function loadHistory(): HistoryEntry[] {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch {
    // sessionStorage full — ignore
  }
}

/* ─── replay matching ─────────────────────────────────────────────────── */

/**
 * Tests whether an OpenAPI template path matches a concrete path where the
 * `{param}` slots have already been substituted. Segment counts must be
 * equal; a `{param}` segment matches any single non-empty segment; all other
 * segments must be literally equal.
 */
function pathMatchesTemplate(template: string, concrete: string): boolean {
  if (template === concrete) return true;
  const tSeg = template.split('/');
  const cSeg = concrete.split('/');
  if (tSeg.length !== cSeg.length) return false;
  for (let i = 0; i < tSeg.length; i++) {
    const t = tSeg[i];
    const c = cSeg[i];
    if (t.startsWith('{') && t.endsWith('}')) {
      if (c.length === 0) return false;
      continue;
    }
    if (t !== c) return false;
  }
  return true;
}

/**
 * Resolves the endpoint definition a history entry should re-select.
 *
 * A history entry stores the *concrete* path that was sent — path params
 * already substituted (e.g. `/vehicles/1/state`) — whereas an endpoint's
 * `path` is the OpenAPI *template* (`/vehicles/{vehicleID}/state`). A plain
 * equality check therefore fails to replay any endpoint that has path params.
 * We try an exact match first (fast path, and it disambiguates a literal route
 * that collides with a templated sibling), then fall back to a segment-wise
 * template match. Returns `undefined` when nothing matches.
 */
export function findReplayEndpoint(
  endpoints: ParsedEndpoint[],
  entry: HistoryEntry,
): ParsedEndpoint | undefined {
  const sameMethod = (endpoints ?? []).filter((e) => e.method === entry.method);
  const exact = sameMethod.find((e) => e.path === entry.path);
  if (exact) return exact;
  return sameMethod.find((e) => pathMatchesTemplate(e.path, entry.path));
}

/* ─── main page ───────────────────────────────────────────────────────── */

export default function ApiPlaygroundPage() {
  const { t } = useTranslation();
  usePageTitle(t('playground.title', 'API Playground'));

  const [selected, setSelected] = useState<ParsedEndpoint | null>(null);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const lastRequestRef = useRef<{ method: string; url: string; body?: string }>({ method: 'GET', url: '' });

  // Fetch and parse OpenAPI spec as text so YAML keys are preserved.
  const specQuery = useQuery<ParsedEndpoint[]>({
    queryKey: ['openapi-spec'],
    queryFn: async () => {
      const text = await request<string>('/system/openapi', {
        responseType: 'text',
        credentials: 'same-origin',
        headers: { Accept: 'text/yaml' },
      });
      const spec = yaml.load(text) as OpenAPISpec;
      return parseSpec(spec);
    },
    staleTime: Infinity,
  });
  const { data: endpoints, isLoading: specLoading, refetch: refetchSpec } = specQuery;

  const handleSelect = useCallback((ep: ParsedEndpoint) => {
    setSelected(ep);
    setResponse(null);
  }, []);

  const handleSend = useCallback(async (url: string, method: string, body?: string, headers?: Record<string, string>) => {
    setLoading(true);
    lastRequestRef.current = { method, url, body };

    try {
      const result = await executeRequest(url, method, body, headers);
      setResponse(result);

      // Add to history
      const entry: HistoryEntry = {
        method,
        path: url.split('?')[0],
        status: result.status,
        duration: result.duration,
        timestamp: new Date().toISOString(),
      };
      setHistory(prev => {
        const next = [entry, ...prev].slice(0, MAX_HISTORY);
        saveHistory(next);
        return next;
      });
    } catch (err) {
      const failMsg = err instanceof Error ? err.message : t('playground.requestFailed', 'Request failed');
      setResponse({
        status: 0,
        statusText: t('playground.networkError', 'Network Error'),
        headers: {},
        body: { error: failMsg },
        bodyText: failMsg,
        duration: 0,
        size: 0,
        contentType: 'text/plain',
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleReplay = useCallback((entry: HistoryEntry) => {
    // Match against the endpoint template so replay still works after path
    // params were substituted into the stored history path (e.g.
    // `/vehicles/1/state` must re-select `/vehicles/{vehicleID}/state`).
    const ep = findReplayEndpoint(endpoints ?? [], entry);
    if (ep) {
      setSelected(ep);
      setResponse(null);
    }
  }, [endpoints]);

  const allEndpoints = endpoints ?? [];

  // KPI band — every value is derived from the already-loaded spec and the
  // local request history, so the overview never fetches or fabricates data.
  const stats = useMemo(() => {
    const list = endpoints ?? [];
    const total = list.length;
    const read = list.filter((e) => e.method === 'GET').length;
    const groups = new Set(list.map((e) => e.tag || 'Other')).size;
    return { total, read, write: total - read, groups };
  }, [endpoints]);

  const historyStats = useMemo(() => {
    if (history.length === 0) return { count: 0, avgMs: 0 };
    const sum = history.reduce((acc, h) => acc + (h.duration ?? 0), 0);
    return { count: history.length, avgMs: Math.round(sum / history.length) };
  }, [history]);

  const kpis = useMemo<Array<{ key: string; label: string; value: string | number; icon: ReactNode; color: NeonColor }>>(() => [
    { key: 'total', label: t('playground.kpi.total', 'Total Endpoints'), value: stats.total, icon: <Boxes className="h-5 w-5" aria-hidden="true" />, color: 'cyan' },
    { key: 'read', label: t('playground.kpi.read', 'Read (GET)'), value: stats.read, icon: <ArrowDownToLine className="h-5 w-5" aria-hidden="true" />, color: 'green' },
    { key: 'write', label: t('playground.kpi.write', 'Write Ops'), value: stats.write, icon: <ArrowUpToLine className="h-5 w-5" aria-hidden="true" />, color: 'amber' },
    { key: 'groups', label: t('playground.kpi.groups', 'API Groups'), value: stats.groups, icon: <Tags className="h-5 w-5" aria-hidden="true" />, color: 'purple' },
    { key: 'recent', label: t('playground.kpi.recent', 'Recent Requests'), value: historyStats.count, icon: <History className="h-5 w-5" aria-hidden="true" />, color: 'blue' },
    { key: 'latency', label: t('playground.kpi.latency', 'Avg Latency'), value: historyStats.count > 0 ? `${historyStats.avgMs} ms` : '—', icon: <Timer className="h-5 w-5" aria-hidden="true" />, color: 'cyan' },
  ], [t, stats, historyStats]);

  const actions = (
    <Button
      variant="ghost"
      onClick={() => refetchSpec()}
      disabled={specLoading}
      aria-label={t('playground.refresh', 'Reload API spec')}
    >
      <RefreshCw className={cn('h-4 w-4', specLoading && 'animate-spin')} aria-hidden="true" />
    </Button>
  );

  return (
    <PageContainer
      title={t('playground.title', 'API Playground')}
      subtitle={t('playground.subtitle', 'Explore and test TeslaSync API endpoints')}
      actions={actions}
      query={specQuery}
    >
      {/* 1 — KPI band: derived spec + history metrics, full-width responsive strip */}
      <FadeIn>
        <section
          aria-label={t('playground.kpis', 'API overview metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 3xl:grid-cols-6"
        >
          {specLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} height={84} className="rounded-xl" />
              ))
            : kpis.map((k) => (
                <MetricCard key={k.key} label={k.label} value={k.value} icon={k.icon} color={k.color} />
              ))}
        </section>
      </FadeIn>

      {/* 2 — Workspace: endpoint explorer + request/response, full-bleed bento */}
      <FadeIn delay={0.1}>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[20rem_minmax(0,1fr)] xl:gap-5">
          {/* Endpoint explorer — sticky, self-scrolling nav column */}
          <aside
            aria-label={t('playground.explorer', 'Endpoint explorer')}
            className="xl:sticky xl:top-4 xl:self-start"
          >
            <GlassPanel className="flex h-[26rem] flex-col overflow-hidden xl:h-[calc(100vh-13rem)]">
              {specLoading ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <Skeleton key={i} height={24} className="rounded" />
                  ))}
                </div>
              ) : specQuery.isError ? (
                <div className="p-4">
                  <QueryError
                    error={specQuery.error}
                    onRetry={() => refetchSpec()}
                    resourceName={t('playground.spec', 'API spec')}
                  />
                </div>
              ) : allEndpoints.length === 0 ? (
                <EmptyState /* no-action: transient empty state — surfaces when the spec exposes no endpoints; no specific recovery action available */
                  icon={<BookOpen className="h-8 w-8" />}
                  message={t('playground.noEndpoints', 'No endpoints found in the API spec')}
                />
              ) : (
                <EndpointSidebar
                  endpoints={allEndpoints}
                  selected={selected}
                  onSelect={handleSelect}
                />
              )}
            </GlassPanel>
          </aside>

          {/* Request / response workspace */}
          <section
            aria-label={t('playground.workspace', 'Request workspace')}
            className="min-w-0 space-y-4"
          >
            {!selected ? (
              <GlassPanel className="p-6 sm:p-8">
                <EmptyState /* no-action: transient empty state — surfaces before an endpoint is picked; selecting one is the recovery path */
                  icon={<BookOpen className="h-8 w-8" />}
                  message={t('playground.selectEndpoint', 'Select an endpoint from the explorer to start testing')}
                />
                {allEndpoints.length > 0 && (
                  <Text as="p" variant="caption" className="mt-2 text-center">
                    {t('playground.endpointCount', '{{count}} endpoints available', { count: allEndpoints.length })}
                  </Text>
                )}
              </GlassPanel>
            ) : (
              <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2 2xl:gap-5">
                {/* Request column — builder + generated code snippet */}
                <section
                  aria-label={t('playground.request', 'Request')}
                  className="min-w-0 space-y-4"
                >
                  <RequestBuilder endpoint={selected} onSend={handleSend} loading={loading} />
                  {response && (
                    <SnippetPanel
                      method={lastRequestRef.current.method}
                      url={apiUrl(lastRequestRef.current.url)}
                      body={lastRequestRef.current.body}
                    />
                  )}
                </section>

                {/* Response column — status, body, headers, replay history */}
                <section
                  aria-label={t('playground.responseSection', 'Response')}
                  className="min-w-0"
                >
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
    </PageContainer>
  );
}
