import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';

import { GlassPanel, PanelTitle, Toggle } from '@/components/ui';
import {
  useGeofencesFull,
  useGeofenceNeedsReview,
  useGeofenceCurrentRates,
} from '@/api/hooks/useLocations';
import { NeedsSetupQueue } from './NeedsSetupQueue';
import { PlacesTable } from './PlacesTable';
import { PlaceDetailPanel } from './PlaceDetailPanel';
import type { Geofence } from '@/api/types';

/**
 * Top-level Charging Places workspace — the "Needs Setup" queue for
 * auto-discovered places, the full places list with each place's current
 * rate, and (via {@link PlaceDetailPanel}) the rate history / add-a-rate
 * / preview-apply / charging-activity detail view for whichever place is
 * selected. Mounted as a section of `GeofencesPage`, alongside (not
 * replacing) the existing zones/geofence management UI.
 */
export function ChargingPlacesWorkspace() {
  const { t } = useTranslation();
  const [selectedPlace, setSelectedPlace] = useState<Geofence | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const placesQuery = useGeofencesFull(showArchived);
  const needsReviewQuery = useGeofenceNeedsReview();
  const currentRatesQuery = useGeofenceCurrentRates();

  const visiblePlaces = useMemo(() => {
    const all = placesQuery.data ?? [];
    return showArchived ? all : all.filter((p) => !p.archived_at);
  }, [placesQuery.data, showArchived]);

  // Keep the open detail panel's data fresh as the underlying list
  // refetches (e.g. right after an archive/unarchive/reviewed mutation)
  // instead of holding a stale snapshot from the moment it was opened.
  const liveSelectedPlace = useMemo(() => {
    if (!selectedPlace) return null;
    return placesQuery.data?.find((p) => p.id === selectedPlace.id) ?? selectedPlace;
  }, [selectedPlace, placesQuery.data]);

  return (
    <GlassPanel className="p-4 sm:p-6">
      <PanelTitle className="mb-4 flex items-center gap-2 text-lg">
        <Zap className="h-5 w-5 text-amber-300" aria-hidden="true" />
        {t('chargingPlaces.workspace.title', 'Charging Places')}
      </PanelTitle>

      <div className="flex flex-col gap-4">
        <NeedsSetupQueue
          places={needsReviewQuery.data}
          isLoading={needsReviewQuery.isLoading}
          error={needsReviewQuery.error}
          onRetry={() => void needsReviewQuery.refetch()}
          onReview={setSelectedPlace}
        />

        <div className="flex items-center justify-end">
          <Toggle
            label={t('chargingPlaces.workspace.showArchived', 'Show archived')}
            checked={showArchived}
            onChange={setShowArchived}
            size="sm"
          />
        </div>

        <PlacesTable
          places={visiblePlaces}
          currentRates={currentRatesQuery.data}
          isLoading={placesQuery.isLoading}
          error={placesQuery.error}
          onRetry={() => void placesQuery.refetch()}
          onSelect={setSelectedPlace}
          includesArchived={showArchived}
        />
      </div>

      <PlaceDetailPanel place={liveSelectedPlace} onClose={() => setSelectedPlace(null)} />
    </GlassPanel>
  );
}
