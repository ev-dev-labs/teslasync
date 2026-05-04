import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import yaml from 'js-yaml';
import { PageContainer } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { EmptyState, Skeleton } from '@/components/feedback';
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
  const { data: endpoints, isLoading: specLoading, error: specError } = useQuery<ParsedEndpoint[]>({
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
      setResponse({
        status: 0,
        statusText: 'Network Error',
        headers: {},
        body: { error: err instanceof Error ? err.message : 'Request failed' },
        bodyText: err instanceof Error ? err.message : 'Request failed',
        duration: 0,
        size: 0,
        contentType: 'text/plain',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const handleReplay = useCallback((entry: HistoryEntry) => {
    // Find matching endpoint
    const ep = (endpoints ?? []).find(
      e => e.method === entry.method && e.path === entry.path,
    );
    if (ep) {
      setSelected(ep);
      setResponse(null);
    }
  }, [endpoints]);

  const allEndpoints = endpoints ?? [];

  return (
    <PageContainer
      title={t('playground.title', 'API Playground')}
      subtitle={t('playground.subtitle', 'Explore and test TeslaSync API endpoints')}
      loading={specLoading}
      error={specError instanceof Error ? specError : specError ? new Error(String(specError)) : null}
    >
      <FadeIn>
        <div className="flex gap-4 min-h-[600px]">
          {/* Sidebar */}
          <GlassPanel className="w-72 shrink-0 overflow-hidden flex flex-col">
            {specLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 10 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 rounded" />
                ))}
              </div>
            ) : (
              <EndpointSidebar
                endpoints={allEndpoints}
                selected={selected}
                onSelect={handleSelect}
              />
            )}
          </GlassPanel>

          {/* Main panel */}
          <div className="flex-1 space-y-4 min-w-0">
            {!selected ? (
              <GlassPanel className="p-8">
                <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                  icon={<BookOpen className="h-8 w-8" />}
                  message={t('playground.selectEndpoint', 'Select an endpoint from the sidebar to start testing')}
                />
                {allEndpoints.length > 0 && (
                  <p className="text-center text-xs text-[var(--text-muted)] mt-2">
                    {t('playground.endpointCount', '{{count}} endpoints available', { count: allEndpoints.length })}
                  </p>
                )}
              </GlassPanel>
            ) : (
              <>
                {/* Request builder */}
                <RequestBuilder
                  endpoint={selected}
                  onSend={handleSend}
                  loading={loading}
                />

                {/* Code snippet for current request */}
                {response && (
                  <SnippetPanel
                    method={lastRequestRef.current.method}
                    url={apiUrl(lastRequestRef.current.url)}
                    body={lastRequestRef.current.body}
                  />
                )}

                {/* Response viewer */}
                <ResponseViewer
                  response={response}
                  loading={loading}
                  history={history}
                  onReplay={handleReplay}
                />
              </>
            )}
          </div>
        </div>
      </FadeIn>
    </PageContainer>
  );
}
