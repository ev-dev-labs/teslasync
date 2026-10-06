import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import { EmptyState, QueryError } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates, knownString } from '@/api/dataState';
import { VehicleAccessBody } from '../components/continuation-dashboard-3/VehicleAccessBody';
import { VehicleAccessCompact } from '../components/continuation-dashboard-3/VehicleAccessCompact';
import { useVehicleDrivers, useVehicleInvitations } from '@/api/hooks/useVehicleAccess';
import { useVehicleMobileEnabled, useVehicles } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import type { DetailEntry } from './shared';
import type { WidgetProps } from './types';
import { formatDateShort } from '@/lib/dateFormat';

export default function VehicleAccessWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const vehicleQuery = useVehicles();
  const { data: vehicles, isLoading: vehiclesLoading } = vehicleQuery;
  const vehicleState = useDataState(vehicleQuery);
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vidStr = vid != null ? String(vid) : undefined;

  const driversQuery = useVehicleDrivers(vidStr);
  const {
    data: drivers,
    isLoading: driversLoading,
    isFetching: driversFetching,
    isStale: driversStale,
    isError: driversError,
    dataUpdatedAt: driversUpdatedAt,
    refetch: refetchDrivers,
  } = driversQuery;
  const driverState = useDataState(driversQuery);

  const invitationsQuery = useVehicleInvitations(vidStr);
  const {
    data: invitations,
    isLoading: invitationsLoading,
    isFetching: invitationsFetching,
    isStale: invitationsStale,
    isError: invitationsError,
    dataUpdatedAt: invitationsUpdatedAt,
    refetch: refetchInvitations,
  } = invitationsQuery;
  const invitationState = useDataState(invitationsQuery);

  const mobileQuery = useVehicleMobileEnabled(vidStr);
  const {
    data: mobileData,
    isLoading: mobileLoading,
    isFetching: mobileFetching,
    isStale: mobileStale,
    isError: mobileError,
    dataUpdatedAt: mobileUpdatedAt,
    refetch: refetchMobile,
  } = mobileQuery;
  const mobileState = useDataState(mobileQuery);
  const combined = combineDataStates([driverState, invitationState, mobileState]);

  const isCompact = size.cols <= 1;

  const safeDrivers = drivers ?? [];
  const safeInvitations = invitations ?? [];
  const mobileEnabled = mobileData?.data?.enabled ?? null;

  const driverEntries = useMemo<DetailEntry[]>(
    () =>
      safeDrivers.map((d) => ({
        id: d.id,
        label: knownString(d.driver_name) ?? knownString(d.driver_email) ?? '—',
        value: formatDateShort(d.fetched_at),
        badge: {
          text: d.role === 'owner'
            ? t('widget.vehicleAccessOwner', 'Owner')
            : d.role === 'driver'
              ? t('widget.vehicleAccessDriver', 'Driver')
              : knownString(d.role) ?? t('widget.vehicleAccessUnknown', 'Unknown'),
          variant: (d.role === 'owner' ? 'success' : 'neutral') as 'success' | 'neutral',
        },
      })),
    [safeDrivers, t],
  );

  const invitationEntries = useMemo<DetailEntry[]>(
    () =>
      safeInvitations.map((inv) => ({
        id: inv.id,
        label: inv.created_by ?? '—',
        value: formatDateShort(inv.created_at),
        badge: {
          text: inv.status === 'pending'
            ? t('widget.vehicleAccessPendingStatus', 'Pending')
            : inv.status === 'accepted'
              ? t('widget.vehicleAccessAccepted', 'Accepted')
              : inv.status === 'expired'
                ? t('widget.vehicleAccessExpired', 'Expired')
                : inv.status || t('widget.vehicleAccessUnknown', 'Unknown'),
          variant: (
            inv.status === 'pending' ? 'warning'
              : inv.status === 'accepted' ? 'success'
                : inv.status === 'expired' ? 'error' : 'neutral'
          ) as 'warning' | 'success' | 'error' | 'neutral',
        },
      })),
    [safeInvitations, t],
  );

  // Fold the vehicle-list load into the skeleton: with no explicit vehicleId
  // prop the widget resolves its vehicle from `vehicles?.[0]`, and until that
  // list lands the per-vehicle queries are disabled (and therefore NOT
  // "loading"). Without this the widget would flash the "No access data" empty
  // state before any vehicle resolves.
  const isLoading =
    (vehiclesLoading && vidStr === undefined) ||
    driversLoading ||
    invitationsLoading ||
    mobileLoading;
  const isFetching = driversFetching || invitationsFetching || mobileFetching;
  const isStale = driversStale || invitationsStale || mobileStale;
  const isError = driversError || invitationsError || mobileError;
  const updatedAt = combined.updatedAt ?? Math.min(driversUpdatedAt ?? 0, invitationsUpdatedAt ?? 0, mobileUpdatedAt ?? 0);

  const hasAnyData =
    drivers !== undefined || invitations !== undefined || mobileData !== undefined || isError;

  const handleRefresh = useCallback(() => {
    void refetchDrivers();
    void refetchInvitations();
    void refetchMobile();
  }, [refetchDrivers, refetchInvitations, refetchMobile]);

  return (
    <WidgetShell
      title={t('widget.vehicleAccess', 'Vehicle access')}
      icon={<Users className="h-3.5 w-3.5" aria-hidden="true" />}
      loading={isLoading}
      dataState={vidStr === undefined && (vehicleState.fatalError || vehiclesLoading) ? vehicleState : {
        ...driverState, ...combined,
        hasData: driverState.hasData || invitationState.hasData || mobileState.hasData,
        retry: handleRefresh,
        status: combined.status === 'initial' && !isLoading ? 'unavailable' : combined.status,
      }}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {hasAnyData ? (
        isCompact ? (
          <VehicleAccessCompact
            driverCount={drivers === undefined ? null : safeDrivers.length}
            mobileEnabled={mobileEnabled}
          />
        ) : (
          <VehicleAccessBody
            mobileEnabled={mobileEnabled}
            driverEntries={driverEntries}
            invitationEntries={invitationEntries}
            compact={isCompact}
            driverState={{ ...driverState, status: driverState.status === 'initial' && !driversLoading ? 'unavailable' : driverState.status }}
            invitationState={{ ...invitationState, status: invitationState.status === 'initial' && !invitationsLoading ? 'unavailable' : invitationState.status }}
            mobileState={mobileState}
          />
        )
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Users className="h-5 w-5" />}
          message={t('widget.vehicleAccessNoData', 'No access data available')}
          className="py-4"
        />
      )}
      {isCompact && driverState.fatalError && <QueryError error={driverState.fatalError} onRetry={driverState.retry ?? undefined} />}
      {isCompact && invitationState.fatalError && <QueryError error={invitationState.fatalError} onRetry={invitationState.retry ?? undefined} />}
      {isCompact && mobileState.fatalError && <QueryError error={mobileState.fatalError} onRetry={mobileState.retry ?? undefined} />}
    </WidgetShell>
  );
}
