import { useTranslation } from 'react-i18next';

import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { ShareCardBrief } from '../operationalbrief-all/ShareCardBrief';
import { Table, Text } from '@/components/ui';
import type { ShareCardCoverage } from '../../lib/shareCard';
import { ShareCardSectionBody } from './ShareCardSectionBody';
import type { ShareCardSectionProps } from './types';

export function ShareCardEfficiencyEvidence({
  analysis,
  state,
  display,
}: ShareCardSectionProps) {
  const { t } = useTranslation();
  const hasEvidence = state.enabled && state.hasData;
  const metrics: readonly StatMetric[] = [
    { metricId: 'efficiency', occurrenceId: 'weighted',
      rawValue: hasEvidence && analysis.efficiency.whPerKm != null ? analysis.efficiency.whPerKm / 1_000 : null,
      label: t('shareCard.efficiency.weighted', 'Distance-weighted consumption'),
      description: hasEvidence ? t('shareCard.efficiency.weightedHint', '{{count}} positive-distance energy rows', {
        count: analysis.efficiency.supportRows,
      }) : t('shareCard.states.pending', 'Source availability has not resolved yet.'),
      display: { formatter: (raw) => ({ value: display.formatEfficiency(raw * 1_000), unit: '' }) } },
    { metricId: 'distance', occurrenceId: 'supportDistance',
      rawValue: hasEvidence ? analysis.efficiency.supportDistanceM : null,
      label: t('shareCard.efficiency.supportDistance', 'Efficiency support distance'),
      description: t('shareCard.efficiency.denominator', 'Explicit denominator'),
      display: { formatter: (raw) => ({ value: display.formatDistance(raw), unit: '' }) } },
    { metricId: 'energy', occurrenceId: 'regenEnergy', rawValue: hasEvidence ? analysis.regen.recoveredWh : null,
      label: t('shareCard.efficiency.regenEnergy', 'Measured regen'),
      description: hasEvidence
        ? t('shareCard.efficiency.regenRows', '{{count}} regen rows', { count: analysis.regen.measuredRows })
        : t('shareCard.states.pending', 'Source availability has not resolved yet.'),
      display: { formatter: (raw) => ({ value: display.formatEnergy(raw), unit: '' }) } },
    { metricId: 'percent', occurrenceId: 'regenShare', rawValue: hasEvidence ? analysis.regen.recoveredSharePct : null,
      label: t('shareCard.efficiency.regenShare', 'Paired recovered share'),
      description: hasEvidence
        ? t('shareCard.efficiency.pairedRows', '{{count}} paired energy/regen rows', { count: analysis.regen.pairedRows })
        : t('shareCard.states.pending', 'Source availability has not resolved yet.'),
      display: { formatter: (raw) => ({ value: display.formatPercent(raw), unit: '' }) } },
  ];
  const coverageLabels: Record<keyof ShareCardCoverage, string> = {
    distance: t('shareCard.efficiency.distanceCoverage', 'Distance'),
    duration: t('shareCard.efficiency.durationCoverage', 'Duration'),
    energy: t('shareCard.efficiency.energyCoverage', 'Energy'),
    regen: t('shareCard.efficiency.regenCoverage', 'Regen'),
    averageSpeed: t('shareCard.efficiency.averageSpeedCoverage', 'Average speed'),
    maxSpeed: t('shareCard.efficiency.maxSpeedCoverage', 'Maximum speed'),
    temperature: t('shareCard.efficiency.temperatureCoverage', 'Temperature'),
    routeLabels: t('shareCard.efficiency.routeCoverage', 'Route labels'),
  };

  return (
    <section
      data-testid="share-card-efficiency-evidence"
      aria-label={t('shareCard.efficiency.aria', 'Efficiency regen and field coverage evidence')}
    >
      <ShareCardBrief
        analysis={analysis}
        state={state}
        display={display}
        metrics={metrics}
        title={t('shareCard.efficiency.title', 'Efficiency, regen, and field coverage')}
        description={t('shareCard.brief.efficiencyDescription', 'Consumption uses only positive-distance energy rows; recovered share uses paired energy and regen rows. Missing fields are not measured zero.')}
      />
        <ShareCardSectionBody state={state}>
          <Table className="mt-4" aria-label={t('shareCard.efficiency.title', 'Efficiency, regen, and field coverage')}>
            <tbody>
            {(Object.keys(analysis.coverage) as Array<keyof ShareCardCoverage>).map((key) => {
              const field = analysis.coverage[key];
              return (
                <tr key={key}>
                  <th scope="row"><Text variant="label">{coverageLabels[key]}</Text></th>
                  <td className="text-right"><Text variant="caption">
                    {t(
                      'shareCard.efficiency.coverageCounts',
                      '{{valid}} valid · {{missing}} missing',
                      {
                        valid: field.validRows,
                        missing: field.missingRows,
                      },
                    )}
                  </Text></td>
                </tr>
              );
            })}
            </tbody>
          </Table>
        </ShareCardSectionBody>
    </section>
  );
}
