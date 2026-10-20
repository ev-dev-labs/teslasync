/**
 * Vehicle Command Center route.
 *
 * The page owns fleet selection and the route-level loading/error/empty
 * experience. The selected-vehicle center owns live state, execution,
 * categorized commands, safety guidance, and recent activity.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { History, Radio } from 'lucide-react';

import { PageLayout } from '@/components/layout';
import { StaleRefreshWarning } from '@/components/feedback';
import { Badge, Button, GlassPanel, Heading, Icon, Text, IconButton } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  CommandCenterFallback,
  VehicleCommandCenter,
  type CommandCenterFallbackStatus,
} from '../components/command-center';

export default function CommandsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePageTitle(t('commands.title', 'Commands'));

  /**
   * `useSelectedVehicle` and this route-level query share the same TanStack
   * key. The former provides persisted selection; the latter exposes the
   * loading/error/refetch state needed for explicit route placeholders.
   */
  const vehiclesQuery = useVehicles();
  const vehiclesState = useDataState(vehiclesQuery);
  const { vehicleId, vehicle: selectedFromStore } = useSelectedVehicle();
  const vehicles = vehiclesQuery.data ?? [];

  /**
   * Selection can briefly resolve before the hook's memo catches up after a
   * picker change. Resolve from the current roster as a synchronous fallback
   * so the hero never flashes an unrelated empty state.
   */
  const selectedVehicle =
    selectedFromStore ??
    (vehicleId != null
      ? vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null
      : null) ??
    vehicles[0] ??
    null;

  // Roster state is historical; it cannot establish current reachability.
  const lastKnownActiveCount = useMemo(
    () =>
      vehicles.filter(
        (vehicle) =>
          vehicle.state !== 'asleep' && vehicle.state !== 'offline',
      ).length,
    [vehicles],
  );

  const fallbackStatus: CommandCenterFallbackStatus = vehiclesState.fatalError
    ? 'error'
    : !vehiclesState.hasData
      ? 'loading'
      : 'empty';
  const initialRefreshBlocked =
    !vehiclesState.hasData && vehiclesState.isRefreshBlocked;
  const refreshPausedTitle = t('dataSources.status.paused', 'Refresh paused');

  return (
    <PageLayout
      title={t('commands.pageTitle', 'Vehicle command center')}
      subtitle={t(
        'commands.subtitle',
        'Review vehicle readiness, send remote actions, and verify recent outcomes.',
      )}
      metadataActions={
        vehicles.length > 0 && (
          <Badge
            variant="neutral"
            size="lg"
            className="min-h-11"
          >
            <Icon icon={Radio} size="sm" />
            {t(
              'commands.lastKnownActiveCount',
              '{{active}}/{{total}} last reported active',
              {
                active: lastKnownActiveCount,
                total: vehicles.length,
              },
            )}
          </Badge>
        )
      }
      secondaryActions={
        <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto sm:justify-end">
          <IconButton icon={<Icon icon={History} />} label={t('commands.viewHistory', 'View history')} onClick={() => navigate('/command-history')} />
        </div>
      }
    >
      <StaleRefreshWarning
        state={vehiclesState}
        title={vehiclesState.isRefreshBlocked ? refreshPausedTitle : undefined}
        message={vehiclesState.isRefreshBlocked
          ? t(
              'dataSources.staleMessage',
              'Previously loaded data remains visible while affected sources recover.',
            )
          : undefined}
      />
      <FadeIn>
        <section
          aria-label={t(
            'commands.centerRegion',
            'Selected vehicle command center',
          )}
        >
          {selectedVehicle ? (
            <VehicleCommandCenter
              key={selectedVehicle.id}
              vehicle={selectedVehicle}
            />
          ) : initialRefreshBlocked ? (
            <div className="space-y-4 sm:space-y-5" data-testid="command-center-paused">
              {[
                t('commands.hero.title', 'Selected vehicle'),
                t('commands.readiness.title', 'Command readiness'),
                t('commands.workspace.title', 'Command workspace'),
              ].map((title, index) => (
                <GlassPanel key={title} className="space-y-4 p-4 sm:p-5">
                  <Heading level="section">{title}</Heading>
                  <Text as="p" color="secondary" role={index === 0 ? 'status' : undefined}>
                    {index === 0
                      ? refreshPausedTitle
                      : t(
                          'dataSources.unavailableMessage',
                          'No requested source has returned usable data yet.',
                        )}
                  </Text>
                  {index === 0 && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-11"
                      onClick={() => void vehiclesQuery.refetch()}
                    >
                      {t('error.retry', 'Retry')}
                    </Button>
                  )}
                </GlassPanel>
              ))}
            </div>
          ) : (
            <CommandCenterFallback
              status={fallbackStatus}
              error={vehiclesState.fatalError}
              onRetry={() => void vehiclesQuery.refetch()}
            />
          )}
        </section>
      </FadeIn>
    </PageLayout>
  );
}
