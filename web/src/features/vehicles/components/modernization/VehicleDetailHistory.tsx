import { useTranslation } from 'react-i18next';
import { Section } from '@/components/layout';
import { SectionErrorBoundary } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import type { DataStateSource } from '@/api/dataState';
import type { Drive, ChargingSession } from '@/api/types';
import { RecentDrivesSection, RecentChargesSection } from '../vehicle-detail';
import { VehiclePanelGrid } from './VehiclePanelGrid';
import { VehicleSourcePanel } from './VehicleSourcePanel';

/** Existing DataTables remain black boxes: IDs, columns, sorting, pagination
 * and View all destinations stay in the unchanged domain components. */
export function VehicleDetailHistory({ drivesQuery, sessionsQuery }: {
  drivesQuery: DataStateSource<Drive[]>;
  sessionsQuery: DataStateSource<ChargingSession[]>;
}) {
  const { t } = useTranslation();
  return (
    <FadeIn delay={0.14}>
      <Section id="vehicle-recent-activity" title={t('vehicles.detail.recentActivity', 'Recent activity')}>
        <VehiclePanelGrid label={t('vehicles.detail.recentActivity', 'Recent activity')} items={[
          { id: 'vehicle-recent-drives', size: 'half', content:
            <SectionErrorBoundary name="vehicle-detail:recent-drives" fallbackTitle={t('vehicles.detail.section.recentDrivesFailed', 'Recent drives failed to load')}>
              <VehicleSourcePanel query={drivesQuery}
                label={t('common.recentDrives', 'Recent drives')}
                emptyMessage={t('common.noDrives', 'No drives recorded yet')}
                errorMessage={t('vehicles.detail.section.recentDrivesFailed', 'Recent drives failed to load')}>
                <RecentDrivesSection drives={drivesQuery.data} />
              </VehicleSourcePanel>
            </SectionErrorBoundary>
          },
          { id: 'vehicle-recent-charges', size: 'half', content:
            <SectionErrorBoundary name="vehicle-detail:recent-charges" fallbackTitle={t('vehicles.detail.section.recentChargesFailed', 'Recent charges failed to load')}>
              <VehicleSourcePanel query={sessionsQuery}
                label={t('common.recentCharges', 'Recent charges')}
                emptyMessage={t('common.noCharges', 'No charging sessions recorded yet')}
                errorMessage={t('vehicles.detail.section.recentChargesFailed', 'Recent charges failed to load')}>
                <RecentChargesSection sessions={sessionsQuery.data} />
              </VehicleSourcePanel>
            </SectionErrorBoundary>
          },
        ]} />
      </Section>
    </FadeIn>
  );
}
