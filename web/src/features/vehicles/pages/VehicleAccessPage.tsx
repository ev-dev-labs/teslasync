import { useState, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw, UserPlus, UserMinus, XCircle, Users, Mail } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel,
  Button,
  Badge,
  CopyButton,
  DataTable,
  ConfirmDialog,
  PanelTitle,
  Text,
  type BadgeProps,
  type Column,
} from '@/components/ui';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { TimeStamp } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';

import {
  useVehicleDrivers,
  useVehicleInvitations,
  useRefreshVehicleDrivers,
  useRefreshVehicleInvitations,
  useRemoveVehicleDriver,
  useCreateVehicleInvitation,
  useRevokeVehicleInvitation,
} from '@/api/hooks/useVehicleAccess';
import { useVehicle } from '@/api/hooks/useVehicles';
import type { VehicleDriver, VehicleInvitation } from '@/api/types';

import {
  AccessKpiBand,
  AccessOverviewPanel,
  type AccessStatusSlice,
  type AccessRoleSlice,
} from '../components/vehicle-access';

type BadgeVariant = NonNullable<BadgeProps['variant']>;

/** Display color per invitation status for the Access Overview bars. */
const INVITATION_STATUS_COLOR: Record<string, string> = {
  pending: '#f59e0b',
  accepted: '#10b981',
  revoked: '#f43f5e',
  expired: '#64748b',
  default: '#64748b',
};

/** Semantic Badge variant per invitation status (paired with the status text so
 *  meaning never relies on color alone). */
const INVITATION_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: 'warning',
  accepted: 'success',
  revoked: 'danger',
  expired: 'neutral',
};

const SEVEN_DAYS_MS = 7 * 86_400_000;

