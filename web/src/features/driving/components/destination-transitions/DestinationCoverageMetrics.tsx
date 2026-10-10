import { useTranslation } from 'react-i18next';


import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import {
  destinationDateTime,
  destinationPercent,
} from './labels';
import {
  DestinationTransitionsMetricGroup,
  type DestinationTransitionsEvidenceMetric,
} from './DestinationTransitionsMetricGroup';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface DestinationCoverageMetricsProps {
  model: DestinationTransitionResult;
  locale: string;
  timeZone: string;
}

export function DestinationCoverageMetrics({
  model,
  locale,
  timeZone,
}: DestinationCoverageMetricsProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const evidence = model.evidence;
  const days = (value: number | null) =>
    value != null ? fmtNumber(value, undefined, locale) : '—';
  const metrics: DestinationTransitionsEvidenceMetric[] = [
    {
      label: t(
        'destinationTransitions.quality.coverage.activeDays',
        'Active local days',
      ),
      metricId: 'count', rawValue: evidence.activeLocalDays,
      displayValue: fmtInt(evidence.activeLocalDays),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.activeWeeks',
        'Active local weeks',
      ),
      metricId: 'count', rawValue: evidence.activeLocalWeeks,
      displayValue: fmtInt(evidence.activeLocalWeeks),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.returnedFirst',
        'First parseable returned start',
      ),
      metricId: 'number', rawValue: evidence.returnedFirstObservationMs,
      description: t('destinationTransitions.quality.timestampSource', 'Source epoch milliseconds, rendered in the selected display timezone.'),
      displayValue: destinationDateTime(
        evidence.returnedFirstObservationMs,
        locale,
        timeZone,
      ),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.returnedLast',
        'Last parseable returned start',
      ),
      metricId: 'number', rawValue: evidence.returnedLastObservationMs,
      description: t('destinationTransitions.quality.timestampSource', 'Source epoch milliseconds, rendered in the selected display timezone.'),
      displayValue: destinationDateTime(
        evidence.returnedLastObservationMs,
        locale,
        timeZone,
      ),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.returnedSpan',
        'Returned span (days)',
      ),
      metricId: 'duration', rawValue: evidence.returnedSpanDays != null ? evidence.returnedSpanDays * 86400 : null,
      displayValue: days(evidence.returnedSpanDays),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.includedFirst',
        'First included visit',
      ),
      metricId: 'number', rawValue: evidence.firstIncludedVisitMs,
      description: t('destinationTransitions.quality.timestampSource', 'Source epoch milliseconds, rendered in the selected display timezone.'),
      displayValue: destinationDateTime(
        evidence.firstIncludedVisitMs,
        locale,
        timeZone,
      ),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.includedLast',
        'Last included visit',
      ),
      metricId: 'number', rawValue: evidence.lastIncludedVisitMs,
      description: t('destinationTransitions.quality.timestampSource', 'Source epoch milliseconds, rendered in the selected display timezone.'),
      displayValue: destinationDateTime(
        evidence.lastIncludedVisitMs,
        locale,
        timeZone,
      ),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.includedSpan',
        'Included span (days)',
      ),
      metricId: 'duration', rawValue: evidence.includedSpanDays != null ? evidence.includedSpanDays * 86400 : null,
      displayValue: days(evidence.includedSpanDays),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.recency',
        'Visit recency (days)',
      ),
      metricId: 'duration', rawValue: evidence.daysSinceLastIncludedVisit != null ? evidence.daysSinceLastIncludedVisit * 86400 : null,
      displayValue: days(evidence.daysSinceLastIncludedVisit),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.transitionFirst',
        'First accepted transition',
      ),
      metricId: 'number', rawValue: evidence.firstAcceptedTransitionMs,
      description: t('destinationTransitions.quality.timestampSource', 'Source epoch milliseconds, rendered in the selected display timezone.'),
      displayValue: destinationDateTime(
        evidence.firstAcceptedTransitionMs,
        locale,
        timeZone,
      ),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.transitionLast',
        'Last accepted transition',
      ),
      metricId: 'number', rawValue: evidence.lastAcceptedTransitionMs,
      description: t('destinationTransitions.quality.timestampSource', 'Source epoch milliseconds, rendered in the selected display timezone.'),
      displayValue: destinationDateTime(
        evidence.lastAcceptedTransitionMs,
        locale,
        timeZone,
      ),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.transitionSpan',
        'Accepted span (days)',
      ),
      metricId: 'duration', rawValue: evidence.acceptedTransitionSpanDays != null ? evidence.acceptedTransitionSpanDays * 86400 : null,
      displayValue: days(evidence.acceptedTransitionSpanDays),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.supportedOrigins',
        'Supported origins',
      ),
      metricId: 'count', rawValue: evidence.supportedOriginStates,
      displayValue: fmtInt(evidence.supportedOriginStates),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.unsupportedOrigins',
        'Unsupported origins',
      ),
      metricId: 'count', rawValue: evidence.unsupportedOriginStates,
      displayValue: fmtInt(evidence.unsupportedOriginStates),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.supportedShare',
        'Supported-origin transition coverage',
      ),
      metricId: 'percent', rawValue: evidence.supportedOriginTransitionCoverage != null ? evidence.supportedOriginTransitionCoverage * 100 : null,
      displayValue: destinationPercent(
        evidence.supportedOriginTransitionCoverage,
        locale,
      ),
    },
  ];

  return (
    <DestinationTransitionsMetricGroup
      title={t(
        'destinationTransitions.quality.coverage.title',
        'Spans, recency, activity, and supported coverage',
      )}
      metrics={metrics}
      testId="destination-coverage-recency-brief"
    />
  );
}
