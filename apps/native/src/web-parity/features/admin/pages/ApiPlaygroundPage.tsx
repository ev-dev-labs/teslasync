/**
 * Native parity port of
 * web/src/features/admin/pages/ApiPlaygroundPage.tsx.
 *
 * The web file is the API-Playground page: it fetches the backend OpenAPI YAML
 * spec (`GET /api/v1/system/openapi`, requested as raw text so YAML keys survive),
 * parses it into a flat, sorted `ParsedEndpoint[]`, and renders a two-column
 * workspace — an `EndpointSidebar` navigator on the left and, on the right, either
 * an empty "select an endpoint" state or the `RequestBuilder` + (after a send) a
 * `SnippetPanel` + the `ResponseViewer`. It owns the `selected` / `response` /
 * `loading` / `history` state, runs requests via a raw-fetch `executeRequest`
 * helper (capturing status / headers / timing / byte-size), records a capped,
 * session-persisted request history, and replays history entries back into the
 * builder. This native port preserves that contract 1:1 — the same state names,
 * the same `/system/openapi` fetch + `parseSpec` pipeline, the verbatim OpenAPI
 * `resolveRef` / `parseParameter` / `parseRequestBody` / `parseSpec` parser, the
 * verbatim `executeRequest` request flow, the `HISTORY_KEY` / `MAX_HISTORY`
 * history helpers, and the `handleSelect` / `handleSend` / `handleReplay`
 * callbacks — using React Native primitives + the existing native AppText /
 * GlassPanel / design tokens and the already-ported sibling EndpointSidebar /
 * RequestBuilder / ResponseViewer.
 *
 * Browser-only / unconverted dependencies are reduced explicitly and documented
 * in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L2): native-safe `t(key, fallback?,
 *     vars?)` fallback (the RequestBuilder precedent) returning the English
 *     default and interpolating i18next-style `{{token}}` placeholders, so the
 *     `playground.endpointCount` `{{count}}` message keeps its i18n intent. Every
 *     web key is preserved verbatim.
 *   - `@tanstack/react-query` `useQuery` (web L3): kept verbatim — react-query is
 *     a native dependency and the page is mounted under the native QueryClient.
 *   - lucide-react `BookOpen` (web L4): rendered as a decorative AppText glyph
 *     (BOOK_GLYPH) — the established native inline-icon stand-in.
 *   - js-yaml `yaml` (web L5): kept verbatim (pure-JS, installed, runs under
 *     Metro + Jest); typed via the colocated `js-yaml.d.ts` ambient shim.
 *   - `@/components/layout` `PageContainer` (web L6): no native parity port exists
 *     yet (this is the first page conversion), so a minimal native-safe
 *     `PageScaffold` is reproduced locally (title / subtitle / loading / error /
 *     children — the only props this page uses), the established "reproduce
 *     locally when no native parity port exists" precedent.
 *   - `@/components/ui` `GlassPanel` (web L7): the existing native GlassPanel.
 *   - `@/components/feedback` `EmptyState` / `Skeleton` (web L8): minimal local
 *     native-safe equivalents (an AppText empty state + a token-backed box).
 *   - `@/components/motion` `FadeIn` (web L9): framer-motion entrance -> a static
 *     passthrough View (the Layout framer-motion -> static precedent).
 *   - `@/hooks/usePageTitle` (web L10): `document.title` is browser-only, so the
 *     native hook is a documented no-op (the native navigator owns the title).
 *   - `@/api/client` `apiUrl` / `request` (web L11): the web-parity native client,
 *     whose `request` supports `responseType: 'text'`, so the YAML fetch maps 1:1.
 *   - sessionStorage history persistence (web L200-215): React Native has no Web
 *     Storage API, so it is reduced to an in-memory module store mirroring
 *     getItem/setItem (the MaintenanceBanner / DraftRestorePrompt precedent); the
 *     HISTORY_KEY namespace + MAX_HISTORY cap + try/catch shape are preserved and
 *     a fresh JS runtime starts with empty history (matching sessionStorage's
 *     per-session semantics).
 *   - `performance.now()` (web L150/167): not typed in RN globals, so timing uses
 *     `Date.now()` — the duration is `Math.round`-ed to whole ms either way.
 *   - `new Blob([text]).size` (web L170): kept verbatim — Blob (with `.size`) IS
 *     typed in RN globals and returns the same UTF-8 byte count at runtime.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';
import yaml from 'js-yaml';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';
import {apiUrl, request} from '../../../api/client';
import EndpointSidebar, {
  type ParsedBody,
  type ParsedEndpoint,
  type ParsedParam,
} from '../components/EndpointSidebar';
import RequestBuilder from '../components/RequestBuilder';
import ResponseViewer, {
  SnippetPanel,
  type ApiResponse,
  type HistoryEntry,
} from '../components/ResponseViewer';

/* ─── constants ───────────────────────────────────────────────────────── */

