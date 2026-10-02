import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { Badge, Caption, PanelTitle } from '@/components/ui';
import { combineDataStates, deriveDataState } from '@/api/dataState';
import { EmptyState } from '@/components/feedback';
import { useSignalStats, useSignalGaps, useSignals } from '@/api/hooks/useTelemetry';
import { useVehicles } from '@/api/hooks/useVehicles';
import { fmtInt } from '@/lib/numberFormat';
import { formatRelative } from '@/lib/dateFormat';
import { severityTokens } from '@/lib/tokens';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import type { WidgetProps } from './types';

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

interface GapSignal {
  name: string;
  lastSeen: string | null;
  isStale: boolean;
}

export default function SignalHealthWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const statsQuery = useSignalStats(id);
  const {
    data: stats,
    isLoading: statsLoading,
    isFetching: statsFetching,
    isStale: statsStale,
    isError: statsError,
  } = statsQuery;

  const gapsQuery = useSignalGaps(id);
  const signalsQuery = useSignals(id);
  const { data: gapData } = gapsQuery;
  const { data: signals } = signalsQuery;
  const sourceStates = [statsQuery, gapsQuery, signalsQuery].map((query) =>
    deriveDataState({ ...query, data: query.data ?? (statsQuery.isLoading || query.isLoading || query.isError || query.error ? undefined : null) }));
  const state = { ...sourceStates[0]!, ...combineDataStates(sourceStates) };
  if (stats == null && gapData == null && signals == null) {
    const fatal = sourceStates.find((source) => source.fatalError)?.fatalError;
    if (fatal) { state.status = 'initialFailure'; state.fatalError = fatal; }
  }
  const refresh = () => {
    void statsQuery.refetch();
    void gapsQuery.refetch?.();
    void signalsQuery.refetch?.();
  };

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const analysis = useMemo(() => {
    const allSignals = signals ?? [];
    const totalSignals = signals == null ? null : allSignals.length;
    const liveEntries = gapData ?? {};
    const now = Date.now();

    let activeCount = 0;
    let staleCount = 0;
    let latestTimestamp: string | null = null;
    let latestMs: number | null = null;
    const gapSignals: GapSignal[] = [];

    for (const [name, entry] of Object.entries(liveEntries)) {
      const ts = entry?.timestamp ?? null;
      const parsedMs = ts ? new Date(ts).getTime() : Number.NaN;
      // A missing OR unparseable timestamp is a signal gap: it must count as
      // stale (never "active"), and it must not poison the freshness reading
      // with NaN via the newest-timestamp comparison below. Comparing parsed
      // millis (not the raw ISO strings) also keeps ordering correct when
      // timestamps differ in precision (e.g. with/without milliseconds).
      if (ts && Number.isFinite(parsedMs)) {
        const age = now - parsedMs;
        if (age > STALE_THRESHOLD_MS) {
          staleCount++;
          gapSignals.push({ name, lastSeen: ts, isStale: true });
        } else {
          activeCount++;
        }
        if (latestMs === null || parsedMs > latestMs) {
          latestMs = parsedMs;
          latestTimestamp = ts;
        }
      } else {
        staleCount++;
        gapSignals.push({ name, lastSeen: null, isStale: true });
      }
    }

    // Sort gap signals: null last-seen first, then oldest
    gapSignals.sort((a, b) => {
      if (!a.lastSeen && !b.lastSeen) return a.name.localeCompare(b.name);
      if (!a.lastSeen) return -1;
      if (!b.lastSeen) return 1;
      return new Date(a.lastSeen).getTime() - new Date(b.lastSeen).getTime();
    });

    // Freshness age in seconds, derived from the newest VALID timestamp so an
    // unparseable value can never surface as "NaN…" in the freshness label.
    const freshnessAge = latestMs !== null
      ? Math.max(0, Math.floor((now - latestMs) / 1000))
      : null;

    return { totalSignals, activeCount, staleCount, gapSignals, freshnessAge, latestTimestamp };
  }, [signals, gapData]);

  // Color coding: green = all fresh, amber = some stale, red = many gaps
  const healthLevel = useMemo(() => {
    const { activeCount, staleCount } = analysis;
    const total = activeCount + staleCount;
    if (total === 0) return 'neutral';
    const staleRatio = staleCount / total;
    if (staleRatio >= 0.5) return 'red';
    if (staleRatio > 0) return 'amber';
    return 'green';
  }, [analysis]);

  const healthColor = healthLevel === 'green'
    ? severityTokens.success.fg
    : healthLevel === 'amber'
      ? severityTokens.warn.fg
      : healthLevel === 'red'
        ? severityTokens.critical.fg
        : 'text-[var(--text-muted)]';

  const healthBadgeVariant = healthLevel === 'green'
    ? 'success' as const
    : healthLevel === 'amber'
      ? 'warning' as const
      : healthLevel === 'red'
        ? 'danger' as const
        : 'neutral' as const;
  const healthLabel = healthLevel === 'green'
    ? t('widget.signalHealth.healthy', 'Healthy')
    : healthLevel === 'amber'
      ? t('widget.signalHealth.degraded', 'Degraded')
      : healthLevel === 'red'
        ? t('widget.signalHealth.critical', 'Critical')
        : t('widget.signalHealth.unknown', 'Unknown');

  function formatAge(seconds: number | null): string {
    if (seconds == null) return '—';
    if (seconds < 60) return t('widget.signalHealth.secAgo', '{{count}}s ago', { count: seconds });
    if (seconds < 3600) return t('widget.signalHealth.minAgo', '{{count}}m ago', { count: Math.floor(seconds / 60) });
    return t('widget.signalHealth.hrAgo', '{{count}}h ago', { count: Math.floor(seconds / 3600) });
  }

  const hasData = stats || signals || gapData;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.signalHealth.title', 'Signal health')}
      icon={<Activity className={`h-3.5 w-3.5 ${healthColor}`} />}
      loading={statsLoading}
      dataState={state}
      updatedAt={state.updatedAt ?? 0}
      isFetching={statsFetching || gapsQuery.isFetching || signalsQuery.isFetching}
      isStale={statsStale || gapsQuery.isStale || signalsQuery.isStale}
      isError={statsError || gapsQuery.isError || signalsQuery.isError}
      onRefresh={refresh}
    >
      {isCompact ? (
        /* ── Compact layout (1-col) ── */
        <div className="flex flex-col items-center justify-center gap-2 h-full min-h-[44px]">
          <Badge variant={healthBadgeVariant} className="text-xs">
            {gapData == null ? '—' : `${analysis.activeCount}/${analysis.activeCount + analysis.staleCount}`}
          </Badge>
          <Caption>{healthLabel}</Caption>
          <WidgetBigNumber value={analysis.totalSignals == null ? null : fmtInt(analysis.totalSignals)} label={t('widget.signalHealth.signals', 'Signals')} />
          {analysis.freshnessAge != null && (
            <Caption className={healthColor}>
              {formatAge(analysis.freshnessAge)}
            </Caption>
          )}
        </div>
      ) : (
        /* ── Standard / Wide layout ── */
        <div className="flex flex-col gap-3 h-full">
          {/* Stats grid */}
          <WidgetStatGrid cols={isWide ? 4 : 2} stats={[
            { label: t('widget.signalHealth.totalSignals', 'Total signals'), value: analysis.totalSignals == null ? '—' : fmtInt(analysis.totalSignals), icon: <Activity className="size-3.5" /> },
            { label: t('widget.signalHealth.active', 'Active'), value: gapData == null ? '—' : fmtInt(analysis.activeCount), icon: <CheckCircle2 className="size-3.5" /> },
            { label: t('widget.signalHealth.withGaps', 'With gaps'), value: gapData == null ? '—' : fmtInt(analysis.staleCount), icon: <AlertTriangle className="size-3.5" /> },
            { label: t('widget.signalHealth.freshness', 'Freshness'), value: formatAge(analysis.freshnessAge), icon: <Clock className="size-3.5" /> },
          ]} />

          {/* Health badge */}
          <div className="flex items-center justify-between">
            <Caption>
              {t('widget.signalHealth.status', 'Status')}
            </Caption>
            <Badge variant={healthBadgeVariant} className="text-2xs">
              {healthLabel}
            </Badge>
          </div>

          {/* Wide view: stale signal list */}
          {isWide && (
            <div className="mt-auto pt-2 border-t border-[var(--border-subtle)] flex-1 min-h-0 overflow-y-auto">
              <PanelTitle className="mb-1.5">
                {t('widget.signalHealth.staleSignals', 'Stale / gap signals')}
              </PanelTitle>
              <div className="space-y-1">
                {analysis.gapSignals.slice(0, isCompact ? 3 : 15).map((sig) => (
                  <div key={sig.name} className="flex items-center justify-between min-h-[28px]">
                    <Caption className="truncate max-w-[45%]" title={sig.name}>
                      {sig.name}
                    </Caption>
                    <Caption className="truncate">
                      {sig.lastSeen ? formatRelative(sig.lastSeen) : '—'}
                    </Caption>
                  </div>
                ))}
                {analysis.gapSignals.length === 0 && <EmptyState message={gapData == null
                  ? t('widget.signalHealth.noData', 'No signal health data')
                  : t('widget.signalHealth.noGaps', 'No observed signal gaps')} />}
              </div>
            </div>
          )}
          {!hasData && !isWide && <EmptyState icon={<Activity className="size-5" />} message={t('widget.signalHealth.noData', 'No signal health data')} className="py-4" />}
        </div>
      )}
    </WidgetShell>
  );
}
