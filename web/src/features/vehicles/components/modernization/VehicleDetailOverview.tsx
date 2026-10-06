import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { Section } from '@/components/layout';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { SectionErrorBoundary } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import type { DataStateSource } from '@/api/dataState';
import type { VehicleState } from '@/api/types';
import { BatteryRangePanel, LiveStateIndicators } from '../vehicle-detail';
import { VehiclePanelGrid } from './VehiclePanelGrid';
import { VehicleSourcePanel } from './VehicleSourcePanel';

export function VehicleDetailOverview({ state, stateQuery }: {
  state: VehicleState | undefined;
  stateQuery: DataStateSource<unknown>;
}) {
  const { t } = useTranslation();
  const liveResource = t('vehicles.detail.liveStateResource', 'Live vehicle state');
  return (
    <FadeIn delay={0.03}>
      <Section id="vehicle-live-overview" title={t('vehicles.detail.overview', 'Live overview')}>
        <VehiclePanelGrid label={t('vehicles.detail.overview', 'Live overview')} items={[
          { id: 'vehicle-battery-range', size: 'half', content:
            <SectionErrorBoundary name="vehicle-detail:battery-range" fallbackTitle={t('vehicles.detail.section.batteryRangeFailed', 'Battery & range section failed to load')}>
              <VehicleSourcePanel query={stateQuery} available={state != null} renderEmpty={false}
                resourceName={liveResource}
                label={t('vehicles.detail.batteryRange', 'Battery & range')}
                emptyMessage={t('vehicles.noLiveData', 'No live data')}
                errorMessage={t('vehicles.detail.section.batteryRangeFailed', 'Battery & range section failed to load')}>
                {state ? <BatteryRangePanel state={state} /> : null}
              </VehicleSourcePanel>
            </SectionErrorBoundary>
          },
          { id: 'vehicle-live-indicators', size: 'half', content:
            <SectionErrorBoundary name="vehicle-detail:live-state" fallbackTitle={t('vehicles.detail.section.liveStateFailed', 'Live state indicators failed to load')}>
              <VehicleSourcePanel query={stateQuery} available={state != null} renderEmpty={false}
                resourceName={liveResource}
                label={t('vehicles.detail.liveState', 'Live state')}
                emptyMessage={t('vehicles.noLiveData', 'No live data')}
                errorMessage={t('vehicles.detail.section.liveStateFailed', 'Live state indicators failed to load')}>
                {state ? (
                  <GlassPanel className="h-full p-6">
                    <PanelTitle className="mb-4 flex items-center gap-2">
                      <Activity className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
                      {t('vehicles.detail.liveState', 'Live state')}
                    </PanelTitle>
                    <LiveStateIndicators state={state} />
                  </GlassPanel>
                ) : null}
              </VehicleSourcePanel>
            </SectionErrorBoundary>
          },
        ]} />
      </Section>
    </FadeIn>
  );
}
