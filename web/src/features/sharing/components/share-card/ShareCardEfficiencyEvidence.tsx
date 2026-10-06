import { BatteryCharging, Gauge, ShieldCheck, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { Grid, LayoutCard } from '@/components/layout';
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
      <LayoutCard title={t('shareCard.efficiency.title', 'Efficiency, regen, and field coverage')}>
        <ShareCardSectionBody state={state}>
          <Grid cols={{ default: 1, sm: 2, xl: 4 }} gap={3}>
            <MetricCard
              label={t('shareCard.efficiency.weighted', 'Distance-weighted consumption')}
              value={display.formatEfficiency(analysis.efficiency.whPerKm)}
              subtitle={t('shareCard.efficiency.weightedHint', '{{count}} positive-distance energy rows', {
                count: analysis.efficiency.supportRows,
              })}
              icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
              color="cyan"
            />
            <MetricCard
              label={t('shareCard.efficiency.supportDistance', 'Efficiency support distance')}
              value={display.formatDistance(analysis.efficiency.supportDistanceM)}
              subtitle={t('shareCard.efficiency.denominator', 'Explicit denominator')}
              icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
              color="blue"
            />
            <MetricCard
              label={t('shareCard.efficiency.regenEnergy', 'Measured regen')}
              value={display.formatEnergy(analysis.regen.recoveredWh)}
              subtitle={t('shareCard.efficiency.regenRows', '{{count}} regen rows', {
                count: analysis.regen.measuredRows,
              })}
              icon={<BatteryCharging className="h-5 w-5" aria-hidden="true" />}
              color="green"
            />
            <MetricCard
              label={t('shareCard.efficiency.regenShare', 'Paired recovered share')}
              value={display.formatPercent(analysis.regen.recoveredSharePct)}
              subtitle={t('shareCard.efficiency.pairedRows', '{{count}} paired energy/regen rows', {
                count: analysis.regen.pairedRows,
              })}
              icon={<Zap className="h-5 w-5" aria-hidden="true" />}
              color="amber"
            />
          </Grid>
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
      </LayoutCard>
    </section>
  );
}
