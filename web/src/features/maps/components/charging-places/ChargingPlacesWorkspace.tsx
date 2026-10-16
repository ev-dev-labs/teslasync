import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';

import {
  Button,
  ConfirmDialog,
  Text,
  Toggle, IconButton } from '@/components/ui';
import { LayoutCard, SourceContent, type SourceContentProps } from '@/components/layout';
import { deriveDataState, type DataState } from '@/api/dataState';
import { SearchInput } from '@/components/forms';
import { InlineCallout } from '@/components/feedback';
import {
  getGeofenceBulkDeleteOutcome,
  useGeofencesFull,
  useGeofenceNeedsReview,
  useGeofenceCurrentRates,
  type GeofenceBulkResult,
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
  /** Forward the unchanged server result; fulfillment alone does not confirm deletion. */
  onBulkDelete?: (places: Geofence[]) => Promise<GeofenceBulkResult>;
  deletePending?: boolean;
}

interface BulkRecovery {
  ids: number[];
  failed: GeofenceBulkResult['failed'];
  outcome: 'partial' | 'failed' | 'unconfirmed';
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
  const [bulkRecovery, setBulkRecovery] = useState<BulkRecovery | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const bulkLock = useRef(false);

  const placesQuery = useGeofencesFull(showArchived);
  const needsReviewQuery = useGeofenceNeedsReview();
  const currentRatesQuery = useGeofenceCurrentRates();
  const placesState = deriveDataState(placesQuery);
  const needsReviewState = deriveDataState(needsReviewQuery);
  const ratesState = deriveDataState(currentRatesQuery);
  const { data: pins = [] } = usePinned('geofence');

