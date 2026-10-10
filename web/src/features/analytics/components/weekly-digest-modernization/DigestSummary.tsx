import { useTranslation } from 'react-i18next';
import { Car, Activity, Zap, Fuel, Leaf, MapPin, BarChart3 } from 'lucide-react';
import { StatStrip, type StatMetric } from '@/components/data-display/stat-reference';
import { LayoutCard } from '@/components/layout/layout-reference';
import { QueryError } from '@/components/feedback';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { StatPeriod } from '@/lib/metric-reference';
import type { DigestMetrics, FunFact } from '../weekly-digest/types';
import { trendFor } from '../weekly-digest/helpers';
import { formatEfficiencyFromSI } from '../weekly-digest/display';
import { presentedMetric } from './presentation';
import { DigestTrend } from './DigestTrend';

interface DigestSummaryProps {
  metrics: DigestMetrics;
  period: StatPeriod;
  funFact?: FunFact;
  comparison?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

/** Both original KPI bands remain separate: five totals + optional fun fact,
 * then six comparison metrics including the specialist efficiency measure.
 * Labels, operands, polarity and zero-baseline behavior stay source-owned.
 */
export function DigestSummary({
  metrics,
  period,
  funFact,
  comparison = false,
  isLoading,
  isError,
  error,
  onRetry,
}: DigestSummaryProps) {
  const { t } = useTranslation();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { formatCurrency } = useFormatting();
  const { unitPrefs, formatDistance, formatEnergy } = useUnits();
  const title = comparison
    ? t('analytics.weeklyDigest.weekOverWeek', 'Week-over-week comparison')
    : t('analytics.weeklyDigest.weekSummary', 'Week summary');
  const iconClass = 'h-4 w-4';
  const items: StatMetric[] = [
    presentedMetric(
      'distance',
      comparison
        ? t('analytics.weeklyDigest.distance', 'Distance')
        : t('analytics.weeklyDigest.totalDistance', 'Total distance'),
      formatDistance(metrics.totalDistanceM ?? 0),
      <Car className={iconClass} aria-hidden="true" />,
      <DigestTrend
        highlight={!comparison}
        trend={trendFor(metrics.totalDistanceM ?? 0, metrics.prevDistanceM ?? 0)}
      />,
    ),
    presentedMetric(
      'drives',
      comparison
        ? t('analytics.weeklyDigest.drives', 'Drives')
        : t('analytics.weeklyDigest.totalDrives', 'Total drives'),
      fmtInt(metrics.totalDrives ?? 0),
      <Activity className={iconClass} aria-hidden="true" />,
      <DigestTrend
        highlight={!comparison}
        trend={trendFor(metrics.totalDrives ?? 0, metrics.prevDriveCount ?? 0)}
      />,
    ),
    presentedMetric(
      'energy',
      comparison
        ? t('analytics.weeklyDigest.energy', 'Energy')
        : t('analytics.weeklyDigest.energyUsed', 'Energy used'),
      formatEnergy(metrics.energyUsedWh ?? 0),
      <Zap className={iconClass} aria-hidden="true" />,
      <DigestTrend
        highlight={!comparison}
        trend={trendFor(metrics.energyUsedWh ?? 0, metrics.prevEnergyWh ?? 0, true)}
      />,
    ),
    presentedMetric(
      'cost',
      comparison
        ? t('analytics.weeklyDigest.cost', 'Cost')
        : t('analytics.weeklyDigest.chargingCost', 'Charging cost'),
      formatCurrency(metrics.chargingCost ?? 0),
      <Fuel className={iconClass} aria-hidden="true" />,
      <DigestTrend
        highlight={!comparison}
        trend={trendFor(metrics.chargingCost ?? 0, metrics.prevChargingCost ?? 0, true)}
      />,
    ),
  ];

  if (comparison) {
    items.push(presentedMetric(
      'efficiency',
      t('analytics.weeklyDigest.efficiency', 'Efficiency'),
      formatEfficiencyFromSI(metrics.avgEfficiencyWhPerM ?? 0, unitPrefs),
      <BarChart3 className={iconClass} aria-hidden="true" />,
      <DigestTrend trend={trendFor(
        metrics.avgEfficiencyWhPerM ?? 0,
        metrics.prevAvgEfficiencyWhPerM ?? 0,
        true,
      )} />,
    ));
  }
  items.push(presentedMetric(
    'co2',
    comparison
      ? t('analytics.weeklyDigest.co2', 'CO₂ saved')
      : t('analytics.weeklyDigest.co2Saved', 'CO₂ saved'),
    `${fmtNumber(metrics.co2Saved ?? 0)} kg`,
    <Leaf className={iconClass} aria-hidden="true" />,
    <DigestTrend
      highlight={!comparison}
      trend={trendFor(metrics.co2Saved ?? 0, metrics.prevCo2 ?? 0)}
    />,
  ));
  if (!comparison && funFact) {
    items.push(presentedMetric(
      'fun-fact',
      t('analytics.weeklyDigest.funFact', 'Fun fact'),
      `${funFact.times}×`,
      <>
        <MapPin className={iconClass} aria-hidden="true" />
        {t('analytics.weeklyDigest.funFactDesc', '≈ {{times}}× {{from}} → {{to}}', {
          times: funFact.times,
          from: funFact.from,
          to: funFact.to,
        })}
      </>,
    ));
  } else if (!comparison && isLoading) {
    // The original hero band always reserves six skeleton tiles.
    items.push(presentedMetric(
      'fun-fact',
      t('analytics.weeklyDigest.funFact', 'Fun fact'),
      '—',
    ));
  }

  return (
    <LayoutCard title={title}>
      {isError ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : (
        <StatStrip
          id={comparison ? 'weekly-digest-comparison' : 'weekly-digest-summary'}
          variant="embedded"
          metrics={items}
          period={period}
          loading={isLoading}
          comparisonLabel={t(
            'analytics.weeklyDigest.modernization.comparisonPeriod',
            'Compared with previous week',
          )}
        />
      )}
    </LayoutCard>
  );
}
