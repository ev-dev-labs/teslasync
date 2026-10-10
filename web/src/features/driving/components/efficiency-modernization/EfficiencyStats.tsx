import { useTranslation } from 'react-i18next';
import { GlossaryTerm, Text } from '@/components/ui';
import { ActionableEmptyState } from '@/components/feedback';
import { LayoutCard } from '@/components/layout/layout-reference';
import { StatStrip, StatGroup, type StatPeriod } from '@/components/data-display/stat-reference';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { EfficiencySource } from './EfficiencySource';
import { efficiencyMetrics } from './metrics';
import type { StatsPresentation } from './types';

export function EfficiencyStats(props: StatsPresentation & { kind: 'kpis' | 'insights' }) {
  const { t } = useTranslation();
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { kpis, insights } = efficiencyMetrics(props, t, fmtNumber, fmtInt);
  const isKpis = props.kind === 'kpis';
  const title = isKpis ? t('efficiency.section.kpis', 'Key metrics') : t('efficiency.insights', 'Energy insights');
  const period: StatPeriod = {
    kind: 'alltime',
    label: t('efficiency.period.lifetime', 'Lifetime driving summary'),
    provenance: t('efficiency.period.statsSource', 'Vehicle driving aggregates; not filtered by the workspace range.'),
  };
  const preferences = { units: props.units.unitPrefs, currency: { kind: 'symbol' as const, value: '$' } };
  const content = <EfficiencySource {...props.source} available={Boolean(props.stats)} label={title}
    emptyMessage={isKpis ? t('efficiency.noStats', 'No efficiency data available yet') : t('efficiency.noInsights', 'No energy insights available yet')}
    emptyContent={isKpis ? <ActionableEmptyState guidanceId="analytics.efficiency"
      fallbackMessage={t('efficiency.noStats', 'No efficiency data available yet')} /> : undefined}>
    {isKpis
      ? <StatStrip id="efficiency-kpis" variant="embedded" metrics={kpis} period={period} preferences={preferences}
          retained={props.source.state.refreshError != null} />
      : <StatGroup id="efficiency-insights" metrics={insights} period={period} preferences={preferences}
          retained={props.source.state.refreshError != null} />}
  </EfficiencySource>;
  return <LayoutCard title={title}>
    {isKpis && <Text as="p" variant="bodySm" color="muted"
      className="flex flex-wrap items-center gap-x-4 gap-y-1" data-testid="efficiency-glossary-strip">
      <span>{t('efficiency.glossary.lead', 'Terms on this page:')}</span>
      <GlossaryTerm term="efficiency" />
      <GlossaryTerm term="rated_range" />
      <GlossaryTerm term="phantom_drain" />
    </Text>}
    {content}
  </LayoutCard>;
}