export default function VehicleAccessPage() {
  const { t } = useTranslation();
  const { id: vehicleId } = useParams<{ id: string }>();
  usePageTitle(t('vehicleAccess.title', 'Vehicle Access'));

  const { data: vehicle } = useVehicle(vehicleId ?? '');

  const driversQuery = useVehicleDrivers(vehicleId);
  const invitationsQuery = useVehicleInvitations(vehicleId);

  const {
    data: drivers,
    isLoading: driversLoading,
    isError: driversIsError,
    error: driversError,
    refetch: refetchDrivers,
  } = driversQuery;
  const {
    data: invitations,
    isLoading: invitationsLoading,
    isError: invitationsIsError,
    error: invitationsError,
    refetch: refetchInvitations,
  } = invitationsQuery;
  const dataSources = useMemo(
    () => [
      {
        id: 'drivers',
        label: t('dataSources.labels.vehicleDrivers', 'Vehicle drivers'),
        query: driversQuery,
      },
      {
        id: 'invitations',
        label: t('dataSources.labels.shareInvitations', 'Share invitations'),
        query: invitationsQuery,
      },
    ],
    [driversQuery, invitationsQuery, t],
  );

  const refreshDrivers = useRefreshVehicleDrivers();
  const refreshInvitations = useRefreshVehicleInvitations();
  const removeDriver = useRemoveVehicleDriver();
  const createInvitation = useCreateVehicleInvitation();
  const revokeInvitation = useRevokeVehicleInvitation();

  const [removeTarget, setRemoveTarget] = useState<VehicleDriver | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<VehicleInvitation | null>(null);

  const handleRemoveDriver = useCallback(() => {
    // Match the actions-column render predicate (`share_user_id != null`) so a
    // driver whose share id is present-but-falsy (0) is still removable —
    // otherwise the row shows a Remove button that silently no-ops on confirm.
    if (removeTarget?.share_user_id == null || !vehicleId) return;
    removeDriver.mutate(
      { vehicleId, shareUserId: removeTarget.share_user_id },
      { onSettled: () => setRemoveTarget(null) },
    );
  }, [removeTarget, vehicleId, removeDriver]);

  const handleRevokeInvitation = useCallback(() => {
    if (!revokeTarget || !vehicleId) return;
    revokeInvitation.mutate(
      { vehicleId, invitationId: revokeTarget.invitation_id },
      { onSettled: () => setRevokeTarget(null) },
    );
  }, [revokeTarget, vehicleId, revokeInvitation]);

  const driversList = drivers ?? [];
  const invitationsList = invitations ?? [];

  // ── Derived summaries (single source for KPIs + overview) ──────────

  const pendingCount = useMemo(
    () => invitationsList.filter((inv) => inv.status === 'pending').length,
    [invitationsList],
  );

  const expiringSoonCount = useMemo(() => {
    const now = Date.now();
    return invitationsList.filter((inv) => {
      if (inv.status !== 'pending' || !inv.expires_at) return false;
      const ts = new Date(inv.expires_at).getTime();
      return Number.isFinite(ts) && ts > now && ts - now <= SEVEN_DAYS_MS;
    }).length;
  }, [invitationsList]);

  const statusBreakdown = useMemo<AccessStatusSlice[]>(() => {
    const counts = new Map<string, number>();
    for (const inv of invitationsList) {
      const status = inv.status ?? 'unknown';
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => ({
        status,
        count,
        color: INVITATION_STATUS_COLOR[status] ?? INVITATION_STATUS_COLOR.default,
      }));
  }, [invitationsList]);

  const roleBreakdown = useMemo<AccessRoleSlice[]>(() => {
    const counts = new Map<string, number>();
    for (const driver of driversList) {
      const role = driver.role ?? 'unknown';
      counts.set(role, (counts.get(role) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([role, count]) => ({ role, count }));
  }, [driversList]);

  // ── Driver columns ──────────────────────────────────────────────

  const driverColumns: Column<VehicleDriver>[] = useMemo(() => [
    {
      key: 'name',
      header: t('vehicleAccess.drivers.name', 'Name'),
      render: (row) => (
        <Text weight="medium" color="primary">
          {row.driver_name ?? '—'}
        </Text>
      ),
    },
    {
      key: 'email',
      header: t('vehicleAccess.drivers.email', 'Email'),
      render: (row) => (
        <Text color="secondary">{row.driver_email ?? '—'}</Text>
      ),
    },
    {
      key: 'role',
      header: t('vehicleAccess.drivers.role', 'Role'),
      render: (row) => row.role ? (
        <Badge variant="info">{row.role}</Badge>
      ) : (
        <Text color="muted">—</Text>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => row.share_user_id != null ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setRemoveTarget(row)}
          aria-label={t('vehicleAccess.drivers.remove', 'Remove driver')}
          className="text-rose-300 hover:text-rose-200"
        >
          <UserMinus className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : null,
      className: 'w-12',
    },
  ], [t]);

  // ── Invitation columns ──────────────────────────────────────────

  const invitationColumns: Column<VehicleInvitation>[] = useMemo(() => [
    {
      key: 'status',
      header: t('vehicleAccess.invitations.status', 'Status'),
      render: (row) => (
        <Badge variant={INVITATION_STATUS_VARIANT[row.status] ?? 'neutral'}>
          {t(`vehicleAccess.status.${row.status}`, row.status)}
        </Badge>
      ),
    },
    {
      key: 'createdBy',
      header: t('vehicleAccess.invitations.createdBy', 'Created By'),
      render: (row) => (
        <Text color="secondary">{row.created_by ?? '—'}</Text>
      ),
    },
    {
      key: 'expires',
      header: t('vehicleAccess.invitations.expires', 'Expires'),
      render: (row) => <TimeStamp value={row.expires_at} />,
    },
    {
      key: 'link',
      header: t('vehicleAccess.invitations.link', 'Link'),
      render: (row) => row.invite_url ? (
        <CopyButton
          text={row.invite_url}
          size="sm"
          variant="ghost"
          iconOnly
          withToast
          ariaLabel={t('vehicleAccess.invitations.copyLink', 'Copy invite link')}
          className="text-cyan-300 hover:text-cyan-200"
        />
      ) : (
        <Text color="muted">—</Text>
      ),
      className: 'w-12',
    },
    {
      key: 'actions',
      header: '',
      render: (row) => row.status === 'pending' ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setRevokeTarget(row)}
          aria-label={t('vehicleAccess.invitations.revoke', 'Revoke invitation')}
          className="text-rose-300 hover:text-rose-200"
        >
          <XCircle className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : null,
      className: 'w-12',
    },
  ], [t]);

  return (
    <PageContainer
      title={t('vehicleAccess.title', 'Vehicle Access')}
      subtitle={t('vehicleAccess.subtitle', 'Manage drivers and share invitations')}
      query={[driversQuery, invitationsQuery]}
      dataSources={dataSources}
      breadcrumbLabels={{
        '/vehicles/:id': vehicle?.display_name ?? t('vehicles.detail.vehicleNumber', 'Vehicle #{{id}}', { id: vehicleId }),
      }}
    >
      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <AccessKpiBand
          drivers={driversList.length}
          invitations={invitationsList.length}
          pending={pendingCount}
          expiringSoon={expiringSoonCount}
        />
      </FadeIn>

      {/* 2 — Drivers (hero) + Access Overview (context) bento */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2" data-tour="vehicle-access">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-cyan-300" aria-hidden="true" />
                <PanelTitle>{t('vehicleAccess.drivers.title', 'Drivers')}</PanelTitle>
                {driversList.length > 0 && (
                  <Badge variant="neutral">{driversList.length}</Badge>
                )}
              </div>
              <Button
                variant="ghost"
                onClick={() => vehicleId && refreshDrivers.mutate(vehicleId)}
                loading={refreshDrivers.isPending}
                aria-label={t('vehicleAccess.drivers.refresh', 'Refresh drivers')}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">{t('vehicleAccess.refresh', 'Refresh')}</span>
              </Button>
            </div>

            {driversLoading ? (
              <Skeleton height={220} />
            ) : driversIsError ? (
              <QueryError
                error={driversError}
                onRetry={() => { refetchDrivers(); }}
                resourceName={t('vehicleAccess.drivers.resource', 'Drivers')}
              />
            ) : driversList.length === 0 ? (
              <EmptyState /* no-action: transient empty state — surfaces when Tesla has no shared drivers; user can Refresh above */
                icon={<Users className="h-8 w-8" />}
                message={t('vehicleAccess.drivers.empty', 'No drivers found. Refresh to sync from Tesla.')}
              />
            ) : (
              <DataTable
                tableId="vehicles:access-drivers"
                columns={driverColumns}
                data={driversList}
                keyExtractor={(row) => row.id}
                emptyMessage={t('vehicleAccess.drivers.empty', 'No drivers found')}
                compact
              />
            )}
          </GlassPanel>

          <AccessOverviewPanel
            statusBreakdown={statusBreakdown}
            roleBreakdown={roleBreakdown}
            totalInvitations={invitationsList.length}
            totalDrivers={driversList.length}
            isLoading={driversLoading || invitationsLoading}
            isError={driversIsError || invitationsIsError}
            error={driversError ?? invitationsError}
            onRetry={() => { refetchDrivers(); refetchInvitations(); }}
          />
        </section>
      </FadeIn>

      {/* 3 — Share Invitations: full-width detail band */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-cyan-300" aria-hidden="true" />
              <PanelTitle>{t('vehicleAccess.invitations.title', 'Share Invitations')}</PanelTitle>
              {invitationsList.length > 0 && (
                <Badge variant="neutral">{invitationsList.length}</Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => vehicleId && refreshInvitations.mutate(vehicleId)}
                loading={refreshInvitations.isPending}
                aria-label={t('vehicleAccess.invitations.refresh', 'Refresh invitations')}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">{t('vehicleAccess.refresh', 'Refresh')}</span>
              </Button>
              <Button
                onClick={() => vehicleId && createInvitation.mutate(vehicleId)}
                loading={createInvitation.isPending}
                aria-label={t('vehicleAccess.invitations.create', 'Create invitation')}
              >
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                {t('vehicleAccess.invitations.createBtn', 'Invite Driver')}
              </Button>
            </div>
          </div>

          {invitationsLoading ? (
            <Skeleton height={220} />
          ) : invitationsIsError ? (
            <QueryError
              error={invitationsError}
              onRetry={() => { refetchInvitations(); }}
              resourceName={t('vehicleAccess.invitations.resource', 'Invitations')}
            />
          ) : invitationsList.length === 0 ? (
            <EmptyState /* no-action: transient empty state — surfaces before any invitation is created; user can Invite Driver above */
              icon={<Mail className="h-8 w-8" />}
              message={t('vehicleAccess.invitations.empty', 'No invitations yet. Create one to share vehicle access.')}
            />
          ) : (
            <DataTable
              tableId="vehicles:access-invitations"
              columns={invitationColumns}
              data={invitationsList}
              keyExtractor={(row) => row.id}
              emptyMessage={t('vehicleAccess.invitations.empty', 'No invitations found')}
              compact
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Confirm Dialogs ───────────────────────────────────── */}
      <ConfirmDialog
        open={removeTarget !== null}
        title={t('vehicleAccess.drivers.removeTitle', 'Remove Driver')}
        message={t('vehicleAccess.drivers.removeMessage', 'Are you sure you want to remove this driver\'s access? This action cannot be undone.')}
        confirmLabel={t('vehicleAccess.drivers.removeConfirm', 'Remove')}
        variant="danger"
        onConfirm={handleRemoveDriver}
        onCancel={() => setRemoveTarget(null)}
      />
      <ConfirmDialog
        open={revokeTarget !== null}
        title={t('vehicleAccess.invitations.revokeTitle', 'Revoke Invitation')}
        message={t('vehicleAccess.invitations.revokeMessage', 'Are you sure you want to revoke this invitation? The invite link will no longer work.')}
        confirmLabel={t('vehicleAccess.invitations.revokeConfirm', 'Revoke')}
        variant="danger"
        onConfirm={handleRevokeInvitation}
        onCancel={() => setRevokeTarget(null)}
      />
    </PageContainer>
  );
}
