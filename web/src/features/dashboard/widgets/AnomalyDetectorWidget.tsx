import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
      return <AlertOctagon className="h-4 w-4 text-red-400" />;
    case 'warning':
      return <AlertTriangle className="h-4 w-4 text-amber-400" />;
    default:
      return <Info className="h-4 w-4 text-blue-400" />;
  }
}

function formatRelativeTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

function maxSeverity(anomalies: { severity: string }[]): string {
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
        .map((entry) => ({
          id: `${entry.signal}-${entry.detected_at}`,
          icon: severityIcon(entry.severity),
          title: `${entry.signal ?? '—'} · z=${fmtNumber(entry.z_score ?? 0, 1)} · ${formatRelativeTime(entry.detected_at ?? '')}`,
          description: entry.message ?? '—',
          impact: SEVERITY_IMPACT[entry.severity] ?? ('low' as const),
          impactLabel: t(
            `widget.anomalyDetector.severity.${entry.severity}`,
            entry.severity ?? '—',
          ),
        })),
    [anomalies, t],
  );

  const shellProps = {
    loading: isLoading,
    error: error ? String(error) : null,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  if (isCompact) {
    const count = anomalies.length;
    const sev = maxSeverity(anomalies);
    const badgeVariant = SEVERITY_BADGE[sev] ?? 'neutral';

    return (
      <WidgetShell {...shellProps}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
        <div className="flex h-full flex-col items-center justify-center gap-2 min-h-[44px]">
          {count > 0 ? (
            <>
              <span className="text-2xl font-bold text-[var(--text-primary)]">{count}</span>
              <Badge variant={badgeVariant} size="sm">
                {t('widget.anomalyDetector.activeCount', '{{count}} active', { count })}
              </Badge>
            </>
          ) : (
            <EmptyState
              icon={<AlertTriangle className="h-5 w-5" />}
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
      icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
      {...shellProps}
    >
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0">
          <WidgetTipCards
            tips={tips}
            compact={false}
            emptyMessage={t('widget.anomalyDetector.noAnomalies', 'No anomalies')}
            emptyIcon={<AlertTriangle className="h-5 w-5" />}
          />
        </div>
      </div>
    </WidgetShell>
  );
}
