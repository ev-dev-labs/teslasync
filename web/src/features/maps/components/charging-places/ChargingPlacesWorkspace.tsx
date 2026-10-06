import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';

import {
  Button,
  ConfirmDialog,
  Toggle,
} from '@/components/ui';
import { LayoutCard, SourceContent } from '@/components/layout';
import { deriveDataState } from '@/api/dataState';
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
} from './PlacesTable';
import { PlaceDetailPanel } from './PlaceDetailPanel';
import { VisitedCandidates } from './VisitedCandidates';
import type { Geofence, VisitedPlaceCandidate } from '@/api/types';

export interface ChargingPlacesWorkspaceProps {
  onAdd?: () => void;
  onReviewCandidate?: (candidate: VisitedPlaceCandidate) => void;
  onSelectForTemplate?: (id: number) => void;
  onEdit?: (place: Geofence) => void;
  onDelete?: (place: Geofence) => void;
  onBulkDelete?: (places: Geofence[]) => Promise<void>;
  deletePending?: boolean;
}

export function ChargingPlacesWorkspace({
  onAdd,
  onReviewCandidate,
  onSelectForTemplate,
  onEdit,
  onDelete,
  onBulkDelete,
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
  const placesState = deriveDataState(placesQuery);
  const needsReviewState = deriveDataState(needsReviewQuery);
  const ratesState = deriveDataState(currentRatesQuery);
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
    <LayoutCard
      title={t('chargingPlaces.workspace.unifiedTitle', 'Places & charging zones')}
      description={t('chargingPlaces.workspace.unifiedDescription', 'Review visited places, define their boundaries and charging purpose, and manage rates and session history.')}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            wrapLabel
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
              wrapLabel
              size="sm"
              variant="primary"
              icon={<Plus className="h-4 w-4" aria-hidden="true" />}
              onClick={onAdd}
            >
              {t('chargingPlaces.workspace.addPlace', 'Add place')}
            </Button>
          )}
        </div>
      }
    >

      <div className="flex flex-col gap-4">
        <SourceContent
          state={needsReviewState.refreshError ? 'retained' : 'ready'}
          label={t('chargingPlaces.workspace.unifiedTitle', 'Places & charging zones')}
          emptyMessage={t('chargingPlaces.workspace.noReview', 'No places are awaiting review.')}
          errorMessage={t('chargingPlaces.workspace.reviewLoadFailed', 'The place review queue could not be loaded.')}
        >
        <NeedsSetupQueue
          places={needsReviewQuery.data}
          isLoading={needsReviewQuery.isLoading && !needsReviewState.hasData}
          error={needsReviewState.fatalError}
          onRetry={() => void needsReviewQuery.refetch()}
          onReview={setSelectedPlace}
        />
        </SourceContent>
        {onReviewCandidate && (
          <VisitedCandidates onReview={onReviewCandidate} onSelectForTemplate={onSelectForTemplate} />
        )}

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

        <SourceContent
          state={ratesState.refreshError ? 'retained' : 'ready'}
          label={t('chargingPlaces.table.rates', 'charging rates')}
          emptyMessage={t('chargingPlaces.workspace.noRates', 'No current charging rates are available.')}
          errorMessage={t('chargingPlaces.workspace.ratesLoadFailed', 'Current charging rates could not be loaded.')}
        >
        {ratesState.fatalError && (
          <QueryError
            error={ratesState.fatalError}
            onRetry={() => void currentRatesQuery.refetch()}
            resourceName={t('chargingPlaces.table.rates', 'charging rates')}
          />
        )}
        </SourceContent>

        <SourceContent
          state={placesState.refreshError ? 'retained' : 'ready'}
          label={t('chargingPlaces.workspace.unifiedTitle', 'Places & charging zones')}
          emptyMessage={t('chargingPlaces.workspace.noPlaces', 'No places are available.')}
          errorMessage={t('chargingPlaces.workspace.placesLoadFailed', 'The place directory could not be loaded.')}
        >
        <PlacesTable
          places={placesState.hasData ? visiblePlaces : undefined}
          filterData={placesQuery.data}
          currentRates={currentRatesQuery.data}
          ratesLoading={currentRatesQuery.isLoading}
          isLoading={placesQuery.isLoading && !placesState.hasData}
          error={placesState.fatalError}
          onRetry={refreshAll}
          onSelect={setSelectedPlace}
          onEdit={onEdit}
          onDelete={onDelete}
          selectedKeys={selectedKeys}
          onSelectionChange={onBulkDelete ? setSelectedKeys : undefined}
          bulkActions={
            onBulkDelete
              ? (selected) => (
                  <Button
                    wrapLabel
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
        </SourceContent>
      </div>

      <PlaceDetailPanel place={liveSelectedPlace} onClose={() => setSelectedPlace(null)} />
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </LayoutCard>
  );
}
