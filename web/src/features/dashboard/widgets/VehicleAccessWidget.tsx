import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
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
  driverCount: number;
  mobileEnabled: boolean | null;
  t: (key: string, fallback: string) => string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 min-h-[44px]">
      <div className="flex items-center gap-2 min-w-0">
        <Users className="h-4 w-4 flex-shrink-0 text-[var(--text-secondary)]" />
        <span className="text-sm text-[var(--text-primary)] truncate">
          {driverCount} {t('widget.vehicleAccessDrivers', 'Drivers')}
        </span>
      </div>
      <span
        className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${
          mobileEnabled === true
            ? 'bg-emerald-400'
            : mobileEnabled === false
              ? 'bg-red-400'
              : 'bg-[var(--surface-2)]'
        }`}
        title={
          mobileEnabled === true
            ? t('widget.vehicleAccessMobileOn', 'Mobile access enabled')
            : mobileEnabled === false
              ? t('widget.vehicleAccessMobileOff', 'Mobile access disabled')
              : t('widget.vehicleAccessMobileUnknown', 'Mobile access unknown')
        }
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
  t,
}: {
  mobileEnabled: boolean | null;
  driverEntries: DetailEntry[];
  invitationEntries: DetailEntry[];
  isCompact: boolean;
  t: (key: string, fallback: string) => string;
}) {
  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Mobile access status */}
      <div className="flex items-center justify-between gap-2 flex-shrink-0 min-h-[44px]">
        <span className="text-xs text-[var(--text-muted)] uppercase tracking-wide">
          {t('widget.vehicleAccessMobile', 'Mobile Access')}
        </span>
        <Badge variant={mobileEnabled === true ? 'success' : mobileEnabled === false ? 'danger' : 'neutral'}>
          {mobileEnabled === true
            ? t('widget.vehicleAccessEnabled', 'Enabled')
            : mobileEnabled === false
              ? t('widget.vehicleAccessDisabled', 'Disabled')
              : t('widget.vehicleAccessUnknown', 'Unknown')}
        </Badge>
      </div>

      {/* Drivers section */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <p className="text-[10px] uppercase text-[var(--text-muted)] tracking-wide mb-1">
          {t('widget.vehicleAccessAuthorized', 'Authorized Drivers')}
        </p>
        <WidgetDetailCard
          entries={driverEntries}
          compact={isCompact}
          emptyMessage={t('widget.vehicleAccessNoDrivers', 'No authorized drivers')}
          emptyIcon={<Users className="h-5 w-5" />}
        />
      </div>

      {/* Invitations section */}
      {invitationEntries.length > 0 && (
        <div className="flex-shrink-0 border-t border-white/[0.06] pt-2">
          <p className="text-[10px] uppercase text-[var(--text-muted)] tracking-wide mb-1">
            {t('widget.vehicleAccessPending', 'Pending Invitations')}
          </p>
          <WidgetDetailCard
            entries={invitationEntries}
            compact={isCompact}
            emptyMessage={t('widget.vehicleAccessNoInvitations', 'No pending invitations')}
          />
        </div>
      )}
    </div>
  );
}

// ── Main widget ──────────────────────────────────────────────────────

export default function VehicleAccessWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vidStr = vid != null ? String(vid) : undefined;

  const {
    data: drivers,
    isLoading: driversLoading,
    isFetching: driversFetching,
    isStale: driversStale,
    isError: driversError,
    dataUpdatedAt: driversUpdatedAt,
    refetch: refetchDrivers,
  } = useVehicleDrivers(vidStr);

  const {
    data: invitations,
    isLoading: invitationsLoading,
    isFetching: invitationsFetching,
    isStale: invitationsStale,
    isError: invitationsError,
    dataUpdatedAt: invitationsUpdatedAt,
    refetch: refetchInvitations,
  } = useVehicleInvitations(vidStr);

  const {
    data: mobileData,
    isLoading: mobileLoading,
    isFetching: mobileFetching,
    isStale: mobileStale,
    isError: mobileError,
    dataUpdatedAt: mobileUpdatedAt,
    refetch: refetchMobile,
  } = useVehicleMobileEnabled(vidStr);

  const isCompact = size.cols <= 1;

  const safeDrivers = drivers ?? [];
  const safeInvitations = invitations ?? [];
  const mobileEnabled = mobileData?.data?.enabled ?? null;

  const driverEntries = useMemo<DetailEntry[]>(
    () =>
      safeDrivers.map((d) => ({
        label: d.driver_name ?? d.driver_email ?? '—',
        value: formatDateShort(d.fetched_at),
        badge: {
          text: d.role === 'owner'
            ? t('widget.vehicleAccessOwner', 'Owner')
            : t('widget.vehicleAccessDriver', 'Driver'),
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
              : t('widget.vehicleAccessExpired', 'Expired'),
          variant: (
            inv.status === 'pending' ? 'warning'
              : inv.status === 'accepted' ? 'success'
                : 'error'
          ) as 'warning' | 'success' | 'error',
        },
      })),
    [safeInvitations, t],
  );

  const isLoading = driversLoading || invitationsLoading || mobileLoading;
  const isFetching = driversFetching || invitationsFetching || mobileFetching;
  const isStale = driversStale || invitationsStale || mobileStale;
  const isError = driversError || invitationsError || mobileError;
  const updatedAt = Math.max(
    driversUpdatedAt ?? 0,
    invitationsUpdatedAt ?? 0,
    mobileUpdatedAt ?? 0,
  );

  return (
    <WidgetShell
      title={t('widget.vehicleAccess', 'Vehicle Access')}
      icon={<Users className="h-3.5 w-3.5 text-cyan-400" />}
      loading={isLoading}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => {
        refetchDrivers();
        refetchInvitations();
        refetchMobile();
      }}
    >
      {safeDrivers.length > 0 || safeInvitations.length > 0 || mobileEnabled !== null ? (
        isCompact ? (
          <CompactView
            driverCount={safeDrivers.length}
            mobileEnabled={mobileEnabled}
            t={t}
          />
        ) : (
          <StandardView
            mobileEnabled={mobileEnabled}
            driverEntries={driverEntries}
            invitationEntries={invitationEntries}
            isCompact={isCompact}
            t={t}
          />
        )
      ) : (
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          message={t('widget.vehicleAccessNoData', 'No access data available')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
