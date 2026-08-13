import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, Trash2, Zap } from 'lucide-react';

import {
  Button,
  Caption,
  ConfirmDialog,
  GlassPanel,
  PanelTitle,
  Toggle,
} from '@/components/ui';
import { SearchInput } from '@/components/forms';
import { QueryError } from '@/components/feedback';
import {
  useGeofencesFull,
  useGeofenceNeedsReview,
  useGeofenceCurrentRates,
} from '@/api/hooks/useLocations';
import { usePinned } from '@/api/hooks/usePinned';
import { useConfirm } from '@/hooks/useConfirm';
import { NeedsSetupQueue } from './NeedsSetupQueue';
import {
  PlacesTable,
  type GeofenceQuickPatch,
} from './PlacesTable';
import { PlaceDetailPanel } from './PlaceDetailPanel';
import type { Geofence } from '@/api/types';

export interface ChargingPlacesWorkspaceProps {
  onAdd?: () => void;
  onEdit?: (place: Geofence) => void;
  onDelete?: (place: Geofence) => void;
  onUpdate?: (place: Geofence, patch: GeofenceQuickPatch) => void;
  onBulkDelete?: (places: Geofence[]) => Promise<void>;
  updatePending?: boolean;
  deletePending?: boolean;
}

export function ChargingPlacesWorkspace({
  onAdd,
  onEdit,
  onDelete,
  onUpdate,
  onBulkDelete,
  updatePending = false,
  deletePending = false,
}: ChargingPlacesWorkspaceProps) {
  const { t } = useTranslation();
  const { confirm, dialogProps } = useConfirm();
  const [selectedPlace, setSelectedPlace] = useState<Geofence | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');

  const placesQuery = useGeofencesFull(showArchived);
  const needsReviewQuery = useGeofenceNeedsReview();
  const currentRatesQuery = useGeofenceCurrentRates();
  const { data: pins = [] } = usePinned('geofence');

  const visiblePlaces = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const all = (placesQuery.data ?? []).filter(
      (place) => showArchived || !place.archived_at,
    );
    const filtered = query
      ? all.filter((place) =>
          [place.name, place.category ?? '', place.origin]
            .some((value) => value.toLocaleLowerCase().includes(query)),
        )
      : all;

    if (pins.length === 0) return filtered;
    const pinOrder = new Map(pins.map((pin) => [Number(pin.item_id), pin.position]));
    return [...filtered].sort((a, b) => {
      const aPosition = pinOrder.get(a.id);
      const bPosition = pinOrder.get(b.id);
      if (aPosition != null && bPosition != null) return aPosition - bPosition;
      if (aPosition != null) return -1;
      if (bPosition != null) return 1;
      return 0;
    });
  }, [placesQuery.data, showArchived, search, pins]);

  const liveSelectedPlace = useMemo(() => {
    if (!selectedPlace) return null;
    return placesQuery.data?.find((place) => place.id === selectedPlace.id) ?? selectedPlace;
  }, [selectedPlace, placesQuery.data]);

  useEffect(() => {
    const visibleIds = new Set(visiblePlaces.map((place) => place.id));
    setSelectedKeys((current) => {
      const next = current.filter((id) => visibleIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [visiblePlaces]);

  const refreshAll = () => {
    void placesQuery.refetch();
    void needsReviewQuery.refetch();
    void currentRatesQuery.refetch();
  };

  const handleBulkDelete = async (places: Geofence[]) => {
    if (!onBulkDelete || places.length === 0) return;
    const ok = await confirm({
      title: t('geofences.bulk.deleteConfirm.title', 'Delete geofences?'),
      message: t(
        'geofences.bulk.deleteConfirm.body',
        'Selected places will be removed permanently. Places with charging or drive history must be archived instead.',
      ),
      confirmLabel: t('common.delete', 'Delete'),
      variant: 'danger',
    });
    if (!ok) return;
    await onBulkDelete(places);
    setSelectedKeys([]);
  };

  return (
    <GlassPanel className="p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <PanelTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-300" aria-hidden="true" />
            {t('chargingPlaces.workspace.unifiedTitle', 'Places & Charging Zones')}
          </PanelTitle>
          <Caption className="mt-1">
            {t(
              'chargingPlaces.workspace.unifiedDescription',
              'Manage zone boundaries, alerts, categories, charging rates, and session history in one place.',
            )}
          </Caption>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className={placesQuery.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden="true" />}
            onClick={refreshAll}
            disabled={placesQuery.isFetching}
          >
            {t('common.refresh', 'Refresh')}
          </Button>
          {onAdd && (
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="h-4 w-4" aria-hidden="true" />}
              onClick={onAdd}
            >
              {t('chargingPlaces.workspace.addPlace', 'Add Place')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <NeedsSetupQueue
          places={needsReviewQuery.data}
          isLoading={needsReviewQuery.isLoading}
          error={needsReviewQuery.error}
          onRetry={() => void needsReviewQuery.refetch()}
          onReview={setSelectedPlace}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t(
              'chargingPlaces.workspace.search',
              'Search places, categories, or origin…',
            )}
            clearLabel={t('chargingPlaces.workspace.clearSearch', 'Clear search')}
            className="w-full sm:max-w-md"
            historyScope="charging-places"
          />
          <Toggle
            label={t('chargingPlaces.workspace.showArchived', 'Show archived')}
            checked={showArchived}
            onChange={setShowArchived}
            size="sm"
          />
        </div>

        {currentRatesQuery.error && (
          <QueryError
            error={currentRatesQuery.error}
            onRetry={() => void currentRatesQuery.refetch()}
            resourceName={t('chargingPlaces.table.rates', 'charging rates')}
          />
        )}

        <PlacesTable
          places={visiblePlaces}
          currentRates={currentRatesQuery.data}
          isLoading={placesQuery.isLoading}
          error={placesQuery.error}
          onRetry={refreshAll}
          onSelect={setSelectedPlace}
          onEdit={onEdit}
          onDelete={onDelete}
          onUpdate={onUpdate}
          updatePending={updatePending}
          selectedKeys={selectedKeys}
          onSelectionChange={onBulkDelete ? setSelectedKeys : undefined}
          bulkActions={
            onBulkDelete
              ? (selected) => (
                  <Button
                    size="sm"
                    variant="danger"
                    icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                    onClick={() => void handleBulkDelete(selected)}
                    loading={deletePending}
                  >
                    {t('geofences.bulk.delete', 'Delete')}
                  </Button>
                )
              : undefined
          }
          includesArchived={showArchived}
          emptyMessage={
            search
              ? t(
                  'chargingPlaces.workspace.noSearchMatches',
                  'No places match this search. Clear the search to see all places.',
                )
              : undefined
          }
        />
      </div>

      <PlaceDetailPanel place={liveSelectedPlace} onClose={() => setSelectedPlace(null)} />
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </GlassPanel>
  );
}
