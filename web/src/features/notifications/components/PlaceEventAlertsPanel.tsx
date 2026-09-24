import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { BellRing } from 'lucide-react';
import { useGeofencesFull, useUpdateGeofenceAlerts } from '@/api/hooks/useLocations';
import type { Geofence } from '@/api/types';
import { QueryError, Skeleton, InlineCallout } from '@/components/feedback';
import { Button, DataTable, GlassPanel, PanelTitle, Text, Toggle, type Column } from '@/components/ui';

export function PlaceEventAlertsPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const placesQuery = useGeofencesFull();
  const update = useUpdateGeofenceAlerts();
  const places = placesQuery.data ?? [];
  const columns = useMemo<Column<Geofence>[]>(() => [
    {
      key: 'place',
      header: t('notifications.alertStudio.placeEvents.place', 'Place'),
      render: place => (
        <div>
          <Text variant="body">{place.name}</Text>
          {place.needs_review && (
            <Text variant="caption">
              {t('notifications.alertStudio.placeEvents.reviewFirst', 'Review this place before enabling its notifications.')}
            </Text>
          )}
        </div>
      ),
    },
    {
      key: 'entry',
      header: t('notifications.alertStudio.placeEvents.entry', 'On entry'),
      render: place => (
        <Toggle
          label={t('notifications.alertStudio.placeEvents.entryFor', 'Alert on entry: {{name}}', { name: place.name })}
          checked={place.alert_on_entry}
          disabled={place.needs_review || update.isPending}
          onChange={alertOnEntry => update.mutate({ geofenceId: place.id, alertOnEntry })}
          size="sm"
        />
      ),
    },
    {
      key: 'exit',
      header: t('notifications.alertStudio.placeEvents.exit', 'On exit'),
      render: place => (
        <Toggle
          label={t('notifications.alertStudio.placeEvents.exitFor', 'Alert on exit: {{name}}', { name: place.name })}
          checked={place.alert_on_exit}
          disabled={place.needs_review || update.isPending}
          onChange={alertOnExit => update.mutate({ geofenceId: place.id, alertOnExit })}
          size="sm"
        />
      ),
    },
  ], [t, update]);

  return (
    <GlassPanel className="space-y-3 p-4 sm:p-5" role="region" aria-label={t('notifications.alertStudio.placeEvents.title', 'Place arrival and departure alerts')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PanelTitle className="flex items-center gap-2">
            <BellRing className="h-4 w-4" aria-hidden="true" />
            {t('notifications.alertStudio.placeEvents.title', 'Place arrival and departure alerts')}
          </PanelTitle>
          <Text variant="bodySm" className="mt-1">
            {t('notifications.alertStudio.placeEvents.description', 'Choose which reviewed places notify you when a vehicle enters or leaves. Manage place names and boundaries in Places.')}
          </Text>
        </div>
        <Button size="sm" variant="secondary" onClick={() => navigate('/geofences')}>
          {t('notifications.alertStudio.placeEvents.manage', 'Manage places')}
        </Button>
      </div>
      {placesQuery.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : placesQuery.error ? (
        <QueryError error={placesQuery.error} onRetry={() => void placesQuery.refetch()} />
      ) : places.length === 0 ? (
        <InlineCallout variant="info">
          {t('notifications.alertStudio.placeEvents.empty', 'No places yet. Add or review a place to configure its alerts.')}
        </InlineCallout>
      ) : (
        <DataTable
          tableId="notifications:place-events"
          caption={t('notifications.alertStudio.placeEvents.title', 'Place arrival and departure alerts')}
          columns={columns}
          data={places}
          keyExtractor={place => place.id}
          mobileColumns={['place', 'entry', 'exit']}
          pagination
          density="compact"
        />
      )}
      {update.error && (
        <Text variant="bodySm" role="alert" className="text-rose-400">
          {t('notifications.alertStudio.placeEvents.saveError', 'Could not save place alerts. Try again.')}
        </Text>
      )}
    </GlassPanel>
  );
}
