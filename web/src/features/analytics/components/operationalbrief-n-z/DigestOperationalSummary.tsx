import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { QueryError } from '@/components/feedback';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { DigestSummary } from '../weekly-digest-modernization/DigestSummary';
import { DigestTrend } from '../weekly-digest-modernization/DigestTrend';
import { trendFor } from '../weekly-digest/helpers';
import { formatEfficiencyFromSI } from '../weekly-digest/display';

export function DigestOperationalSummary({
  metrics, period, funFact, comparison = false, isLoading, isError, error, onRetry, driveAvailable, chargingAvailable,
}: ComponentProps<typeof DigestSummary> & { driveAvailable?: boolean; chargingAvailable?: boolean }) {
  const { t } = useTranslation();
  const { formatDistance, formatEnergy, unitPrefs } = useUnits();
  const { formatCurrency } = useFormatting();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const drivesKnown = driveAvailable ?? (!isLoading && !isError);
  const chargingKnown = chargingAvailable ?? (!isLoading && !isError);
  const title = comparison ? t('analytics.weeklyDigest.weekOverWeek', 'Week-over-week comparison')
    : t('analytics.weeklyDigest.weekSummary', 'Week summary');
  const trend = (current: number, previous: number, invert = false) => (
    <DigestTrend highlight={!comparison} trend={trendFor(current, previous, invert)} />
  );
  const items: StatMetric[] = [
    { metricId: 'distance', occurrenceId: 'weekly-distance',
      label: comparison ? t('analytics.weeklyDigest.distance', 'Distance') : t('analytics.weeklyDigest.totalDistance', 'Total distance'),
      rawValue: drivesKnown ? metrics.totalDistanceM ?? 0 : null,
      display: { formatter: raw => ({ value: formatDistance(raw), unit: '' }) },
      comparisonContent: drivesKnown ? trend(metrics.totalDistanceM ?? 0, metrics.prevDistanceM ?? 0) : undefined },
    { metricId: 'count', occurrenceId: 'weekly-drives',
      label: comparison ? t('analytics.weeklyDigest.drives', 'Drives') : t('analytics.weeklyDigest.totalDrives', 'Total drives'),
      rawValue: drivesKnown ? metrics.totalDrives ?? 0 : null,
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) },
      comparisonContent: drivesKnown ? trend(metrics.totalDrives ?? 0, metrics.prevDriveCount ?? 0) : undefined },
    { metricId: 'energy', occurrenceId: 'weekly-energy',
      label: comparison ? t('analytics.weeklyDigest.energy', 'Energy') : t('analytics.weeklyDigest.energyUsed', 'Energy used'),
      rawValue: drivesKnown ? metrics.energyUsedWh ?? 0 : null,
      display: { formatter: raw => ({ value: formatEnergy(raw), unit: '' }) },
      comparisonContent: drivesKnown ? trend(metrics.energyUsedWh ?? 0, metrics.prevEnergyWh ?? 0, true) : undefined },
    { metricId: 'currency', occurrenceId: 'weekly-cost',
      label: comparison ? t('analytics.weeklyDigest.cost', 'Cost') : t('analytics.weeklyDigest.chargingCost', 'Charging cost'),
      rawValue: chargingKnown ? metrics.chargingCost ?? 0 : null,
      display: { formatter: raw => ({ value: formatCurrency(raw), unit: '' }) },
      comparisonContent: chargingKnown ? trend(metrics.chargingCost ?? 0, metrics.prevChargingCost ?? 0, true) : undefined },
  ];
  if (comparison) items.push({
    metricId: 'efficiency', occurrenceId: 'weekly-efficiency',
    label: t('analytics.weeklyDigest.efficiency', 'Efficiency'),
    rawValue: drivesKnown ? metrics.avgEfficiencyWhPerM ?? 0 : null,
    display: { formatter: raw => ({ value: formatEfficiencyFromSI(raw, unitPrefs), unit: '' }) },
    comparisonContent: drivesKnown ? trend(metrics.avgEfficiencyWhPerM ?? 0, metrics.prevAvgEfficiencyWhPerM ?? 0, true) : undefined,
  });
  items.push({
    metricId: 'mass', occurrenceId: 'weekly-co2',
    label: comparison ? t('analytics.weeklyDigest.co2', 'CO₂ saved') : t('analytics.weeklyDigest.co2Saved', 'CO₂ saved'),
    rawValue: drivesKnown ? metrics.co2Saved ?? 0 : null,
    display: { formatter: raw => ({ value: fmtNumber(raw), unit: 'kg' }) },
    comparisonContent: drivesKnown ? trend(metrics.co2Saved ?? 0, metrics.prevCo2 ?? 0) : undefined,
  });
  if (!comparison && (funFact || isLoading)) items.push({
    metricId: 'multiplier', occurrenceId: 'weekly-fun-fact',
    label: t('analytics.weeklyDigest.funFact', 'Fun fact'),
    rawValue: drivesKnown && funFact ? Number(funFact.times) : null,
    display: { formatter: () => ({ value: funFact?.times ?? '—', unit: '×' }) },
    context: funFact ? t('analytics.weeklyDigest.funFactDesc', '≈ {{times}}× {{from}} → {{to}}', {
      times: funFact.times, from: funFact.from, to: funFact.to,
    }) : undefined,
  });
  const operationalMetrics = useOperationalMetrics(items);
  return <div data-digest-summary-frame>
    <OperationalBrief compact
      testId={comparison ? 'weekly-digest-comparison' : 'weekly-digest-summary'}
      eyebrow={t('analytics.weeklyDigest.title', 'Weekly digest')} title={title}
      description={t('analytics.weeklyDigest.brief.description', 'Available drive and charging records for the selected week, compared with the previous week.')}
      statusLabel={isError ? drivesKnown || chargingKnown
        ? t('analytics.weeklyDigest.brief.retained', 'Retained or partial weekly records')
        : t('analytics.weeklyDigest.brief.unavailable', 'Weekly sources unavailable')
        : isLoading ? t('analytics.weeklyDigest.brief.loading', 'Loading weekly records')
          : t('analytics.weeklyDigest.brief.available', 'Returned weekly records')}
      statusTone={isError ? 'warning' : 'neutral'} metrics={operationalMetrics} loading={Boolean(isLoading && !drivesKnown && !chargingKnown)}
      scope={period.label}
      freshness={t('analytics.weeklyDigest.modernization.comparisonPeriod', 'Compared with previous week')}
      provenance={t('analytics.weeklyDigest.modernization.periodProvenance', 'Selected week; based on available history records.')}
    />
    {isError && <QueryError error={error} onRetry={onRetry} />}
  </div>;
}
