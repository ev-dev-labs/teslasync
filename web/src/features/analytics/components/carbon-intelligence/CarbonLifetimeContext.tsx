import { CalendarClock, Factory, History, ListChecks, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
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
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <History
            className="h-4 w-4 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          {t('carbon.lifetime.title', 'Lifetime context and period share')}
        </PanelTitle>
        <CarbonSectionBody state={states.lifetime}>
          <Grid cols={{ default: 1, sm: 2, xl: 4 }} gap={3}>
            <MetricCard
              label={t('carbon.lifetime.energy', 'Lifetime energy')}
              value={display.formatEnergy(lifetime.totalEnergyWh)}
              subtitle={t('carbon.lifetime.energyShare', 'Period share: {{share}}', {
                share: display.formatPercent(context.energySharePct),
              })}
              icon={<Zap className="h-5 w-5" aria-hidden="true" />}
              color="cyan"
            />
            <MetricCard
              label={t('carbon.lifetime.co2', 'Lifetime charging CO₂')}
              value={display.formatKg(lifetime.totalCo2Kg)}
              subtitle={t('carbon.lifetime.co2Share', 'Period share: {{share}}', {
                share: display.formatPercent(context.co2SharePct),
              })}
              icon={<Factory className="h-5 w-5" aria-hidden="true" />}
              color="amber"
            />
            <MetricCard
              label={t('carbon.lifetime.sessions', 'Lifetime sessions scored')}
              value={display.formatNumber(lifetime.sessionsScored, 0)}
              subtitle={t(
                'carbon.lifetime.sessionShare',
                'Period share: {{share}}',
                { share: display.formatPercent(context.sessionSharePct) },
              )}
              icon={<ListChecks className="h-5 w-5" aria-hidden="true" />}
              color="blue"
            />
            <MetricCard
              label={t('carbon.lifetime.months', 'Lifetime monthly rows')}
              value={display.formatNumber(lifetime.monthly.length, 0)}
              subtitle={t(
                'carbon.lifetime.monthHint',
                'Returned full-history rollups',
              )}
              icon={<CalendarClock className="h-5 w-5" aria-hidden="true" />}
              color="purple"
            />
          </Grid>
          <Text as="p" variant="caption" className="mt-4">
            {t(
              'carbon.lifetime.boundary',
              'Shares compare the selected-period endpoint with the separate full-history endpoint. A zero lifetime denominator is reported as unavailable, never as 0%.',
            )}
          </Text>
        </CarbonSectionBody>
      </GlassPanel>
    </section>
  );
}
