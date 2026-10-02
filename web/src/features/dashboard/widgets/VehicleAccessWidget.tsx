import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates, knownString, type DataState } from '@/api/dataState';
import { dashboardTokens } from '../lib/dashboardTokens';
import { useVehicleDrivers, useVehicleInvitations } from '@/api/hooks/useVehicleAccess';
import { useVehicleMobileEnabled, useVehicles } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetDetailCard } from './shared';
import type { DetailEntry } from './shared';
import type { WidgetProps } from './types';
import { formatDateShort } from '@/lib/dateFormat';

// ── Compact layout (1×2) ─────────────────────────────────────────────

function CompactView({
  driverCount,
  mobileEnabled,
  t,
}: {
  driverCount: number | null;
  mobileEnabled: boolean | null;
  t: (key: string, fallback: string) => string;
}) {
  const mobileLabel =
    mobileEnabled === true
      ? t('widget.vehicleAccessMobileOn', 'Mobile access enabled')
      : mobileEnabled === false
        ? t('widget.vehicleAccessMobileOff', 'Mobile access disabled')
        : t('widget.vehicleAccessMobileUnknown', 'Mobile access unknown');

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 min-h-[44px]">
      <div className="flex items-center gap-2 min-w-0">
        <Users className="h-4 w-4 flex-shrink-0 text-[var(--text-secondary)]" />
        <span className={dashboardTokens.metricLabel}>
          {driverCount ?? '—'} {t('widget.vehicleAccessDrivers', 'drivers')}
        </span>
      </div>
      <span
        role="img"
        aria-label={mobileLabel}
        className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${
          mobileEnabled === true
            ? 'bg-emerald-400'
            : mobileEnabled === false
              ? 'bg-red-400'
              : 'bg-[var(--surface-2)]'
        }`}
        title={mobileLabel}
      />
    </div>
  );
}

// ── Standard / Wide layout ───────────────────────────────────────────

function StandardView({
  mobileEnabled,
  driverEntries,
  invitationEntries,
  isCompact,
  driverState,
  invitationState,
  mobileState,
  t,
}: {
  mobileEnabled: boolean | null;
  driverEntries: DetailEntry[];
  invitationEntries: DetailEntry[];
  isCompact: boolean;
  driverState: DataState<unknown>;
  invitationState: DataState<unknown>;
  mobileState: DataState<unknown>;
  t: (key: string, fallback: string) => string;
}) {
  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Mobile access status */}
      <div className="flex flex-wrap items-center justify-between gap-2 flex-shrink-0 min-h-[44px]">
        <span className={dashboardTokens.metricLabel}>
          {t('widget.vehicleAccessMobile', 'Mobile access')}
        </span>
        <Badge variant={mobileEnabled === true ? 'success' : mobileEnabled === false ? 'danger' : 'neutral'}>
          {mobileEnabled === true
            ? t('widget.vehicleAccessEnabled', 'Enabled')
            : mobileEnabled === false
              ? t('widget.vehicleAccessDisabled', 'Disabled')
              : t('widget.vehicleAccessUnknown', 'Unknown')}
        </Badge>
      </div>
      {mobileState.fatalError && <QueryError error={mobileState.fatalError} onRetry={mobileState.retry ?? undefined} />}
      {mobileState.status === 'initial' && <Skeleton className="h-8" />}

      {/* Drivers section */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <p className={`${dashboardTokens.metricLabel} mb-1`}>
          {t('widget.vehicleAccessAuthorized', 'Authorized drivers')}
        </p>
        {driverState.fatalError ? <QueryError error={driverState.fatalError} onRetry={driverState.retry ?? undefined} />
          : driverState.status === 'initial' ? <Skeleton className="h-16" /> : <WidgetDetailCard
          entries={driverEntries}
          compact={isCompact}
          emptyMessage={t('widget.vehicleAccessNoDrivers', 'No authorized drivers')}
          emptyIcon={<Users className="h-5 w-5" />}
        />}
      </div>

      {/* Invitations section */}
        <div className="min-w-0 shrink-0 border-t border-[var(--border-subtle)] pt-2">
          <p className={`${dashboardTokens.metricLabel} mb-1`}>
            {t('widget.vehicleAccessPending', 'Pending invitations')}
          </p>
          {invitationState.fatalError ? <QueryError error={invitationState.fatalError} onRetry={invitationState.retry ?? undefined} />
            : invitationState.status === 'initial' ? <Skeleton className="h-16" /> : <WidgetDetailCard
            entries={invitationEntries}
            compact={isCompact}
            emptyMessage={t('widget.vehicleAccessNoInvitations', 'No pending invitations')}
          />}
        </div>
    </div>
  );
}

// ── Main widget ──────────────────────────────────────────────────────

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
          <CompactView
            driverCount={drivers === undefined ? null : safeDrivers.length}
            mobileEnabled={mobileEnabled}
            t={t}
          />
        ) : (
          <StandardView
            mobileEnabled={mobileEnabled}
            driverEntries={driverEntries}
            invitationEntries={invitationEntries}
            isCompact={isCompact}
            driverState={{ ...driverState, status: driverState.status === 'initial' && !driversLoading ? 'unavailable' : driverState.status }}
            invitationState={{ ...invitationState, status: invitationState.status === 'initial' && !invitationsLoading ? 'unavailable' : invitationState.status }}
            mobileState={mobileState}
            t={t}
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
