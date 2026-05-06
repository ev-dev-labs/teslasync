import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Pause, Play, Trash2, ArrowDown, ArrowDownUp } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel, Badge, Button, Input, DataTable, type Column } from '@/components/ui';
import { StatCard, FreshnessIndicator } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { useRealtimeEvents } from '@/hooks/useRealtimeEvents';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import type { SignalEntry } from '@/types/telemetry';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MAX_BUFFER = 500;

const TYPE_COLOR: Record<string, string> = {
  number: 'text-cyan-400',
  string: 'text-green-400',
  boolean: 'text-amber-400',
};

/* ------------------------------------------------------------------ */
/*  Signal table columns                                               */
/* ------------------------------------------------------------------ */

function buildSignalColumns(t: (k: string, d: string) => string): Column<SignalEntry>[] {
  return [
    {
      key: 'time',
      header: t('liveMonitor.time', 'Time'),
      render: (entry) => (
        <span className="font-mono text-[var(--text-muted)] whitespace-nowrap">
          {formatTime(entry.timestamp)}
        </span>
      ),
    },
    {
      key: 'signal',
      header: t('liveMonitor.signal', 'Signal'),
      render: (entry) => (
        <span className="font-mono text-[var(--text-primary)] whitespace-nowrap">
          {entry.name}
        </span>
      ),
    },
    {
      key: 'value',
      header: t('liveMonitor.value', 'Value'),
      render: (entry) => (
        <span className={cn('font-mono whitespace-nowrap', TYPE_COLOR[entry.type])}>
          {entry.value}
        </span>
      ),
    },
    {
      key: 'type',
      header: t('liveMonitor.type', 'Type'),
      render: (entry) => (
        <Badge
          variant={entry.type === 'number' ? 'info' : entry.type === 'boolean' ? 'warning' : 'success'}
          size="sm"
        >
          {entry.type}
        </Badge>
      ),
    },
    {
      key: 'freshness',
      header: t('liveMonitor.freshness', 'Freshness'),
      render: (entry) => (
        <FreshnessIndicator timestamp={entry.timestamp} size="sm" />
      ),
    },
  ];
}

