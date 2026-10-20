import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display';
import { Text } from '@/components/ui';
import type { CarbonSectionProps } from '../carbon-intelligence/types';
import { CarbonBriefBand } from './CarbonBriefBand';

export function CarbonLifetimeBrief({ analysis, states, display }: CarbonSectionProps) {
  const { t } = useTranslation();
  const { lifetime, context } = analysis;
  const resolved = states.lifetime.hasData;
  const metrics: StatMetric[] = [
    { metricId: 'energy', occurrenceId: 'carbon-lifetime-energy', rawValue: resolved ? lifetime.totalEnergyWh : null,
      label: t('carbon.lifetime.energy', 'Lifetime energy'),
      display: { formatter: raw => ({ value: display.formatEnergy(raw), unit: '' }) },
      context: t('carbon.lifetime.energyShare', 'Period share: {{share}}', { share: display.formatPercent(context.energySharePct) }) },
    { metricId: 'mass', occurrenceId: 'carbon-lifetime-co2', rawValue: resolved ? lifetime.totalCo2Kg : null,
      label: t('carbon.lifetime.co2', 'Lifetime charging CO₂'),
      display: { formatter: raw => ({ value: display.formatKg(raw), unit: '' }) },
      context: t('carbon.lifetime.co2Share', 'Period share: {{share}}', { share: display.formatPercent(context.co2SharePct) }) },
    { metricId: 'count', occurrenceId: 'carbon-lifetime-sessions', rawValue: resolved ? lifetime.sessionsScored : null,
      label: t('carbon.lifetime.sessions', 'Lifetime sessions scored'),
      display: { formatter: raw => ({ value: display.formatNumber(raw), unit: '' }) },
      context: t('carbon.lifetime.sessionShare', 'Period share: {{share}}', { share: display.formatPercent(context.sessionSharePct) }) },
    { metricId: 'count', occurrenceId: 'carbon-lifetime-months', rawValue: resolved ? lifetime.monthly.length : null,
      label: t('carbon.lifetime.months', 'Lifetime monthly rows'),
      display: { formatter: raw => ({ value: display.formatNumber(raw, 0), unit: '' }) },
      context: t('carbon.lifetime.monthHint', 'Returned full-history rollups') },
  ];
  const boundary = t('carbon.lifetime.boundary', 'Shares compare the selected-period endpoint with the separate full-history endpoint. A zero lifetime denominator is reported as unavailable, never as 0%.');
  return <CarbonBriefBand testId="carbon-lifetime-context" metrics={metrics} state={states.lifetime}
    title={t('carbon.lifetime.title', 'Lifetime context and period share')}
    description={t('carbon.source.lifetime', 'Lifetime summary')}
    scope={<span>{t('carbon.source.lifetimeScope', 'Full vehicle history')}</span>}>
    <Text as="p" variant="caption" className="mt-4">{boundary}</Text>
  </CarbonBriefBand>;
}
