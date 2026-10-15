import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icons } from '@/lib/icons';

import { GlassPanel, Button as UiButton, Badge, Text, Select, PanelTitle } from '@/components/ui';
import { DataSourceNotice, EmptyState, Skeleton, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
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
    <GlassPanel hover className="p-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-[var(--surface-2)] border border-[var(--border-subtle)] flex items-center justify-center">
          <Icons.location className="h-5 w-5 text-[var(--text-muted)]" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <Text as="h3" size="sm" weight="semibold" color="primary" className="break-words">
            {routine.name}
          </Text>
          <Text as="p" variant="bodySm" className="mt-0.5">
            {routine.event === 'enter'
              ? t('automations.routines.onEnter', 'On geofence enter')
              : routine.event === 'exit' ? t('automations.routines.onExit', 'On geofence exit') : '—'}
          </Text>
        </div>
        <Badge variant="neutral" size="sm">
          {Array.isArray(routine.actions) ? t('automations.routines.actionCount', '{{count}} actions', { count: routine.actions.length }) : '—'}
        </Badge>
      </div>

      <Text as="p" variant="bodySm" className="leading-relaxed break-words">
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
        className="mt-1 min-h-11 w-full"
      >
        <Icons.add className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
        {t('automations.routines.install', 'Install')}
      </UiButton>
    </GlassPanel>
  );
}

/**
 * Geofence routine wizard: pick a place, one-click install arrival/departure
 * routines. Rendered alongside the automation rules in AutomationListPage.
 */
export function RoutineWizard({ actionsDisabled }: { actionsDisabled?: boolean }) {
  const { t } = useTranslation();
  const templatesQuery = useRoutineTemplates();
  const templatesState = useDataState(templatesQuery);
  const { data: routines, refetch } = templatesQuery;
  const geofencesQuery = useGeofencesFull();
  const geofencesState = useDataState(geofencesQuery);
  const { data: geofences } = geofencesQuery;
  const [placeId, setPlaceId] = useState<string>('');

  const places = useMemo(
    () => (geofences ?? []).filter((g) => g.enabled && !g.archived_at),
    [geofences],
  );
  const selectedPlace = places.find((g) => String(g.id) === placeId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <PanelTitle className="flex items-center gap-2">
          <Icons.location className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('automations.routines.title', 'Geofence routines')}
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
            disabled={!geofencesState.hasData || geofencesState.isRefreshBlocked || Boolean(geofencesState.refreshError)}
          />
        </div>
      </div>

      <StaleRefreshWarning state={geofencesState} label={t('automations.routines.place', 'Place')} />
      {geofencesState.isRefreshing && (
        <Text role="status" aria-busy="true" color="secondary">
          {t('automations.routines.place', 'Place')}: {t('freshness.updating', 'Updating…')}
        </Text>
      )}
      {!geofencesState.hasData && !geofencesState.fatalError && !geofencesState.isRefreshBlocked && (geofencesQuery.isLoading || geofencesQuery.isFetching) && (
        <div role="status" aria-busy="true">
          <Text color="secondary">{t('common.loading', 'Loading...')}</Text>
          <Skeleton className="h-10 w-full" />
        </div>
      )}
      {geofencesState.fatalError && (
        <QueryError
          error={geofencesState.fatalError}
          onRetry={() => geofencesQuery.refetch()}
          resourceName={t('automations.routines.place', 'Place')}
        />
      )}
      {!geofencesState.hasData && geofencesState.isRefreshBlocked && !geofencesState.fatalError && (
        <DataSourceNotice sources={[{ id: 'routine-places', label: t('automations.routines.place', 'Place'), query: geofencesQuery }]} />
      )}
      {!geofencesState.hasData && !geofencesQuery.isLoading && !geofencesQuery.isFetching && !geofencesState.isRefreshBlocked && !geofencesState.fatalError && (
        <Text role="status" color="secondary">—</Text>
      )}
      {geofencesState.hasData && places.length === 0 && (
        <EmptyState /* no-action: informational empty — no CTA */
          icon={<Icons.location className="h-8 w-8" />}
          message={t('automations.routines.noPlaces', 'Create a geofence place first to install routines.')}
        />
      )}
      <StaleRefreshWarning state={templatesState} label={t('automations.routines.resource', 'Geofence routines')} />
      {templatesState.isRefreshing && (
        <Text role="status" aria-busy="true" color="secondary">
          {t('automations.routines.resource', 'Geofence routines')}: {t('freshness.updating', 'Updating…')}
        </Text>
      )}
      {templatesState.fatalError ? (
        <QueryError
          error={templatesState.fatalError}
          onRetry={() => refetch()}
          resourceName={t('automations.routines.resource', 'Geofence routines')}
        />
      ) : !templatesState.hasData ? (
        templatesState.isRefreshBlocked ? (
          <DataSourceNotice sources={[{ id: 'routine-templates', label: t('automations.routines.resource', 'Geofence routines'), query: templatesQuery }]} />
        ) : templatesQuery.isLoading || templatesQuery.isFetching ? (
          <div role="status" aria-busy="true">
            <Text color="secondary">{t('common.loading', 'Loading...')}</Text>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <GlassPanel key={i} className="p-5 flex flex-col gap-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-8 w-full" />
                </GlassPanel>
              ))}
            </div>
          </div>
        ) : <Text role="status" color="secondary">—</Text>
      ) : routines?.length === 0 ? (
        <EmptyState /* no-action: this informational panel has no local recovery action; parent-page source controls remain available. */ message={t('automations.routines.resource', 'Geofence routines')} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {(routines ?? []).map((routine) => (
            <RoutineCard
              key={routine.id}
              routine={routine}
              placeId={selectedPlace ? selectedPlace.id : null}
              placeName={selectedPlace?.name ?? ''}
              disabled={actionsDisabled || templatesState.isRefreshBlocked || Boolean(templatesState.refreshError) || !geofencesState.hasData || geofencesState.isRefreshBlocked || Boolean(geofencesState.refreshError)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
