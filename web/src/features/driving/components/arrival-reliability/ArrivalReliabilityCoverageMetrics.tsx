import { useTranslation } from 'react-i18next';

import { formatDateTime } from '@/lib/dateFormat';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { ArrivalReliabilityResult } from '../../lib/arrivalReliability';
import {
  ArrivalReliabilityEvidenceMetricGroup,
  type ArrivalReliabilityEvidenceMetric,
} from './ArrivalReliabilityEvidenceMetricGroup';
import { arrivalPercent } from './labels';

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
  const { t } = useTranslation();
  const coverage = analysis.coverage;
  const date = (value: number | null) =>
    value != null
      ? formatDateTime(new Date(value), { locale, tz: timeZone })
      : '—';
  const days = (value: number | null) =>
    value != null ? fmtNumber(value, 1, locale) : '—';
  const metrics: ArrivalReliabilityEvidenceMetric[] = [
    {
      label: t('arrivalReliability.quality.supportedRoutes', 'Supported routes'),
      value: fmtInt(coverage.supportedRoutes),
    },
    {
      label: t(
        'arrivalReliability.quality.unsupportedRoutes',
        'Unsupported routes',
      ),
      value: fmtInt(coverage.unsupportedRoutes),
    },
    {
      label: t(
        'arrivalReliability.quality.repeatedDrives',
        'Supported-route drives',
      ),
      value: fmtInt(coverage.repeatedDrives),
    },
    {
      label: t(
        'arrivalReliability.quality.unsupportedDrives',
        'Unsupported-route drives',
      ),
      value: fmtInt(coverage.unsupportedDrives),
    },
    {
      label: t(
        'arrivalReliability.quality.repeatedCoverage',
        'Repeated-route coverage',
      ),
      value: arrivalPercent(coverage.repeatedRouteCoverage, locale),
    },
    {
      label: t('arrivalReliability.quality.activeDays', 'Active local days'),
      value: fmtInt(coverage.activeLocalDays),
    },
    {
      label: t('arrivalReliability.quality.activeWeeks', 'Active local weeks'),
      value: fmtInt(coverage.activeLocalWeeks),
    },
    {
      label: t(
        'arrivalReliability.quality.supportedActiveDays',
        'Supported-route active days',
      ),
      value: fmtInt(coverage.supportedActiveLocalDays),
    },
    {
      label: t(
        'arrivalReliability.quality.supportedActiveWeeks',
        'Supported-route active weeks',
      ),
      value: fmtInt(coverage.supportedActiveLocalWeeks),
    },
    {
      label: t('arrivalReliability.quality.returnedSpan', 'Returned span (days)'),
      value: days(coverage.returnedSpanDays),
    },
    {
      label: t(
        'arrivalReliability.quality.returnedFirst',
        'First parseable returned start',
      ),
      value: date(coverage.returnedFirstObservationMs),
    },
    {
      label: t(
        'arrivalReliability.quality.returnedLast',
        'Last parseable returned start',
      ),
      value: date(coverage.returnedLastObservationMs),
    },
    {
      label: t('arrivalReliability.quality.includedSpan', 'Included span (days)'),
      value: days(coverage.includedSpanDays),
    },
    {
      label: t('arrivalReliability.quality.firstIncluded', 'First included drive'),
      value: date(coverage.firstIncludedObservationMs),
    },
    {
      label: t('arrivalReliability.quality.lastIncluded', 'Last included drive'),
      value: date(coverage.lastIncludedObservationMs),
    },
    {
      label: t('arrivalReliability.quality.recency', 'Recency (days)'),
      value: days(coverage.daysSinceLastIncludedObservation),
    },
    {
      label: t('arrivalReliability.quality.concentration', 'Largest-route share'),
      value: arrivalPercent(coverage.routeConcentration, locale),
    },
  ];

  return (
    <ArrivalReliabilityEvidenceMetricGroup
      title={t(
        'arrivalReliability.quality.coverageTitle',
        'Coverage, recurrence, and recency',
      )}
      metrics={metrics}
    />
  );
}
