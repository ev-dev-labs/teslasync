import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { GlassPanel, Button } from '@/components/ui';
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

/* ─── code snippet generator ──────────────────────────────────────────── */

function generateSnippet(
  method: string,
  url: string,
  format: 'curl' | 'javascript' | 'python' | 'go',
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
  const [format, setFormat] = useState<'curl' | 'javascript' | 'python' | 'go'>('curl');
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const snippet = generateSnippet(method, url, format, body);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formats: Array<{ value: typeof format; label: string }> = [
    { value: 'curl', label: 'cURL' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'python', label: 'Python' },
    { value: 'go', label: 'Go' },
  ];

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[11px] text-white/40 hover:text-white/60 transition-colors"
      >
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
        {t('playground.codeSnippet', 'Code Snippet')}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-white/[0.06] bg-black/30 overflow-hidden">
          <div className="flex items-center gap-1 p-2 border-b border-white/[0.04]">
            {formats.map(f => (
              <button
                key={f.value}
                onClick={() => setFormat(f.value)}
                className={cn(
                  'px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                  format === f.value
                    ? 'bg-white/10 text-white/80'
                    : 'text-white/40 hover:text-white/60',
                )}
              >
                {f.label}
              </button>
            ))}
            <div className="flex-1" />
            <Button
              onClick={handleCopy}
              className="!text-[10px] !px-2 !py-0.5"
            >
              {copied ? (
                <><Check className="h-3 w-3 mr-1" />{t('playground.copied', 'Copied')}</>
              ) : (
                <><Copy className="h-3 w-3 mr-1" />{t('playground.copy', 'Copy')}</>
              )}
            </Button>
          </div>
          <pre className="p-3 text-[11px] font-mono text-white/60 overflow-x-auto whitespace-pre">
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
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[11px] text-white/40 hover:text-white/60 transition-colors"
      >
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
        {t('playground.responseHeaders', 'Response Headers')} ({entries.length})
      </button>
      {open && (
        <div className="mt-1 rounded-lg border border-white/[0.04] bg-black/20 p-2 text-[10px] font-mono text-white/40 space-y-0.5 max-h-40 overflow-y-auto">
          {entries.map(([k, v]) => (
            <div key={k}>
              <span className="text-white/50">{k}:</span> {v}
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

  if (history.length === 0) return null;

  return (
    <GlassPanel className="p-3">
      <h4 className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-2">
        {t('playground.history', 'Recent Requests')}
      </h4>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {history.map((h, i) => (
          <button
            key={i}
            onClick={() => onReplay(h)}
            className="flex-shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.04] transition-colors"
            title={`${h.method} ${h.path} → ${h.status} (${h.duration}ms)`}
          >
            <span
              className={cn(
                'px-1 py-0.5 rounded text-[8px] font-bold',
                h.method === 'GET' ? 'bg-green-500/20 text-green-400' :
                h.method === 'POST' ? 'bg-blue-500/20 text-blue-400' :
                h.method === 'DELETE' ? 'bg-red-500/20 text-red-400' :
                'bg-amber-500/20 text-amber-400',
              )}
            >
              {h.method}
            </span>
            <span className="text-white/40 max-w-[120px] truncate">{h.path}</span>
            <span className={cn('font-bold', statusColor(h.status))}>
              {h.status}
            </span>
            <span className="text-white/25">{h.duration}ms</span>
          </button>
        ))}
      </div>
    </GlassPanel>
  );
}

/* ─── main component ──────────────────────────────────────────────────── */

export default function ResponseViewer({ response, loading, history, onReplay }: ResponseViewerProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      {/* Response */}
      <GlassPanel className="p-4">
        <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">
          {t('playground.response', 'Response')}
        </h4>

        {loading && <Skeleton className="h-48 rounded-lg" />}

        {!loading && !response && (
          <EmptyState
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
              <span className={cn('font-mono text-sm font-bold', statusColor(response.status))}>
                {response.status} {response.statusText}
              </span>
              <span className="text-xs text-white/40">
                {response.duration}ms · {formatBytes(response.size)}
              </span>
            </div>

            {/* Body */}
            <pre className="text-xs font-mono text-white/70 overflow-auto max-h-[500px] bg-black/30 rounded-lg p-3 border border-white/[0.04]">
              {(response.contentType ?? '').includes('json') && typeof response.body !== 'string'
                ? JSON.stringify(response.body, null, 2)
                : response.bodyText}
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
