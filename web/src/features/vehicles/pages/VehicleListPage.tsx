import { useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Car, RefreshCw, Battery, Gauge, Zap, Activity, ListChecks,
  ExternalLink, Trash2, Lock, Shield, ArrowLeftRight, AlertCircle,
  BatteryCharging, Bell, MapPin, Route, Wrench,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel, Badge, Button, ConfirmDialog, PinButton,
  SectionTitle, PanelTitle, Text,
} from '@/components/ui';
import {
  AnimatedNumber,
  DataFreshnessAuto,
  MetricBar,
  MetricCard,
  OperationalBrief,
  EntityPreviewDrawer,
  type OperationalAttention,
} from '@/components/data-display';
import {
  Skeleton,
  EmptyState,
  QueryError,
  AlertBanner,
  DataStateNotice,
  StatGridSkeleton,
} from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { useVehicleLive } from '@/hooks/useVehicleLive';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  useVehicles, useSyncVehicles, useDeleteVehicle, useFleetStates,
} from '@/api/hooks/useVehicles';
import { useFleetWorkOrders } from '@/api/hooks/useFleetOps';
import { usePinned } from '@/api/hooks/usePinned';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';
import { batteryColor, statusHexColor } from '@/lib/colors';
import { typography } from '@/lib/tokens';
import { cn } from '@/lib/cn';
import { deriveVehicleStatus, statusVariant } from '@/api/types';
import type { Vehicle } from '@/types/vehicle';
import type { VehicleState } from '@/api/types';
import type { OperationalNarrative } from '@/types/operationalNarrative';
import { VisuallyHidden } from '@/components/a11y';
import { Icons } from '@/lib/icons';

/* ── Types ─────────────────────────────────────────────────── */

/** A fleet entry whose live state has resolved (non-null). */
type LoadedEntry = { vehicle: Vehicle; state: VehicleState };

/* ── Loading skeleton ──────────────────────────────────────── */

/**
 * Mirrors the redesigned bento layout while the fleet list loads: KPI band →
 * overview bento (hero battery + status) → responsive vehicle-card grid.
 * Rendered inside a real `<PageContainer>` so the title bar appears instantly
 * and layout shift stays at zero when the real content arrives.
 */
function VehicleListSkeleton() {
  const { t } = useTranslation();
  return (
    <PageContainer
      title={t('nav.vehicles', 'Fleet')}
      subtitle={t('vehicles.subtitle', 'View, manage, and sync your Tesla vehicles')}
    >
      <div className="space-y-6" data-testid="vehicle-list-skeleton">
        <StatGridSkeleton cards={4} />
        <div className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-3">
          <Skeleton className="h-64 rounded-xl xl:col-span-2" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}

/* ── Small building blocks ─────────────────────────────────── */

/** Compact icon + value chip used inside the vehicle card stat row. */
function StatChip({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-white/[0.03] px-2 py-1',
        typography.size.xs,
        typography.color.secondary,
      )}
    >
      {icon}
      <VisuallyHidden>{label}: </VisuallyHidden>
      <Text color="primary" className="tabular-nums">{value}</Text>
    </span>
  );
}

/* ── KPI band ──────────────────────────────────────────────── */

interface FleetKpisProps {
  totalVehicles: number;
  avgBattery: number;
  totalRange: number;
  chargingCount: number;
  onlineCount: number;
}

/** Full-width responsive metric grid summarising the whole fleet. */
function FleetKpis({ totalVehicles, avgBattery, totalRange, chargingCount, onlineCount }: FleetKpisProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  return (
    <section
      aria-label={t('vehicles.summary', 'Fleet summary')}
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
    >
      <MetricCard
        label={t('vehicles.totalVehicles', 'Total Vehicles')}
        value={totalVehicles}
        icon={<Car className="h-5 w-5" />}
        color="cyan"
      />
      <MetricCard
        label={t('vehicles.avgBattery', 'Avg Battery')}
        value={`${fmtNumber(avgBattery)}%`}
        icon={<Battery className="h-5 w-5" />}
        color="green"
      />
      <MetricCard
        label={`${t('vehicles.totalRange', 'Total Range')} (${unitPrefs.distance})`}
        value={fmtNumber(convertDistanceFromSI(totalRange, unitPrefs.distance))}
        icon={<Gauge className="h-5 w-5" />}
        color="purple"
      />
      <MetricCard
        label={t('vehicles.chargingOnline', 'Charging / Online')}
        value={`${chargingCount} / ${onlineCount}`}
        icon={<Zap className="h-5 w-5" />}
        color="green"
      />
    </section>
  );
}

/* ── Fleet battery panel (hero) ────────────────────────────── */

interface FleetBatteryPanelProps {
  entries: LoadedEntry[];
  avgBattery: number;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}

