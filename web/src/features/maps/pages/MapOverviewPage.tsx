import { PageContainer } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useVehicles } from '@/api/hooks/useVehicles';
import { vehicleStates } from '@/lib/fsm';
import type { Vehicle } from '@/types/vehicle';
import { useTranslation } from 'react-i18next';

export default function MapOverviewPage() {
  const { t } = useTranslation('maps');
  const { data: vehicles, isLoading, error } = useVehicles();

  return (
    <PageContainer
      title={t('overview.title', 'Fleet Map')}
      subtitle={t('overview.subtitle', 'See all your vehicles on a map')}
      loading={isLoading}
      error={error as Error | null}
      empty={vehicles?.length === 0}
      emptyMessage={t('overview.empty', 'No vehicles to display on the map.')}
    >
      {/* Map placeholder — full MapContainer integration requires leaflet setup */}
      <Card className="relative h-[500px] overflow-hidden">
        <div className="absolute inset-0 bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-500 mb-4">Map view requires Leaflet integration</p>
            <div className="space-y-2">
              {vehicles?.map((v: Vehicle) => {
                const stateConfig = vehicleStates[v.fsmState] ?? vehicleStates.unknown;
                return (
                  <div key={v.id} className="flex items-center gap-2 text-sm">
                    <Badge variant={stateConfig.variant} size="sm">{stateConfig.label}</Badge>
                    <span>{v.displayName}</span>
                    <span className="text-gray-400 font-mono text-xs">
                      {(v.latitude ?? 0).toFixed(4)}, {(v.longitude ?? 0).toFixed(4)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Card>
    </PageContainer>
  );
}
