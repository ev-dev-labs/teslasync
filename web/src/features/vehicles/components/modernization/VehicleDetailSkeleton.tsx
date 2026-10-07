import { useTranslation } from 'react-i18next';
import { Skeleton, StatGridSkeleton } from '@/components/feedback';
import { VehiclePanelGrid } from './VehiclePanelGrid';
import { VehicleChartSkeleton } from './VehicleChartSkeleton';

/** Mirrors the loaded ordering/host policy without pretending to be data. */
export function VehicleDetailSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="min-w-0 space-y-6" data-testid="vehicle-detail-skeleton">
      <VehiclePanelGrid label={t('vehicles.detail.overview', 'Live overview')} items={[
        { id: 'battery-loading', size: 'half', content: <Skeleton className="h-44 rounded-panel" /> },
        { id: 'live-loading', size: 'half', content: <Skeleton className="h-44 rounded-panel" /> },
      ]} />
      <StatGridSkeleton cards={8} />
      <VehiclePanelGrid label={t('vehicles.detail.systems', 'Vehicle systems')} items={[
        { id: 'motor-loading', size: 'half', content: <Skeleton className="h-44 rounded-panel" /> },
        { id: 'climate-loading', size: 'half', content: <Skeleton className="h-44 rounded-panel" /> },
        { id: 'charging-loading', size: 'full', content: <Skeleton className="h-44 rounded-panel" /> },
        { id: 'security-loading', size: 'half', content: <Skeleton className="h-44 rounded-panel" /> },
        { id: 'tires-loading', size: 'half', content: <Skeleton className="h-44 rounded-panel" /> },
      ]} />
      <VehiclePanelGrid label={t('vehicles.detail.batteryRange', 'Battery & range')} items={[
        { id: 'battery-chart-loading', size: 'half', content: <VehicleChartSkeleton /> },
        { id: 'drive-chart-loading', size: 'half', content: <VehicleChartSkeleton /> },
      ]} />
      <VehiclePanelGrid label={t('vehicles.detail.recentActivity', 'Recent activity')} items={[
        { id: 'drives-loading', size: 'half', content: <Skeleton className="h-56 rounded-panel" /> },
        { id: 'charges-loading', size: 'half', content: <Skeleton className="h-56 rounded-panel" /> },
      ]} />
      <Skeleton className="h-44 rounded-panel" />
      <StatGridSkeleton cards={6} className="md:grid-cols-3 lg:grid-cols-6" />
      <Skeleton className="h-44 rounded-panel" />
    </div>
  );
}
