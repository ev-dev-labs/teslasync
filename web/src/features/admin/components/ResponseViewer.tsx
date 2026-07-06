import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { GlassPanel, Button as UiButton, CopyButton, Text } from '@/components/ui';
import { Skeleton, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

/* ─── types ───────────────────────────────────────────────────────────── */

export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  bodyText: string;
  duration: number;
  size: number;
  contentType: string;
}

export interface HistoryEntry {
  method: string;
  path: string;
  status: number;
  duration: number;
  timestamp: string;
}

interface ResponseViewerProps {
  response: ApiResponse | null;
  loading: boolean;
  history: HistoryEntry[];
  onReplay: (entry: HistoryEntry) => void;
}

/* ─── helpers ─────────────────────────────────────────────────────────── */

function formatBytes(bytes: number): string {
  // Guard against a missing/NaN/Infinity/negative size — the API occasionally
  // omits Content-Length, and a bare `${bytes}` would render "NaN MB" or a
  // nonsensical negative size instead of a neutral value.
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusColor(status: number): string {
  if (status < 300) return 'text-green-400';
  if (status < 400) return 'text-amber-400';
  return 'text-red-400';
}

function statusBg(status: number): string {
  if (status < 300) return 'bg-green-500/10 border-green-500/20';
  if (status < 400) return 'bg-amber-500/10 border-amber-500/20';
  return 'bg-red-500/10 border-red-500/20';
}

/* ─── body formatting ─────────────────────────────────────────────────── */

/**
 * Renders the response payload as display text. JSON bodies are pretty-printed;
 * everything else falls back to the raw `bodyText`. Hardened against three
 * runtime hazards a bare `JSON.stringify` would hit:
 *   - a circular / non-serialisable body (stringify throws) → raw text,
 *   - an `undefined` body (stringify returns `undefined`) → raw text,
 *   - a missing `bodyText` → empty string (never a blank `undefined`).
 */
function formatBody(response: ApiResponse): string {
  const isJson = (response.contentType ?? '').includes('json');
  if (isJson && typeof response.body !== 'string') {
    try {
      return JSON.stringify(response.body, null, 2) ?? (response.bodyText ?? '');
    } catch {
      return response.bodyText ?? '';
    }
  }
  return response.bodyText ?? '';
}

/* ─── code snippet generator ──────────────────────────────────────────── */

type SnippetFormat = 'curl' | 'javascript' | 'python' | 'go';

const SNIPPET_FORMATS: ReadonlyArray<{ value: SnippetFormat; label: string }> = [
  { value: 'curl', label: 'cURL' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'go', label: 'Go' },
];

function generateSnippet(
  method: string,
  url: string,
  format: SnippetFormat,
  body?: string,
): string {
  const authNote = '# Add auth: -H "X-API-Key: YOUR_KEY" or use session cookies';

  switch (format) {
    case 'curl': {
      const parts = [`curl -X ${method} '${url}'`];
      if (body && method !== 'GET') {
        parts.push(`  -H 'Content-Type: application/json'`);
        parts.push(`  -d '${body}'`);
      }
      return `${authNote}\n${parts.join(' \\\n')}`;
    }
    case 'javascript':
      return `// Auth: include credentials or X-API-Key header
const response = await fetch('${url}', {
  method: '${method}',${body && method !== 'GET' ? `\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify(${body}),` : ''}
});
const data = await response.json();`;
    case 'python':
      return `# Auth: pass headers={"X-API-Key": "YOUR_KEY"}
import requests

response = requests.${method.toLowerCase()}('${url}'${body && method !== 'GET' ? `, json=${body}` : ''})
data = response.json()`;
    case 'go':
      if (method === 'GET') {
        return `// Auth: add X-API-Key header to the request
resp, err := http.Get("${url}")
if err != nil { log.Fatal(err) }
defer resp.Body.Close()`;
      }
      return `// Auth: add X-API-Key header to the request
body := strings.NewReader(\`${body ?? '{}'}\`)
req, _ := http.NewRequest("${method}", "${url}", body)
req.Header.Set("Content-Type", "application/json")
resp, err := http.DefaultClient.Do(req)
if err != nil { log.Fatal(err) }
defer resp.Body.Close()`;
    default:
      return '';
  }
}

/* ─── snippet panel ───────────────────────────────────────────────────── */

function SnippetPanel({ method, url, body }: { method: string; url: string; body?: string }) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<SnippetFormat>('curl');
  const [open, setOpen] = useState(false);

  const snippet = useMemo(
    () => generateSnippet(method, url, format, body),
    [method, url, format, body],
  );

  return (
    <div className="mt-3">
      <UiButton
        type="button"
        variant="ghost"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="!h-auto !px-0 !py-0 text-xs text-[var(--text-muted)] hover:!bg-transparent hover:text-[var(--text-secondary)]"
      >
        <ChevronDown aria-hidden="true" className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
        {t('playground.codeSnippet', 'Code Snippet')}
      </UiButton>
      {open && (
        <div className="mt-2 rounded-lg border border-white/[0.06] bg-[var(--surface-overlay)] overflow-hidden">
          <div className="flex items-center gap-1 p-2 border-b border-white/[0.04]">
            {SNIPPET_FORMATS.map(f => (
              <UiButton
                key={f.value}
                type="button"
                variant="ghost"
                onClick={() => setFormat(f.value)}
                aria-pressed={format === f.value}
                className={cn(
                  '!h-auto !px-2 !py-0.5 text-2xs font-medium',
                  format === f.value
                    ? '!bg-[var(--surface-2)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:!bg-transparent hover:text-[var(--text-secondary)]',
                )}
              >
                {f.label}
              </UiButton>
            ))}
            <div className="flex-1" />
            <CopyButton
              text={snippet}
              variant="primary"
              size="sm"
              withToast
              label={t('playground.copy', 'Copy')}
              className="!text-2xs !px-2 !py-0.5 !h-auto"
            />
          </div>
          <pre
            aria-label={t('playground.codeSnippetContent', 'Generated code snippet')}
            className="p-3 text-xs font-mono text-[var(--text-secondary)] overflow-x-auto whitespace-pre"
          >
            {snippet}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ─── response headers toggle ─────────────────────────────────────────── */

function ResponseHeaders({ headers }: { headers: Record<string, string> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const entries = Object.entries(headers);
  if (entries.length === 0) return null;

  return (
    <div className="mt-2">
      <UiButton
        type="button"
        variant="ghost"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="!h-auto !px-0 !py-0 text-xs text-[var(--text-muted)] hover:!bg-transparent hover:text-[var(--text-secondary)]"
      >
        <ChevronDown aria-hidden="true" className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
        {t('playground.responseHeaders', 'Response Headers')} ({entries.length})
      </UiButton>
      {open && (
        <div className="mt-1 rounded-lg border border-white/[0.04] bg-[var(--surface-overlay)] p-2 text-2xs font-mono text-[var(--text-muted)] space-y-0.5 max-h-40 overflow-y-auto">
          {entries.map(([k, v]) => (
            <div key={k}>
              <span className="text-[var(--text-secondary)]">{k}:</span> {v}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── history strip ───────────────────────────────────────────────────── */

function RequestHistory({ history, onReplay }: { history: HistoryEntry[]; onReplay: (e: HistoryEntry) => void }) {
  const { t } = useTranslation();

  const items = history ?? [];
  if (items.length === 0) return null;

  return (
    <GlassPanel className="p-3">
      <Text as="h4" size="2xs" weight="semibold" color="muted" className="uppercase tracking-wider mb-2">
        {t('playground.history', 'Recent Requests')}
      </Text>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {items.map((h, i) => (
          <UiButton
            key={`${h.timestamp}-${h.method}-${h.path}-${i}`}
            type="button"
            variant="ghost"
            onClick={() => onReplay(h)}
            className="!h-auto flex-shrink-0 gap-1.5 !rounded-md border border-white/[0.04] !bg-white/[0.03] !px-2 !py-1 font-mono text-2xs hover:!bg-white/[0.06]"
            title={`${h.method} ${h.path} → ${h.status} (${h.duration}ms)`}
          >
            <span
              className={cn(
                'px-1 py-0.5 rounded text-2xs font-bold',
                h.method === 'GET' ? 'bg-green-500/20 text-green-400' :
                h.method === 'POST' ? 'bg-blue-500/20 text-blue-400' :
                h.method === 'DELETE' ? 'bg-red-500/20 text-red-400' :
                'bg-amber-500/20 text-amber-400',
              )}
            >
              {h.method}
            </span>
            <span className="text-[var(--text-muted)] max-w-[120px] truncate">{h.path}</span>
            <span className={cn('font-bold', statusColor(h.status))}>
              {h.status}
            </span>
            <span className="text-[var(--text-muted)]">{h.duration}ms</span>
          </UiButton>
        ))}
      </div>
    </GlassPanel>
  );
}

/* ─── main component ──────────────────────────────────────────────────── */

export default function ResponseViewer({ response, loading, history, onReplay }: ResponseViewerProps) {
  const { t } = useTranslation();

  // Pretty-printing a large JSON body is non-trivial — memoise so it only
  // recomputes when a new response actually arrives.
  const formattedBody = useMemo(() => (response ? formatBody(response) : ''), [response]);

  return (
    <div className="space-y-3">
      {/* Response */}
      <GlassPanel className="p-4">
        <Text as="h4" size="xs" weight="semibold" color="secondary" className="uppercase tracking-wider mb-3">
          {t('playground.response', 'Response')}
        </Text>

        {loading && <Skeleton className="h-48 rounded-lg" />}

        {!loading && !response && (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            message={t('playground.noResponse', 'Send a request to see the response')}
          />
        )}

        {!loading && response && (
          <FadeIn>
            {/* Status bar */}
            <div className={cn(
              'flex items-center justify-between rounded-lg border px-4 py-2 mb-3',
              statusBg(response.status),
            )}>
              <Text size="sm" weight="bold" mono className={statusColor(response.status)}>
                {response.status} {response.statusText}
              </Text>
              <Text variant="caption">
                {response.duration}ms · {formatBytes(response.size)}
              </Text>
            </div>

            {/* Body */}
            <pre
              role="region"
              aria-label={t('playground.responseBody', 'Response body')}
              className="text-xs font-mono text-[var(--text-secondary)] overflow-auto max-h-[500px] bg-[var(--surface-overlay)] rounded-lg p-3 border border-white/[0.04]"
            >
              {formattedBody}
            </pre>

            {/* Response headers */}
            <ResponseHeaders headers={response.headers} />
          </FadeIn>
        )}
      </GlassPanel>

      {/* History */}
      <RequestHistory history={history} onReplay={onReplay} />
    </div>
  );
}

export { SnippetPanel, type ApiResponse as ApiResponseType };