const HISTORY_KEY = 'teslasync-api-playground-history';
const MAX_HISTORY = 20;

/* ─── decorative glyph stand-in for the lucide-react icon ─────────────────── */

const BOOK_GLYPH = '\uD83D\uDCD6'; // 📖 (lucide BookOpen)

/* ─── native translation fallback (native-safe port of react-i18next) ─────── */

type NativeTFunction = (
  key: string,
  fallback?: string,
  vars?: Record<string, string | number>,
) => string;

/**
 * Mirrors `t(key, default?, vars?)`: returns the English default (else the key)
 * and interpolates i18next-style `{{token}}` placeholders, preserving i18n
 * intent for the `{{count}}` endpoint-count message.
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key, fallback, vars) => {
      const template = fallback ?? key;
      if (!vars) {
        return template;
      }
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        Object.prototype.hasOwnProperty.call(vars, name)
          ? String(vars[name])
          : `{{${name}}}`,
      );
    },
    [],
  );
}

/* ─── native-safe usePageTitle (web document.title is browser-only) ───────── */

function usePageTitle(title: string): void {
  useEffect(() => {
    // The web hook writes document.title; on native the navigator owns the
    // header title, so the resolved title is intentionally not applied here.
    void title;
  }, [title]);
}

/* ─── OpenAPI spec parser (ported verbatim) ───────────────────────────────── */

interface OpenAPISpec {
  paths?: Record<string, Record<string, Record<string, unknown>>>;
  components?: {
    parameters?: Record<string, Record<string, unknown>>;
    schemas?: Record<string, unknown>;
  };
  tags?: Array<{name: string; description?: string}>;
}

function resolveRef(spec: OpenAPISpec, ref: unknown): Record<string, unknown> | null {
  if (typeof ref !== 'object' || ref === null) {
    return null;
  }
  const obj = ref as Record<string, unknown>;
  const refStr = obj['$ref'];
  if (typeof refStr !== 'string') {
    return obj;
  }

  // Parse $ref like "#/components/parameters/vehicleID"
  const parts = refStr.replace('#/', '').split('/');
  let current: unknown = spec;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'object' && current !== null
    ? (current as Record<string, unknown>)
    : null;
}

