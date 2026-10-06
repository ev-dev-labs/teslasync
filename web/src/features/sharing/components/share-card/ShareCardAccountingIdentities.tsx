import { useTranslation } from 'react-i18next';

import { Badge, Table, Text } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { ShareCardSectionBody } from './ShareCardSectionBody';
import type { ShareCardSectionProps } from './types';

export function ShareCardAccountingIdentities({
  analysis,
  state,
  display,
}: ShareCardSectionProps) {
  const { t } = useTranslation();
  const labels: Record<string, string> = {
    'rows.dispositions': t('shareCard.accounting.rows', 'Terminal dispositions sum to returned rows'),
    'coverage.distance': t('shareCard.accounting.distanceCoverage', 'Distance valid + missing equals eligible'),
    'coverage.duration': t('shareCard.accounting.durationCoverage', 'Duration valid + missing equals eligible'),
    'coverage.energy': t('shareCard.accounting.energyCoverage', 'Energy valid + missing equals eligible'),
    'coverage.regen': t('shareCard.accounting.regenCoverage', 'Regen valid + missing equals eligible'),
    'coverage.averageSpeed': t('shareCard.accounting.avgSpeedCoverage', 'Average speed valid + missing equals eligible'),
    'coverage.maxSpeed': t('shareCard.accounting.maxSpeedCoverage', 'Maximum speed valid + missing equals eligible'),
    'coverage.temperature': t('shareCard.accounting.temperatureCoverage', 'Temperature valid + missing equals eligible'),
    'coverage.routeLabels': t('shareCard.accounting.routeCoverage', 'Route label valid + missing equals eligible'),
    'buckets.monthlyCount': t('shareCard.accounting.monthly', 'Monthly counts sum to eligible drives'),
    'buckets.weekdayCount': t('shareCard.accounting.weekday', 'Weekday counts sum to eligible drives'),
    'buckets.dayCount': t('shareCard.accounting.days', 'Active-day counts sum to eligible drives'),
    'distribution.distanceSupport': t('shareCard.accounting.distanceSupport', 'Distance-band counts equal distance support'),
    'distribution.durationSupport': t('shareCard.accounting.durationSupport', 'Duration-band counts equal duration support'),
    'distribution.distanceTotal': t('shareCard.accounting.distanceTotal', 'Distance-band SI totals reconcile'),
    'distribution.durationTotal': t('shareCard.accounting.durationTotal', 'Duration-band SI totals reconcile'),
  };

  return (
    <section
      data-testid="share-card-accounting-identities"
      aria-label={t('shareCard.accounting.aria', 'Exact share card accounting identities')}
    >
      <LayoutCard title={t('shareCard.accounting.title', 'Exact accounting identities')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'shareCard.accounting.subtitle',
            'Count identities are exact. Floating SI distribution totals use a 0.000001-unit tolerance.',
          )}
        </Text>
        <ShareCardSectionBody state={state}>
          <ul className="grid gap-2 lg:grid-cols-2">
            {analysis.identities.map((check) => (
              <li
                key={check.id}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Text as="p" variant="label">{labels[check.id] ?? check.id}</Text>
                  <Badge variant={check.passes ? 'success' : 'danger'}>
                    {check.passes
                      ? t('shareCard.accounting.balances', 'Balances')
                      : t('shareCard.accounting.outside', 'Outside tolerance')}
                  </Badge>
                </div>
                <Table className="mt-2" aria-label={labels[check.id] ?? check.id}>

                  <tbody>
                  <tr><th scope="row"><Text as="span" variant="caption">
                    {t('shareCard.accounting.expected', 'Expected')}
                  </Text></th><td className="text-right"><Text as="span" variant="caption" mono>
                    {display.formatNumber(check.expected)}
                  </Text></td></tr>
                  <tr><th scope="row"><Text as="span" variant="caption">
                    {t('shareCard.accounting.actual', 'Actual')}
                  </Text></th><td className="text-right"><Text as="span" variant="caption" mono>
                    {display.formatNumber(check.actual)}
                  </Text></td></tr>
                  <tr><th scope="row"><Text as="span" variant="caption">
                    {t('shareCard.accounting.residual', 'Residual / tolerance')}
                  </Text></th><td className="text-right"><Text as="span" variant="caption" mono>
                    {t('shareCard.accounting.residualValue', '{{residual}} / {{tolerance}}', {
                      residual: display.formatNumber(check.residual),
                      tolerance: display.formatNumber(check.tolerance),
                    })}
                  </Text></td></tr>
                  </tbody>
                </Table>
              </li>
            ))}
          </ul>
        </ShareCardSectionBody>
      </LayoutCard>
    </section>
  );
}