/** Per-vehicle battery bars — the hero panel of the overview bento. */
function FleetBatteryPanel({ entries, avgBattery, isLoading, isError, error, onRetry }: FleetBatteryPanelProps) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  return (
    <GlassPanel className="flex h-full flex-col p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('vehicles.batteryStatus', 'Fleet Battery Status')}
        </PanelTitle>
        <Text variant="bodySm">
          <AnimatedNumber value={Math.round(avgBattery)} suffix="%" />{' '}
          {t('vehicles.avgLabel', 'avg')}
        </Text>
      </div>

      {isError ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 rounded-lg" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-8 w-8" />}
          message={t(
            'vehicles.noBatteryReadings',
            'Live battery readings have not arrived for the registered fleet.',
          )}
          description={t(
            'vehicles.noBatteryReadingsDescription',
            'Readings appear after vehicles reconnect and send a telemetry update.',
          )}
          action={{
            label: t('vehicles.refreshLiveState', 'Refresh live state'),
            onClick: onRetry,
          }}
          className="py-8"
        />
      ) : (
        <div className="space-y-3">
          {entries.map(({ vehicle, state }) => {
            const level = state.battery_level ?? 0;
            return (
              <MetricBar
                key={vehicle.id}
                label={vehicle.display_name || vehicle.vin}
                value={level}
                max={100}
                color={batteryColor(level)}
                sublabel={`${level}% · ${formatDistance(state.rated_range ?? 0)}`}
              />
            );
          })}
        </div>
      )}
    </GlassPanel>
  );
}

/* ── Fleet status breakdown panel ──────────────────────────── */

interface StatusCount { status: string; count: number }

interface FleetStatusPanelProps {
  counts: StatusCount[];
  total: number;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}

/** Count-by-status breakdown, derived from the same fleet-state batch. */
function FleetStatusPanel({ counts, total, isLoading, isError, error, onRetry }: FleetStatusPanelProps) {
  const { t } = useTranslation();
  return (
    <GlassPanel className="flex h-full flex-col p-4 sm:p-5">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('vehicles.statusBreakdown', 'Fleet Status')}
      </PanelTitle>

      {isError ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 rounded-lg" />
          ))}
        </div>
      ) : counts.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="h-8 w-8" />}
          message={t('vehicles.noStatusData', 'No fleet status data yet')}
          description={t(
            'vehicles.noStatusDataDescription',
            'Availability and readiness appear after at least one registered vehicle reports live state.',
          )}
          action={{
            label: t('vehicles.refreshLiveState', 'Refresh live state'),
            onClick: onRetry,
          }}
          className="py-8"
        />
      ) : (
        <div className="space-y-3">
          {counts.map(({ status, count }) => (
            <MetricBar
              key={status}
              label={status.charAt(0).toUpperCase() + status.slice(1)}
              value={count}
              max={total || count}
              color={statusHexColor(status)}
              sublabel={String(count)}
            />
          ))}
        </div>
      )}
    </GlassPanel>
  );
}

/* ── Vehicle card ──────────────────────────────────────────── */

interface VehicleCardProps {
  vehicle: Vehicle;
  state: VehicleState | null;
  onDelete: (vehicle: Vehicle) => void;
  onPreview: () => void;
}

