import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  Badge,
  MetricLabel,
  MetricValue,
  Text,
} from '@/components/ui';

import type { PreconditioningComparison } from '../../lib/preconditioningEffectiveness';
import {
  preconditioningEvidenceLabel,
  preconditioningEvidenceVariant,
  preconditioningRegimeLabel,
} from './labels';
import type { TemperatureDeltaFormatter } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface PreconditioningComparisonCardsProps {
  comparisons: readonly PreconditioningComparison[];
  metric: 'readiness' | 'improvement';
  formatDelta: TemperatureDeltaFormatter;
}

export function PreconditioningComparisonCards({
  comparisons,
  metric,
  formatDelta,
}: PreconditioningComparisonCardsProps) {
  const { fmtInt, fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();

  return (
    <Grid cols={{ default: 1, xl: 3 }} gap={3} className="mt-4">
      {comparisons.map((comparison) => {
        const published = comparison.evidence !== 'none';
        const active = metric === 'readiness'
          ? comparison.conditionedStartDeltaC
          : comparison.conditionedImprovementC;
        const control = metric === 'readiness'
          ? comparison.unconditionedStartDeltaC
          : comparison.unconditionedImprovementC;
        const difference = metric === 'readiness'
          ? comparison.startDeltaAdvantageC
          : comparison.improvementLiftC;

        return (
          <article
            key={comparison.regime}
            data-app-part="card"
            data-app-card-kind="record"
            data-surface-variant="standalone"
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
          >
            <div data-app-part="record-header" className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Text data-app-part="record-title" as="h4" variant="label">
                  {preconditioningRegimeLabel(t, comparison.regime)}
                </Text>
                <Text data-app-part="record-context" as="p" variant="caption" className="mt-1">
                  {t(
                    'preconditioningEffectiveness.comparison.support',
                    '{{active}} active · {{control}} explicit-off control',
                    {
                      active: fmtInt(comparison.conditionedCount),
                      control: fmtInt(comparison.unconditionedCount),
                    },
                  )}
                </Text>
              </div>
              <Badge variant={preconditioningEvidenceVariant(comparison.evidence)}>
                {preconditioningEvidenceLabel(t, comparison.evidence)}
              </Badge>
            </div>
            <div data-app-part="record-body metric-grid" className="mt-4 grid grid-cols-2 gap-3">
              <div data-app-part="metric" data-app-metric="tile" data-surface-variant="embedded">
                <MetricLabel data-app-part="metric-label">
                  {t(
                    'preconditioningEffectiveness.groups.observedActiveShort',
                    'HVAC-active',
                  )}
                </MetricLabel>
                <div data-app-part="metric-reading" className="mt-1">
                  <MetricValue data-app-part="metric-value">
                    {published ? formatDelta(active) : '—'}
                  </MetricValue>
                </div>
              </div>
              <div data-app-part="metric" data-app-metric="tile" data-surface-variant="embedded">
                <MetricLabel data-app-part="metric-label">
                  {t(
                    'preconditioningEffectiveness.groups.explicitOffShort',
                    'Explicit-off control',
                  )}
                </MetricLabel>
                <div data-app-part="metric-reading" className="mt-1">
                  <MetricValue data-app-part="metric-value">
                    {published ? formatDelta(control) : '—'}
                  </MetricValue>
                </div>
              </div>
              <div data-app-part="metric" data-app-metric="tile" data-surface-variant="embedded">
                <MetricLabel data-app-part="metric-label">
                  {metric === 'readiness'
                    ? t(
                        'preconditioningEffectiveness.comparison.readinessDifference',
                        'Control minus active',
                      )
                    : t(
                        'preconditioningEffectiveness.comparison.improvementDifference',
                        'Active minus control',
                      )}
                </MetricLabel>
                <div data-app-part="metric-reading" className="mt-1">
                  <MetricValue data-app-part="metric-value">
                    {published
                      ? formatDelta(difference, { signed: true })
                      : '—'}
                  </MetricValue>
                </div>
              </div>
              <div data-app-part="metric" data-app-metric="tile" data-surface-variant="embedded">
                <MetricLabel data-app-part="metric-label">
                  {t(
                    'preconditioningEffectiveness.comparison.confidence',
                    'Confidence',
                  )}
                </MetricLabel>
                <div data-app-part="metric-reading" className="mt-1">
                  <MetricValue data-app-part="metric-value">
                    {published ? fmtPercent(comparison.confidence * 100) : '—'}
                  </MetricValue>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </Grid>
  );
}