  const sourceTrust = (
    state: DataState<unknown>,
    label: string,
  ): Pick<SourceContentProps, 'state' | 'retainedMessage' | 'errorRecovery'> => ({
    state: state.isRefreshBlocked || state.status === 'stale' ? 'retained' : 'ready',
    retainedMessage: state.isRefreshBlocked
      ? state.hasData
        ? t('chargingPlaces.workspace.pausedRetained', '{{source}} refresh is paused. Previously loaded data remains visible.', { source: label })
        : t('chargingPlaces.workspace.initialPaused', '{{source}} loading is paused. No data has been loaded yet.', { source: label })
      : t('chargingPlaces.workspace.staleRetained', '{{source}} has not refreshed successfully. Previously loaded data remains visible.', { source: label }),
    errorRecovery: { onRetry: state.retry ?? undefined, resourceName: label },
  });
  const reviewLabel = t('chargingPlaces.needsSetup.title', 'Needs setup');
  const directoryLabel = t('chargingPlaces.table.title', 'Place directory');
  const ratesLabel = t('chargingPlaces.table.rates', 'charging rates');

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
    if (!placesState.hasData) return;
    const visibleIds = new Set(visiblePlaces.map((place) => place.id));
    const recoveryIds = new Set(bulkRecovery?.ids);
    setSelectedKeys((current) => {
      const next = current.filter((id) => visibleIds.has(id) || recoveryIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [visiblePlaces, placesState.hasData, bulkRecovery]);

  const refreshAll = () => {
    void placesQuery.refetch();
    void needsReviewQuery.refetch();
    void currentRatesQuery.refetch();
  };

  const handleBulkDelete = async (places: Geofence[]) => {
    if (!onBulkDelete || places.length === 0 || deletePending || bulkLock.current) return;
    bulkLock.current = true;
    setBulkPending(true);
    const ids = [...new Set(places.map((place) => place.id))];
    const submitted = new Set(ids);
    const retainOutcome = (outcome: BulkRecovery['outcome'], retained: number[], failed: GeofenceBulkResult['failed']) => {
      setSelectedKeys((current) => [...new Set([
        ...current.filter((id) => !submitted.has(id)),
        ...retained,
      ])]);
      setBulkRecovery((current) => {
        const remaining = current?.ids.filter((id) => !submitted.has(id)) ?? [];
        const recoveryIds = [...new Set([...remaining, ...retained])];
        if (recoveryIds.length === 0) return null;
        const reasons = new Map((current?.failed ?? []).map((failure) => [failure.id, failure]));
        for (const id of submitted) {
          if (!retained.includes(id)) reasons.delete(id);
        }
        for (const failure of failed) reasons.set(failure.id, failure);
        return { ids: recoveryIds, failed: [...reasons.values()], outcome };
      });
    };
    try {
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
      const result = await onBulkDelete(places);
      if (!result) {
        retainOutcome('unconfirmed', ids, []);
        return;
      }
      const outcome = getGeofenceBulkDeleteOutcome(result, ids);
      const failures = result.failed.filter((failure) => submitted.has(failure.id));
      const failedIds = [...new Set(failures.map((failure) => failure.id))];
      // A short count without a complete per-ID accounting cannot identify successes.
      const retained = outcome === 'complete' ? []
        : outcome === 'partial' && result.deleted + failedIds.length === ids.length
          ? failedIds : ids;
      retainOutcome(outcome === 'complete' ? 'partial' : outcome, retained, failures);
    } catch {
      // The mutation owns the error toast; keep its failed selection/reasons recoverable.
      retainOutcome('failed', ids, []);
    } finally {
      bulkLock.current = false;
      setBulkPending(false);
    }
  };

  return (
    <LayoutCard
      title={t('chargingPlaces.workspace.unifiedTitle', 'Places & charging zones')}
      description={t('chargingPlaces.workspace.unifiedDescription', 'Review visited places, define their boundaries and charging purpose, and manage rates and session history.')}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <IconButton icon={<RefreshCw className={placesQuery.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden="true" />} label={t('common.refresh', 'Refresh')} onClick={refreshAll} disabled={placesQuery.isFetching} />
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
        <div role="region" aria-label={reviewLabel}>
        <SourceContent
          {...sourceTrust(needsReviewState, reviewLabel)}
          label={reviewLabel}
          emptyMessage={t('chargingPlaces.workspace.noReview', 'No places are awaiting review.')}
          errorMessage={t('chargingPlaces.workspace.reviewLoadFailed', 'The place review queue could not be loaded.')}
        >
        <NeedsSetupQueue
          places={needsReviewQuery.data}
          isLoading={needsReviewState.status === 'initial'}
          error={needsReviewState.fatalError}
          onRetry={() => void needsReviewQuery.refetch()}
          onReview={setSelectedPlace}
        />
        </SourceContent>
        </div>
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

        <div role="region" aria-label={ratesLabel}>
        <SourceContent
          {...sourceTrust(ratesState, ratesLabel)}
          state={ratesState.fatalError ? 'error' : !ratesState.isRefreshBlocked && ratesState.status === 'initial' ? 'loading' : sourceTrust(ratesState, ratesLabel).state}
          error={ratesState.fatalError}
          label={ratesLabel}
          emptyMessage={t('chargingPlaces.workspace.noRates', 'No current charging rates are available.')}
          errorMessage={t('chargingPlaces.workspace.ratesLoadFailed', 'Current charging rates could not be loaded.')}
        >
          {null}
        </SourceContent>
        </div>

        {bulkRecovery && (
          <div className="min-w-0 space-y-2 break-words">
            <InlineCallout variant="warning">
              {bulkRecovery.outcome === 'unconfirmed'
                ? t('chargingPlaces.workspace.bulkUnconfirmed', 'Deletion was not confirmed. Selections remain available for review.')
                : t('chargingPlaces.workspace.bulkIncomplete', 'Some deletions did not complete. Failed selections remain available for review.')}
            </InlineCallout>
            <ul className="min-w-0 space-y-1">
              {bulkRecovery.failed.map(({ id, reason }) => (
                <li key={id}>
                  <Text variant="bodySm">
                    {t('chargingPlaces.workspace.bulkFailureReason', 'Place {{id}}: {{reason}}', { id, reason })}
                  </Text>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div role="region" aria-label={directoryLabel}>
        <SourceContent
          {...sourceTrust(placesState, directoryLabel)}
          label={directoryLabel}
          emptyMessage={t('chargingPlaces.workspace.noPlaces', 'No places are available.')}
          errorMessage={t('chargingPlaces.workspace.placesLoadFailed', 'The place directory could not be loaded.')}
        >
        <PlacesTable
          places={placesState.hasData ? visiblePlaces : undefined}
          filterData={placesQuery.data}
          currentRates={currentRatesQuery.data}
          ratesLoading={currentRatesQuery.isLoading}
          isLoading={placesState.status === 'initial'}
          error={placesState.fatalError}
          onRetry={() => void placesQuery.refetch()}
          onSelect={setSelectedPlace}
          onEdit={onEdit}
          onDelete={onDelete}
          selectedKeys={selectedKeys}
          onSelectionChange={onBulkDelete ? setSelectedKeys : undefined}
          bulkActions={
            onBulkDelete
              ? (selected) => (
                  /* confirm-step: handleBulkDelete asks in the shared ConfirmDialog first */
                  <IconButton icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} label={t('geofences.bulk.delete', 'Delete')} onClick={() => void handleBulkDelete(selected)} busy={deletePending || bulkPending} />
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
      </div>

      <PlaceDetailPanel place={liveSelectedPlace} onClose={() => setSelectedPlace(null)} />
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </LayoutCard>
  );
}
