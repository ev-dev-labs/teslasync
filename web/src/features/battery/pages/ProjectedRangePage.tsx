import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Route } from 'lucide-react';
import { CardGrid, LayoutCard, PageLayout } from '@/components/layout';
import { EmptyState } from '@/components/feedback';
import { Icon } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { AIRangePrediction } from '@/components/ai';
import { useRangeProjection } from '@/api/hooks/useAnalytics';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useDataState } from '@/hooks/useDataState';
import { useLoadAnnouncement } from '@/hooks/useStatusAnnouncer';
import { RangeSummary } from '../components/projected-range-modernization/RangeSummary';
import { RangeEfficiency } from '../components/projected-range-modernization/RangeEfficiency';
import { RangeCurve } from '../components/projected-range-modernization/RangeCurve';
import { RangeScenarios } from '../components/projected-range-modernization/RangeScenarios';
import { RangeMatrix } from '../components/projected-range-modernization/RangeMatrix';
import { RangeCalculator } from '../components/projected-range-modernization/RangeCalculator';
import { RangeFactors } from '../components/projected-range-modernization/RangeFactors';
import { RangeTips } from '../components/projected-range-modernization/RangeTips';
import { SourceTrustNotice } from '../components/projected-range-modernization/SourceTrustNotice';

export { effColor, scenarioIcon, interpolateRange } from '../components/projected-range-modernization/helpers';

export default function ProjectedRangePage() {
  const { t } = useTranslation();
  usePageTitle(t('range.title', 'Projected Range'));
  const { vehicleId } = useSelectedVehicle();
  const activeId = vehicleId == null ? '' : String(vehicleId);
  const rangeQuery = useRangeProjection(activeId);
  const source = useDataState(rangeQuery, { provenance: 'inferred' });
  const pageProps = {
    title: t('range.title', 'Projected Range'),
    subtitle: t('range.subtitle', 'Personalized range estimates based on your driving patterns, weather, and conditions'),
  };
  const initialLoading = Boolean(activeId) && rangeQuery.isLoading && !source.hasData;
  useLoadAnnouncement({
    label: pageProps.title,
    isLoading: initialLoading,
    isError: source.fatalError != null,
    enabled: Boolean(activeId) && !source.isRefreshBlocked
      && (initialLoading || source.hasData || source.fatalError != null),
  });
  const [whatIfSpeed, setWhatIfSpeed] = useState(80);
  const [whatIfTemperature, setWhatIfTemperature] = useState(20);
  const sectionProps = { source, loading: rangeQuery.isLoading };

  if (!activeId) {
    return (
      <PageLayout {...pageProps}>
        <LayoutCard title={t('range.title', 'Projected Range')}>
          {/* no-action: The shared header vehicle picker owns selection. */}
          <EmptyState icon={<Icon icon={Route} size="xl" />}
            message={t('range.selectVehicle', 'Select a vehicle to see its projected range.')} />
        </LayoutCard>
      </PageLayout>
    );
  }

  return (
    <PageLayout {...pageProps} query={rangeQuery}
      busy={initialLoading || source.isRefreshing} announce={false}>
      <SourceTrustNotice source={source} label={t('range.title', 'Projected Range')} />
      <FadeIn><RangeSummary {...sectionProps} /></FadeIn>
      <FadeIn delay={0.05}>
        <CardGrid label={t('range.projectionCurve', 'Range Projection Curve')} items={[
          { id: 'range-efficiency', size: 'third', content: <RangeEfficiency {...sectionProps} /> },
          { id: 'range-projection-curve', size: 'half', content: <RangeCurve {...sectionProps} /> },
        ]} />
      </FadeIn>
      <FadeIn delay={0.1}>
        <AIRangePrediction vehicleId={vehicleId ?? undefined} />
      </FadeIn>
      <FadeIn delay={0.15}><RangeScenarios {...sectionProps} /></FadeIn>
      <FadeIn delay={0.2}>
        <CardGrid label={t('range.whatIf', 'What If Calculator')} items={[
          { id: 'range-efficiency-matrix', size: 'half', content: <RangeMatrix {...sectionProps} /> },
          { id: 'range-what-if', size: 'half', content: <RangeCalculator {...sectionProps}
            speed={whatIfSpeed} temperature={whatIfTemperature}
            onSpeedChange={setWhatIfSpeed} onTemperatureChange={setWhatIfTemperature} /> },
        ]} />
      </FadeIn>
      <FadeIn delay={0.25}><RangeFactors {...sectionProps} /></FadeIn>
      <FadeIn delay={0.3}><RangeTips /></FadeIn>
    </PageLayout>
  );
}
