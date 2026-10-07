import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertTriangle, AlertOctagon, Info } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useAnomalies } from '@/api/hooks/useAnomalies';
import { useVehicles } from '@/api/hooks/useVehicles';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetTipCards, type TipItem } from './shared';
import type { WidgetProps } from './types';

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

const SEVERITY_IMPACT: Record<string, 'high' | 'medium' | 'low'> = {
  critical: 'high',
  warning: 'medium',
  info: 'low',
};

const SEVERITY_BADGE: Record<string, 'danger' | 'warning' | 'neutral'> = {
  critical: 'danger',
  warning: 'warning',
  info: 'neutral',
};

function severityIcon(severity: string) {
  switch (severity) {
    case 'critical':
      return <AlertOctagon className="h-4 w-4 text-red-400" aria-hidden="true" />;
    case 'warning':
      return <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden="true" />;
    default:
      return <Info className="h-4 w-4 text-blue-400" aria-hidden="true" />;
  }
}

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

export default function AnomalyDetectorWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : null;

  const {
    data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch,
  } = useAnomalies(vehicleIdStr);

  const isCompact = size.cols <= 1;
  const anomalies = data?.anomalies ?? [];

  const tips: TipItem[] = useMemo(
    () =>
      [...anomalies]
        .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2))
        .map((entry, index) => ({
          id: `${entry.signal ?? 'signal'}-${entry.detected_at ?? index}`,
          icon: severityIcon(entry.severity),
          title: `${entry.signal ?? '—'} · z=${fmtNumber(entry.z_score ?? 0, 1)} · ${formatRelativeTime(entry.detected_at ?? '', t)}`,
          description: entry.message ?? '—',
          impact: SEVERITY_IMPACT[entry.severity] ?? ('low' as const),
          impactLabel: t(
            `widget.anomalyDetector.severity.${entry.severity}`,
            entry.severity ?? '—',
          ),
        })),
    [anomalies, t],
  );

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const shellProps = {
    loading: isLoading,
    error: error ? String(error) : null,
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
          {count > 0 ? (
            <>
              <span className="text-2xl font-bold text-[var(--text-primary)]">{count}</span>
              <Badge variant={badgeVariant} size="sm">
                {t('widget.anomalyDetector.activeCount', '{{count}} active', { count })}
              </Badge>
            </>
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
      title={t('widget.anomalyDetector.title', 'Anomaly Detector')}
      icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />}
      {...shellProps}
    >
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0">
          <WidgetTipCards
            tips={tips}
            compact={false}
            emptyMessage={t('widget.anomalyDetector.noAnomalies', 'No anomalies')}
            emptyIcon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          />
        </div>
      </div>
    </WidgetShell>
  );
}
