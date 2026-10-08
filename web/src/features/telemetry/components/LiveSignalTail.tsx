/**
 * LiveSignalTail — scrolling DataTable of incoming SSE signal events.
 * Pure-render component. The underlying state (entries, paused, rate) is
 * owned by `useLiveSignalStream` so callers can place the tail anywhere
 * without coupling the SSE subscription to the panel.
 * Used by:
 *   - LiveSignalMonitorPage  (full-page tail)
 *   - SignalsWorkspacePage   (tail under the chart in Live mode)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, Pause, Play, Radio, Trash2 } from 'lucide-react';

import { GlassPanel, Badge, Button, Input, DataTable, PanelTitle, Text, Code, type Column } from '@/components/ui';
import { FreshnessIndicator, type StatMetric } from '@/components/data-display';
import { TelemetrySummaryBrief } from './operationalbrief-all/TelemetrySummaryBrief';
import { FadeIn } from '@/components/motion';
import { formatTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import type { SignalEntry } from '@/types/telemetry';

const TYPE_VALUE_COLOR: Record<string, string> = {
  number: 'text-cyan-300',
  string: 'text-emerald-300',
  boolean: 'text-amber-300',
};

const MOBILE_SIGNAL_ROLES = {
  signal: 'title',
  value: 'primary',
  time: 'meta',
  type: 'badge',
  freshness: 'hidden',
} as const;

export interface LiveSignalTailProps {
  entries: SignalEntry[];
  rate: number;
  paused: boolean;
  onPauseToggle: () => void;
  onClear: () => void;
  /** Buffer cap displayed in the "Buffer Size" stat (typically 500). */
  bufferMax: number;
  /** Show the 4 stat cards (rate, buffer, unique, filtered). Default true. */
  showStats?: boolean;
  /** Override panel title. */
  title?: string;
  /** Slot rendered next to the title — e.g. connection badge. */
  headerExtra?: React.ReactNode;
  /** Max-height for the scrolling table. Default 65vh. */
  maxHeight?: string;
  className?: string;
}

