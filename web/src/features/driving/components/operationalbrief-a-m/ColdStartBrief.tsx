import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { EmptyState } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { ColdStartKpis } from '../cold-start/ColdStartKpis';
import { useColdStartDisplay } from '../cold-start/useColdStartDisplay';
import { COLD_GAP_HOURS } from '../../lib/coldStart';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

type Props = ComponentProps<typeof ColdStartKpis> & { scope: string; retained: boolean };

export function ColdStartBrief({ summary, penaltyCostLabel, isLoading, error, onRetry, scope, retained }: Props) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const { formatEfficiency, formatEnergy } = useColdStartDisplay();
  const available = !isLoading && error == null;
  const metrics: readonly StatMetric[] = [
    { metricId: 'efficiency', occurrenceId: 'cold-penalty',
      rawValue: available && summary.penaltyWhPerKm != null ? summary.penaltyWhPerKm / 1000 : null,
      label: t('coldStart.penalty', 'Cold Penalty'),
      description: t('coldStart.brief.penalty', 'Observed cold-start consumption difference against warm starts.'),
      context: available && summary.penaltyShare != null
        ? t('coldStart.penaltyVsWarm', '{{sign}}{{pct}}% vs warm starts', {
            sign: summary.penaltyShare > 0 ? '+' : summary.penaltyShare < 0 ? '−' : '',
            pct: fmtNumber(Math.abs(summary.penaltyShare) * 100),
          }) : undefined,
      display: { formatter: (raw) => ({ value: formatEfficiency(raw * 1000), unit: '' }) } },
    { metricId: 'energy', occurrenceId: 'extra-energy', rawValue: available ? summary.totalPenaltyWh : null,
      label: t('coldStart.totalEnergy', 'Extra Energy'),
      description: t('coldStart.brief.energy', 'Estimated extra energy from the observed cold-versus-warm consumption difference.'),
      context: available ? penaltyCostLabel : undefined,
      display: { formatter: (raw) => ({ value: formatEnergy(raw), unit: '' }) } },
    { metricId: 'percent', occurrenceId: 'cold-share',
      rawValue: available && summary.coldShare != null ? summary.coldShare * 100 : null,
      label: t('coldStart.coldShare', 'Cold Starts'),
      description: t('coldStart.gapDef', 'parked {{h}}h or more', { h: COLD_GAP_HOURS }) },
    { metricId: 'count', occurrenceId: 'analyzed', rawValue: available ? summary.analyzed : null,
      label: t('coldStart.analyzed', 'Analyzed'),
      description: t('coldStart.driveCount', 'drives with a known gap') },
  ];
  return <section aria-label={t('coldStart.kpis', 'Cold start summary metrics')} data-testid="cold-start-kpis">
    <DrivingSummaryBrief metrics={metrics} title={t('coldStart.kpis', 'Cold start summary metrics')}
      description={t('coldStart.brief.description', 'Cold and warm starts compared within the returned selected window; this is observed cohort evidence, not a causal test.')}
      scope={scope} provenance={t('coldStart.brief.source', 'Returned drive energy and preceding parking gaps; up to 1,000 drives in the selected window.')}
      loading={isLoading} error={error} retained={retained} onRetry={onRetry} />
    {available && summary.analyzed === 0 && <EmptyState
      message={t('coldStart.emptyWindow', 'No drives with usable energy and a known preceding parking gap were returned for this selected window.')} />}
  </section>;
}
