import { CalendarClock, Factory, History, ListChecks, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { StatStrip } from '@/components/data-display';
import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';
import { CarbonSectionBody } from './CarbonSectionBody';
import type { CarbonSectionProps } from './types';

export function CarbonLifetimeContext({
  analysis,
  states,
  display,
}: CarbonSectionProps) {
  const { t } = useTranslation();
  const lifetime = analysis.lifetime;
  const context = analysis.context;

  return (
    <section
      data-testid="carbon-lifetime-context"
      aria-label={t(
        'carbon.lifetime.aria',
        'Lifetime carbon context and selected-period shares',
      )}
    >
      <LayoutCard
        title={t('carbon.lifetime.title', 'Lifetime context and period share')}
        actions={<History className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />}
      >
        <CarbonSectionBody state={states.lifetime}>
          <StatStrip
            id="carbon-lifetime-context-metrics"
            variant="embedded"
            period={{
              kind: 'alltime',
              label: t('carbon.source.lifetimeScope', 'Full vehicle history'),
              provenance: t('carbon.source.lifetime', 'Lifetime summary'),
            }}
            metrics={[
              {
                metricId: 'text', occurrenceId: 'carbon-lifetime-energy',
                label: t('carbon.lifetime.energy', 'Lifetime energy'),
                rawValue: display.formatEnergy(lifetime.totalEnergyWh),
                context: <><Zap className="h-5 w-5" aria-hidden="true" />{t('carbon.lifetime.energyShare', 'Period share: {{share}}', {
                  share: display.formatPercent(context.energySharePct),
                })}</>,
              },
              {
                metricId: 'text', occurrenceId: 'carbon-lifetime-co2',
                label: t('carbon.lifetime.co2', 'Lifetime charging CO₂'),
                rawValue: display.formatKg(lifetime.totalCo2Kg),
                context: <><Factory className="h-5 w-5" aria-hidden="true" />{t('carbon.lifetime.co2Share', 'Period share: {{share}}', {
                  share: display.formatPercent(context.co2SharePct),
                })}</>,
              },
              {
                metricId: 'text', occurrenceId: 'carbon-lifetime-sessions',
                label: t('carbon.lifetime.sessions', 'Lifetime sessions scored'),
                rawValue: display.formatNumber(lifetime.sessionsScored),
                context: <><ListChecks className="h-5 w-5" aria-hidden="true" />{t('carbon.lifetime.sessionShare', 'Period share: {{share}}', {
                  share: display.formatPercent(context.sessionSharePct),
                })}</>,
              },
              {
                metricId: 'text', occurrenceId: 'carbon-lifetime-months',
                label: t('carbon.lifetime.months', 'Lifetime monthly rows'),
                rawValue: display.formatNumber(lifetime.monthly.length, 0),
                context: <><CalendarClock className="h-5 w-5" aria-hidden="true" />{t('carbon.lifetime.monthHint', 'Returned full-history rollups')}</>,
              },
            ]}
          />
          <Text as="p" variant="caption" className="mt-4">
            {t(
              'carbon.lifetime.boundary',
              'Shares compare the selected-period endpoint with the separate full-history endpoint. A zero lifetime denominator is reported as unavailable, never as 0%.',
            )}
          </Text>
        </CarbonSectionBody>
      </LayoutCard>
    </section>
  );
}