function detectType(value: unknown): 'number' | 'string' | 'boolean' {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function LiveSignalMonitorPage() {
  const { t } = useTranslation();
  usePageTitle(t('liveMonitor.title', 'Live Monitor'));

  const [entries, setEntries] = useState<SignalEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('');
  const [rate, setRate] = useState(0);
  const idRef = useRef(0);
  const tableRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const rateRef = useRef<number[]>([]);

  pausedRef.current = paused;

  /* ---- SSE handler ---- */
  const handleVehicleUpdate = useCallback((data: unknown) => {
    if (pausedRef.current) return;
    const payload = data as Record<string, unknown>;
    const now = new Date().toISOString();
    const newEntries: SignalEntry[] = [];

    // 1. Flatten "cold" array: [{name, value}, ...]
    const cold = payload?.cold;
    if (Array.isArray(cold)) {
      for (const item of cold) {
        if (item && typeof item === 'object' && 'name' in item && 'value' in item) {
          const { name, value } = item as { name: string; value: unknown };
          idRef.current += 1;
          newEntries.push({ id: idRef.current, timestamp: now, name, value: String(value), type: detectType(value) });
        }
      }
    }

    // 2. Flatten "tables" object: {tableName: {column: value, ...}, ...}
    const tables = payload?.tables;
    if (tables && typeof tables === 'object') {
      for (const [, columns] of Object.entries(tables as Record<string, unknown>)) {
        if (columns && typeof columns === 'object') {
          for (const [colName, colValue] of Object.entries(columns as Record<string, unknown>)) {
            idRef.current += 1;
            newEntries.push({ id: idRef.current, timestamp: now, name: colName, value: String(colValue), type: detectType(colValue) });
          }
        }
      }
    }

    // 3. Fallback: flat signals (old format compatibility)
    if (!cold && !tables) {
      const signals = (payload?.signals ?? payload) as Record<string, unknown> | undefined;
      if (signals && typeof signals === 'object') {
        for (const [name, value] of Object.entries(signals)) {
          if (name === 'timestamp' || name === 'vehicle_id' || name === 'ts') continue;
          if (typeof value === 'object' && value !== null) continue;
          idRef.current += 1;
          newEntries.push({ id: idRef.current, timestamp: now, name, value: String(value), type: detectType(value) });
        }
      }
    }

    rateRef.current.push(newEntries.length);
    setEntries((prev) => [...newEntries, ...prev].slice(0, MAX_BUFFER));
  }, []);

  /* ---- Rate counter ---- */
  useEffect(() => {
    const interval = setInterval(() => {
      setRate(rateRef.current.reduce((a, b) => a + b, 0));
      rateRef.current = [];
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const { connected } = useRealtimeEvents({ onVehicleUpdate: handleVehicleUpdate });

  /* ---- Auto-scroll ---- */
  useEffect(() => {
    if (autoScroll && tableRef.current) tableRef.current.scrollTop = 0;
  }, [entries, autoScroll]);

  const filteredEntries = useMemo(
    () => (filter ? entries.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase())) : entries),
    [entries, filter],
  );

  const uniqueSignals = useMemo(() => new Set(entries.map((e) => e.name)).size, [entries]);
  const signalColumns = useMemo(() => buildSignalColumns(t), [t]);

  return (
    <PageContainer
      title={t('liveMonitor.title', 'Live Signal Monitor')}
      subtitle={t('liveMonitor.subtitle', 'Real-time scrolling view of incoming vehicle signals')}
      actions={
        <Badge variant={connected ? 'success' : 'danger'} dot>
          {connected ? t('liveMonitor.connected', 'Connected') : t('liveMonitor.disconnected', 'Disconnected')}
        </Badge>
      }
    >
      {/* Stats */}
      <FadeIn delay={0.1}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            label={t('liveMonitor.sigPerSec', 'Signals / sec')}
            value={rate}
            icon={<Activity className="h-4 w-4" />}
          />
          <StatCard
            label={t('liveMonitor.bufferSize', 'Buffer Size')}
            value={entries.length}
            unit={`/ ${MAX_BUFFER}`}
            icon={<ArrowDownUp className="h-4 w-4" />}
          />
          <StatCard
            label={t('liveMonitor.uniqueSignals', 'Unique Signals')}
            value={uniqueSignals}
            icon={<Activity className="h-4 w-4" />}
          />
          <StatCard
            label={t('liveMonitor.filtered', 'Filtered')}
            value={filteredEntries.length}
            icon={<Activity className="h-4 w-4" />}
          />
        </div>
      </FadeIn>

      {/* Controls + Table */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
            <Input
              type="text"
              placeholder={t('liveMonitor.filterPlaceholder', 'Filter by signal name...')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label={t('liveMonitor.filterLabel', 'Filter signals')}
              className="w-full sm:w-64"
            />
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setPaused((p) => !p)}
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
                icon={<ArrowDown className="h-3.5 w-3.5" />}
                className={autoScroll ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' : ''}
              >
                {t('liveMonitor.autoScroll', 'Auto-scroll')}
              </Button>
              <Button
                onClick={() => { setEntries([]); idRef.current = 0; }}
                variant="danger"
                size="sm"
                icon={<Trash2 className="h-3.5 w-3.5" />}
              >
                {t('liveMonitor.clear', 'Clear')}
              </Button>
            </div>
          </div>

          <div ref={tableRef} className="overflow-auto max-h-[65vh] rounded-lg border border-[var(--border-subtle)]">
            <DataTable<SignalEntry>
              tableId="telemetry:live-signals"
              columns={signalColumns}
              data={filteredEntries}
              keyExtractor={(entry) => entry.id}
              compact
              pagination={{ defaultPageSize: 50 }}
              emptyMessage={
                entries.length === 0
                  ? t('liveMonitor.waiting', 'Waiting for signals…')
                  : t('liveMonitor.noMatch', 'No signals match filter')
              }
            />
          </div>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
