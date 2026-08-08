import { useTranslation } from 'react-i18next';

import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import {
  destinationDateTime,
  destinationPercent,
} from './labels';
import {
  DestinationTransitionsMetricGroup,
  type DestinationTransitionsEvidenceMetric,
} from './DestinationTransitionsMetricGroup';

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
  const { t } = useTranslation();
  const evidence = model.evidence;
  const days = (value: number | null) =>
    value != null ? fmtNumber(value, 1, locale) : '—';
  const metrics: DestinationTransitionsEvidenceMetric[] = [
    {
      label: t(
        'destinationTransitions.quality.coverage.activeDays',
        'Active local days',
      ),
      value: fmtInt(evidence.activeLocalDays),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.activeWeeks',
        'Active local weeks',
      ),
      value: fmtInt(evidence.activeLocalWeeks),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.returnedFirst',
        'First parseable returned start',
      ),
      value: destinationDateTime(
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
      value: destinationDateTime(
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
      value: days(evidence.returnedSpanDays),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.includedFirst',
        'First included visit',
      ),
      value: destinationDateTime(
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
      value: destinationDateTime(
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
      value: days(evidence.includedSpanDays),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.recency',
        'Visit recency (days)',
      ),
      value: days(evidence.daysSinceLastIncludedVisit),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.transitionFirst',
        'First accepted transition',
      ),
      value: destinationDateTime(
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
      value: destinationDateTime(
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
      value: days(evidence.acceptedTransitionSpanDays),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.supportedOrigins',
        'Supported origins',
      ),
      value: fmtInt(evidence.supportedOriginStates),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.unsupportedOrigins',
        'Unsupported origins',
      ),
      value: fmtInt(evidence.unsupportedOriginStates),
    },
    {
      label: t(
        'destinationTransitions.quality.coverage.supportedShare',
        'Supported-origin transition coverage',
      ),
      value: destinationPercent(
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
    />
  );
}