function parseParameter(spec: OpenAPISpec, raw: unknown): ParsedParam | null {
  const resolved = resolveRef(spec, raw);
  if (!resolved) {
    return null;
  }

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
  if (!resolved) {
    return undefined;
  }

  const content = resolved.content as Record<string, Record<string, unknown>> | undefined;
  if (!content) {
    return undefined;
  }

  const jsonContent = content['application/json'];
  if (!jsonContent) {
    // Check for other content types
    const firstKey = Object.keys(content)[0];
    if (firstKey) {
      return {contentType: firstKey};
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
      if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
        continue;
      }

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
          Object.entries((op.responses ?? {}) as Record<string, Record<string, unknown>>).map(
            ([code, resp]) => {
              const resolved = resolveRef(spec, resp);
              return [code, {description: String(resolved?.description ?? '')}];
            },
          ),
        ),
      });
    }
  }

  // Sort by tag, then method weight, then path
  const methodWeight: Record<string, number> = {GET: 0, POST: 1, PUT: 2, PATCH: 3, DELETE: 4};
  endpoints.sort((a, b) => {
    const tagCmp = a.tag.localeCompare(b.tag);
    if (tagCmp !== 0) {
      return tagCmp;
    }
    const mCmp = (methodWeight[a.method] ?? 9) - (methodWeight[b.method] ?? 9);
    if (mCmp !== 0) {
      return mCmp;
    }
    return a.path.localeCompare(b.path);
  });

  return endpoints;
}

/* ─── request execution (ported verbatim; browser globals reduced) ───────── */

async function executeRequest(
  url: string,
  method: string,
  body?: string,
  headers?: Record<string, string>,
): Promise<ApiResponse> {
  const start = Date.now();
  const fullUrl = apiUrl(url);

  const options: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body && method !== 'GET' ? {'Content-Type': 'application/json'} : {}),
      ...headers,
    },
  };

  if (body && method !== 'GET') {
    options.body = body;
  }

  const resp = await fetch(fullUrl, options);
  const duration = Math.round(Date.now() - start);
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

/* ─── history helpers (sessionStorage -> in-memory native store) ──────────── */

// React Native has no Web Storage API. This module-level store mirrors
// sessionStorage's getItem/setItem and lives for the JS runtime, so history
// survives navigation within a session and resets on a cold start — matching
// the per-session semantics of the web sessionStorage usage.
const sessionStore = new Map<string, string>();