/** One vehicle in the responsive fleet grid — all data + row actions. */
function VehicleCard({ vehicle, state, onDelete, onPreview }: VehicleCardProps) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();

  const status = deriveVehicleStatus(state);
  const level = state?.battery_level ?? 0;
  const color = batteryColor(level);
  const name = vehicle.display_name || vehicle.vin;
  const modelLine = [vehicle.model, vehicle.trim_badging].filter(Boolean).join(' ');

  return (
    <GlassPanel
      hover
      glow="cyan"
      padding="none"
      data-tour="vehicles-card"
      className="group flex h-full flex-col overflow-hidden"
    >
      <div
        className="h-1 bg-gradient-to-r from-cyan-400 via-purple-400 to-emerald-400 opacity-40 transition-opacity group-hover:opacity-80"
        aria-hidden="true"
      />

      <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
        {/* Header — name, status, pin */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Link
                to={`/vehicles/${vehicle.id}`}
                className={cn(
                  typography.role.panelTitle,
                  'truncate rounded outline-none transition-colors hover:text-cyan-300 focus-visible:text-cyan-300 focus-visible:ring-1 focus-visible:ring-cyan-400/40',
                )}
              >
                {name}
              </Link>
              <Badge variant={statusVariant(status)} dot size="sm">
                {status}
              </Badge>
            </div>
            <Text variant="caption" as="p" className="mt-1 truncate">
              {modelLine || t('vehicles.unknownModel', 'Unknown model')}
              {' · '}
              <span className={typography.family.mono}>{vehicle.vin}</span>
            </Text>
          </div>
          <PinButton itemType="vehicle" itemId={vehicle.id} size="md" />
        </div>

        {/* Battery */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Text variant="bodySm">
              {t('vehicles.battery', 'Battery')}
            </Text>
            <Text size="sm" weight="semibold" color="primary" className="tabular-nums">
              <AnimatedNumber value={level} suffix="%" />
            </Text>
          </div>
          <div
            role="progressbar"
            aria-valuenow={level}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('vehicles.batteryLevel', 'Battery level')}
            className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]"
          >
            <div
              className="h-full rounded-full transition-all duration-slow"
              style={{ width: `${level}%`, background: `linear-gradient(90deg, ${color}99, ${color})` }}
            />
          </div>
        </div>

        {/* Stat chips */}
        <div className="flex flex-wrap items-center gap-2">
          {state ? (
            <>
              <StatChip
                icon={<Gauge className="h-3.5 w-3.5" aria-hidden="true" />}
                label={t('vehicles.range', 'Range')}
                value={formatDistance(state.rated_range ?? 0)}
              />
              <StatChip
                icon={<Activity className="h-3.5 w-3.5" aria-hidden="true" />}
                label={t('vehicles.odometer', 'Odometer')}
                value={formatDistance(state.odometer ?? 0)}
              />
              {state.is_charging && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md bg-neon-green/10 px-2 py-1 text-emerald-300',
                    typography.size.xs,
                    typography.weight.medium,
                  )}
                >
                  <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                  {fmtNumber(state.charger_power ?? 0)} kW
                </span>
              )}
            </>
          ) : (
            <Text variant="caption">
              {t('vehicles.noLiveData', 'No live data')}
            </Text>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {state?.is_locked && (
              <Lock className="h-4 w-4 text-emerald-400" aria-label={t('vehicles.locked', 'Locked')} />
            )}
            {state?.sentry_mode && (
              <Shield className="h-4 w-4 text-cyan-400" aria-label={t('vehicles.sentryOn', 'Sentry mode on')} />
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
          <Link
            to={`/vehicles/${vehicle.id}`}
            aria-label={t('vehicles.openDetail', 'Open {{name}} details', { name })}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-cyan-300 outline-none transition-colors hover:text-cyan-200 focus-visible:ring-1 focus-visible:ring-cyan-400/40',
              typography.size.sm,
              typography.weight.medium,
            )}
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            {t('vehicles.viewDetails', 'View details')}
          </Link>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onPreview}
              aria-label={t('vehicles.quickViewAria', 'Quick view {{name}}', { name })}
              title={t('common.quickView', 'Quick view')}
              className="min-h-11 min-w-11 p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <Icons.show className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(vehicle)}
              aria-label={t('vehicles.removeAria', 'Remove {{name}}', { name })}
              className="min-h-11 min-w-11 p-0 text-[var(--text-muted)] hover:bg-rose-500/10 hover:text-rose-300"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </GlassPanel>
  );
}

/* ── Page ──────────────────────────────────────────────────── */

