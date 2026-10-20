import { useTranslation } from 'react-i18next';
import { Car, Gauge, Zap, DollarSign } from 'lucide-react';
import type { LifetimeStats } from '@/api/hooks/useAnalytics';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { QueryError } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useFormatting } from '@/hooks/useFormatting';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { convertDistanceFromSI } from '@/lib/unitConversion';

export function LifetimeBrief({ stats, loading, fatalError, error, onRetry }: {
  stats: LifetimeStats | null | undefined; loading: boolean;
  fatalError: boolean; error: unknown; onRetry: () => void;
}) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { formatCurrency } = useFormatting();
  const metrics: StatMetric[] = [
    {
      metricId: 'count', occurrenceId: 'lifetime-total-drives',
      rawValue: stats?.total_drives, label: t('lifetime.totalDrives', 'Total drives'),
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) },
      context: <><Car className="inline h-4 w-4" aria-hidden="true" />{' '}
        {stats?.total_driving_hours != null ? fmtNumber(stats.total_driving_hours) : '—'} {t('lifetime.hours', 'hrs')}</>,
    },
    {
      metricId: 'distance', occurrenceId: 'lifetime-total-distance',
      rawValue: stats?.total_distance_km != null ? stats.total_distance_km * 1000 : null,
      label: t('lifetime.totalDistance', 'Total distance'),
      display: { formatter: raw => ({ value: fmtNumber(convertDistanceFromSI(raw, unitPrefs.distance)), unit: unitPrefs.distance }) },
      context: <Gauge className="h-4 w-4" aria-hidden="true" />,
    },
    {
      metricId: 'energy', occurrenceId: 'lifetime-total-energy',
      rawValue: stats?.total_energy_kwh != null ? stats.total_energy_kwh * 1000 : null,
      label: t('lifetime.totalEnergy', 'Total energy'),
      display: { formatter: raw => ({ value: fmtNumber(raw / 1000), unit: 'kWh' }) },
      context: <><Zap className="inline h-4 w-4" aria-hidden="true" />{' '}
        {stats?.total_charge_sessions != null ? fmtInt(stats.total_charge_sessions) : '—'} {t('lifetime.sessions', 'sessions')}</>,
    },
    {
      metricId: 'currency', occurrenceId: 'lifetime-total-savings',
      rawValue: stats?.total_savings, label: t('lifetime.totalSavings', 'Total savings'),
      display: { formatter: raw => ({ value: formatCurrency(raw), unit: '' }) },
      context: <><DollarSign className="inline h-4 w-4" aria-hidden="true" />{' '}{t('lifetime.vsGas', 'vs gasoline')}</>,
    },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  return <div id="lifetime-key-metrics" className="min-w-0 space-y-3">
    <OperationalBrief compact metrics={operationalMetrics} loading={loading && stats == null}
      eyebrow={t('lifetime.title', 'Lifetime stats')}
      title={t('lifetime.brief.title', 'Lifetime driving and charging summary')}
      description={t('lifetime.brief.description', 'Server lifetime aggregates with recorded driving hours, charging sessions, and savings versus gasoline.')}
      statusLabel={loading && stats == null ? t('analytics.brief.loading', 'Loading evidence')
        : stats == null ? t('analytics.brief.unavailable', 'Evidence unavailable')
          : error != null ? t('analytics.brief.retained', 'Retained evidence') : t('analytics.brief.returned', 'Returned evidence')}
      statusTone={fatalError || error != null ? 'warning' : 'neutral'}
      scope={<span>{t('lifetime.source.allTime', 'All time')}</span>}
      provenance={t('lifetime.source.aggregate', 'Server lifetime aggregates')}
    />
    {error != null && <QueryError error={error} onRetry={onRetry} />}
  </div>;
}
