// LiveLogsPage — Phase-46 / Prompt 34
//
// Operator-facing live log tail. Streams the API server's structured
// zerolog events via the SSE endpoint at GET /admin/logs/stream (see
// internal/api/admin_log_stream_handler.go) and renders them in a
// virtualized DataTable so the browser stays responsive even when the
// server is gushing thousands of lines per minute.
//
// The page intentionally NEVER auto-runs anything destructive — it is
// a read-only window onto the existing log pipeline. Filters are:
//   - level (debug/info/warn/error) — server-side, restarts subscription
//   - grep  (regular expression)    — server-side, restarts subscription
//   - vehicle_id                    — client-side, applied to current buffer
//
// Pause/Resume holds the buffer steady on the client without dropping
// the connection (server keeps fanning out, page just stops appending).
// Auto-scroll follows new events to the bottom; toggling it off — or
// scrolling up manually — pins the table at the user's position.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Download,
  Pause,
  Play,
  RefreshCw,
  ScrollText,
  Trash2,
} from 'lucide-react';

import { PageContainer, Stack } from '@/components/layout';
import {
  Badge,
  Button,
  GlassPanel,
  Input,
  Select,
  Toggle,
  DataTable,
  type Column,
} from '@/components/ui';
import { Caption, MetricLabel, Text } from '@/components/ui/Typography';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import {
  LOG_STREAM_MAX_EVENTS,
  useLogStream,
  type LogStreamEvent,
  type LogStreamLevel,
  type UseLogStreamOptions,
} from '@/api/hooks/useLogStream';
import { cn } from '@/lib/cn';

// ── helpers ─────────────────────────────────────────────────────────

const LEVEL_OPTIONS: { value: LogStreamLevel; defaultLabel: string; i18nKey: string }[] = [
  { value: 'debug', defaultLabel: 'Debug', i18nKey: 'liveLogs.level.debug' },
  { value: 'info', defaultLabel: 'Info', i18nKey: 'liveLogs.level.info' },
  { value: 'warn', defaultLabel: 'Warn', i18nKey: 'liveLogs.level.warn' },
  { value: 'error', defaultLabel: 'Error', i18nKey: 'liveLogs.level.error' },
];

