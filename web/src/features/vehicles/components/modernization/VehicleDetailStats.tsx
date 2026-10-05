import { useTranslation } from 'react-i18next';
import { Section } from '@/components/layout/layout-reference';
import { SectionErrorBoundary } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import type { DataStateSource } from '@/api/dataState';
import type { VehicleState, VehicleStatus } from '@/api/types';
import { QuickStatsGrid } from '../vehicle-detail';
import { VehicleSourcePanel } from './VehicleSourcePanel';

/** Retain all eight existing MetricCards and their specialist formatters. */
export function VehicleDetailStats({ state, status, stateQuery }: {
  state: VehicleState | undefined;
  status: VehicleStatus;
  stateQuery: DataStateSource<unknown>;
}) {
  const { t } = useTranslation();
  return (
    <FadeIn delay={0.08}>
      <Section id="vehicle-quick-stats" title={t('vehicles.detail.quickStats', 'Quick stats')}>
        <SectionErrorBoundary name="vehicle-detail:quick-stats" fallbackTitle={t('vehicles.detail.section.quickStatsFailed', 'Quick stats failed to load')}>
          <VehicleSourcePanel query={stateQuery} available={state != null} renderEmpty={false}
            resourceName={t('vehicles.detail.liveStateResource', 'Live vehicle state')}
            label={t('vehicles.detail.quickStats', 'Quick stats')}
            emptyMessage={t('vehicles.noLiveData', 'No live data')}
            errorMessage={t('vehicles.detail.section.quickStatsFailed', 'Quick stats failed to load')}>
            {state ? <QuickStatsGrid state={state} status={status} /> : null}
          </VehicleSourcePanel>
        </SectionErrorBoundary>
      </Section>
    </FadeIn>
  );
}