export function LiveSignalTail({
  entries,
  rate,
  paused,
  onPauseToggle,
  onClear,
  bufferMax,
  showStats = true,
  title,
  headerExtra,
  maxHeight = '65vh',
  className,
}: LiveSignalTailProps) {
  const { t } = useTranslation();
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('');
  const tableRef = useRef<HTMLDivElement>(null);

  // Null-safe: a caller may hand us an undefined buffer before the SSE stream
  // has produced its first entry — never iterate a possibly-undefined list.
  const items = useMemo(() => entries ?? [], [entries]);

  const filtered = useMemo(
    () =>
      filter
        ? items.filter((e) => (e.name ?? '').toLowerCase().includes(filter.toLowerCase()))
        : items,
    [items, filter],
  );

  useEffect(() => {
    if (autoScroll && tableRef.current) tableRef.current.scrollTop = 0;
  }, [items, autoScroll]);

  const columns: Column<SignalEntry>[] = useMemo(() => [
    {
      key: 'time',
      header: t('liveMonitor.time', 'Time'),
      render: (entry) => (
        <Text mono size="xs" color="muted" className="whitespace-nowrap">
          {formatTime(entry.timestamp)}
        </Text>
      ),
    },
    {
      key: 'signal',
      header: t('liveMonitor.signal', 'Signal'),
      render: (entry) => (
        <Code className="whitespace-pre-wrap break-words">{entry.name}</Code>
      ),
    },
    {
      key: 'value',
      header: t('liveMonitor.value', 'Value'),
      render: (entry) => (
        <Text mono size="xs" className={cn('whitespace-pre-wrap break-words', TYPE_VALUE_COLOR[entry.type])}>{entry.value}</Text>
      ),
    },
    {
      key: 'type',
      header: t('liveMonitor.type', 'Type'),
      render: (entry) => (
        <Badge variant={entry.type === 'number' ? 'info' : entry.type === 'boolean' ? 'warning' : 'success'} size="sm">
          {entry.type}
        </Badge>
      ),
    },
    {
      key: 'freshness',
      header: t('liveMonitor.freshness', 'Freshness'),
      render: (entry) => <FreshnessIndicator timestamp={entry.timestamp} size="sm" />,
    },
  ], [t]);

  const uniqueSignals = useMemo(() => new Set(items.map((e) => e.name)).size, [items]);
  const metrics: readonly StatMetric[] = [
    { metricId: 'rate', occurrenceId: 'rate', rawValue: rate,
      label: t('liveMonitor.sigPerSec', 'Signals / sec'),
      display: { formatter: (raw) => ({ value: String(raw), unit: '' }) },
      description: t('liveMonitor.brief.sseRate', 'Signals per second from the live tail, averaged at 1 Hz; not an all-time ingestion rate.') },
    { metricId: 'count', occurrenceId: 'buffer', rawValue: items.length,
      label: t('liveMonitor.bufferSize', 'Buffer size'),
      description: `/ ${bufferMax ?? 0}`,
      context: t('liveMonitor.brief.bufferScope', 'Current bounded SSE tail buffer only; cleared and replaced independently of durable history.') },
    { metricId: 'count', occurrenceId: 'unique', rawValue: uniqueSignals,
      label: t('liveMonitor.uniqueSignals', 'Unique signals'),
      description: t('liveMonitor.brief.bufferScope', 'Current bounded SSE tail buffer only; cleared and replaced independently of durable history.') },
    { metricId: 'count', occurrenceId: 'filtered', rawValue: filtered.length,
      label: t('liveMonitor.filtered', 'Filtered'),
      description: t('liveMonitor.brief.tailFiltered', 'Buffered entries after the case-insensitive signal-name filter; not distinct signals.') },
  ];

  return (
    <FadeIn className="min-w-0 max-w-full">
      <GlassPanel className={cn('min-w-0 max-w-full p-4 sm:p-5 space-y-3', className)}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {title ? (
            <div className="flex min-w-0 items-center gap-2">
              <Radio className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
              <PanelTitle className="min-w-0 break-words">{title}</PanelTitle>
            </div>
          ) : null}
          <Input
            type="text"
            placeholder={t('liveMonitor.filterPlaceholder', 'Filter by signal name...')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label={t('liveMonitor.filterLabel', 'Filter signals')}
            className="w-full sm:w-64"
          />
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:ms-auto">
            {headerExtra}
            <Button
              onClick={onPauseToggle}
              variant="secondary"
              size="sm"
              className="min-h-11 md:min-h-0"
              wrapLabel
              aria-pressed={paused}
              icon={paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            >
              {paused ? t('liveMonitor.resume', 'Resume') : t('liveMonitor.pause', 'Pause')}
            </Button>
            <Button
              onClick={() => setAutoScroll((a) => !a)}
              variant="secondary"
              size="sm"
              wrapLabel
              aria-pressed={autoScroll}
              icon={<ArrowDown className="h-3.5 w-3.5" />}
              className={cn('min-h-11 md:min-h-0', autoScroll && 'bg-[var(--surface-3)] border-[var(--border-strong)]')}
            >
              {t('liveMonitor.autoScroll', 'Auto-scroll')}
            </Button>
            <Button
              onClick={onClear}
              variant="danger"
              size="sm"
              className="min-h-11 md:min-h-0"
              wrapLabel
              icon={<Trash2 className="h-3.5 w-3.5" />}
            >
              {t('liveMonitor.clear', 'Clear')}
            </Button>
          </div>
        </div>

        {showStats ? (
          <TelemetrySummaryBrief title={t('liveMonitor.brief.tailTitle', 'Buffered tail summary')}
            metrics={metrics} testId="live-tail-summary"
            statusLabel={paused ? t('liveMonitor.brief.tailPaused', 'Tail paused') : t('liveMonitor.brief.tailRecording', 'Tail recording enabled')}
            scope={t('liveMonitor.brief.sseScope', 'Current SSE session · bounded tail buffer')}
            provenance={t('liveMonitor.brief.sseProvenance', 'Client SSE tail and locally sampled throughput')}
            description={t('liveMonitor.brief.tailDescription', 'Pause freezes the tail presentation, not durable telemetry ingestion. Connection and per-row timestamp freshness remain separate evidence.')} />
        ) : null}

        <div ref={tableRef} className="overflow-auto rounded-lg border border-[var(--border-subtle)]" style={{ maxHeight }}>
          <DataTable<SignalEntry>
            tableId="telemetry:live-signal-tail"
            columns={columns}
            mobileColumns={['signal', 'value', 'time']}
            mobilePresentation={{
              roles: MOBILE_SIGNAL_ROLES,
              displayValue: (entry, key) => {
                switch (key) {
                  case 'signal': return entry.name;
                  case 'value': return entry.value;
                  case 'time': return formatTime(entry.timestamp);
                  case 'type': return entry.type;
                  default: return undefined;
                }
              },
            }}
            data={filtered}
            keyExtractor={(entry) => entry.id}
            compact
            pagination={{ defaultPageSize: 50 }}
            emptyMessage={
              items.length === 0
                ? t('liveMonitor.waiting', 'Waiting for signals…')
                : t('liveMonitor.noMatch', 'No signals match filter')
            }
          />
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
