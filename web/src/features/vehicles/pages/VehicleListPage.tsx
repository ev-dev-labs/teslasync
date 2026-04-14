import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Car, RefreshCw, Activity, Battery, Gauge, Zap,
  ExternalLink, Trash2, Lock, Shield,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Button, ConfirmDialog } from '@/components/ui';
import { MetricCard, AnimatedNumber } from '@/components/data-display';
import { Skeleton, EmptyState } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useSettings } from '@/hooks/useSettings';
import { useVehicleLive } from '@/hooks/useVehicleLive';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';
import { fetchVehicleState } from '@/api/hooks/useVehicles';
import type { Vehicle } from '@/types/vehicle';
import type { VehicleState } from '@/api/types';

/* ── Helpers ─────────────────────────────────────────────── */

function batteryColor(level: number): string {
  if (level > 60) return '#10b981';
  if (level > 30) return '#f59e0b';
  return '#ef4444';
}

type StatusKey = 'online' | 'asleep' | 'driving' | 'charging' | 'offline';

function deriveStatus(vehicle: Vehicle, state?: VehicleState | null): StatusKey {
  if (state?.is_charging) return 'charging';
  if (state?.speed && state.speed > 0) return 'driving';
  if (vehicle.state === 'online') return 'online';
  if (vehicle.state === 'asleep') return 'asleep';
  return 'offline';
}

const STATUS_VARIANT: Record<StatusKey, 'success' | 'warning' | 'info' | 'danger' | 'neutral'> = {
  online: 'success',
  charging: 'warning',
  driving: 'info',
  asleep: 'neutral',
  offline: 'danger',
};

const STATUS_LABEL: Record<StatusKey, string> = {
  online: 'Online',
  charging: 'Charging',
  driving: 'Driving',
  asleep: 'Asleep',
  offline: 'Offline',
};

/* ── Page ────────────────────────────────────────────────── */