function levelBadgeVariant(
  level: string,
): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  const norm = level.toLowerCase();
  if (norm === 'debug' || norm === 'trace') return 'neutral';
  if (norm === 'info') return 'info';
  if (norm === 'warn' || norm === 'warning') return 'warning';
  if (norm === 'error' || norm === 'err' || norm === 'fatal' || norm === 'panic')
    return 'danger';
  return 'neutral';
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  // Use the user's locale-formatted time + millisecond precision so
  // bursty log streams stay distinguishable.
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const sss = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${sss}`;
}

function extractMessage(parsed: Record<string, unknown> | null, raw: string): string {
  if (!parsed) return raw;
  if (typeof parsed.message === 'string') return parsed.message;
  if (typeof parsed.msg === 'string') return parsed.msg;
  return raw;
}

function extractFields(
  parsed: Record<string, unknown> | null,
): Array<[string, string]> {
  if (!parsed) return [];
  const skip = new Set(['level', 'time', 'message', 'msg']);
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (skip.has(k)) continue;
    if (v === null || v === undefined) continue;
    let str: string;
    if (typeof v === 'string') str = v;
    else if (typeof v === 'number' || typeof v === 'boolean') str = String(v);
    else {
      try {
        str = JSON.stringify(v);
      } catch {
        str = '[unserialisable]';
      }
    }
    out.push([k, str]);
  }
  return out;
}

function extractVehicleId(
  parsed: Record<string, unknown> | null,
): string | null {
  if (!parsed) return null;
  const candidates = ['vehicle_id', 'vehicleID', 'vehicleId'];
  for (const k of candidates) {
    const v = parsed[k];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function downloadFilename(template: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[:]/g, '-')
    .replace(/\.\d+Z$/, 'Z');
  return template.replace('{{ts}}', stamp);
}

function eventToText(ev: LogStreamEvent): string {
  return `[${formatTime(ev.receivedAt)}] ${ev.level.toUpperCase()} ${ev.payload}`;
}

// ── small subcomponents ─────────────────────────────────────────────

function ConnectionBadge({
  isConnected,
  paused,
  hasError,
  enabled,
}: {
  isConnected: boolean;
  paused: boolean;
  hasError: boolean;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  if (hasError) {
    return (
      <Badge variant="danger" data-testid="livelogs-status-badge">
        {t('liveLogs.status.error', 'Connection error')}
      </Badge>
    );
  }
  if (!enabled) {
    return (
      <Badge variant="neutral" data-testid="livelogs-status-badge">
        {t('liveLogs.status.disconnected', 'Disconnected')}
      </Badge>
    );
  }
  if (!isConnected) {
    return (
      <Badge variant="info" data-testid="livelogs-status-badge">
        {t('liveLogs.status.connecting', 'Connecting…')}
      </Badge>
    );
  }
  if (paused) {
    return (
      <Badge variant="warning" data-testid="livelogs-status-badge">
        {t('liveLogs.status.paused', 'Paused (still receiving)')}
      </Badge>
    );
  }
  return (
    <Badge variant="success" data-testid="livelogs-status-badge">
      {t('liveLogs.status.connected', 'Live')}
    </Badge>
  );
}

function HighlightedText({
  text,
  pattern,
}: {
  text: string;
  pattern: RegExp | null;
}) {
  if (!pattern || text.length === 0) return <>{text}</>;
  const segments: Array<{ text: string; match: boolean }> = [];
  let last = 0;
  // Re-create the regex with global+sticky-safe options.
  let working: RegExp;
  try {
    working = new RegExp(
      pattern.source,
      pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
    );
  } catch {
    return <>{text}</>;
  }
  let m: RegExpExecArray | null;
  while ((m = working.exec(text)) !== null) {
    if (m.index > last) {
      segments.push({ text: text.slice(last, m.index), match: false });
    }
    const matched = m[0] ?? '';
    if (matched.length === 0) {
      // Avoid infinite loops on zero-width matches.
      working.lastIndex += 1;
      continue;
    }
    segments.push({ text: matched, match: true });
    last = m.index + matched.length;
  }
  if (last < text.length) {
    segments.push({ text: text.slice(last), match: false });
  }
  return (
    <>
      {segments.map((s, i) =>
        s.match ? (
          <mark
            key={i}
            className="rounded bg-amber-300/30 px-0.5 text-amber-100"
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

// ── page ────────────────────────────────────────────────────────────

export interface LiveLogsPageProps {
  /** Test seam — replace fetch in unit tests. */
  fetchImpl?: UseLogStreamOptions['fetchImpl'];
  /** Test seam — point at a stub server. */
  endpoint?: string;
}

export default function LiveLogsPage({
  fetchImpl,
  endpoint,
}: LiveLogsPageProps = {}) {
  const { t } = useTranslation();
  usePageTitle(t('liveLogs.title', 'Live logs'));

  const [level, setLevel] = useState<LogStreamLevel>('info');
  const [grep, setGrep] = useState('');
  const [grepDraft, setGrepDraft] = useState('');
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [paused, setPaused] = useState(false);
  const [autoscroll, setAutoscroll] = useState(true);
  const [enabled, setEnabled] = useState(true);

  const stream = useLogStream({
    level,
    grep,
    enabled,
    paused,
    fetchImpl,
    endpoint,
  });

  const grepPattern = useMemo<RegExp | null>(() => {
    if (grep.trim().length === 0) return null;
    try {
      return new RegExp(grep, 'i');
    } catch {
      return null;
    }
  }, [grep]);

  const filteredEvents = useMemo(() => {
    if (vehicleFilter.trim().length === 0) return stream.events;
    const needle = vehicleFilter.trim();
    return stream.events.filter((ev) => extractVehicleId(ev.parsed) === needle);
  }, [stream.events, vehicleFilter]);

  // Find the scrollable container the DataTable renders inside so we
  // can pin the view to the bottom when autoscroll is on. The
  // virtualized DataTable wraps its rows in an element that scrolls;
  // we identify it by the data-testid we set on the table wrapper.
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!autoscroll) return;
    const el = tableWrapRef.current?.querySelector<HTMLDivElement>(
      '[data-table-scroll-container="true"]',
    );
    const target = el ?? tableWrapRef.current;
    if (target) {
      target.scrollTop = target.scrollHeight;
    }
  }, [autoscroll, filteredEvents.length]);

  const applyGrep = useCallback(() => {
    setGrep(grepDraft);
  }, [grepDraft]);

  const handleClear = useCallback(() => {
    stream.clear();
  }, [stream]);

  const handleReconnect = useCallback(() => {
    setEnabled(false);
    // Defer to the next tick so React processes the unmount-style
    // tear-down before we ask for a fresh connection.
    queueMicrotask(() => setEnabled(true));
  }, []);

  const handleDownload = useCallback(() => {
    if (filteredEvents.length === 0) return;
    const filename = downloadFilename(
      t('liveLogs.filename', { ts: '{{ts}}' }),
    );
    const body = filteredEvents.map(eventToText).join('\n');
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [filteredEvents, t]);

  const columns = useMemo<Column<LogStreamEvent>[]>(() => {
    return [
      {
        key: 'time',
        header: t('liveLogs.table.time', 'Time'),
        defaultWidth: 110,
        render: (row) => (
          <span className="font-mono text-xs text-[var(--text-secondary)]">
            {formatTime(row.receivedAt)}
          </span>
        ),
      },
      {
        key: 'level',
        header: t('liveLogs.table.level', 'Level'),
        defaultWidth: 80,
        render: (row) => (
          <Badge variant={levelBadgeVariant(row.level)} size="sm">
            {row.level
              ? row.level.toUpperCase()
              : t('liveLogs.table.noLevel', '—')}
          </Badge>
        ),
      },
      {
        key: 'message',
        header: t('liveLogs.table.message', 'Message'),
        render: (row) => (
          <span className="block break-words font-mono text-xs text-[var(--text-primary)]">
            <HighlightedText
              text={extractMessage(row.parsed, row.payload)}
              pattern={grepPattern}
            />
          </span>
        ),
      },
      {
        key: 'fields',
        header: t('liveLogs.table.fields', 'Fields'),
        defaultWidth: 320,
        render: (row) => {
          const fields = extractFields(row.parsed);
          if (fields.length === 0) return null;
          return (
            <span className="flex flex-wrap gap-1">
              {fields.slice(0, 6).map(([k, v]) => (
                <span
                  key={k}
                  className="rounded border border-[var(--border-subtle)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]"
                  title={`${k}=${v}`}
                >
                  <span className="text-[var(--text-muted)]">{k}=</span>
                  <span className="text-[var(--text-primary)]">
                    {v.length > 32 ? `${v.slice(0, 32)}…` : v}
                  </span>
                </span>
              ))}
              {fields.length > 6 ? (
                <span className="px-1 font-mono text-[10px] text-[var(--text-muted)]">
                  +{fields.length - 6}
                </span>
              ) : null}
            </span>
          );
        },
      },
    ];
  }, [grepPattern, t]);

  const filterPanel = (
    <GlassPanel className="p-4" data-testid="livelogs-filters">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div>
          <Select
            label={t('liveLogs.filters.level', 'Minimum level')}
            value={level}
            onChange={(e) =>
              setLevel((e.target.value as LogStreamLevel) ?? 'info')
            }
            options={LEVEL_OPTIONS.map((o) => ({
              value: o.value,
              label: t(o.i18nKey, o.defaultLabel),
            }))}
            data-testid="livelogs-level-select"
          />
        </div>
        <div className="md:col-span-2">
          <Input
            label={t('liveLogs.filters.grep', 'Grep (regular expression)')}
            value={grepDraft}
            onChange={(e) => setGrepDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyGrep();
              }
            }}
            onBlur={applyGrep}
            placeholder={t(
              'liveLogs.filters.grepPlaceholder',
              'e.g. mqtt|signal_log',
            )}
            hint={t(
              'liveLogs.filters.grepHelp',
              'Server-side filter. Maximum 256 characters. Invalid expressions are rejected before connecting.',
            )}
            maxLength={256}
            data-testid="livelogs-grep-input"
          />
        </div>
        <div>
          <Input
            label={t('liveLogs.filters.vehicleId', 'Vehicle ID')}
            value={vehicleFilter}
            onChange={(e) => setVehicleFilter(e.target.value.trim())}
            placeholder={t(
              'liveLogs.filters.vehicleIdPlaceholder',
              'Numeric — applied client-side',
            )}
            data-testid="livelogs-vehicle-input"
            inputMode="numeric"
          />
        </div>
      </div>
    </GlassPanel>
  );

  const controlsPanel = (
    <GlassPanel className="p-4" data-testid="livelogs-controls">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <ConnectionBadge
            isConnected={stream.isConnected}
            paused={paused}
            hasError={stream.error !== null}
            enabled={enabled}
          />
          <Caption>
            {t('liveLogs.stats.buffered', {
              count: stream.events.length,
              defaultValue: 'Buffered: {{count}}',
            })}
          </Caption>
          <Caption>
            {t('liveLogs.stats.received', {
              count: stream.totalReceived,
              defaultValue: 'Received: {{count}}',
            })}
          </Caption>
          {stream.drops > 0 ? (
            <Caption className="text-amber-300">
              {t('liveLogs.stats.drops', {
                count: stream.drops,
                defaultValue: 'Server drops: {{count}}',
              })}
            </Caption>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Toggle
            label={t('liveLogs.controls.autoscroll', 'Auto-scroll')}
            checked={autoscroll}
            onChange={setAutoscroll}
            size="sm"
            data-testid="livelogs-autoscroll-toggle"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPaused((p) => !p)}
            icon={
              paused ? (
                <Play className="h-4 w-4" aria-hidden />
              ) : (
                <Pause className="h-4 w-4" aria-hidden />
              )
            }
            data-testid="livelogs-pause-button"
          >
            {paused
              ? t('liveLogs.controls.resume', 'Resume')
              : t('liveLogs.controls.pause', 'Pause')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            icon={<Trash2 className="h-4 w-4" aria-hidden />}
            data-testid="livelogs-clear-button"
          >
            {t('liveLogs.controls.clear', 'Clear buffer')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            disabled={filteredEvents.length === 0}
            icon={<Download className="h-4 w-4" aria-hidden />}
            data-testid="livelogs-download-button"
          >
            {t('liveLogs.controls.download', 'Download visible (.txt)')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReconnect}
            icon={<RefreshCw className="h-4 w-4" aria-hidden />}
            data-testid="livelogs-reconnect-button"
          >
            {t('liveLogs.controls.reconnect', 'Reconnect')}
          </Button>
        </div>
      </div>
    </GlassPanel>
  );

  return (
    <PageContainer
      title={t('liveLogs.title', 'Live logs')}
      subtitle={t(
        'liveLogs.subtitle',
        "Stream the API server's structured log events in real time. Filter by severity and an optional regular expression. The connection is dropped when you navigate away.",
      )}
    >
      <FadeIn>
        <Stack className="gap-4">
          {filterPanel}
          {controlsPanel}
          {stream.error ? (
            <GlassPanel
              className="border border-rose-500/30 p-4"
              data-testid="livelogs-error"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle
                  className="h-5 w-5 shrink-0 text-rose-300"
                  aria-hidden
                />
                <div>
                  <MetricLabel className="mb-1 block">
                    {t(
                      'liveLogs.error.title',
                      'Could not connect to log stream',
                    )}
                  </MetricLabel>
                  <Text variant="bodySm" as="p">
                    {stream.error.message ||
                      t(
                        'liveLogs.error.hint',
                        'Check your network and admin permissions, then click Reconnect.',
                      )}
                  </Text>
                </div>
              </div>
            </GlassPanel>
          ) : null}
          <GlassPanel className="p-2" data-testid="livelogs-table-panel">
            <div ref={tableWrapRef}>
              {filteredEvents.length === 0 ? (
                <EmptyState
                  icon={<ScrollText className="h-10 w-10" aria-hidden />}
                  title={t('liveLogs.title', 'Live logs')}
                  message={t(
                    'liveLogs.empty.noEvents',
                    'No log events yet. Trigger activity (e.g. start a charging session) to see live output.',
                  )}
                  action={
                    !enabled
                      ? {
                          label: t('liveLogs.controls.reconnect', 'Reconnect'),
                          onClick: handleReconnect,
                        }
                      : undefined
                  }
                />
              ) : (
                <DataTable<LogStreamEvent>
                  tableId="admin:live-logs"
                  data={filteredEvents}
                  columns={columns}
                  keyExtractor={(row) => row.seq}
                  virtualized={filteredEvents.length > 200}
                  rowHeight={36}
                  maxHeight={520}
                  density="compact"
                  className={cn('font-mono text-xs')}
                />
              )}
            </div>
          </GlassPanel>
          <Caption>
            {t('liveLogs.stats.buffered', {
              count: stream.events.length,
              defaultValue: 'Buffered: {{count}}',
            })}{' '}
            / max {LOG_STREAM_MAX_EVENTS}
          </Caption>
        </Stack>
      </FadeIn>
    </PageContainer>
  );
}
