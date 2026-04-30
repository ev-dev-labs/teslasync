import { useState, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw, UserPlus, UserMinus, XCircle, Users, Mail, Copy, Check, Shield } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Button, Badge, DataTable, ConfirmDialog, type Column } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { StatusBadge } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useBreadcrumbs } from '@/hooks/useBreadcrumbs';

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

export default function VehicleAccessPage() {
  const { t } = useTranslation();
  const { id: vehicleId } = useParams<{ id: string }>();
  usePageTitle(t('vehicleAccess.title', 'Vehicle Access'));

  const { data: vehicle } = useVehicle(vehicleId ?? '');
  const breadcrumbs = useBreadcrumbs({
    '/vehicles/:id': vehicle?.display_name ?? `Vehicle #${vehicleId}`,
  });

  const { data: drivers, isLoading: driversLoading } = useVehicleDrivers(vehicleId);
  const { data: invitations, isLoading: invitationsLoading } = useVehicleInvitations(vehicleId);

  const refreshDrivers = useRefreshVehicleDrivers();
  const refreshInvitations = useRefreshVehicleInvitations();
  const removeDriver = useRemoveVehicleDriver();
  const createInvitation = useCreateVehicleInvitation();
  const revokeInvitation = useRevokeVehicleInvitation();

  const [removeTarget, setRemoveTarget] = useState<VehicleDriver | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<VehicleInvitation | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isLoading = driversLoading || invitationsLoading;

  const handleCopyLink = useCallback((url: string, invitationId: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(invitationId);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleRemoveDriver = useCallback(() => {
    if (!removeTarget?.share_user_id || !vehicleId) return;
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

  // ── Driver columns ──────────────────────────────────────────────

  const driverColumns: Column<VehicleDriver>[] = useMemo(() => [
    {
      key: 'name',
      header: t('vehicleAccess.drivers.name', 'Name'),
      render: (row) => (
        <span className="text-white/90 font-medium">
          {row.driver_name ?? '—'}
        </span>
      ),
    },
    {
      key: 'email',
      header: t('vehicleAccess.drivers.email', 'Email'),
      render: (row) => (
        <span className="text-white/60">
          {row.driver_email ?? '—'}
        </span>
      ),
    },
    {
      key: 'role',
      header: t('vehicleAccess.drivers.role', 'Role'),
      render: (row) => row.role ? (
        <Badge variant="info">{row.role}</Badge>
      ) : (
        <span className="text-white/40">—</span>
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
          className="text-red-400 hover:text-red-300"
        >
          <UserMinus className="h-4 w-4" />
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
        <StatusBadge status={row.status === 'pending' ? 'online' : row.status === 'revoked' ? 'offline' : 'asleep'} />
      ),
    },
    {
      key: 'createdBy',
      header: t('vehicleAccess.invitations.createdBy', 'Created By'),
      render: (row) => (
        <span className="text-white/60">{row.created_by ?? '—'}</span>
      ),
    },
    {
      key: 'expires',
      header: t('vehicleAccess.invitations.expires', 'Expires'),
      render: (row) => (
        <span className="text-white/60">
          {row.expires_at ? new Date(row.expires_at).toLocaleString() : '—'}
        </span>
      ),
    },
    {
      key: 'link',
      header: t('vehicleAccess.invitations.link', 'Link'),
      render: (row) => row.invite_url ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleCopyLink(row.invite_url!, row.invitation_id)}
          aria-label={t('vehicleAccess.invitations.copyLink', 'Copy invite link')}
          className="text-cyan-400 hover:text-cyan-300"
        >
          {copiedId === row.invitation_id ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      ) : (
        <span className="text-white/40">—</span>
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
          className="text-red-400 hover:text-red-300"
        >
          <XCircle className="h-4 w-4" />
        </Button>
      ) : null,
      className: 'w-12',
    },
  ], [t, copiedId, handleCopyLink]);

  return (
    <PageContainer
      title={t('vehicleAccess.title', 'Vehicle Access')}
      subtitle={t('vehicleAccess.subtitle', 'Manage drivers and share invitations')}
      loading={isLoading}
      breadcrumbs={breadcrumbs}
    >
      {/* ── Drivers Section ───────────────────────────────────── */}
      <FadeIn>
        <GlassPanel className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-cyan-400" />
              <h2 className="text-lg font-semibold text-white/90">
                {t('vehicleAccess.drivers.title', 'Drivers')}
              </h2>
              {driversList.length > 0 && (
                <Badge variant="neutral">{driversList.length}</Badge>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => vehicleId && refreshDrivers.mutate(vehicleId)}
              loading={refreshDrivers.isPending}
              aria-label={t('vehicleAccess.drivers.refresh', 'Refresh drivers')}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              {t('vehicleAccess.refresh', 'Refresh')}
            </Button>
          </div>
          {driversList.length > 0 ? (
            <DataTable
              columns={driverColumns}
              data={driversList}
              keyExtractor={(row) => row.id}
              emptyMessage={t('vehicleAccess.drivers.empty', 'No drivers found')}
              compact
            />
          ) : (
            <EmptyState
              icon={<Users className="h-8 w-8" />}
              message={t('vehicleAccess.drivers.empty', 'No drivers found. Refresh to sync from Tesla.')}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Invitations Section ───────────────────────────────── */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-cyan-400" />
              <h2 className="text-lg font-semibold text-white/90">
                {t('vehicleAccess.invitations.title', 'Share Invitations')}
              </h2>
              {invitationsList.length > 0 && (
                <Badge variant="neutral">{invitationsList.length}</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => vehicleId && refreshInvitations.mutate(vehicleId)}
                loading={refreshInvitations.isPending}
                aria-label={t('vehicleAccess.invitations.refresh', 'Refresh invitations')}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                {t('vehicleAccess.refresh', 'Refresh')}
              </Button>
              <Button
                size="sm"
                onClick={() => vehicleId && createInvitation.mutate(vehicleId)}
                loading={createInvitation.isPending}
                aria-label={t('vehicleAccess.invitations.create', 'Create invitation')}
              >
                <UserPlus className="h-4 w-4 mr-1" />
                {t('vehicleAccess.invitations.createBtn', 'Invite Driver')}
              </Button>
            </div>
          </div>
          {invitationsList.length > 0 ? (
            <DataTable
              columns={invitationColumns}
              data={invitationsList}
              keyExtractor={(row) => row.id}
              emptyMessage={t('vehicleAccess.invitations.empty', 'No invitations found')}
              compact
            />
          ) : (
            <EmptyState
              icon={<Shield className="h-8 w-8" />}
              message={t('vehicleAccess.invitations.empty', 'No invitations yet. Create one to share vehicle access.')}
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
