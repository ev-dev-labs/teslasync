import { useTranslation } from 'react-i18next';
import { Car } from 'lucide-react';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { VehicleTwin } from '@/components/vehicles';
import type { VehicleTwinState } from '@/lib/vehicleState';

interface DigitalTwinPanelProps {
  twinState: VehicleTwinState;
  vehicleId: number | undefined;
  hasData: boolean;
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

/** Hero visual: the interactive digital twin of the selected vehicle,
 *  self-sufficient with its own loading / empty / error states. */
export function DigitalTwinPanel({
  twinState,
  vehicleId,
  hasData,
  isLoading,
  error,
  onRetry,
  className,
}: DigitalTwinPanelProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel className={className} padding="md">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Car className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('admin.security.twin.title', 'Digital Twin')}
      </PanelTitle>
      {error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isLoading && !hasData ? (
        <div
          role="status"
          aria-busy="true"
          aria-label={t('common.loading', 'Loading…')}
        >
          <Skeleton height={220} />
        </div>
      ) : hasData ? (
        <div className="flex items-center justify-center py-2">
          <VehicleTwin {...twinState} size="sm" interactive vehicleId={vehicleId} />
        </div>
      ) : (
        <EmptyState
          icon={<Car className="h-8 w-8" aria-hidden="true" />}
          message={t('admin.security.twin.noData', 'No live vehicle state available yet')}
        />
      )}
    </GlassPanel>
  );
}