export default function VehicleListPage() {
  const { t } = useTranslation();
  usePageTitle(t('nav.vehicles', 'Fleet'));
  const queryClient = useQueryClient();
  const { convertDistance, distanceUnit } = useSettings();

  /* ── Data ── */
  const { data: vehicles, isLoading, error } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
    staleTime: 30_000,
  });

  const vehicleList = vehicles ?? [];
  const primaryId = vehicleList[0]?.id;
  useVehicleLive(primaryId);

  /* Batch-fetch vehicle states for summary + battery chart */
  const { data: fleetStates } = useQuery({
    queryKey: ['fleet-vehicle-states', vehicleList.map(v => v.id).sort()],
    queryFn: () =>
      Promise.all(
        vehicleList.map(async (v) => {
          try {
            const { state } = await fetchVehicleState(v.id);
            return { vehicle: v, state: state ?? null };
          } catch {
            return { vehicle: v, state: null };
          }
        }),
      ),
    enabled: vehicleList.length > 0,
    refetchInterval: 30_000,
  });

  /* ── Computed fleet metrics ── */
  const fleet = useMemo(() => {
    const withState = (fleetStates ?? []).filter(
      (e): e is { vehicle: Vehicle; state: VehicleState } => e.state !== null,
    );
    const avg =
      withState.length > 0
        ? withState.reduce((s, e) => s + (e.state.battery_level ?? 0), 0) / withState.length
        : 0;
    const totalRange = withState.reduce((s, e) => s + (e.state.rated_range ?? 0), 0);
    const charging = withState.filter(e => e.state.is_charging).length;
    return { entries: withState, avgBattery: avg, totalRange, chargingCount: charging, onlineCount: withState.length };
  }, [fleetStates]);

  /* ── Mutations ── */
  const syncMut = useMutation({
    mutationFn: () =>
      request<{ synced: number }>('/vehicles/sync', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      request<void>(`/vehicles/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-vehicle-states'] });
      setDeleteTarget(null);
    },
  });

  const [deleteTarget, setDeleteTarget] = useState<Vehicle | null>(null);

  /* ── Loading skeleton ── */
  if (isLoading) {
    return (
      <PageContainer title={t('nav.vehicles', 'Fleet')}>
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={96} />
            ))}
          </div>
          <Skeleton height={140} />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height={112} />
          ))}
        </div>
      </PageContainer>
    );
  }

  /* ── Error state ── */
  if (error) {
    return (
      <PageContainer
        title={t('nav.vehicles', 'Fleet')}
        error={error instanceof Error ? error : new Error(String(error))}
      >
        <GlassPanel className="p-6 text-center">
          <p className="text-sm text-red-500">
            {t('vehicles.loadError', 'Failed to load vehicles.')}
          </p>
        </GlassPanel>
      </PageContainer>
    );
  }

  /* ── Render ── */
  return (
    <PageContainer
      title={t('nav.vehicles', 'Fleet')}
      subtitle={t('vehicles.subtitle', 'View, manage, and sync your Tesla vehicles')}
      actions={
        <Button
          onClick={() => syncMut.mutate()}
          loading={syncMut.isPending}
          icon={<RefreshCw className="h-4 w-4" />}
        >
          {t('vehicles.syncButton', 'Sync from Tesla')}
        </Button>
      }
    >
      {/* Sync feedback banners */}
      {syncMut.isSuccess && (
        <FadeIn>
          <GlassPanel className="border-green-500/30 bg-green-900/10 p-4">
            <p className="text-sm text-green-400">
              {t('vehicles.syncSuccess', 'Vehicles synced successfully.')}
            </p>
          </GlassPanel>
        </FadeIn>
      )}
      {syncMut.isError && (
        <FadeIn>
          <GlassPanel className="border-red-500/30 bg-red-900/10 p-4">
            <p className="text-sm text-red-400">
              {t('vehicles.syncError', 'Sync failed. Please try again.')}
            </p>
          </GlassPanel>
        </FadeIn>
      )}

      {vehicleList.length === 0 ? (
        <EmptyState
          icon={<Car className="h-10 w-10" />}
          title={t('vehicles.emptyTitle', 'No vehicles yet')}
          message={t(
            'vehicles.emptyMessage',
            'Connect your Tesla account and sync your vehicles to get started with fleet tracking, battery monitoring, and trip analysis.',
          )}
          action={{ label: t('vehicles.syncButton', 'Sync from Tesla'), onClick: () => syncMut.mutate() }}
        />
      ) : (
        <div className="space-y-8">
          {/* ── Fleet Summary ──────────────────────────── */}
          <FadeIn delay={0.05}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <MetricCard
                label={t('vehicles.totalVehicles', 'Total Vehicles')}
                value={vehicleList.length}
                icon={<Car className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('vehicles.avgBattery', 'Avg Battery')}
                value={`${Math.round(fleet.avgBattery)}%`}
                icon={<Battery className="h-5 w-5" />}
                color="green"
              />
              <MetricCard
                label={`${t('vehicles.totalRange', 'Total Range')} (${distanceUnit})`}
                value={Math.round(convertDistance(fleet.totalRange))}
                icon={<Gauge className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('vehicles.chargingOnline', 'Charging / Online')}
                value={`${fleet.chargingCount} / ${fleet.onlineCount}`}
                icon={<Zap className="h-5 w-5" />}
                color="green"
              />
            </div>
          </FadeIn>

          {/* ── Battery Comparison Chart ───────────────── */}
          <FadeIn delay={0.1}>
            <GlassPanel className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-cyan-400" />
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    {t('vehicles.batteryStatus', 'Fleet Battery Status')}
                  </span>
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  <AnimatedNumber value={Math.round(fleet.avgBattery)} suffix="%" />
                  {' '}{t('vehicles.avgLabel', 'avg')}
                </span>
              </div>

              {fleet.entries.length > 0 ? (
                <div className="space-y-3">
                  {fleet.entries.map(({ vehicle, state }) => {
                    const level = state.battery_level ?? 0;
                    const color = batteryColor(level);
                    return (
                      <div key={vehicle.id} className="flex items-center gap-3">
                        <span className="text-xs text-gray-600 dark:text-gray-300 w-24 truncate">
                          {vehicle.display_name || vehicle.vin}
                        </span>
                        <div className="flex-1 h-3 rounded-full bg-white/[0.04] overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-1000"
                            style={{
                              width: `${level}%`,
                              background: `linear-gradient(90deg, ${color}80, ${color})`,
                              boxShadow: `0 0 10px ${color}40`,
                            }}
                          />
                        </div>
                        <span className="text-xs font-medium text-gray-900 dark:text-white w-10 text-right">
                          {level}%
                        </span>
                        <span className="text-[10px] text-gray-500 dark:text-gray-400 w-16 text-right">
                          {Math.round(convertDistance(state.rated_range ?? 0))} {distanceUnit}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-muted)]">
                  <Activity className="h-8 w-8 opacity-20" />
                  <p className="text-xs">{t('common.noData', 'No data available')}</p>
                </div>
              )}
            </GlassPanel>
          </FadeIn>

          {/* ── Vehicle Cards ─────────────────────────── */}
          <FadeIn delay={0.15}>
            <div className="flex items-center gap-2 mb-4">
              <Car className="h-4 w-4 text-purple-400" />
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                {t('vehicles.allVehicles', 'All Vehicles')}
              </span>
            </div>
          </FadeIn>

          <StaggerContainer className="space-y-4">
            {vehicleList.map((vehicle) => {
              const entry = fleet.entries.find(e => e.vehicle.id === vehicle.id);
              const state = entry?.state ?? null;
              const status = deriveStatus(vehicle, state);
              const level = state?.battery_level ?? 0;
              const color = batteryColor(level);

              return (
                <StaggerItem key={vehicle.id}>
                  <GlassPanel hover glow="cyan" className="p-0 overflow-hidden group">
                    <div className="h-1 bg-gradient-to-r from-cyan-400 via-purple-400 to-green-400 opacity-40 group-hover:opacity-80 transition-opacity" />

                    <div className="p-5">
                      <div className="flex items-start gap-5">
                        {/* Vehicle info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1.5">
                            <Link
                              to={`/vehicles/${vehicle.id}`}
                              className="text-base font-semibold text-gray-900 dark:text-white hover:text-cyan-400 transition-colors truncate"
                            >
                              {vehicle.display_name || vehicle.vin}
                            </Link>
                            <Badge variant={STATUS_VARIANT[status]} dot size="sm">
                              {STATUS_LABEL[status]}
                            </Badge>
                          </div>

                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                            {vehicle.model} {vehicle.trim_badging} ·{' '}
                            <span className="font-mono">{vehicle.vin}</span>
                          </p>

                          {/* Battery + stats row */}
                          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                            <div className="flex items-center gap-2">
                              <div className="w-20 h-2 rounded-full bg-white/[0.06] overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-700"
                                  style={{
                                    width: `${level}%`,
                                    background: `linear-gradient(90deg, ${color}80, ${color})`,
                                  }}
                                />
                              </div>
                              <span className="text-sm font-bold text-gray-900 dark:text-white">
                                <AnimatedNumber value={level} suffix="%" />
                              </span>
                            </div>

                            {state && (
                              <>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {Math.round(convertDistance(state.rated_range ?? 0))} {distanceUnit}
                                </span>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {Math.round(convertDistance(state.odometer ?? 0)).toLocaleString()} {distanceUnit}
                                </span>
                                {state.is_charging && (
                                  <span className="text-xs font-medium text-green-400">
                                    {state.charger_power} kW
                                  </span>
                                )}
                              </>
                            )}

                            <div className={cn('flex items-center gap-2 ml-auto')}>
                              {state?.is_locked && <Lock className="h-3.5 w-3.5 text-green-500" />}
                              {state?.sentry_mode && <Shield className="h-3.5 w-3.5 text-cyan-400" />}
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col items-center gap-1 shrink-0">
                          <Link
                            to={`/vehicles/${vehicle.id}`}
                            className="rounded-lg p-2 text-gray-400 hover:bg-cyan-400/10 hover:text-cyan-400 transition-all"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteTarget(vehicle)}
                            className="rounded-lg p-2 text-gray-400 hover:bg-red-500/10 hover:text-red-500"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </GlassPanel>
                </StaggerItem>
              );
            })}
          </StaggerContainer>
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('vehicles.removeTitle', 'Remove Vehicle')}
        message={
          deleteTarget
            ? t('vehicles.removeMessage', {
                name: deleteTarget.display_name || deleteTarget.vin,
                defaultValue: `Are you sure you want to remove "${deleteTarget.display_name || deleteTarget.vin}"? This will delete all associated data including drives, charges, and state history.`,
              })
            : ''
        }
        confirmLabel={t('common.delete', 'Remove')}
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) deleteMut.mutate(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </PageContainer>
  );
}
