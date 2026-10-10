import { useTranslation } from 'react-i18next';

import { formatDateTime } from '@/lib/dateFormat';

import type { ArrivalReliabilityResult } from '../../lib/arrivalReliability';
import {
  ArrivalReliabilityEvidenceMetricGroup,
  type ArrivalReliabilityEvidenceMetric,
} from './ArrivalReliabilityEvidenceMetricGroup';
import { arrivalPercent } from './labels';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface ArrivalReliabilityCoverageMetricsProps {
  analysis: ArrivalReliabilityResult;
  locale: string;
  timeZone: string;
}

export function ArrivalReliabilityCoverageMetrics({
  analysis,
  locale,
  timeZone,
}: ArrivalReliabilityCoverageMetricsProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const coverage = analysis.coverage;
  const date = (value: number | null) =>
    value != null && Number.isFinite(value)
      ? formatDateTime(new Date(value), { locale, tz: timeZone })
      : '—';
  const days = (value: number | null) =>
    value != null ? fmtNumber(value, undefined, locale) : '—';
  const metrics: ArrivalReliabilityEvidenceMetric[] = [
    {
      label: t('arrivalReliability.quality.supportedRoutes', 'Supported routes'),
      metricId: 'count', rawValue: coverage.supportedRoutes,
      displayValue: fmtInt(coverage.supportedRoutes),
    },
    {
      label: t(
        'arrivalReliability.quality.unsupportedRoutes',
        'Unsupported routes',
      ),
      metricId: 'count', rawValue: coverage.unsupportedRoutes,
      displayValue: fmtInt(coverage.unsupportedRoutes),
    },
    {
      label: t(
        'arrivalReliability.quality.repeatedDrives',
        'Supported-route drives',
      ),
      metricId: 'count', rawValue: coverage.repeatedDrives,
      displayValue: fmtInt(coverage.repeatedDrives),
    },
    {
      label: t(
        'arrivalReliability.quality.unsupportedDrives',
        'Unsupported-route drives',
      ),
      metricId: 'count', rawValue: coverage.unsupportedDrives,
      displayValue: fmtInt(coverage.unsupportedDrives),
    },
    {
      label: t(
        'arrivalReliability.quality.repeatedCoverage',
        'Repeated-route coverage',
      ),
      metricId: 'percent', rawValue: coverage.repeatedRouteCoverage != null ? coverage.repeatedRouteCoverage * 100 : null,
      displayValue: arrivalPercent(coverage.repeatedRouteCoverage, locale),
    },
    {
      label: t('arrivalReliability.quality.activeDays', 'Active local days'),
      metricId: 'count', rawValue: coverage.activeLocalDays,
      displayValue: fmtInt(coverage.activeLocalDays),
    },
    {
      label: t('arrivalReliability.quality.activeWeeks', 'Active local weeks'),
      metricId: 'count', rawValue: coverage.activeLocalWeeks,
      displayValue: fmtInt(coverage.activeLocalWeeks),
    },
    {
      label: t(
        'arrivalReliability.quality.supportedActiveDays',
        'Supported-route active days',
      ),
      metricId: 'count', rawValue: coverage.supportedActiveLocalDays,
      displayValue: fmtInt(coverage.supportedActiveLocalDays),
    },
    {
      label: t(
        'arrivalReliability.quality.supportedActiveWeeks',
        'Supported-route active weeks',
      ),
      metricId: 'count', rawValue: coverage.supportedActiveLocalWeeks,
      displayValue: fmtInt(coverage.supportedActiveLocalWeeks),
    },
    {
      label: t('arrivalReliability.quality.returnedSpan', 'Returned span (days)'),
      metricId: 'duration', rawValue: coverage.returnedSpanDays != null ? coverage.returnedSpanDays * 86400 : null,
      displayValue: days(coverage.returnedSpanDays),
    },
    {
      label: t(
        'arrivalReliability.quality.returnedFirst',
        'First parseable returned start',
      ),
      metricId: 'number', rawValue: coverage.returnedFirstObservationMs,
      description: t('arrivalReliability.quality.timestampSource', 'Source epoch milliseconds, rendered in the selected display timezone.'),
      displayValue: date(coverage.returnedFirstObservationMs),
    },
    {
      label: t(
        'arrivalReliability.quality.returnedLast',
        'Last parseable returned start',
      ),
      metricId: 'number', rawValue: coverage.returnedLastObservationMs,
      description: t('arrivalReliability.quality.timestampSource', 'Source epoch milliseconds, rendered in the selected display timezone.'),
      displayValue: date(coverage.returnedLastObservationMs),
    },
    {
      label: t('arrivalReliability.quality.includedSpan', 'Included span (days)'),
      metricId: 'duration', rawValue: coverage.includedSpanDays != null ? coverage.includedSpanDays * 86400 : null,
      displayValue: days(coverage.includedSpanDays),
    },
    {
      label: t('arrivalReliability.quality.firstIncluded', 'First included drive'),
      metricId: 'number', rawValue: coverage.firstIncludedObservationMs,
      description: t('arrivalReliability.quality.timestampSource', 'Source epoch milliseconds, rendered in the selected display timezone.'),
      displayValue: date(coverage.firstIncludedObservationMs),
    },
    {
      label: t('arrivalReliability.quality.lastIncluded', 'Last included drive'),
      metricId: 'number', rawValue: coverage.lastIncludedObservationMs,
      description: t('arrivalReliability.quality.timestampSource', 'Source epoch milliseconds, rendered in the selected display timezone.'),
      displayValue: date(coverage.lastIncludedObservationMs),
    },
    {
      label: t('arrivalReliability.quality.recency', 'Recency (days)'),
      metricId: 'duration', rawValue: coverage.daysSinceLastIncludedObservation != null ? coverage.daysSinceLastIncludedObservation * 86400 : null,
      displayValue: days(coverage.daysSinceLastIncludedObservation),
    },
    {
      label: t('arrivalReliability.quality.concentration', 'Largest-route share'),
      metricId: 'percent', rawValue: coverage.routeConcentration != null ? coverage.routeConcentration * 100 : null,
      displayValue: arrivalPercent(coverage.routeConcentration, locale),
    },
  ];

  return (
    <ArrivalReliabilityEvidenceMetricGroup
      title={t(
        'arrivalReliability.quality.coverageTitle',
        'Coverage, recurrence, and recency',
      )}
      metrics={metrics}
      testId="arrival-coverage-recurrence-brief"
    />
  );
}
