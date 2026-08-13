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
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { Badge, Button } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { Icons } from '@/lib/icons';
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

  /**
   * Keep the existing fleet readiness summary, but make the language honest:
   * roster state is a last-known connection state, not proof that a command
   * will execute now.
   */
  const reachableCount = useMemo(
    () =>
      vehicles.filter(
        (vehicle) =>
          vehicle.state !== 'asleep' && vehicle.state !== 'offline',
      ).length,
    [vehicles],
  );

  const fallbackStatus: CommandCenterFallbackStatus = vehiclesQuery.isLoading
    ? 'loading'
    : vehiclesQuery.error
      ? 'error'
      : 'empty';

  return (
    <PageContainer
      title={t('commands.pageTitle', 'Vehicle Command Center')}
      subtitle={t(
        'commands.subtitle',
        'Review vehicle readiness, send remote actions, and verify recent outcomes.',
      )}
      actions={
        <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto sm:justify-end">
          {vehicles.length > 0 && (
            <Badge
              variant={reachableCount > 0 ? 'success' : 'warning'}
              size="lg"
              className="min-h-11"
            >
              <Icons.wifi className="h-3.5 w-3.5" aria-hidden="true" />
              {t(
                'commands.reachableCount',
                '{{reachable}}/{{total}} recently reachable',
                {
                  reachable: reachableCount,
                  total: vehicles.length,
                },
              )}
            </Badge>
          )}

          <VehicleSelect
            id="commands-vehicle"
            ariaLabel={t('commands.selectVehicle', 'Select vehicle')}
            className="min-h-11 min-w-48"
            withIcon
          />

          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="min-h-11"
            icon={<Icons.history className="h-4 w-4" aria-hidden="true" />}
            onClick={() => navigate('/command-history')}
          >
            {t('commands.viewHistory', 'View history')}
          </Button>
        </div>
      }
    >
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
          ) : (
            <CommandCenterFallback
              status={fallbackStatus}
              error={vehiclesQuery.error}
              onRetry={() => void vehiclesQuery.refetch()}
            />
          )}
        </section>
      </FadeIn>
    </PageContainer>
  );
}
