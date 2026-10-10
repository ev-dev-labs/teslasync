import { useTranslation } from 'react-i18next';
import type { DataStateSource } from '@/api/dataState';
import type { Drive, VehicleState } from '@/api/types';
import { VehiclePanelGrid } from './VehiclePanelGrid';
import { VehicleSourcePanel } from './VehicleSourcePanel';
import { VehicleBatteryChart } from './VehicleBatteryChart';
import { VehicleDriveChart } from './VehicleDriveChart';

export function VehicleDetailCharts({ state, drives, stateQuery, drivesQuery }: {
  state: VehicleState | undefined;
  drives: Drive[] | undefined;
  stateQuery: DataStateSource<unknown>;
  drivesQuery: DataStateSource<unknown>;
}) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0">
      <VehiclePanelGrid label={t('vehicles.detail.batteryRange', 'Battery & range')} items={[
        { id: 'battery-overview-chart', size: 'half', content:
          <VehicleSourcePanel query={stateQuery} available={state != null} renderEmpty={false}
            label={t('vehicles.detail.batteryOverview', 'Battery overview')}
            emptyMessage={t('vehicles.noLiveData', 'No live data')}
            errorMessage={t('vehicles.detail.section.batteryChartsFailed', 'Battery & range charts failed to load')}>
            {state ? <VehicleBatteryChart state={state} /> : null}
          </VehicleSourcePanel>
        },
        { id: 'drive-distance-trend-chart', size: 'half', content:
          <VehicleSourcePanel query={drivesQuery}
            label={t('vehicles.detail.driveTrend', 'Drive distance trend')}
            emptyMessage={t('vehicles.detail.noDriveData', 'No drive data for chart')}
            errorMessage={t('vehicles.detail.section.recentDrivesFailed', 'Recent drives failed to load')}>
            <VehicleDriveChart drives={drives} />
          </VehicleSourcePanel>
        },
      ]} />
    </div>
  );
}
