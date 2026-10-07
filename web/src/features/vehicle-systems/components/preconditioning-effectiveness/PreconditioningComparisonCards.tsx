import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  Badge,
  MetricLabel,
  MetricValue,
  Text,
} from '@/components/ui';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import type { PreconditioningComparison } from '../../lib/preconditioningEffectiveness';
import {
  preconditioningEvidenceLabel,
  preconditioningEvidenceVariant,
  preconditioningRegimeLabel,
} from './labels';
import type { TemperatureDeltaFormatter } from './types';

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
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Text as="h4" variant="label">
                  {preconditioningRegimeLabel(t, comparison.regime)}
                </Text>
                <Text as="p" variant="caption" className="mt-1">
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
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <MetricLabel>
                  {t(
                    'preconditioningEffectiveness.groups.observedActiveShort',
                    'HVAC-active',
                  )}
                </MetricLabel>
                <MetricValue className="mt-1">
                  {published ? formatDelta(active) : '—'}
                </MetricValue>
              </div>
              <div>
                <MetricLabel>
                  {t(
                    'preconditioningEffectiveness.groups.explicitOffShort',
                    'Explicit-off control',
                  )}
                </MetricLabel>
                <MetricValue className="mt-1">
                  {published ? formatDelta(control) : '—'}
                </MetricValue>
              </div>
              <div>
                <MetricLabel>
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
                <MetricValue className="mt-1">
                  {published
                    ? formatDelta(difference, { signed: true })
                    : '—'}
                </MetricValue>
              </div>
              <div>
                <MetricLabel>
                  {t(
                    'preconditioningEffectiveness.comparison.confidence',
                    'Confidence',
                  )}
                </MetricLabel>
                <MetricValue className="mt-1">
                  {published ? fmtPercent(comparison.confidence * 100, 0) : '—'}
                </MetricValue>
              </div>
            </div>
          </article>
        );
      })}
    </Grid>
  );
}