function loadHistory(): HistoryEntry[] {
  try {
    const raw = sessionStore.get(HISTORY_KEY) ?? null;
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  try {
    sessionStore.set(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch {
    // store full — ignore
  }
}

/* ─── native-safe page scaffold (web PageContainer) ───────────────────────── */

function Skeleton({style}: {style?: StyleProp<ViewStyle>}) {
  return <View style={[styles.skeleton, style]} />;
}

function FadeIn({children}: {children: ReactNode}) {
  return <View>{children}</View>;
}

interface PageScaffoldProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: Error | null;
  children: ReactNode;
}

function PageScaffold({title, subtitle, loading, error, children}: PageScaffoldProps) {
  return (
    <ScrollView contentContainerStyle={styles.scaffold} testID="api-playground-page">
      <View style={styles.scaffoldHeader}>
        <AppText style={styles.scaffoldTitle} variant="title" weight="bold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={styles.scaffoldSubtitle} tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.scaffoldLoading} testID="api-playground-loading">
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.scaffoldError} testID="api-playground-error">
          <AppText style={styles.scaffoldErrorText}>{error.message}</AppText>
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

/* ─── main page ───────────────────────────────────────────────────────── */

export default function ApiPlaygroundPage() {
  const t = useNativeTranslationFallback();
  usePageTitle(t('playground.title', 'API Playground'));

  const [selected, setSelected] = useState<ParsedEndpoint | null>(null);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const lastRequestRef = useRef<{method: string; url: string; body?: string}>({
    method: 'GET',
    url: '',
  });

  // Fetch and parse OpenAPI spec as text so YAML keys are preserved.
  const {
    data: endpoints,
    isLoading: specLoading,
    error: specError,
  } = useQuery<ParsedEndpoint[]>({
    queryKey: ['openapi-spec'],
    queryFn: async () => {
      const text = await request<string>('/system/openapi', {
        responseType: 'text',
        credentials: 'same-origin',
        headers: {Accept: 'text/yaml'},
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

  const handleSend = useCallback(
    async (url: string, method: string, body?: string, headers?: Record<string, string>) => {
      setLoading(true);
      lastRequestRef.current = {method, url, body};

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
          body: {error: err instanceof Error ? err.message : 'Request failed'},
          bodyText: err instanceof Error ? err.message : 'Request failed',
          duration: 0,
          size: 0,
          contentType: 'text/plain',
        });
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const handleReplay = useCallback(
    (entry: HistoryEntry) => {
      // Find matching endpoint
      const ep = (endpoints ?? []).find(
        e => e.method === entry.method && e.path === entry.path,
      );
      if (ep) {
        setSelected(ep);
        setResponse(null);
      }
    },
    [endpoints],
  );

  const allEndpoints = endpoints ?? [];

  return (
    <PageScaffold
      error={
        specError instanceof Error
          ? specError
          : specError
            ? new Error(String(specError))
            : null
      }
      loading={specLoading}
      subtitle={t('playground.subtitle', 'Explore and test TeslaSync API endpoints')}
      title={t('playground.title', 'API Playground')}>
      <FadeIn>
        <View style={styles.layout}>
          {/* Sidebar */}
          <GlassPanel style={styles.sidebarPanel}>
            {specLoading ? (
              <View style={styles.sidebarSkeletons}>
                {Array.from({length: 10}).map((_, i) => (
                  <Skeleton key={i} style={styles.sidebarSkeletonRow} />
                ))}
              </View>
            ) : (
              <EndpointSidebar
                endpoints={allEndpoints}
                onSelect={handleSelect}
                selected={selected}
              />
            )}
          </GlassPanel>

          {/* Main panel */}
          <View style={styles.mainPanel}>
            {!selected ? (
              <GlassPanel style={styles.emptyPanel} testID="api-playground-empty">
                <View style={styles.emptyState}>
                  <AppText style={styles.emptyGlyph} tone="muted">
                    {BOOK_GLYPH}
                  </AppText>
                  <AppText style={styles.emptyMessage} tone="muted">
                    {t(
                      'playground.selectEndpoint',
                      'Select an endpoint from the sidebar to start testing',
                    )}
                  </AppText>
                </View>
                {allEndpoints.length > 0 ? (
                  <AppText style={styles.endpointCount} tone="muted">
                    {t('playground.endpointCount', '{{count}} endpoints available', {
                      count: allEndpoints.length,
                    })}
                  </AppText>
                ) : null}
              </GlassPanel>
            ) : (
              <>
                {/* Request builder */}
                <RequestBuilder endpoint={selected} loading={loading} onSend={handleSend} />

                {/* Code snippet for current request */}
                {response ? (
                  <SnippetPanel
                    body={lastRequestRef.current.body}
                    method={lastRequestRef.current.method}
                    url={apiUrl(lastRequestRef.current.url)}
                  />
                ) : null}

                {/* Response viewer */}
                <ResponseViewer
                  history={history}
                  loading={loading}
                  onReplay={handleReplay}
                  response={response}
                />
              </>
            )}
          </View>
        </View>
      </FadeIn>
    </PageScaffold>
  );
}

const styles = StyleSheet.create({
  scaffold: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  scaffoldHeader: {
    gap: spacing.xs,
  },
  scaffoldTitle: {
    letterSpacing: -0.5,
  },
  scaffoldSubtitle: {
    fontSize: typography.caption,
  },
  scaffoldLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  scaffoldError: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    padding: spacing.md,
  },
  scaffoldErrorText: {
    fontSize: typography.caption,
    color: colors.danger,
  },
  layout: {
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 600,
  },
  sidebarPanel: {
    width: 288,
    overflow: 'hidden',
  },
  sidebarSkeletons: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  sidebarSkeletonRow: {
    height: 24,
  },
  mainPanel: {
    flex: 1,
    gap: spacing.md,
    minWidth: 0,
  },
  emptyPanel: {
    padding: spacing.xl,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  emptyGlyph: {
    fontSize: 32,
  },
  emptyMessage: {
    fontSize: typography.caption,
    textAlign: 'center',
  },
  endpointCount: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  skeleton: {
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 6,
  },
});
