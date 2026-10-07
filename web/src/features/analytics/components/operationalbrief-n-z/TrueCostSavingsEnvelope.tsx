import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { Badge } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { TrueCostSectionBody } from '../true-cost/TrueCostSectionBody';
import type { TrueCostSectionProps } from '../true-cost/types';
import type { TcoDisposition } from '../../lib/trueCost';

export function TrueCostSavingsEnvelope({ analysis, state, display }: TrueCostSectionProps) {
  const { t } = useTranslation();
  const resolved = state.isResolved && state.hasData;
  const disposition = (value: TcoDisposition) => value === 'savings'
    ? { label: t('tco.savings.savings', 'Savings'), variant: 'success' as const }
    : value === 'loss' ? { label: t('tco.savings.loss', 'Loss'), variant: 'danger' as const }
      : value === 'balanced' ? { label: t('tco.savings.balanced', 'Near balance'), variant: 'warning' as const }
        : { label: t('tco.savings.unavailable', 'Unavailable'), variant: 'neutral' as const };
  const fuel = disposition(analysis.fuelDisposition);
  const combined = disposition(analysis.combinedDisposition);
  const heuristicLabel = analysis.gates.maintenanceHeuristic
    ? t('tco.savings.heuristic', 'Heuristic') : t('tco.savings.withheld', 'Withheld');
  const metrics: StatMetric[] = [
    { metricId: 'currency', occurrenceId: 'tco-envelope-fuel',
      label: t('tco.savings.fuel', 'Fuel-only savings / loss'),
      rawValue: resolved && analysis.gates.fuelComparison ? analysis.metrics.totalFuelDelta.value : null,
      description: t('tco.savings.fuelHint', 'Lifetime distance-derived gas equivalent less recorded charging spend'),
      context: <Badge variant={fuel.variant}>{fuel.label}</Badge>,
      display: { formatter: raw => ({ value: display.formatSignedCurrency(raw), unit: '' }) } },
    { metricId: 'currency', occurrenceId: 'tco-envelope-maintenance',
      label: t('tco.savings.maintenance', 'Maintenance heuristic'),
      rawValue: resolved && analysis.gates.maintenanceHeuristic ? analysis.metrics.maintenanceHeuristic.value : null,
      description: t('tco.savings.maintenanceHint', '$50 × modeled drive-span months; not observed service spend'),
      context: <Badge variant="warning">{heuristicLabel}</Badge>,
      display: { formatter: raw => ({ value: display.formatCurrency(raw), unit: '' }) } },
    { metricId: 'currency', occurrenceId: 'tco-envelope-combined',
      label: t('tco.savings.combined', 'Fuel delta + heuristic'),
      rawValue: resolved ? analysis.combinedFuelAndMaintenance : null,
      description: t('tco.savings.combinedHint', 'Algebraic combination only; not verified net ownership savings'),
      context: <Badge variant={combined.variant}>{combined.label}</Badge>,
      display: { formatter: raw => ({ value: display.formatSignedCurrency(raw), unit: '' }) } },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  return <div data-testid="tco-savings-envelope">
    <OperationalBrief compact testId="tco-savings-brief"
      eyebrow={t('tco.modernization.evidence.title', 'Operating-cost evidence')}
      title={t('tco.savings.title', 'Savings / loss envelope')}
      description={t('tco.brief.savingsDescription', 'Fuel comparison and the maintenance heuristic remain separate from their algebraic combination; none asserts verified net ownership savings.')}
      statusLabel={state.refreshError ? t('tco.brief.retained', 'Retained operating evidence')
        : resolved ? t('tco.brief.available', 'Returned operating evidence')
          : state.isLoading ? t('tco.brief.loading', 'Loading operating evidence')
            : t('tco.brief.unavailable', 'Operating evidence unavailable')}
      statusTone={state.error || state.refreshError || state.isPaused || state.refreshPaused ? 'warning' : 'neutral'}
      scope={t('tco.brief.scope', 'Lifetime source envelope; modeled first-to-last positive-drive span')}
      provenance={t('tco.savings.combinedHint', 'Algebraic combination only; not verified net ownership savings')}
      loading={state.isLoading}
      metrics={operationalMetrics.map((metric, index) => ({
        ...metric,
        tone: index === 1 ? 'warning' as const
          : (index === 0 ? analysis.fuelDisposition : analysis.combinedDisposition) === 'savings' ? 'success' as const
            : (index === 0 ? analysis.fuelDisposition : analysis.combinedDisposition) === 'loss' ? 'danger' as const
              : 'warning' as const,
      }))} />
    {!resolved && <TrueCostSectionBody state={state}>{null}</TrueCostSectionBody>}
  </div>;
}
