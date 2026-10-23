import { memo, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnits } from '@/hooks/useUnits';
import { formatAnomalyExplanation, formatAnomalyReading } from '@/lib/anomalyExplanation';
import { useTicker } from '@/hooks/useTicker';
import type { TFunction } from 'i18next';
import { AlertTriangle } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useAnomalies } from '@/api/hooks/useAnomalies';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useDataState } from '@/hooks/useDataState';
import { safeArray } from '@/lib/safeArray';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetDetailCard, type DetailEntry } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

const SEVERITY_BADGE: Record<string, 'error' | 'warning' | 'neutral'> = {
  critical: 'error',
  warning: 'warning',
  info: 'neutral',
};

/**
 * i18n-aware "time ago" label for an anomaly's `detected_at` timestamp.
 *
 * Guards the three ways a raw timestamp corrupts the label: an absent/empty
 * string, an unparseable string (`new Date('x')` → Invalid Date → NaN, which
 * previously cascaded to "NaNd ago"), and a future timestamp from
 * vehicle/browser clock skew (which would render negative minutes). The first
 * two collapse to an em-dash; a future timestamp reads "Just now".
 */
export function formatRelativeTime(isoStr: string, t: TFunction): string {
  if (!isoStr) return t('widget.anomalyDetector.relative.unknown', '—');
  const ms = new Date(isoStr).getTime();
  if (!Number.isFinite(ms)) return t('widget.anomalyDetector.relative.unknown', '—');
  const diffMs = Date.now() - ms;
  // relative-time: when the anomaly was detected
  if (diffMs < 0) return t('widget.anomalyDetector.relative.justNow', 'Just now');
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return t('widget.anomalyDetector.relative.justNow', 'Just now');
  if (diffMin < 60)
    return t('widget.anomalyDetector.relative.minutes', '{{count}}m ago', { count: diffMin });
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24)
    return t('widget.anomalyDetector.relative.hours', '{{count}}h ago', { count: diffHrs });
  const diffDays = Math.floor(diffHrs / 24);
  return t('widget.anomalyDetector.relative.days', '{{count}}d ago', { count: diffDays });
}

/**
 * Most severe level present in a list of anomalies (critical > warning >
 * info). Unknown severities are treated as the least severe (`info`) so a
 * malformed payload never masks a real critical alert. Returns `info` for an
 * empty list.
 */
export function maxSeverity(anomalies: { severity: string }[]): string {
  let best = 'info';
  for (const a of anomalies) {
    if ((SEVERITY_ORDER[a.severity] ?? 2) < (SEVERITY_ORDER[best] ?? 2)) {
      best = a.severity;
    }
  }
  return best;
}

export default memo(function AnomalyDetectorWidget({ vehicleId, size }: WidgetProps) {
  // Row ages ("5m ago") are embedded in the tip title strings, so the feed
  // subscribes to the shared ticker as a unit. It renders text rows and no
  // charts, so a tick costs a trivial feed re-render while heavy widgets
  // stay untouched.
  useTicker();
  const units = useUnits();
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading: vehiclesLoading } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : null;

  const query = useAnomalies(vehicleIdStr);
  const {
    data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch,
  } = query;
  const hasAnomalyEvidence = Array.isArray(data?.anomalies);
  const unavailable = vehicleIdStr == null && !vehiclesLoading && !isLoading && data === undefined && !error;
  const state = useDataState(
    { ...query, data: unavailable ? null : data },
    { partial: data != null && !hasAnomalyEvidence, unavailable },
  );

  const isCompact = size.cols <= 1;
  const anomalies = safeArray(data?.anomalies).filter(entry => entry != null);

  const entries: DetailEntry[] = useMemo(
    () =>
      [...anomalies]
        .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2))
        .map((entry, index) => ({
          id: `${entry.signal ?? 'signal'}-${entry.detected_at ?? index}`,
          label: `${entry.signal ?? '—'} · z=${entry.z_score != null && Number.isFinite(entry.z_score) ? fmtNumber(entry.z_score) : '—'} · ${formatRelativeTime(entry.detected_at ?? '', t)}`,
          sublabel: formatAnomalyExplanation(entry, t, value => formatAnomalyReading(value, entry.unit, units, fmtNumber), fmtNumber) ?? '—',
          value: '',
          status: entry.severity === 'critical' ? 'error' : entry.severity === 'warning' ? 'warning' : 'info',
          badge: {
            text: t(
            `widget.anomalyDetector.severity.${entry.severity}`,
            entry.severity ?? '—',
            ),
            variant: entry.severity === 'critical' ? 'error' : entry.severity === 'warning' ? 'warning' : 'info',
          },
        })),
    [anomalies, t, fmtNumber, units],
  );

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const shellProps = {
    title: t('widget.anomalyDetector.title', 'Anomaly detector'),
    loading: isLoading || (vehicleId == null && vehiclesLoading),
    dataState: state,
    error: state.fatalError ? String(state.fatalError) : null,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: handleRefresh,
  };

  if (isCompact) {
    const count = anomalies.length;
    const sev = maxSeverity(anomalies);
    const badgeVariant = SEVERITY_BADGE[sev] ?? 'neutral';

    return (
      <WidgetShell {...shellProps}>
        <div className="flex h-full flex-col items-center justify-center gap-2 min-h-[44px]">
          {count > 0 || !hasAnomalyEvidence ? (
            <WidgetBigNumber
              value={hasAnomalyEvidence ? fmtInt(count) : null}
              align="center"
              badge={hasAnomalyEvidence ? {
                text: t('widget.anomalyDetector.activeCount', '{{count}} active', {
                  count, replace: { count: fmtInt(count) },
                }),
                variant: badgeVariant,
              } : undefined}
            />
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
              message={t('widget.anomalyDetector.noAnomalies', 'No anomalies')}
              className="py-2"
            />
          )}
        </div>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />}
      {...shellProps}
    >
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0">
          {hasAnomalyEvidence ? <WidgetDetailCard
            entries={entries.slice(0, 3)}
            compact={false}
            emptyMessage={t('widget.anomalyDetector.noAnomalies', 'No anomalies')}
            emptyIcon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          /> : (
            <EmptyState /* no-action: source evidence is absent; shell recovery remains available */
              message={t('common.noData', 'No data available')}
            />
          )}
        </div>
      </div>
    </WidgetShell>
  );
})
