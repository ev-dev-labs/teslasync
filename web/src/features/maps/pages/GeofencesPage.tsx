/**
 * GeofencesPage — manage geofence zones with create/edit/delete.
 *
 * Displays summary stats, staggered geofence cards with alert badges,
 * active toggles, and a modal form for creating/editing geofences.
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  MapPin, Plus, Pencil, Trash2, Globe, Ruler, Shield,
  LogIn, LogOut, Check, X, Activity,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Button, Input, Select, Modal, Toggle, ConfirmDialog } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState } from '@/components/feedback';
import { useToast } from '@/components/feedback/Toast';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';
import type { Geofence } from '@/types/location';

// ─── Types ───────────────────────────────────────────────────────────────────

type AlertType = 'entry' | 'exit' | 'both' | 'none';

interface GeofenceFormData {
  name: string;
  latitude: string;
  longitude: string;
  radius: string;
  alertType: AlertType;
  enabled: boolean;
}

const EMPTY_FORM: GeofenceFormData = {
  name: '',
  latitude: '',
  longitude: '',
  radius: '100',
  alertType: 'both',
  enabled: true,
};

const ALERT_OPTIONS = [
  { value: 'entry', label: 'Entry Only' },
  { value: 'exit', label: 'Exit Only' },
  { value: 'both', label: 'Entry & Exit' },
  { value: 'none', label: 'None' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAlertType(g: Geofence): AlertType {
  if (g.alertOnEntry && g.alertOnExit) return 'both';
  if (g.alertOnEntry) return 'entry';
  if (g.alertOnExit) return 'exit';
  return 'none';
}

function alertFlags(type: AlertType) {
  return {
    alertOnEntry: type === 'entry' || type === 'both',
    alertOnExit: type === 'exit' || type === 'both',
  };
}

function alertBadgeVariant(type: AlertType): 'success' | 'warning' | 'info' | 'neutral' {
  switch (type) {
    case 'both': return 'success';
    case 'entry': return 'info';
    case 'exit': return 'warning';
    default: return 'neutral';
  }
}

function alertBadgeLabel(type: AlertType, t: (k: string) => string): string {
  switch (type) {
    case 'both': return t('Entry & Exit');
    case 'entry': return t('Entry');
    case 'exit': return t('Exit');
    default: return t('None');
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function GeofencesPage() {
  const { t } = useTranslation();
  usePageTitle(t('Geofences'));
  const queryClient = useQueryClient();
  const toast = useToast();

  // ─── State ───────────────────────────────────────────────────────────────

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<GeofenceFormData>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Geofence | null>(null);

  // ─── Data fetching ───────────────────────────────────────────────────────

  const { data: geofences, isLoading, error } = useQuery({
    queryKey: ['geofences'],
    queryFn: () => request<Geofence[]>('/geofences'),
  });

  const createMut = useMutation({
    mutationFn: (body: Omit<Geofence, 'id' | 'createdAt'>) =>
      request<Geofence>('/geofences', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geofences'] });
      toast.success(t('Geofence created'));
      closeModal();
    },
    onError: (err: Error) => toast.error(t('Failed to create geofence'), err.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Omit<Geofence, 'id' | 'createdAt'> }) =>
      request<Geofence>(`/geofences/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geofences'] });
      toast.success(t('Geofence updated'));
      closeModal();
    },
    onError: (err: Error) => toast.error(t('Failed to update geofence'), err.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      request<void>(`/geofences/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geofences'] });
      toast.success(t('Geofence deleted'));
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(t('Failed to delete geofence'), err.message),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      request<Geofence>(`/geofences/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['geofences'] }),
    onError: (err: Error) => toast.error(t('Failed to toggle geofence'), err.message),
  });

  // ─── Computed stats ──────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const list = geofences ?? [];
    return {
      total: list.length,
      active: list.filter((g) => g.enabled).length,
      entryAlerts: list.filter((g) => g.alertOnEntry).length,
      exitAlerts: list.filter((g) => g.alertOnExit).length,
    };
  }, [geofences]);

  // ─── Handlers ────────────────────────────────────────────────────────────

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }, []);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((g: Geofence) => {
    setEditingId(g.id);
    setForm({
      name: g.name,
      latitude: String(g.latitude),
      longitude: String(g.longitude),
      radius: String(g.radius),
      alertType: getAlertType(g),
      enabled: g.enabled,
    });
    setModalOpen(true);
  }, []);

  const handleSubmit = useCallback(() => {
    const flags = alertFlags(form.alertType);
    const payload = {
      name: form.name,
      latitude: parseFloat(form.latitude),
      longitude: parseFloat(form.longitude),
      radius: parseFloat(form.radius),
      alertOnEntry: flags.alertOnEntry,
      alertOnExit: flags.alertOnExit,
      enabled: form.enabled,
      costPerKwh: null,
    };
    if (editingId) {
      updateMut.mutate({ id: editingId, body: payload });
    } else {
      createMut.mutate(payload);
    }
  }, [form, editingId, createMut, updateMut]);

  const isFormValid =
    form.name.trim().length > 0 &&
    form.latitude.trim().length > 0 &&
    form.longitude.trim().length > 0 &&
    form.radius.trim().length > 0 &&
    !isNaN(parseFloat(form.latitude)) &&
    !isNaN(parseFloat(form.longitude)) &&
    !isNaN(parseFloat(form.radius));

  const isSaving = createMut.isPending || updateMut.isPending;

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <PageContainer
      title={t('Geofences')}
      subtitle={t('Define locations for contextual tracking and automation')}
      loading={isLoading}
      error={error as Error | null}
      actions={
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
          {t('Add Geofence')}
        </Button>
      }
    >
      {/* Summary Stats */}
      {!isLoading && (
        <FadeIn>
          <GlassPanel className="mb-6 grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
            {geofences && geofences.length > 0 ? (
              <>
                <MetricCard
                  label={t('Total Geofences')}
                  value={stats.total}
                  icon={<MapPin className="h-4 w-4" />}
                  color="purple"
                />
                <MetricCard
                  label={t('Active')}
                  value={stats.active}
                  icon={<Check className="h-4 w-4" />}
                  color="green"
                />
                <MetricCard
                  label={t('Entry Alerts')}
                  value={stats.entryAlerts}
                  icon={<LogIn className="h-4 w-4" />}
                  color="cyan"
                />
                <MetricCard
                  label={t('Exit Alerts')}
                  value={stats.exitAlerts}
                  icon={<LogOut className="h-4 w-4" />}
                  color="amber"
                />
              </>
            ) : (
              <div className="col-span-full flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-muted)]">
                <Activity className="h-8 w-8 opacity-20" />
                <p className="text-xs">{t('common.noData', 'No data available')}</p>
              </div>
            )}
          </GlassPanel>
        </FadeIn>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <GlassPanel className="space-y-4 p-5">
          <Skeleton height={24} />
          <Skeleton height={80} />
          <Skeleton height={80} />
          <Skeleton height={80} />
        </GlassPanel>
      )}

      {/* Geofence List */}
      {!isLoading && (
        <StaggerContainer className="space-y-3">
          {geofences && geofences.length > 0 ? (
            <>
              {geofences.map((g) => (
                <StaggerItem key={g.id}>
                  <GlassPanel
                    hover
                    glow="purple"
                    className={cn(
                      'flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between',
                    )}
                  >
                    {/* Left: info */}
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-2)]">
                        <MapPin className="h-5 w-5 text-[var(--text-muted)]" />
                      </div>

                      <div className="min-w-0">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-[var(--text-primary)]">
                            {g.name}
                          </span>
                          <Badge variant={g.enabled ? 'success' : 'neutral'} size="sm">
                            {g.enabled ? t('Active') : t('Inactive')}
                          </Badge>
                          <Badge variant={alertBadgeVariant(getAlertType(g))} size="sm">
                            {alertBadgeLabel(getAlertType(g), t)}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
                          <span className="flex items-center gap-1 font-mono">
                            <Globe className="h-3 w-3" />
                            {fmtNumber(g.latitude ?? 0, 6)}, {fmtNumber(g.longitude ?? 0, 6)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Ruler className="h-3 w-3" />
                            {g.radius}{t('m')}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right: actions */}
                    <div className="flex shrink-0 items-center gap-2">
                      <Toggle
                        checked={g.enabled}
                        onChange={(checked) => toggleMut.mutate({ id: g.id, enabled: checked })}
                        size="sm"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Pencil className="h-4 w-4" />}
                        onClick={() => openEdit(g)}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 className="h-4 w-4" />}
                        onClick={() => setDeleteTarget(g)}
                      />
                    </div>
                  </GlassPanel>
                </StaggerItem>
              ))}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-muted)]">
              <Activity className="h-8 w-8 opacity-20" />
              <p className="text-xs">{t('common.noData', 'No data available')}</p>
            </div>
          )}
        </StaggerContainer>
      )}

      {/* Empty state */}
      {!isLoading && geofences && geofences.length === 0 && (
        <EmptyState
          icon={<Shield className="h-12 w-12" />}
          title={t('No geofences defined')}
          message={t('Add a geofence to track when your vehicle arrives or leaves a location.')}
          action={{ label: t('Add Geofence'), onClick: openCreate }}
        />
      )}

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? t('Edit Geofence') : t('Create Geofence')}
        size="md"
      >
        <div className="space-y-4">
          <Input
            label={t('Name')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t('Home')}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t('Latitude')}
              type="number"
              step="any"
              value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: e.target.value })}
              placeholder="37.7749"
              icon={<Globe className="h-4 w-4" />}
            />
            <Input
              label={t('Longitude')}
              type="number"
              step="any"
              value={form.longitude}
              onChange={(e) => setForm({ ...form, longitude: e.target.value })}
              placeholder="-122.4194"
              icon={<Globe className="h-4 w-4" />}
            />
          </div>

          <Input
            label={t('Radius (meters)')}
            type="number"
            value={form.radius}
            onChange={(e) => setForm({ ...form, radius: e.target.value })}
            placeholder="100"
            icon={<Ruler className="h-4 w-4" />}
            hint={t('Minimum 10m, maximum 50000m')}
          />

          <Select
            label={t('Alert Type')}
            options={ALERT_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))}
            value={form.alertType}
            onChange={(e) =>
              setForm({ ...form, alertType: e.target.value as AlertType })
            }
          />

          <Toggle
            label={t('Active')}
            checked={form.enabled}
            onChange={(checked) => setForm({ ...form, enabled: checked })}
          />

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={closeModal} icon={<X className="h-4 w-4" />}>
              {t('Cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={!isFormValid || isSaving}
              loading={isSaving}
              icon={<Check className="h-4 w-4" />}
            >
              {editingId ? t('Update') : t('Create')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('Delete Geofence')}
        message={t('Are you sure you want to delete "{{name}}"? This action cannot be undone.', {
          name: deleteTarget?.name ?? '',
        })}
        confirmLabel={t('Delete')}
        cancelLabel={t('Cancel')}
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) deleteMut.mutate(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </PageContainer>
  );
}
