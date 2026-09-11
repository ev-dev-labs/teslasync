import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Plus } from 'lucide-react';

import { GlassPanel, Button as UiButton, Badge, Text, Select, PanelTitle } from '@/components/ui';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { useRoutineTemplates, useInstallRoutine } from '@/api/hooks/useAutomations';
import { useGeofencesFull } from '@/api/hooks/useLocations';
import type { RoutineTemplate } from '@/api/types';

function RoutineCard({
  routine,
  placeId,
  placeName,
  disabled,
}: {
  routine: RoutineTemplate;
  placeId: number | null;
  placeName: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const install = useInstallRoutine();

  return (
    <GlassPanel hover glow="cyan" className="p-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
          <MapPin className="h-5 w-5 text-cyan-400" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <Text as="h3" size="sm" weight="semibold" color="primary" className="truncate">
            {routine.name}
          </Text>
          <Text as="p" variant="bodySm" className="mt-0.5">
            {routine.event === 'enter'
              ? t('automations.routines.onEnter', 'On geofence enter')
              : t('automations.routines.onExit', 'On geofence exit')}
          </Text>
        </div>
        <Badge variant="neutral" size="sm">
          {t('automations.routines.actionCount', '{{count}} actions', { count: routine.actions.length })}
        </Badge>
      </div>

      <Text as="p" variant="bodySm" className="leading-relaxed line-clamp-2">
        {routine.description}
      </Text>

      <UiButton
        size="sm"
        variant="secondary"
        disabled={disabled || placeId == null || install.isPending}
        loading={install.isPending}
        onClick={() =>
          placeId != null &&
          install.mutate({ id: routine.id, place_id: placeId, name: `${routine.name} — ${placeName}` })
        }
        aria-label={t('automations.routines.installNamed', 'Install {{name}}', { name: routine.name })}
        className="mt-1 w-full"
      >
        <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
        {t('automations.routines.install', 'Install')}
      </UiButton>
    </GlassPanel>
  );
}

/**
 * Geofence routine wizard: pick a place, one-click install arrival/departure
 * routines. Rendered above the static preset grid in PresetGallery.
 */
export function RoutineWizard({ actionsDisabled }: { actionsDisabled?: boolean }) {
  const { t } = useTranslation();
  const { data: routines, isLoading, isError, error, refetch } = useRoutineTemplates();
  const { data: geofences } = useGeofencesFull();
  const [placeId, setPlaceId] = useState<string>('');

  const places = useMemo(
    () => (geofences ?? []).filter((g) => g.enabled && !g.archived_at),
    [geofences],
  );
  const selectedPlace = places.find((g) => String(g.id) === placeId) ?? null;

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <GlassPanel key={i} className="p-5 flex flex-col gap-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-full" />
          </GlassPanel>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <QueryError
        error={error}
        onRetry={() => refetch()}
        resourceName={t('automations.routines.resource', 'Geofence routines')}
      />
    );
  }

  if ((routines ?? []).length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <PanelTitle className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('automations.routines.title', 'Geofence Routines')}
        </PanelTitle>
        <div className="min-w-52 flex-1 sm:max-w-72">
          <Select
            label={t('automations.routines.place', 'Place')}
            options={[
              { value: '', label: t('automations.routines.choosePlace', 'Choose a place…') },
              ...places.map((g) => ({ value: String(g.id), label: g.name })),
            ]}
            value={placeId}
            onChange={(e) => setPlaceId(e.target.value)}
          />
        </div>
      </div>

      {places.length === 0 ? (
        <EmptyState
          icon={<MapPin className="h-8 w-8" />}
          message={t('automations.routines.noPlaces', 'Create a geofence place first to install routines.')}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {(routines ?? []).map((routine) => (
            <RoutineCard
              key={routine.id}
              routine={routine}
              placeId={selectedPlace ? selectedPlace.id : null}
              placeName={selectedPlace?.name ?? ''}
              disabled={actionsDisabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}