export default function VehicleListPage() {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  usePageTitle(t('nav.vehicles', 'Fleet'));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { setVehicleId } = useSelectedVehicle();

  /* ── Data ── */
  const vehiclesQuery = useVehicles();
  const { data: vehicles, isLoading, error } = vehiclesQuery;
  const vehicleList = vehicles ?? [];

  // Keep the first vehicle's SSE live-state warm for snappy detail navigation.
  const primaryId = vehicleList[0]?.id;
  useVehicleLive(primaryId);

  const statesQuery = useFleetStates(vehicleList);
  const fleetStates = statesQuery.data;
  const workOrdersQuery = useFleetWorkOrders({ limit: 100 });
  const workOrders = workOrdersQuery.data?.items ?? [];

  /* Pinned vehicles float to the top of the list. */
  const { data: vehiclePins = [] } = usePinned('vehicle');
  const sortedVehicleList = useMemo(() => {
    if (vehiclePins.length === 0) return vehicleList;
    const order = new Map<string, number>();
    vehiclePins.forEach((p) => order.set(String(p.item_id), p.position));
    return [...vehicleList].sort((a, b) => {
      const ap = order.get(String(a.id));
      const bp = order.get(String(b.id));
      if (ap != null && bp != null) return ap - bp;
      if (ap != null) return -1;
      if (bp != null) return 1;
      return 0;
    });
  }, [vehicleList, vehiclePins]);

  /* ── Computed fleet metrics ── */
  const fleet = useMemo(() => {
    const withState = (fleetStates ?? []).filter(
      (e): e is LoadedEntry => e.state !== null,
    );
    const avg =
      withState.length > 0
        ? withState.reduce((s, e) => s + (e.state.battery_level ?? 0), 0) / withState.length
        : 0;
    const totalRange = withState.reduce((s, e) => s + (e.state.rated_range ?? 0), 0);
    const charging = withState.filter((e) => e.state.is_charging).length;
    const ready = withState.filter((e) => (e.state.battery_level ?? 0) >= 20).length;
    const active = withState.filter((e) => {
      const status = deriveVehicleStatus(e.state);
      return status === 'driving' || status === 'charging';
    }).length;
    const softwareVersions = new Set(
      withState
        .map((entry) => entry.state.software_version?.trim())
        .filter((version): version is string => Boolean(version)),
    );
    return {
      entries: withState,
      avgBattery: avg,
      totalRange,
      chargingCount: charging,
      onlineCount: withState.length,
      readyCount: ready,
      activeCount: active,
      softwareVersions: [...softwareVersions].sort(),
      softwareReportingCount: withState.filter(
        (entry) => Boolean(entry.state.software_version?.trim()),
      ).length,
    };
  }, [fleetStates]);

  /* O(1) live-state lookup by vehicle id, shared by the status breakdown and
     the card grid so neither rescans the fleet-state array once per row. */
  const stateById = useMemo(() => {
    const map = new Map<number, VehicleState | null>();
    (fleetStates ?? []).forEach((e) => map.set(e.vehicle.id, e.state));
    return map;
  }, [fleetStates]);

  /* Count vehicles by derived status for the breakdown panel. */
  const statusCounts = useMemo<StatusCount[]>(() => {
    const counts = new Map<string, number>();
    for (const v of vehicleList) {
      const status = deriveVehicleStatus(stateById.get(v.id) ?? null);
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  }, [stateById, vehicleList]);
  const fleetStatePending = statesQuery.isLoading;
  const offlineCount = fleetStatePending
    ? 0
    : Math.max(0, vehicleList.length - fleet.onlineCount);
  const lowBatteryCount = fleet.entries.filter(
    ({ state }) => (state.battery_level ?? 100) < 20,
  ).length;
  const openWorkOrders = workOrders.filter(
    (order) => order.status !== 'completed' && order.status !== 'cancelled',
  );
  const urgentWorkOrders = openWorkOrders.filter(
    (order) => order.severity === 'high' || order.severity === 'critical',
  );
  const utilizationPct = vehicleList.length > 0
    ? Math.round((fleet.activeCount / vehicleList.length) * 100)
    : 0;
  const fleetAttention: OperationalAttention[] = [
    ...(!fleetStatePending && offlineCount > 0
      ? [{
          key: 'offline',
          title: t('operations.vehicles.offlineTitle', '{{count}} vehicle unavailable', {
            count: offlineCount,
          }),
          description: t(
            'operations.vehicles.offlineDescription',
            'Live state could not be resolved. Verify connectivity before issuing commands.',
          ),
          tone: 'warning' as const,
        }]
      : []),
    ...(lowBatteryCount > 0
      ? [{
          key: 'low-battery',
          title: t('operations.vehicles.lowBatteryTitle', '{{count}} vehicle below 20%', {
            count: lowBatteryCount,
          }),
          description: t(
            'operations.vehicles.lowBatteryDescription',
            'Review charging readiness before the next scheduled departure.',
          ),
          tone: 'warning' as const,
        }]
      : []),
    ...(fleet.softwareVersions.length > 1
      ? [{
          key: 'software',
          title: t(
            'operations.vehicles.softwareMixedTitle',
            '{{count}} software versions are active',
            { count: fleet.softwareVersions.length },
          ),
          description: t(
            'operations.vehicles.softwareMixedDescription',
            'Review rollout consistency before diagnosing behavior that differs between vehicles.',
          ),
          tone: 'warning' as const,
        }]
      : []),
    ...(urgentWorkOrders.length > 0
      ? [{
          key: 'service',
          title: t(
            'operations.vehicles.serviceAttentionTitle',
            'Urgent service work requires attention ({{count}})',
            { count: urgentWorkOrders.length },
          ),
          description: t(
            'operations.vehicles.serviceAttentionDescription',
            'High- or critical-severity maintenance is still open in Fleet Operations.',
          ),
          tone: 'danger' as const,
        }]
      : []),
  ];
  const narrativeEvidence: OperationalNarrative['evidence'] = [
    ...vehicleList.slice(0, 4).map((vehicle) => {
      const state = stateById.get(vehicle.id) ?? null;
      return {
        id: `fleet-vehicle-${vehicle.id}`,
        summary: t(
          'operations.vehicles.narrative.vehicleSummary',
          '{{vehicle}}: {{state}}, battery {{battery}}.',
          {
            vehicle: vehicle.display_name,
            state:
              state?.state
              ?? t('operations.vehicles.narrative.stateUnavailable', 'live state unavailable'),
            battery: state == null ? '—' : `${fmtNumber(state.battery_level)}%`,
          },
        ),
        observedAt: state?.since ?? null,
        provenance: {
          source: t('operations.vehicles.liveStateSource', 'Live vehicle state'),
          recordId: String(vehicle.id),
          method: t(
            'operations.vehicles.narrative.vehicleMethod',
            'Latest independently resolved state for this registered vehicle.',
          ),
        },
      };
    }),
    ...urgentWorkOrders.slice(0, 2).map((workOrder) => ({
      id: `fleet-work-order-${workOrder.id}`,
      summary: t(
        'operations.vehicles.narrative.workOrderSummary',
        '{{vehicle}}: {{severity}} work order — {{title}}.',
        {
          vehicle: workOrder.vehicle_display_name,
          severity: workOrder.severity,
          title: workOrder.title,
        },
      ),
      observedAt: workOrder.updated_at,
      provenance: {
        source: t('operations.vehicles.workOrdersSource', 'Fleet work orders'),
        recordId: String(workOrder.id),
        method: t(
          'operations.vehicles.narrative.workOrderMethod',
          'Open high- or critical-severity Fleet Operations work order.',
        ),
      },
    })),
  ];
  const narrative: OperationalNarrative = {
    whatChanged: t(
      'operations.vehicles.narrative.whatChanged',
      '{{online}} of {{total}} registered vehicles have live state; {{ready}} are departure ready and {{urgent}} urgent work orders remain open.',
      {
        online: fleet.onlineCount,
        total: vehicleList.length,
        ready: fleet.readyCount,
        urgent: urgentWorkOrders.length,
      },
    ),
    whyItMatters:
      fleetAttention[0]?.description
      ?? t(
        'operations.vehicles.narrative.readyImpact',
        'Current connectivity, charge level, software posture, and service status support fleet dispatch decisions.',
      ),
    confidence: {
      label:
        vehicleList.length > 0
        && fleet.onlineCount === vehicleList.length
        && !workOrdersQuery.isError
          ? 'high'
          : fleet.onlineCount > 0
            ? 'medium'
            : 'low',
      score: null,
      basis: [
        t(
          'operations.vehicles.narrative.liveBasis',
          'Live state resolved for {{online}} of {{total}} registered vehicles.',
          { online: fleet.onlineCount, total: vehicleList.length },
        ),
        workOrdersQuery.isError
          ? t(
              'operations.vehicles.narrative.workOrderLimitedBasis',
              'Fleet Operations work orders were unavailable.',
            )
          : t(
              'operations.vehicles.narrative.workOrderBasis',
              '{{count}} open work orders were evaluated for service attention.',
              { count: openWorkOrders.length },
            ),
      ],
    },
    likelyCause: null,
    recommendedResponse:
      urgentWorkOrders.length > 0
        ? t(
            'operations.vehicles.narrative.serviceResponse',
            'Review the urgent Fleet Operations work orders before assigning affected vehicles.',
          )
        : offlineCount > 0
          ? t(
              'operations.vehicles.narrative.connectivityResponse',
              'Verify connectivity before issuing commands to vehicles without live state.',
            )
          : lowBatteryCount > 0
            ? t(
                'operations.vehicles.narrative.chargeResponse',
                'Confirm charging plans for vehicles below the departure-readiness threshold.',
              )
            : t(
                'operations.vehicles.narrative.monitorResponse',
                'No immediate fleet response is indicated; continue monitoring readiness and service status.',
              ),
    limitations: [
      t(
        'operations.vehicles.narrative.snapshotLimitation',
        'Live vehicle state is a current snapshot and does not explain why a vehicle is offline or at a low charge level.',
      ),
      ...(workOrdersQuery.isError
        ? [
            t(
              'operations.vehicles.narrative.workOrderLimitation',
              'Service readiness is incomplete while Fleet Operations work orders are unavailable.',
            ),
          ]
        : []),
      t(
        'operations.vehicles.narrative.evidenceLimit',
        'Supporting evidence is limited to four vehicle snapshots and two urgent work orders.',
      ),
    ],
    evidence: narrativeEvidence,
    provenance: [
      {
        source: t('operations.vehicles.liveStateSource', 'Live vehicle state'),
        method: t(
          'operations.vehicles.narrative.liveMethod',
          'Resolves current state independently for every registered vehicle.',
        ),
      },
      {
        source: t('operations.vehicles.workOrdersSource', 'Fleet work orders'),
        method: t(
          'operations.vehicles.narrative.serviceMethod',
          'Counts open work orders and elevates high- and critical-severity records.',
        ),
      },
    ],
  };

  /* ── Mutations ── */
  const syncMut = useSyncVehicles();
  const deleteMut = useDeleteVehicle();
  const [deleteTarget, setDeleteTarget] = useState<Vehicle | null>(null);
  const [previewTarget, setPreviewTarget] = useState<{
    vehicle: Vehicle;
    state: VehicleState | null;
  } | null>(null);

  const handleSync = () => {
    syncMut.mutate(undefined, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fleet-vehicle-states'] }),
    });
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    deleteMut.mutate(deleteTarget.id, {
      onSuccess: () => {
        setDeleteTarget(null);
        queryClient.invalidateQueries({ queryKey: ['fleet-vehicle-states'] });
      },
    });
  };

  const handleCompare = () => {
    // leftId / rightId are FRONTEND route params read by FleetComparePage via
    // useSearchParams — built through URLSearchParams for correct encoding.
    const params = new URLSearchParams({
      leftId: String(vehicleList[0]?.id ?? ''),
      rightId: String(vehicleList[1]?.id ?? ''),
    });
    navigate(`/vehicle-comparison?${params.toString()}`);
  };

  /* ── Loading / error short-circuits ── */
  if (isLoading) {
    return <VehicleListSkeleton />;
  }

  if (error) {
    return (
      <PageContainer
        title={t('nav.vehicles', 'Fleet')}
        subtitle={t('vehicles.subtitle', 'View, manage, and sync your Tesla vehicles')}
      >
        <GlassPanel className="p-4 sm:p-5">
          <QueryError
            error={error}
            onRetry={() => vehiclesQuery.refetch()}
            resourceName={t('nav.vehicles', 'Fleet')}
          />
        </GlassPanel>
      </PageContainer>
    );
  }

  /* ── Render ── */
  return (
    <PageContainer
      title={t('nav.vehicles', 'Fleet')}
      subtitle={t('vehicles.subtitle', 'View, manage, and sync your Tesla vehicles')}
      query={[vehiclesQuery, statesQuery, workOrdersQuery]}
      secondaryActions={
        vehicleList.length >= 2 ? (
          <Button
            variant="outline"
            icon={<ArrowLeftRight className="h-4 w-4" />}
            onClick={handleCompare}
          >
            {t('vehicles.compareButton', 'Compare vehicles')}
          </Button>
        ) : undefined
      }
      primaryAction={
        <Button
          onClick={handleSync}
          loading={syncMut.isPending}
          icon={<RefreshCw className="h-4 w-4" />}
        >
          {t('vehicles.syncButton', 'Sync from Tesla')}
        </Button>
      }
    >
      {/* Sync feedback — transient, dismissible */}
      {syncMut.isSuccess && (
        <FadeIn>
          <AlertBanner
            variant="success"
            icon={<RefreshCw className="h-5 w-5" />}
            onClose={() => syncMut.reset()}
          >
            {t('vehicles.syncSuccess', 'Vehicles synced successfully.')}
          </AlertBanner>
        </FadeIn>
      )}
      {syncMut.isError && (
        <FadeIn>
          <AlertBanner
            variant="danger"
            icon={<AlertCircle className="h-5 w-5" />}
            onClose={() => syncMut.reset()}
          >
            {t('vehicles.syncError', 'Sync failed. Please try again.')}
          </AlertBanner>
        </FadeIn>
      )}
      {workOrdersQuery.isError && vehicleList.length > 0 && (
        <DataStateNotice
          state="partial"
          title={t(
            'operations.vehicles.serviceUnavailableTitle',
            'Service attention is temporarily unavailable',
          )}
        >
          {t(
            'operations.vehicles.serviceUnavailableDescription',
            'Fleet availability and live state remain visible, but maintenance work orders could not be loaded.',
          )}
        </DataStateNotice>
      )}

      {vehicleList.length === 0 ? (
        <EmptyState
          icon={<Car className="h-10 w-10" />}
          title={t('vehicles.emptyTitle', 'No vehicles yet')}
          message={t(
            'vehicles.emptyMessage',
            'Connect your Tesla account and sync your vehicles to get started with fleet tracking, battery monitoring, and trip analysis.',
          )}
          action={{ label: t('vehicles.syncButton', 'Sync from Tesla'), onClick: handleSync }}
        />
      ) : (
        <>
          <OperationalBrief
            testId="fleet-operational-brief"
            eyebrow={t('operations.vehicles.eyebrow', 'Fleet posture')}
            title={t('operations.vehicles.title', 'Availability and readiness across the fleet')}
            description={t(
              'operations.vehicles.description',
              'Live connectivity, departure readiness, utilization, software consistency, and service attention are consolidated before vehicle-level detail.',
            )}
            statusLabel={
              fleetStatePending
                ? t('operations.status.loading', 'Resolving live state')
                : fleetAttention.length > 0
                ? t('operations.status.review', 'Review recommended')
                : t('operations.status.ready', 'Fleet ready')
            }
            statusTone={
              fleetStatePending
                ? 'neutral'
                : fleetAttention.length > 0
                  ? 'warning'
                  : 'success'
            }
            narrative={narrative}
            freshness={
              <div className="flex flex-wrap items-center gap-2">
                <DataFreshnessAuto
                  query={statesQuery}
                  source={t('operations.vehicles.liveStateSource', 'Live vehicle state')}
                />
                <DataFreshnessAuto
                  query={workOrdersQuery}
                  source={t('operations.vehicles.workOrdersSource', 'Fleet work orders')}
                />
              </div>
            }
            actions={
              <Button
                type="button"
                variant="outline"
                size="sm"
                icon={<Wrench className="h-4 w-4" aria-hidden="true" />}
                onClick={() => navigate('/fleet-operations')}
              >
                {t('operations.vehicles.openFleetOperations', 'Fleet operations')}
              </Button>
            }
            metricColumns={3}
            metrics={[
              {
                key: 'vehicles',
                label: t('vehicles.totalVehicles', 'Total Vehicles'),
                value: vehicleList.length,
                detail: t(
                  'operations.vehicles.totalDetail',
                  'Vehicles currently registered in this TeslaSync workspace.',
                ),
                tone: 'info',
              },
              {
                key: 'online',
                label: t('operations.vehicles.online', 'Live state available'),
                value: fleetStatePending ? '—' : `${fleet.onlineCount}/${vehicleList.length}`,
                detail: t(
                  'operations.vehicles.onlineDetail',
                  'Vehicles with a current state response available.',
                ),
                tone: fleetStatePending
                  ? 'neutral'
                  : offlineCount > 0
                    ? 'warning'
                    : 'success',
              },
              {
                key: 'readiness',
                label: t('operations.vehicles.readiness', 'Departure ready'),
                value: fleetStatePending ? '—' : `${fleet.readyCount}/${vehicleList.length}`,
                detail: t(
                  'operations.vehicles.readinessDetail',
                  'Vehicles reporting live state with at least 20% battery.',
                ),
                tone: fleetStatePending
                  ? 'neutral'
                  : fleet.readyCount < vehicleList.length
                    ? 'warning'
                    : 'success',
              },
              {
                key: 'utilization',
                label: t('operations.vehicles.utilization', 'Live utilization'),
                value: fleetStatePending ? '—' : `${utilizationPct}%`,
                detail: t(
                  'operations.vehicles.utilizationDetail',
                  '{{active}} of {{total}} registered vehicles are driving or charging now.',
                  { active: fleet.activeCount, total: vehicleList.length },
                ),
                tone: fleetStatePending ? 'neutral' : 'info',
              },
              {
                key: 'software',
                label: t('operations.vehicles.softwarePosture', 'Software posture'),
                value: fleetStatePending || fleet.softwareVersions.length === 0
                  ? '—'
                  : fleet.softwareVersions.length === 1
                    ? fleet.softwareVersions[0]
                    : t(
                        'operations.vehicles.softwareVersionCount',
                        '{{count}} versions',
                        { count: fleet.softwareVersions.length },
                      ),
                detail: t(
                  'operations.vehicles.softwareDetail',
                  '{{reported}} of {{online}} live vehicles reported a software version.',
                  {
                    reported: fleet.softwareReportingCount,
                    online: fleet.onlineCount,
                  },
                ),
                tone: fleetStatePending || fleet.softwareVersions.length === 0
                  ? 'neutral'
                  : fleet.softwareVersions.length > 1
                    ? 'warning'
                    : 'success',
              },
              {
                key: 'service',
                label: t('operations.vehicles.serviceAttention', 'Service attention'),
                value: workOrdersQuery.isLoading || workOrdersQuery.isError
                  ? '—'
                  : t(
                      'operations.vehicles.openWorkOrders',
                      '{{count}} open',
                      { count: openWorkOrders.length },
                    ),
                detail: workOrdersQuery.isError
                  ? t(
                      'operations.vehicles.serviceUnavailableMetric',
                      'Work-order data is unavailable; live fleet data remains usable.',
                    )
                  : t(
                      'operations.vehicles.serviceDetail',
                      'High- or critical-severity work orders requiring review: {{urgent}}.',
                      { urgent: urgentWorkOrders.length },
                    ),
                tone: workOrdersQuery.isLoading || workOrdersQuery.isError
                  ? 'neutral'
                  : urgentWorkOrders.length > 0
                    ? 'danger'
                    : openWorkOrders.length > 0
                      ? 'warning'
                      : 'success',
              },
            ]}
            attention={fleetAttention}
            provenance={t(
              'operations.vehicles.provenance',
              'Based on the registered fleet, the latest independently resolved live state for each vehicle, and Fleet Operations work orders.',
            )}
          />

          {/* 1 — KPI band */}
          <FadeIn delay={0.05}>
            {fleetStatePending ? (
              <StatGridSkeleton cards={4} />
            ) : (
              <FleetKpis
                totalVehicles={vehicleList.length}
                avgBattery={fleet.avgBattery}
                totalRange={fleet.totalRange}
                chargingCount={fleet.chargingCount}
                onlineCount={fleet.onlineCount}
              />
            )}
          </FadeIn>

          {/* 2 — Overview bento: hero battery (2/3) + status breakdown (1/3) */}
          <section aria-labelledby="fleet-overview-heading">
            <SectionTitle id="fleet-overview-heading" className="mb-3">
              {t('vehicles.overview', 'Fleet overview')}
            </SectionTitle>
            <div className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-3">
              <FadeIn delay={0.1} className="h-full xl:col-span-2">
                <FleetBatteryPanel
                  entries={fleet.entries}
                  avgBattery={fleet.avgBattery}
                  isLoading={statesQuery.isLoading}
                  isError={statesQuery.isError}
                  error={statesQuery.error}
                  onRetry={() => statesQuery.refetch()}
                />
              </FadeIn>
              <FadeIn delay={0.15} className="h-full">
                <FleetStatusPanel
                  counts={statusCounts}
                  total={vehicleList.length}
                  isLoading={statesQuery.isLoading}
                  isError={statesQuery.isError}
                  error={statesQuery.error}
                  onRetry={() => statesQuery.refetch()}
                />
              </FadeIn>
            </div>
          </section>

          {/* 3 — All vehicles: responsive full-width card grid */}
          <section aria-labelledby="all-vehicles-heading" data-tour="vehicles-list">
            <SectionTitle id="all-vehicles-heading" className="mb-3 flex items-center gap-2">
              <Car className="h-4 w-4 text-purple-300" aria-hidden="true" />
              {t('vehicles.allVehicles', 'All Vehicles')}
            </SectionTitle>
            <StaggerContainer className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4">
              {sortedVehicleList.map((vehicle) => (
                <StaggerItem key={vehicle.id} className="h-full">
                  <VehicleCard
                    vehicle={vehicle}
                    state={stateById.get(vehicle.id) ?? null}
                    onDelete={setDeleteTarget}
                    onPreview={() => {
                      setPreviewTarget({
                        vehicle,
                        state: stateById.get(vehicle.id) ?? null,
                      });
                    }}
                  />
                </StaggerItem>
              ))}
            </StaggerContainer>
          </section>
        </>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        loading={deleteMut.isPending}
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
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
      <EntityPreviewDrawer
        open={previewTarget !== null}
        onClose={() => setPreviewTarget(null)}
        eyebrow={t('vehicles.preview.eyebrow', 'Vehicle preview')}
        title={
          previewTarget?.vehicle.display_name
          || previewTarget?.vehicle.vin
          || t('vehicles.preview.title', 'Vehicle details')
        }
        description={
          previewTarget
            ? [previewTarget.vehicle.model, previewTarget.vehicle.trim_badging]
                .filter(Boolean)
                .join(' ') || t('vehicles.unknownModel', 'Unknown model')
            : undefined
        }
        statusLabel={
          previewTarget
            ? deriveVehicleStatus(previewTarget.state)
            : undefined
        }
        statusTone={
          previewTarget
            ? statusVariant(deriveVehicleStatus(previewTarget.state))
            : 'neutral'
        }
        fields={
          previewTarget
            ? [
                {
                  key: 'battery',
                  label: t('vehicles.battery', 'Battery'),
                  value: previewTarget.state?.battery_level != null
                    ? `${fmtNumber(previewTarget.state.battery_level)}%`
                    : '—',
                },
                {
                  key: 'range',
                  label: t('vehicles.range', 'Range'),
                  value: previewTarget.state?.rated_range != null
                    ? formatDistance(previewTarget.state.rated_range)
                    : '—',
                },
                {
                  key: 'odometer',
                  label: t('vehicles.odometer', 'Odometer'),
                  value: previewTarget.state?.odometer != null
                    ? formatDistance(previewTarget.state.odometer)
                    : '—',
                },
                {
                  key: 'software',
                  label: t('vehicles.software', 'Software'),
                  value: previewTarget.state?.software_version || '—',
                },
                {
                  key: 'security',
                  label: t('vehicles.preview.security', 'Security'),
                  value: previewTarget.state?.is_locked
                    ? t('vehicles.locked', 'Locked')
                    : t('vehicles.unlocked', 'Unlocked'),
                },
                {
                  key: 'charging',
                  label: t('vehicles.preview.charging', 'Charging'),
                  value: previewTarget.state?.is_charging
                    ? t('common.active', 'Active')
                    : t('common.inactive', 'Inactive'),
                },
              ]
            : []
        }
        primaryAction={
          previewTarget
            ? {
                label: t('vehicles.preview.openDetails', 'Open vehicle details'),
                onClick: () => navigate(`/vehicles/${previewTarget.vehicle.id}`),
              }
            : undefined
        }
        relatedActions={
          previewTarget
            ? [
                {
                  key: 'drives',
                  label: t('entityContext.drives', 'Drive history'),
                  to: '/drives',
                  icon: <Route className="h-4 w-4" aria-hidden="true" />,
                  onNavigate: () => setVehicleId(previewTarget.vehicle.id),
                },
                {
                  key: 'charging',
                  label: t('entityContext.charging', 'Charging sessions'),
                  to: '/charging',
                  icon: <BatteryCharging className="h-4 w-4" aria-hidden="true" />,
                  onNavigate: () => setVehicleId(previewTarget.vehicle.id),
                },
                {
                  key: 'locations',
                  label: t('entityContext.locations', 'Visited locations'),
                  to: '/locations',
                  icon: <MapPin className="h-4 w-4" aria-hidden="true" />,
                  onNavigate: () => setVehicleId(previewTarget.vehicle.id),
                },
                {
                  key: 'alerts',
                  label: t('entityContext.alerts', 'Alerts'),
                  to: '/notifications/alerts',
                  icon: <Bell className="h-4 w-4" aria-hidden="true" />,
                  onNavigate: () => setVehicleId(previewTarget.vehicle.id),
                },
                {
                  key: 'service',
                  label: t('entityContext.service', 'Service history'),
                  to: '/maintenance',
                  icon: <Wrench className="h-4 w-4" aria-hidden="true" />,
                  onNavigate: () => setVehicleId(previewTarget.vehicle.id),
                },
                {
                  key: 'telemetry',
                  label: t('entityContext.telemetry', 'Telemetry evidence'),
                  to: '/signals',
                  icon: <Activity className="h-4 w-4" aria-hidden="true" />,
                  onNavigate: () => setVehicleId(previewTarget.vehicle.id),
                },
              ]
            : []
        }
      />
    </PageContainer>
  );
}
