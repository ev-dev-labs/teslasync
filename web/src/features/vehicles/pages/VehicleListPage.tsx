import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Car, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { useVehicles, useSyncVehicles, useDeleteVehicle } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVehicleLive } from '@/hooks/useVehicleLive';
import type { Vehicle } from '@/api/types';
import { VehicleCard } from '../components/VehicleCard';
import { FleetSummary } from '../components/FleetSummary';
import { BatteryComparison } from '../components/BatteryComparison';

export default function VehicleListPage() {
  const { t } = useTranslation('vehicles');
  usePageTitle(t('list.title', 'Vehicles'));
  const queryClient = useQueryClient();
  const { data: vehicles, isLoading, error } = useVehicles();

  const primaryVehicleId = vehicles?.[0]?.id;
  useVehicleLive(primaryVehicleId);

  // --- Sync mutation ---
  const syncMut = useSyncVehicles();

  // --- Delete mutation ---
  const deleteMut = useDeleteVehicle();
  const onDeleteSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['vehicle-state'] });
    queryClient.invalidateQueries({ queryKey: ['fleet-vehicle-states'] });
    queryClient.invalidateQueries({ queryKey: ['fleet-battery-states'] });
    setDeleteTarget(null);
  };

  const [deleteTarget, setDeleteTarget] = useState<Vehicle | null>(null);

  // --- Loading skeletons ---
  if (isLoading) {
    return (
      <PageContainer
        title={t('list.title', 'Vehicles')}
        subtitle={t('list.subtitle', 'View, manage, and sync your Tesla vehicles')}
        loading={false}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} height={96} />
            ))}
          </div>
          <Skeleton height={128} />
          {[1, 2, 3].map(i => (
            <Skeleton key={i} height={112} />
          ))}
        </div>
      </PageContainer>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <PageContainer
        title={t('list.title', 'Vehicles')}
        subtitle={t('list.subtitle', 'View, manage, and sync your Tesla vehicles')}
        error={error as Error}
      >
        <GlassPanel className="p-6 text-center">
          <p className="text-red-500 text-sm">
            {t('list.loadError', 'Failed to load vehicles.')}
          </p>
        </GlassPanel>
      </PageContainer>
    );
  }

  const vehicleList = vehicles ?? [];

  return (
    <PageContainer
      title={t('list.title', 'Vehicles')}
      subtitle={t('list.subtitle', 'View, manage, and sync your Tesla vehicles')}
      actions={
        <Button
          onClick={() => syncMut.mutate()}
          loading={syncMut.isPending}
          icon={<RefreshCw className="h-4 w-4" />}
        >
          {t('list.syncButton', 'Sync from Tesla')}
        </Button>
      }
    >
      {/* Sync success/error banners */}
      {syncMut.isSuccess && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
          <p className="text-sm text-green-700 dark:text-green-300">
            {t('list.syncSuccess', {
              count: syncMut.data.synced,
              defaultValue: `Synced ${syncMut.data.synced} vehicle(s) successfully.`,
            })}
          </p>
        </div>
      )}
      {syncMut.isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm text-red-700 dark:text-red-300">
            {t('list.syncError', 'Sync failed')}: {(syncMut.error as Error).message}
          </p>
        </div>
      )}

      {vehicleList.length > 0 ? (
        <div className="space-y-8">
          {/* Fleet summary */}
          <FleetSummary vehicles={vehicleList} />

          {/* Battery comparison */}
          <BatteryComparison vehicles={vehicleList} />

          {/* Vehicle cards */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Car className="h-4 w-4 text-purple-400" />
              {t('list.allVehicles', 'All Vehicles')}
            </h3>
            <div className="space-y-4">
              {vehicleList.map((v: Vehicle) => (
                <VehicleCard key={v.id} vehicle={v} onDelete={setDeleteTarget} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<Car className="h-10 w-10" />}
          title={t('list.emptyTitle', 'No vehicles yet')}
          message={t(
            'list.emptyDescription',
            'Connect your Tesla account and sync your vehicles to get started with fleet tracking, battery monitoring, and trip analysis.',
          )}
        />
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('list.deleteTitle', 'Remove Vehicle')}
        message={t('list.deleteMessage', {
          name: deleteTarget?.display_name || deleteTarget?.vin,
          defaultValue: `Are you sure you want to remove "${deleteTarget?.display_name || deleteTarget?.vin}"? This will delete all associated data including drives, charges, and state history.`,
        })}
        confirmLabel={t('list.deleteConfirm', 'Remove')}
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) {
            deleteMut.mutate(deleteTarget.id, { onSuccess: onDeleteSuccess });
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </PageContainer>
  );
}
