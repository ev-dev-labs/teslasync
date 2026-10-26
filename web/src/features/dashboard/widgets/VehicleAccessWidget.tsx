import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import { EmptyState, QueryError } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates, knownString } from '@/api/dataState';
import { useVehicleDrivers, useVehicleInvitations } from '@/api/hooks/useVehicleAccess';
import { useVehicleMobileEnabled, useVehicles } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetDetailCard, type DetailEntry } from './shared';
import type { WidgetProps } from './types';
import { useDateFormat } from '@/hooks/useDateFormat';

export default function VehicleAccessWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatDateShort } = useDateFormat();
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
        id: `driver-${d.id}`,
        label: knownString(d.driver_name) ?? knownString(d.driver_email) ?? '—',
        value: null,
        badge: {
          text: d.role === 'owner'
            ? t('widget.vehicleAccessOwner', 'Owner')
            : d.role === 'driver'
              ? t('widget.vehicleAccessDriver', 'Driver')
              : knownString(d.role) ?? t('widget.vehicleAccessUnknown', 'Unknown'),
          variant: (d.role === 'owner' ? 'success' : 'neutral') as 'success' | 'neutral',
        },
        status: d.role === 'owner' ? 'success' : 'neutral',
      })),
    [safeDrivers, t],
  );

  const invitationEntries = useMemo<DetailEntry[]>(
    () =>
      safeInvitations.map((inv) => ({
        id: `invitation-${inv.id}`,
        label: inv.created_by ?? '—',
        sublabel: inv.created_at
          ? formatDateShort(inv.created_at)
          : undefined,
        value: null,
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
        status: inv.status === 'pending' ? 'warning'
          : inv.status === 'accepted' ? 'success'
            : inv.status === 'expired' ? 'error'
              : 'neutral',
      })),
    [safeInvitations, t, formatDateShort],
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

  const accessEntries = useMemo<DetailEntry[]>(() => {
    const rows = [...driverEntries];
    rows.push(...invitationEntries);
    return rows;
  }, [driverEntries, invitationEntries]);

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
          <div className="flex min-h-[44px] min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Users className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
              <span className="min-w-0 text-sm font-medium text-[var(--text-primary)] [overflow-wrap:anywhere]">
                {drivers === undefined
                  ? `— ${t('widget.vehicleAccessDrivers', 'drivers')}`
                  : `${safeDrivers.length} ${t('widget.vehicleAccessDrivers', 'drivers')}`}
              </span>
            </div>
            <span
              role="img"
              aria-label={mobileEnabled === true
                ? t('widget.vehicleAccessMobileOn', 'Mobile access enabled')
                : mobileEnabled === false
                  ? t('widget.vehicleAccessMobileOff', 'Mobile access disabled')
                  : t('widget.vehicleAccessMobileUnknown', 'Mobile access unknown')}
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                mobileEnabled === true
                  ? 'bg-emerald-400'
                  : mobileEnabled === false ? 'bg-red-400' : 'bg-[var(--surface-2)]'
              }`}
              title={mobileEnabled === true
                ? t('widget.vehicleAccessMobileOn', 'Mobile access enabled')
                : mobileEnabled === false
                  ? t('widget.vehicleAccessMobileOff', 'Mobile access disabled')
                  : t('widget.vehicleAccessMobileUnknown', 'Mobile access unknown')}
            />
          </div>
        ) : (
          <WidgetDetailCard
            entries={accessEntries}
            compact={false}
            emptyMessage={t('widget.vehicleAccessNoData', 'No access data available')}
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
