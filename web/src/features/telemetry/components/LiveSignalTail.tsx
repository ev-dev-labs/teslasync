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
import { Activity, ArrowDown, ArrowUpDown, Pause, Play, Radio, Trash2 } from 'lucide-react';

import { GlassPanel, Badge, Button, Input, DataTable, Text, Code, type Column } from '@/components/ui';
import { StatCard, FreshnessIndicator } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { formatTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import type { SignalEntry } from '@/types/telemetry';

const TYPE_VALUE_COLOR: Record<string, string> = {
  number: 'text-cyan-300',
  string: 'text-emerald-300',
  boolean: 'text-amber-300',
};

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
        <Code className="whitespace-nowrap">{entry.name}</Code>
      ),
    },
    {
      key: 'value',
      header: t('liveMonitor.value', 'Value'),
      render: (entry) => (
        <Text mono size="xs" className={cn('whitespace-nowrap', TYPE_VALUE_COLOR[entry.type])}>{entry.value}</Text>
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

  return (
    <FadeIn>
      <GlassPanel className={cn('p-4 sm:p-5 space-y-3', className)}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {title ? (
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-red-500 animate-pulse" />
              <Text variant="sectionTitle">{title}</Text>
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
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {headerExtra}
            <Button
              onClick={onPauseToggle}
              variant="secondary"
              size="sm"
              icon={paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            >
              {paused ? t('liveMonitor.resume', 'Resume') : t('liveMonitor.pause', 'Pause')}
            </Button>
            <Button
              onClick={() => setAutoScroll((a) => !a)}
              variant="secondary"
              size="sm"
              aria-pressed={autoScroll}
              icon={<ArrowDown className="h-3.5 w-3.5" />}
              className={autoScroll ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' : ''}
            >
              {t('liveMonitor.autoScroll', 'Auto-scroll')}
            </Button>
            <Button
              onClick={onClear}
              variant="danger"
              size="sm"
              icon={<Trash2 className="h-3.5 w-3.5" />}
            >
              {t('liveMonitor.clear', 'Clear')}
            </Button>
          </div>
        </div>

        {showStats ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label={t('liveMonitor.sigPerSec', 'Signals / sec')}
              value={rate ?? 0}
              icon={<Activity className="h-4 w-4" />}
            />
            <StatCard
              label={t('liveMonitor.bufferSize', 'Buffer Size')}
              value={items.length}
              unit={`/ ${bufferMax ?? 0}`}
              icon={<ArrowUpDown className="h-4 w-4" />}
            />
            <StatCard
              label={t('liveMonitor.uniqueSignals', 'Unique Signals')}
              value={uniqueSignals}
              icon={<Activity className="h-4 w-4" />}
            />
            <StatCard
              label={t('liveMonitor.filtered', 'Filtered')}
              value={filtered.length}
              icon={<Activity className="h-4 w-4" />}
            />
          </div>
        ) : null}

        <div ref={tableRef} className="overflow-auto rounded-lg border border-[var(--border-subtle)]" style={{ maxHeight }}>
          <DataTable<SignalEntry>
            tableId="telemetry:live-signal-tail"
            columns={columns}
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
