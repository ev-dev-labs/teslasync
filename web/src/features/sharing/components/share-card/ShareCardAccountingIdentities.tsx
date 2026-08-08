import { Binary } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
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
      aria-label={t('shareCard.accounting.aria', 'Exact Share Card accounting identities')}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-2 flex items-center gap-2">
          <Binary className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('shareCard.accounting.title', 'Exact accounting identities')}
        </PanelTitle>
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
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  <Text as="span" variant="caption">
                    {t('shareCard.accounting.expected', 'Expected')}
                  </Text>
                  <Text as="span" variant="caption" mono>
                    {display.formatNumber(check.expected, 6)}
                  </Text>
                  <Text as="span" variant="caption">
                    {t('shareCard.accounting.actual', 'Actual')}
                  </Text>
                  <Text as="span" variant="caption" mono>
                    {display.formatNumber(check.actual, 6)}
                  </Text>
                  <Text as="span" variant="caption">
                    {t('shareCard.accounting.residual', 'Residual / tolerance')}
                  </Text>
                  <Text as="span" variant="caption" mono>
                    {t('shareCard.accounting.residualValue', '{{residual}} / {{tolerance}}', {
                      residual: display.formatNumber(check.residual, 6),
                      tolerance: display.formatNumber(check.tolerance, 6),
                    })}
                  </Text>
                </div>
              </li>
            ))}
          </ul>
        </ShareCardSectionBody>
      </GlassPanel>
    </section>
  );
}
