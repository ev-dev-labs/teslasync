import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Car, RefreshCw, Gauge, Zap, Activity, ListChecks,
  ExternalLink, Lock, Shield, ArrowLeftRight, AlertCircle,
  BatteryCharging, Bell, MapPin, Route, Wrench,
} from 'lucide-react';

import { PrefetchLink, PageLayout, Section } from '@/components/layout';
import { VehiclePanelGrid } from '../components/modernization';
import { VirtualizedVehicleGrid } from '@/components/vehicles';
import {
  GlassPanel, Badge, Button, ConfirmDialog, PinButton,
  PanelTitle, Text, Popover, MaskedValue,
} from '@/components/ui';
import {
  AnimatedNumber,
  DataProvenanceBadge,
  MetricBar,
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
  StaleRefreshWarning,
  StatGridSkeleton,
} from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber, type DataStatus } from '@/api/dataState';
import { useUnits } from '@/hooks/useUnits';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  useVehicles, useSyncVehicles, useDeleteVehicle, useFleetStates,
  deriveCurrentVehicleStatus, describeFleetState, isFleetStateFieldCurrent,
  summariseFleetStates,
  vehicleKeys,
  type FleetStateEntry, type FleetStatesSummary, type VerifiedVehicleStateField,
} from '@/api/hooks/useVehicles';
import { useFleetWorkOrders } from '@/api/hooks/useFleetOps';
import { usePinned } from '@/api/hooks/usePinned';
import { convertDistanceFromSI } from '@/lib/unitConversion';

import { formatObservationAge } from '@/lib/observationAge';
import { batteryColor, statusHexColor } from '@/lib/colors';
import { maskFor } from '@/lib/maskValue';
import { typography } from '@/lib/tokens';
import { cn } from '@/lib/cn';
import { statusVariant } from '@/api/types';
import type { Vehicle } from '@/types/vehicle';
import type { VehicleState, VehicleStateReadings } from '@/api/types';
import type { OperationalNarrative } from '@/types/operationalNarrative';
import { VisuallyHidden } from '@/components/a11y';
import { Icons } from '@/lib/icons';
import type { TFunction } from 'i18next';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { VehicleEvidenceBrief } from '../components/operationalbrief-n-z/VehicleEvidenceBrief';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

/* ── Types ─────────────────────────────────────────────────── */

/**
 * A fleet entry whose live state has resolved to an actual reading.
 *
 * Extends the wire entry rather than redefining it so the outcome/provenance
 * fields stay available to consumers that need to distinguish a fresh reading
 * from one retained through a failed refresh.
 */
type LoadedEntry = FleetStateEntry & { state: VehicleStateReadings };
const FLEET_VIRTUALIZATION_THRESHOLD = 24;

/* ── Preview trust helpers ─────────────────────────────────── */

/**
 * Render a preview field ONLY when that exact field is currently backed by
 * live telemetry.
 *
 * The drawer used to print every value straight off a retained `state`, so a
 * reading kept alive through a failed refresh looked exactly like a live one.
 * Tesla Fleet Telemetry is a sparse change feed: an em dash here means "not
 * currently verified", not "zero". The last known value is still surfaced —
 * in `detail`, explicitly labelled and dated — so nothing is hidden, it is
 * just no longer presented as current.
 */
function currentFieldValue(
  entry: FleetStateEntry | undefined,
  field: VerifiedVehicleStateField,
  render: (state: VehicleStateReadings) => string,
  t: TFunction,
): { value: string; detail?: string } {
  if (entry?.state == null) {
    return {
      value: '—',
      detail: t('vehicles.preview.noReading', 'No reading available for this vehicle'),
    };
  }
  if (isFleetStateFieldCurrent(entry, field)) {
    return { value: render(entry.state) };
  }
  const age = formatObservationAge(entry.observedAt, t);
  return {
    value: '—',
    detail: age
      ? t('vehicles.preview.lastKnownAged', 'Last known: {{value}} ({{age}}) — not currently verified', {
          value: render(entry.state),
          age,
        })
      : t('vehicles.preview.lastKnown', 'Last known: {{value}} — not currently verified', {
          value: render(entry.state),
        }),
  };
}

/** One-line trust summary shown at the top of the preview drawer. */
function previewTrustSummary(
  entry: FleetStateEntry | undefined,
  t: TFunction,
): { label: string; detail: string } {
  const descriptor = describeFleetState(entry);
  const age = formatObservationAge(descriptor.observedAt, t);
  const dated = (base: string) =>
    age
      ? t('vehicles.preview.observedAt', '{{summary}} · last real observation {{age}}', { summary: base, age })
      : t('vehicles.preview.observedUnknown', '{{summary}} · no verified observation time', { summary: base });

  switch (descriptor.condition) {
    case 'live':
      return {
        label: t('vehicles.preview.trust.live', 'Live'),
        detail: dated(t('vehicles.preview.trust.liveHelp', 'Current, verified telemetry')),
      };
    case 'unverified':
      return {
        label: t('vehicles.preview.trust.unverified', 'Unverified'),
        detail: dated(t(
          'vehicles.preview.trust.unverifiedHelp',
          'State returned, but nothing current backs it',
        )),
      };
    case 'stale':
      return {
        label: t('vehicles.preview.trust.stale', 'Last known'),
        detail: dated(t(
          'vehicles.preview.trust.staleHelp',
          'Refresh failed; a retained reading is being shown',
        )),
      };
    case 'failed':
      return {
        label: t('vehicles.preview.trust.failed', 'Unreachable'),
        detail: t(
          'vehicles.preview.trust.failedHelp',
          'The live-state request failed. This is a fact about our pipeline, not the vehicle.',
        ),
      };
    case 'missing':
      return {
        label: t('vehicles.preview.trust.missing', 'No state'),
        detail: t(
          'vehicles.preview.trust.missingHelp',
          'The backend answered and has no state yet. Unknown, not offline.',
        ),
      };
    default:
      return {
        label: t('vehicles.preview.trust.checking', 'Checking'),
        detail: t('vehicles.preview.trust.checkingHelp', 'Resolving live state…'),
      };
  }
}

/* ── Loading skeleton ──────────────────────────────────────── */

/**
 * Mirrors the redesigned bento layout while the fleet list loads: KPI band →
 * overview bento (hero battery + status) → responsive vehicle-card grid.
 * Rendered inside the shared PageLayout so the title bar appears instantly
 * and layout shift stays at zero when the real content arrives.
 */
function VehicleListSkeleton() {
  const { t } = useTranslation();
  return (
    <PageLayout
      title={t('nav.vehicles', 'Fleet')}
      subtitle={t('vehicles.subtitle', 'View, manage, and sync your Tesla vehicles')}
    >
      <div className="space-y-6" data-testid="vehicle-list-skeleton">
        <StatGridSkeleton cards={4} />
        <VehiclePanelGrid
          label={t('vehicles.overview', 'Fleet overview')}
          items={[
            { id: 'battery-loading', size: 'half', content: <Skeleton className="h-64 rounded-xl" /> },
            { id: 'status-loading', size: 'half', content: <Skeleton className="h-64 rounded-xl" /> },
          ]}
        />
        <VehiclePanelGrid
          label={t('vehicles.allVehicles', 'All vehicles')}
          items={Array.from({ length: 6 }, (_, i) => ({
            id: `vehicle-loading-${i}`, size: 'quarter',
            content: <Skeleton className="h-52 rounded-xl" />,
          }))}
        />
      </div>
    </PageLayout>
  );
}

/* ── Small building blocks ─────────────────────────────────── */

/** Compact icon + value chip used inside the vehicle card stat row. */
function StatChip({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-[var(--surface-2)] px-2 py-1',
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
  /** `null` when no vehicle reported a level. Rendered as an em dash, not 0 %. */
  avgBattery: number | null;
  /** `null` when no vehicle reported a rated range. */
  totalRange: number | null;
  chargingCount: number;
  chargingCoverageCount: number;
  sourceStatus: DataStatus;
}

/** Full-width responsive metric grid summarising the whole fleet. */
function FleetKpis({
  totalVehicles,
  avgBattery,
  totalRange,
  chargingCount,
  chargingCoverageCount,
  sourceStatus,
}: FleetKpisProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  return (
    <VehicleEvidenceBrief
      id="fleet-current-summary"
      title={t('vehicles.summarySnapshot', 'Current verified fleet readings')}
      description={t('vehicles.briefSummaryDescription', 'Registered vehicle count and independently verified battery, range, and charge-state readings. Missing coverage is not zero.')}
      status={sourceStatus === 'ok' && (chargingCoverageCount < totalVehicles || avgBattery == null || totalRange == null) ? 'partial' : sourceStatus}
      scope={t('vehicles.briefSummaryScope', 'Current field coverage differs by measurement; no common observation timestamp is supplied')}
      provenance={t('dataSources.labels.liveVehicleState', 'Live vehicle state')}
      metrics={[
        { metricId: 'count', occurrenceId: 'fleet-total', label: t('vehicles.totalVehicles', 'Total vehicles'), rawValue: totalVehicles },
        { metricId: 'percent', occurrenceId: 'fleet-average-battery', label: t('vehicles.avgBattery', 'Avg battery'),
          rawValue: avgBattery,
          display: { formatter: raw => ({ value: `${fmtNumber(raw)}%`, unit: '' }) } },
        { metricId: 'distance', occurrenceId: 'fleet-total-range',
          label: `${t('vehicles.totalRange', 'Total range')} (${unitPrefs.distance})`,
          rawValue: totalRange,
          display: { formatter: raw => ({ value: fmtNumber(convertDistanceFromSI(raw, unitPrefs.distance)), unit: '' }) } },
        { metricId: 'count', occurrenceId: 'fleet-charging-coverage', label: t('vehicles.chargingLiveState', 'Charging / live state'),
          rawValue: chargingCoverageCount === 0 ? null : chargingCount,
          display: { countTotal: chargingCoverageCount } },
      ]}
    />
  );
}

/* ── Fleet battery panel (hero) ────────────────────────────── */

interface FleetBatteryPanelProps {
  entries: LoadedEntry[];
  /** `null` when no vehicle reported a battery level — never coerced to 0. */
  avgBattery: number | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}

/** Per-vehicle battery bars — the hero panel of the overview bento. */
function FleetBatteryPanel({ entries, avgBattery, isLoading, isError, error, onRetry }: FleetBatteryPanelProps) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  // A failed refresh must not delete the readings already on screen: only
  // fall back to the error surface when there is genuinely nothing retained.
  const showErrorInstead = isError && entries.length === 0;
  return (
    <GlassPanel className="flex h-full flex-col p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('vehicles.batteryStatus', 'Fleet battery status')}
        </PanelTitle>
        <Text variant="bodySm">
          {avgBattery == null ? (
            <span aria-label={t('common.unknown', 'Unknown')}>—</span>
          ) : (
            <AnimatedNumber value={Math.round(avgBattery)} suffix="%" />
          )}{' '}
          {t('vehicles.avgLabel', 'avg')}
        </Text>
      </div>

      {showErrorInstead ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isLoading && entries.length === 0 ? (
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
            const label = vehicle.display_name || vehicle.vin;
            // An unreported state of charge is NOT 0 %. Rendering a full-width
            // empty bar for it would read as "this car is flat".
            const level = knownNumber(state.battery_level);
            const range = knownNumber(state.rated_range);
            if (level == null) {
              return (
                <div
                  key={vehicle.id}
                  className="flex items-center justify-between gap-3"
                  data-testid="fleet-battery-unknown"
                >
                  <Text as="span" variant="bodySm">{label}</Text>
                  <Text as="span" variant="bodySm" className="font-mono">
                    {t('vehicles.batteryUnknown', 'Not reported')}
                  </Text>
                </div>
              );
            }
            return (
              <MetricBar
                key={vehicle.id}
                label={label}
                value={level}
                max={100}
                color={batteryColor(level)}
                sublabel={`${level}% · ${range == null ? '—' : formatDistance(range)}`}
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
  currentCount: number;
  isLoading: boolean;
  /** Aggregate outcome of the per-vehicle fan-out. */
  summary: FleetStatesSummary;
  onRetry: () => void;
}

/**
 * Count-by-status breakdown.
 *
 * Two facts drive every branch, and both come from
 * {@link summariseFleetStates} rather than from the derived counts:
 *
 *   - `statefulCount` — how many vehicles have an ACTUAL reading. The counts
 *     array is built only from those, because `deriveVehicleStatus(null)`
 *     returns `'offline'` and would otherwise manufacture a confident
 *     "everything is offline" breakdown out of an unresolved batch.
 *   - `failedCount` — how many per-vehicle requests failed. `useFleetStates`
 *     resolves each vehicle independently and therefore never rejects, so
 *     `isError` is useless here: a total API outage arrives as a successful
 *     array of failures. This is the only signal that distinguishes it from a
 *     healthy fleet that simply has no snapshots yet.
 */
function FleetStatusPanel({
  counts, total, currentCount, isLoading, summary, onRetry,
}: FleetStatusPanelProps) {
  const { t } = useTranslation();
  const nothingResolved = summary.statefulCount === 0;
  // Transport failure with nothing to show → error surface. A successful
  // batch with no snapshots is a different, non-alarming state.
  const showErrorInstead = nothingResolved && summary.failedCount > 0;
  const showSkeleton = !showErrorInstead && nothingResolved && isLoading;
  const showCounts = counts.length > 0;
  const unresolved = summary.unresolvedCount;

  return (
    <GlassPanel className="flex h-full flex-col p-4 sm:p-5">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('vehicles.statusBreakdown', 'Fleet status')}
      </PanelTitle>

      {showErrorInstead ? (
        <QueryError
          error={new Error(t(
            'vehicles.statusUnavailable',
            'Live state could not be retrieved for any vehicle.',
          ))}
          onRetry={onRetry}
        />
      ) : showSkeleton ? (
        <div className="space-y-3" data-testid="fleet-status-skeleton">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 rounded-lg" />
          ))}
        </div>
      ) : !showCounts ? (
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
          {unresolved > 0 || summary.retainedCount > 0 || summary.unverifiedCount > 0 ? (
            <DataStateNotice
              state="partial"
              data-testid="fleet-status-partial"
              title={t(
                'vehicles.statusPartialTitle',
                'Breakdown covers {{resolved}} of {{total}} vehicles',
                { resolved: currentCount, total: summary.total },
              )}
            >
              {summary.failedCount > 0
                ? t(
                    'vehicles.statusPartialFailed',
                    '{{failed}} vehicle state request(s) failed. Unresolved vehicles are excluded from the breakdown rather than counted as offline.',
                    { failed: summary.failedCount },
                  )
                : summary.unverifiedCount > 0
                  ? t(
                      'vehicles.statusPartialUnverified',
                      '{{unverified}} vehicle(s) have retained state without a current live verification and are excluded from the breakdown.',
                      { unverified: summary.unverifiedCount },
                    )
                : t(
                    'vehicles.statusPartialMissing',
                    '{{missing}} vehicle(s) have not reported a snapshot yet and are excluded from the breakdown rather than counted as offline.',
                    { missing: summary.missingCount },
                  )}
            </DataStateNotice>
          ) : null}
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

/**
 * Per-card overflow menu: Quick view + Remove.
 *
 * The destructive Remove action used to sit one tap from the Quick view
 * icon as a tiny low-contrast glyph; burying it one level deep behind an
 * explicit menu (which still routes through the confirm dialog) makes
 * accidental removal much harder without hiding the action.
 */
function VehicleCardMenu({
  name,
  onPreview,
  onDelete,
}: {
  name: string;
  onPreview: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuLabel = t('vehicles.cardActions', 'Actions for {{name}}', { name });

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={menuLabel}
        title={menuLabel}
        className="min-h-11 min-w-11 p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      >
        <Icons.moreInline className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        align="end"
        ariaLabel={menuLabel}
        className="w-56 p-2"
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            onPreview();
          }}
          aria-label={t('vehicles.quickViewAria', 'Quick view {{name}}', { name })}
          className="w-full justify-start"
        >
          <Icons.show className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('common.quickView', 'Quick view')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            onDelete();
          }}
          aria-label={t('vehicles.removeAria', 'Remove {{name}}', { name })}
          className="w-full justify-start text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
        >
          <Icons.delete className="h-4 w-4" aria-hidden="true" />
          {t('vehicles.remove', 'Remove')}
        </Button>
      </Popover>
    </>
  );
}

interface VehicleCardProps {
  vehicle: Vehicle;
  entry: FleetStateEntry | undefined;
  onDelete: (vehicle: Vehicle) => void;
  onPreview: () => void;
}

/** One vehicle in the responsive fleet grid — all data + row actions. */
function VehicleCard({ vehicle, entry, onDelete, onPreview }: VehicleCardProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const state = entry?.state ?? null;
  const currentState = deriveCurrentVehicleStatus(entry) != null;

  // A vehicle with no reading is UNKNOWN, not offline. `deriveVehicleStatus`
  // maps null → 'offline', which turns "we could not reach the API" into a
  // confident operational claim about the car.
  const status = deriveCurrentVehicleStatus(entry);
  const statusLabel = status ?? t('vehicles.statusUnknown', 'Unknown');
  const level = knownNumber(state?.battery_level);
  const color = batteryColor(level ?? 0);
  const name = vehicle.display_name || maskFor(vehicle.vin ?? '', 'vin');
  const modelLine = [vehicle.model, vehicle.trim_badging].filter(Boolean).join(' ');

  return (
    <GlassPanel
      hover
      padding="none"
      data-tour="vehicles-card"
      className="group flex h-full flex-col overflow-hidden"
    >
      <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
        {/* Header — name, status, pin */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <PrefetchLink
                to={`/vehicles/${vehicle.id}`}
                className={cn(
                  typography.role.panelTitle,
                  'block min-h-11 max-w-full min-w-0 break-words rounded py-2 transition-colors hover:text-[var(--theme-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
                )}
              >
                {vehicle.display_name || maskFor(vehicle.vin ?? '', 'vin')}
              </PrefetchLink>
              <Badge variant={status != null ? statusVariant(status) : 'neutral'} dot size="sm">
                {statusLabel}
              </Badge>
              {state != null && !currentState ? (
                <Badge variant="neutral" size="sm">
                  {t('vehicles.lastKnown', 'Last known')}
                </Badge>
              ) : null}
            </div>
            <Text variant="caption" as="p" className="mt-1 break-words">
              {modelLine || t('vehicles.unknownModel', 'Unknown model')}
              {' · '}
              <MaskedValue
                value={vehicle.vin}
                variant="vin"
                copyable
                ariaLabel={t('vehicles.vinLabel', 'Vehicle identification number')}
              />
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
              {level == null ? (
                <span aria-label={t('vehicles.statusUnknown', 'Unknown')}>—</span>
              ) : (
                <AnimatedNumber value={level} suffix="%" />
              )}
            </Text>
          </div>
          <div
            role="progressbar"
            aria-valuenow={level ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('vehicles.batteryLevel', 'Battery level')}
            className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]"
          >
            <div
              className="h-full rounded-full transition-all duration-slow"
              style={{ width: `${level ?? 0}%`, backgroundColor: color }}
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
          <PrefetchLink
            to={`/vehicles/${vehicle.id}`}
            aria-label={t('vehicles.openDetail', 'Open {{name}} details', { name })}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-[var(--theme-primary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
              typography.size.sm,
              typography.weight.medium,
            )}
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            {t('vehicles.viewDetails', 'View details')}
          </PrefetchLink>
          <VehicleCardMenu
            name={name}
            onPreview={onPreview}
            onDelete={() => onDelete(vehicle)}
          />
        </div>
      </div>
    </GlassPanel>
  );
}

/* ── Page ──────────────────────────────────────────────────── */

export default function VehicleListPage() {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  usePageTitle(t('nav.vehicles', 'Fleet'));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { setVehicleId } = useSelectedVehicle();

  /* ── Data ── */
  const vehiclesQuery = useVehicles();
  const { data: vehicles, isLoading } = vehiclesQuery;
  const vehicleList = vehicles ?? [];
  // Trust contract for the fleet list: `fatalError` (nothing retained) gates
  // the page-level error surface, everything else degrades non-destructively.
  const vehiclesState = useDataState(vehiclesQuery);

  const statesQuery = useFleetStates(vehicleList);
  const fleetStates = statesQuery.data;
  /* Aggregate outcome of the per-vehicle fan-out. Everything on this page that
   * used to ask "is `state` null?" now asks this instead, because null covers
   * three different facts (resolved-offline, no-snapshot, request-failed). */
  const fleetSummary = useMemo(
    () => summariseFleetStates(fleetStates ?? []),
    [fleetStates],
  );
  /* Freshness must be driven by WHEN THE READINGS WERE OBSERVED, not by when
   * the wrapper batch resolved. `useFleetStates` resolves successfully even
   * when every request failed, so `statesQuery.dataUpdatedAt` advances on
   * every 30 s poll — a permanently failing fleet rendered a green
   * "updated just now" chip over readings that were hours old. This synthetic
   * source substitutes the oldest retained observation and re-injects the
   * failure the wrapper swallowed. */
  const fleetStateSource = useMemo(() => ({
    data: fleetStates,
    isPending: statesQuery.isPending,
    isFetching: statesQuery.isFetching,
    fetchStatus: statesQuery.fetchStatus,
    refetch: statesQuery.refetch,
    dataUpdatedAt: fleetSummary.oldestObservedAt ?? 0,
    isError: fleetSummary.failedCount > 0,
    error: fleetSummary.failedCount > 0
      ? new Error(t(
          'operations.vehicles.stateRequestFailed',
          'Live state could not be retrieved for {{count}} vehicle(s).',
          { count: fleetSummary.failedCount },
        ))
      : undefined,
  }), [fleetStates, statesQuery, fleetSummary, t]);
  /** Freshness chip input — same synthetic timestamps as the trust contract. */
  const fleetFreshnessQuery = useMemo(() => ({
    isFetching: statesQuery.isFetching,
    isStale:
      statesQuery.isStale ||
      fleetSummary.retainedCount > 0 ||
      fleetSummary.unverifiedCount > 0,
    isError: fleetSummary.failedCount > 0,
    dataUpdatedAt: fleetSummary.oldestObservedAt ?? 0,
    refetch: statesQuery.refetch,
  }), [statesQuery, fleetSummary]);
  // Live fleet state is pushed/polled current state, so its provenance is
  // `live` — and degrades to `cached` automatically once a refresh fails.
  // `useFleetStates` never rejects (per-vehicle failures are recorded in the
  // payload), so partial/unavailable have to be declared from the summary.
  const fleetStateData = useDataState(fleetStateSource, {
    provenance: 'live',
    partial: fleetSummary.status === 'partial',
    unavailable: fleetSummary.status === 'unavailable' || fleetSummary.status === 'absent',
  });
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
    const entries = fleetStates ?? [];
    // Every entry carrying a reading, including retained values shown on the
    // individual vehicle cards with an explicit "Last known" qualifier.
    const withState = entries.filter((e): e is LoadedEntry => e.state !== null);
    const currentFor = (field: keyof VehicleState) =>
      withState.filter((entry) => isFleetStateFieldCurrent(entry, field));
    const stateCurrent = withState.filter(
      (entry) => deriveCurrentVehicleStatus(entry) != null,
    );
    const batteryCurrent = currentFor('battery_level');
    const rangeCurrent = currentFor('rated_range');
    const chargingCurrent = currentFor('is_charging');
    const softwareCurrent = currentFor('software_version');

    // Vehicles that did not report a level are excluded from BOTH the
    // numerator and the denominator. Treating them as 0 % would drag the
    // fleet average toward zero and invent a low-battery alert.
    const levels = batteryCurrent
      .map((e) => knownNumber(e.state.battery_level))
      .filter((v): v is number => v != null);
    const avg = levels.length > 0
      ? levels.reduce((s, v) => s + v, 0) / levels.length
      : null;
    const ranges = rangeCurrent
      .map((e) => knownNumber(e.state.rated_range))
      .filter((v): v is number => v != null);
    const totalRange = ranges.length > 0 ? ranges.reduce((s, v) => s + v, 0) : null;
    const charging = chargingCurrent.filter((e) => e.state.is_charging).length;
    // "Ready" counts only FRESH readings that actually reported >= 20 %.
    const freshLevels = batteryCurrent
      .map((e) => knownNumber(e.state.battery_level))
      .filter((v): v is number => v != null);
    const ready = freshLevels.filter((v) => v >= 20).length;
    const active = stateCurrent.filter((entry) => {
      const status = deriveCurrentVehicleStatus(entry);
      return status === 'driving' || status === 'charging';
    }).length;
    const softwareVersions = new Set(
      softwareCurrent
        .map((entry) => entry.state.software_version?.trim())
        .filter((version): version is string => Boolean(version)),
    );
    return {
      entries: withState,
      batteryEntries: batteryCurrent,
      avgBattery: avg,
      totalRange,
      chargingCount: charging,
      chargingCoverageCount: chargingCurrent.length,
      /**
       * Vehicles for which a CURRENT state response is available. Named for
       * what it measures: `withState.length` also counted explicit
       * `offline`/`asleep` snapshots and retained stale readings as "online",
       * which is two separate lies in one number.
       */
      liveStateCount: stateCurrent.length,
      /** Denominator for every count derived from fresh readings. */
      coveredCount: stateCurrent.length,
      batteryCoverageCount: levels.length,
      softwareCoverageCount: softwareCurrent.length,
      readyCount: ready,
      activeCount: active,
      softwareVersions: [...softwareVersions].sort(),
    };
  }, [fleetStates]);

  /* O(1) fleet-entry lookup by vehicle id, shared by the status breakdown, the
     card grid and the preview drawer so none of them rescans the fleet-state
     array once per row.
     A vehicle absent from this map has NO reading — which is not the same as
     a reading that says "offline". The map holds the FULL entry (not a bare
     `state`) so every consumer keeps the outcome/freshness/verified-field
     provenance attached to the values it renders. */
  const entryById = useMemo(() => {
    const map = new Map<number, FleetStateEntry>();
    (fleetStates ?? []).forEach((entry) => map.set(entry.vehicle.id, entry));
    return map;
  }, [fleetStates]);
  const warmVisibleVehicles = useCallback(
    (visibleVehicles: readonly Vehicle[]) => {
      visibleVehicles.forEach((vehicle) => {
        queryClient.setQueryData<Vehicle>(
          vehicleKeys.detail(String(vehicle.id)),
          (existing) => existing ?? vehicle,
        );
      });
    },
    [queryClient],
  );
  const renderVehicleCard = useCallback(
    (vehicle: Vehicle) => (
      <VehicleCard
        vehicle={vehicle}
        entry={entryById.get(vehicle.id)}
        onDelete={setDeleteTarget}
        onPreview={() => {
          setPreviewVehicle(vehicle);
        }}
      />
    ),
    [entryById],
  );

  /* Count vehicles by derived status for the breakdown panel.
   *
   * Only vehicles with an ACTUAL reading are counted. `deriveVehicleStatus`
   * maps a null state to `'offline'`, so counting every vehicle here reported
   * a whole fleet as offline whenever the batch had not resolved — including
   * during a total API outage, which `useFleetStates` used to success-shape
   * into a full array of nulls. A vehicle is only offline when the backend
   * returned a snapshot saying so. */
  const statusCounts = useMemo<StatusCount[]>(() => {
    const counts = new Map<string, number>();
    for (const entry of fleetStates ?? []) {
      const status = deriveCurrentVehicleStatus(entry);
      if (status == null) continue;
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  }, [fleetStates]);
  const fleetStatePending = statesQuery.isLoading;
  /** No fresh reading for any vehicle ⇒ every derived count is unknowable. */
  const noCoverage = fleet.coveredCount === 0;
  const offlineCount = fleetStatePending
    ? 0
    : Math.max(0, vehicleList.length - fleet.liveStateCount);
  const lowBatteryCount = fleet.batteryEntries.filter(({ state }) => {
    // Only vehicles that actually reported a level can be "below 20 %".
    const level = knownNumber(state.battery_level);
    return level != null && level < 20;
  }).length;
  const openWorkOrders = workOrders.filter(
    (order) => order.status !== 'completed' && order.status !== 'cancelled',
  );
  const urgentWorkOrders = openWorkOrders.filter(
    (order) => order.severity === 'high' || order.severity === 'critical',
  );
  /**
   * Percentage of the COVERED fleet that is driving or charging.
   *
   * `null` when nothing is covered: with no fresh reading, "0 %" is not a
   * measurement, it is an assumption that every unreachable car is idle.
   * The denominator is the covered count, not the registered count, so a
   * partially-resolved batch reports a real ratio and discloses its coverage
   * rather than silently diluting itself toward zero.
   */
  const utilizationPct = fleet.coveredCount > 0
    ? Math.round((fleet.activeCount / fleet.coveredCount) * 100)
    : null;
  /** Rendered beneath any count whose denominator is narrower than the fleet. */
  const coverageNote = fleet.coveredCount < vehicleList.length
    ? t(
        'operations.vehicles.coverageNote',
        'Based on {{covered}} of {{total}} vehicles with a current reading.',
        { covered: fleet.coveredCount, total: vehicleList.length },
      )
    : '';
  const batteryCoverageNote = fleet.batteryCoverageCount < vehicleList.length
    ? t(
        'operations.vehicles.batteryCoverageNote',
        'Based on {{covered}} of {{total}} vehicles with a current battery reading.',
        { covered: fleet.batteryCoverageCount, total: vehicleList.length },
      )
    : '';
  const evidenceGap =
    fleet.coveredCount < vehicleList.length ||
    fleet.batteryCoverageCount < vehicleList.length ||
    fleet.softwareCoverageCount < vehicleList.length;
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
    ...(!fleetStatePending && evidenceGap && offlineCount === 0
      ? [{
          key: 'evidence-gap',
          title: t(
            'operations.vehicles.evidenceGapTitle',
            'Current fleet evidence is incomplete',
          ),
          description: t(
            'operations.vehicles.evidenceGapDescription',
            'Refresh vehicles without verified battery or software readings before making fleet-wide decisions.',
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
            'High- or critical-severity maintenance is still open in fleet operations.',
          ),
          tone: 'danger' as const,
        }]
      : []),
  ];
  const narrativeEvidence: OperationalNarrative['evidence'] = [
    ...vehicleList.slice(0, 4).map((vehicle) => {
      const entry = entryById.get(vehicle.id);
      const state = entry?.state ?? null;
      const observedAt = entry?.observedAt;
      const stateIsCurrent = entry != null && isFleetStateFieldCurrent(entry, 'state');
      const batteryIsCurrent = entry != null && isFleetStateFieldCurrent(entry, 'battery_level');
      return {
        id: `fleet-vehicle-${vehicle.id}`,
        summary: t(
          'operations.vehicles.narrative.vehicleSummary',
          '{{vehicle}}: {{state}}, battery {{battery}}.',
          {
            vehicle: vehicle.display_name,
            state:
              stateIsCurrent && state?.state
                ? state.state
                : t('operations.vehicles.narrative.stateUnavailable', 'live state unavailable'),
            battery:
              state != null && batteryIsCurrent
                ? `${fmtNumber(state.battery_level)}%`
                : '—',
          },
        ),
        observedAt:
          observedAt != null && Number.isFinite(observedAt)
            ? new Date(observedAt).toISOString()
            : null,
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
          'Open high- or critical-severity fleet operations work order.',
        ),
      },
    })),
  ];
  const narrative: OperationalNarrative = {
    whatChanged:
      fleet.batteryCoverageCount > 0
        ? t(
            'operations.vehicles.narrative.whatChanged',
            '{{online}} of {{total}} registered vehicles have current state; {{ready}} of {{batteryCovered}} with verified battery data are departure ready, and {{urgent}} urgent work orders remain open.',
            {
              online: fleet.liveStateCount,
              total: vehicleList.length,
              ready: fleet.readyCount,
              batteryCovered: fleet.batteryCoverageCount,
              urgent: urgentWorkOrders.length,
            },
          )
        : t(
            'operations.vehicles.narrative.whatChangedWithoutBattery',
            '{{online}} of {{total}} registered vehicles have current state; departure readiness is unknown because no battery reading is verified, and {{urgent}} urgent work orders remain open.',
            {
              online: fleet.liveStateCount,
              total: vehicleList.length,
              urgent: urgentWorkOrders.length,
            },
          ),
    whyItMatters:
      fleetAttention[0]?.description
      ?? t(
        'operations.vehicles.narrative.readyImpact',
        'Verified live state and service status support fleet dispatch decisions; unavailable evidence remains explicitly excluded.',
      ),
    confidence: {
      label:
        vehicleList.length > 0
        && fleet.liveStateCount === vehicleList.length
        && fleet.batteryCoverageCount === vehicleList.length
        && fleet.softwareCoverageCount === vehicleList.length
        && !workOrdersQuery.isError
          ? 'high'
          : fleet.liveStateCount > 0
            ? 'medium'
            : 'low',
      score: null,
      basis: [
        t(
          'operations.vehicles.narrative.liveBasis',
          'Live state resolved for {{online}} of {{total}} registered vehicles.',
          { online: fleet.liveStateCount, total: vehicleList.length },
        ),
        workOrdersQuery.isError
          ? t(
              'operations.vehicles.narrative.workOrderLimitedBasis',
              'Fleet operations work orders were unavailable.',
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
            'Review the urgent fleet operations work orders before assigning affected vehicles.',
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
            : evidenceGap
              ? t(
                  'operations.vehicles.narrative.evidenceGapResponse',
                  'Refresh vehicles without verified state, battery, or software evidence before making fleet-wide readiness decisions.',
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
              'Service readiness is incomplete while fleet operations work orders are unavailable.',
            ),
          ]
        : []),
      ...(evidenceGap
        ? [
            t(
              'operations.vehicles.narrative.coverageLimitation',
              'Fleet-wide conclusions are limited because one or more vehicles lack verified current state, battery, or software evidence.',
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
  const [previewVehicle, setPreviewVehicle] = useState<Vehicle | null>(null);
  // Selection survives refreshes, but its trust entry must follow the current
  // batch so an already-open drawer cannot keep certifying an old Live value.
  const previewTarget = previewVehicle ? {
    vehicle: vehicleList.find((vehicle) => vehicle.id === previewVehicle.id) ?? previewVehicle,
    entry: entryById.get(previewVehicle.id),
  } : null;
  /* Status and trust for the drawer come from the SHARED contract, so the
   * preview can never claim a retained reading is the vehicle's current
   * state — the exact defect this replaces. */
  const previewStatus = deriveCurrentVehicleStatus(previewTarget?.entry);
  const previewTrust = previewTrustSummary(previewTarget?.entry, t);

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

  const postureMetrics = useOperationalMetrics([
    { metricId: 'count', occurrenceId: 'vehicles', rawValue: vehicleList.length },
    { metricId: 'count', occurrenceId: 'online', rawValue: fleetStatePending || noCoverage ? null : fleet.liveStateCount,
      display: { formatter: raw => ({ value: `${raw}/${vehicleList.length}`, unit: '' }) } },
    { metricId: 'count', occurrenceId: 'readiness', rawValue: fleetStatePending || fleet.batteryCoverageCount === 0 ? null : fleet.readyCount,
      display: { formatter: raw => ({ value: `${raw}/${fleet.batteryCoverageCount}`, unit: '' }) } },
    { metricId: 'percent', occurrenceId: 'utilization', rawValue: fleetStatePending ? null : utilizationPct,
      display: { formatter: raw => ({ value: `${raw}%`, unit: '' }) } },
    { metricId: fleet.softwareVersions.length === 1 ? 'text' : 'count', occurrenceId: 'software',
      rawValue: fleetStatePending || fleet.softwareVersions.length === 0 ? null
        : fleet.softwareVersions.length === 1 ? fleet.softwareVersions[0] : fleet.softwareVersions.length,
      display: { formatter: raw => ({
        value: t('operations.vehicles.softwareVersionCount', '{{count}} versions', { count: raw }), unit: '',
      }) } },
    { metricId: 'count', occurrenceId: 'service',
      rawValue: workOrdersQuery.isLoading || workOrdersQuery.isError ? null : openWorkOrders.length,
      display: { formatter: raw => ({
        value: t('operations.vehicles.openWorkOrders', '{{count}} open', { count: raw }), unit: '',
      }) } },
  ]);

  /* ── Loading / error short-circuits ── */
  if (isLoading) {
    return <VehicleListSkeleton />;
  }

  // Only an initial failure — one with NOTHING retained — may replace the
  // page. A background refetch error over a populated fleet keeps the fleet
  // on screen and is surfaced by <StaleRefreshWarning> below instead.
  if (vehiclesState.status === 'initialFailure') {
    return (
      <PageLayout
        title={t('nav.vehicles', 'Fleet')}
        subtitle={t('vehicles.subtitle', 'View, manage, and sync your Tesla vehicles')}
      >
        <GlassPanel className="p-4 sm:p-5">
          <QueryError
            error={vehiclesState.fatalError}
            onRetry={() => vehiclesQuery.refetch()}
            resourceName={t('nav.vehicles', 'Fleet')}
          />
        </GlassPanel>
      </PageLayout>
    );
  }

  /* ── Render ── */
  return (
    <PageLayout
      title={t('nav.vehicles', 'Fleet')}
      subtitle={t('vehicles.subtitle', 'View, manage, and sync your Tesla vehicles')}
      query={[vehiclesQuery, fleetFreshnessQuery, workOrdersQuery]}
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
      <StaleRefreshWarning
        state={vehiclesState}
        label={t('nav.vehicles', 'Fleet')}
      />
      <StaleRefreshWarning
        state={fleetStateData}
        label={t('dataSources.labels.liveVehicleState', 'Live vehicle state')}
      />

      {vehicleList.length === 0 && (
        <GlassPanel padding="md">
          <EmptyState
          icon={<Car className="h-10 w-10" />}
          title={t('vehicles.emptyTitle', 'No vehicles yet')}
          message={t(
            'vehicles.emptyMessage',
            'Connect your Tesla account and sync your vehicles to get started with fleet tracking, battery monitoring, and trip analysis.',
          )}
          action={{ label: t('vehicles.syncButton', 'Sync from Tesla'), onClick: handleSync }}
          />
        </GlassPanel>
      )}
      <VehiclePanelGrid
        label={t('operations.vehicles.title', 'Availability and readiness across the fleet')}
        items={[{ id: 'fleet-operational-posture', size: 'full', content: vehicleList.length > 0 ? (
          <OperationalBrief
            compact
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
                : fleetAttention.length > 0 || evidenceGap
                ? t('operations.status.review', 'Review recommended')
                : t('operations.status.ready', 'Fleet ready')
            }
            statusTone={
              fleetStatePending
                ? 'neutral'
                : fleetAttention.length > 0 || evidenceGap
                  ? 'warning'
                  : 'success'
            }
            narrative={narrative}
            freshness={
              <div className="flex flex-wrap items-center gap-2">
                <DataProvenanceBadge
                  provenance={fleetStateData.provenance}
                  status={fleetStateData.status}
                  updatedAt={fleetStateData.updatedAt}
                />
                <DataProvenanceBadge provenance="historical" />
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
                label: t('vehicles.totalVehicles', 'Total vehicles'),
                value: postureMetrics[0].value,
                rawValue: postureMetrics[0].rawValue,
                valueState: postureMetrics[0].valueState,
                detail: t(
                  'operations.vehicles.totalDetail',
                  'Vehicles currently registered in this TeslaSync workspace.',
                ),
                tone: 'info',
              },
              {
                key: 'online',
                label: t('operations.vehicles.online', 'Live state available'),
                value: postureMetrics[1].value,
                rawValue: postureMetrics[1].rawValue,
                valueState: postureMetrics[1].valueState,
                detail: t(
                  'operations.vehicles.onlineDetail',
                  'Vehicles with a current state response available.',
                ),
                tone: fleetStatePending || noCoverage
                  ? 'neutral'
                  : offlineCount > 0
                    ? 'warning'
                    : 'success',
              },
              {
                key: 'readiness',
                label: t('operations.vehicles.readiness', 'Departure ready'),
                // Without a fresh reading for ANY vehicle, "0/N ready" is an
                // assertion that the fleet cannot depart — from no evidence.
                value: postureMetrics[2].value,
                rawValue: postureMetrics[2].rawValue,
                valueState: postureMetrics[2].valueState,
                detail: [
                  t(
                    'operations.vehicles.readinessDetail',
                    'Vehicles reporting live state with at least 20% battery.',
                  ),
                  batteryCoverageNote,
                ].filter(Boolean).join(' '),
                tone: fleetStatePending || fleet.batteryCoverageCount === 0
                  ? 'neutral'
                  : fleet.readyCount < fleet.batteryCoverageCount
                    ? 'warning'
                    : 'success',
              },
              {
                key: 'utilization',
                label: t('operations.vehicles.utilization', 'Live utilization'),
                value: postureMetrics[3].value,
                rawValue: postureMetrics[3].rawValue,
                valueState: postureMetrics[3].valueState,
                detail: [
                  t(
                    'operations.vehicles.utilizationDetail',
                    '{{active}} of {{total}} registered vehicles are driving or charging now.',
                    { active: fleet.activeCount, total: fleet.coveredCount },
                  ),
                  coverageNote,
                ].filter(Boolean).join(' '),
                tone: fleetStatePending || utilizationPct == null ? 'neutral' : 'info',
              },
              {
                key: 'software',
                label: t('operations.vehicles.softwarePosture', 'Software posture'),
                value: postureMetrics[4].value,
                rawValue: postureMetrics[4].rawValue,
                valueState: postureMetrics[4].valueState,
                detail: t(
                  'operations.vehicles.softwareCoverageDetail',
                  'Based on {{covered}} of {{total}} vehicles with a current software reading.',
                  {
                    covered: fleet.softwareCoverageCount,
                    total: vehicleList.length,
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
                value: postureMetrics[5].value,
                rawValue: postureMetrics[5].rawValue,
                valueState: postureMetrics[5].valueState,
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
              'Based on the registered fleet, the latest independently resolved live state for each vehicle, and fleet operations work orders.',
            )}
          />
        ) : (
          <GlassPanel padding="md">
            {/* // no-action: No registered fleet to assess; the header and fleet-empty Sync from Tesla controls recover this source. */}
            <EmptyState message={t('vehicles.layout.noSectionRecords', 'No fleet records for {{section}}.', {
              section: t('operations.vehicles.eyebrow', 'Fleet posture'),
            })} />
          </GlassPanel>
        ) }]}
      />

          {/* 1 — KPI band */}
          <FadeIn delay={0.05}>
            <Section id="fleet-summary" title={t('vehicles.summary', 'Fleet summary')}>
            {vehicleList.length === 0 ? (
              // no-action: Summary needs registered vehicles; use the existing header or fleet-empty Sync from Tesla action.
              <GlassPanel padding="md"><EmptyState message={t('vehicles.layout.noSectionRecords', 'No fleet records for {{section}}.', {
                section: t('vehicles.summary', 'Fleet summary'),
              })} /></GlassPanel>
            ) : fleetStatePending ? (
              <StatGridSkeleton cards={4} />
            ) : (
              <FleetKpis
                totalVehicles={vehicleList.length}
                avgBattery={fleet.avgBattery}
                totalRange={fleet.totalRange}
                chargingCount={fleet.chargingCount}
                chargingCoverageCount={fleet.chargingCoverageCount}
                sourceStatus={fleetStateData.status}
              />
            )}
            </Section>
          </FadeIn>

          {/* 2 — Existing surface-owning panels, composed by the shared grid. */}
          <Section id="fleet-overview" title={t('vehicles.overview', 'Fleet overview')}>
            {vehicleList.length > 0 ? (
            <VehiclePanelGrid
              label={t('vehicles.overview', 'Fleet overview')}
              items={[
                { id: 'fleet-battery', size: 'half', content: <FadeIn delay={0.1} className="h-full">
                <FleetBatteryPanel
                  entries={fleet.batteryEntries}
                  avgBattery={fleet.avgBattery}
                  isLoading={statesQuery.isLoading}
                  isError={fleetSummary.failedCount > 0}
                  error={statesQuery.error ?? new Error(t(
                    'vehicles.statusUnavailable',
                    'Live state could not be retrieved for any vehicle.',
                  ))}
                  onRetry={() => statesQuery.refetch()}
                />
              </FadeIn> },
                { id: 'fleet-status', size: 'half', content: <FadeIn delay={0.15} className="h-full">
                <FleetStatusPanel
                  counts={statusCounts}
                  total={vehicleList.length}
                  currentCount={fleet.coveredCount}
                  isLoading={statesQuery.isLoading}
                  summary={fleetSummary}
                  onRetry={() => statesQuery.refetch()}
                />
              </FadeIn> },
              ]}
            />
            ) : (
              // no-action: Overview has no fleet to inspect; existing page-level Sync from Tesla controls already recover registration.
              <GlassPanel padding="md"><EmptyState message={t('vehicles.layout.noSectionRecords', 'No fleet records for {{section}}.', {
                section: t('vehicles.overview', 'Fleet overview'),
              })} /></GlassPanel>
            )}
          </Section>

          {/* 3 — All vehicles: responsive full-width card grid */}
          <Section id="all-vehicles" title={t('vehicles.allVehicles', 'All vehicles')}>
            <div data-tour="vehicles-list" className="min-w-0">
            {sortedVehicleList.length > FLEET_VIRTUALIZATION_THRESHOLD ? (
              <VirtualizedVehicleGrid
                vehicles={sortedVehicleList}
                label={t('vehicles.virtualizedFleetLabel', 'Vehicle fleet')}
                renderVehicle={renderVehicleCard}
                onVisibleVehiclesChange={warmVisibleVehicles}
              />
            ) : (
              <StaggerContainer>
                <VehiclePanelGrid
                  label={t('vehicles.virtualizedFleetLabel', 'Vehicle fleet')}
                  items={sortedVehicleList.map((vehicle) => ({
                    id: `vehicle-${vehicle.id}`, size: 'quarter',
                    content: <StaggerItem className="h-full">{renderVehicleCard(vehicle)}</StaggerItem>,
                  }))}
                />
              </StaggerContainer>
            )}
            {sortedVehicleList.length === 0 && (
              // no-action: This is an empty registered fleet, not a local filter; header and fleet-empty Sync from Tesla already provide recovery.
              <GlassPanel padding="md"><EmptyState message={t('vehicles.layout.noSectionRecords', 'No fleet records for {{section}}.', {
                section: t('vehicles.allVehicles', 'All vehicles'),
              })} /></GlassPanel>
            )}
            </div>
          </Section>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        loading={deleteMut.isPending}
        title={t('vehicles.removeTitle', 'Remove vehicle')}
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
        onClose={() => setPreviewVehicle(null)}
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
            ? previewStatus ?? t('vehicles.statusUnknown', 'Unknown')
            : undefined
        }
        statusTone={previewStatus != null ? statusVariant(previewStatus) : 'neutral'}
        fields={
          previewTarget
            ? [
                {
                  key: 'telemetry',
                  label: t('vehicles.preview.telemetry', 'Telemetry'),
                  value: previewTrust.label,
                  detail: previewTrust.detail,
                },
                {
                  key: 'battery',
                  label: t('vehicles.battery', 'Battery'),
                  ...currentFieldValue(
                    previewTarget.entry,
                    'battery_level',
                    (state) => (state.battery_level != null
                      ? `${fmtNumber(state.battery_level)}%`
                      : '—'),
                    t,
                  ),
                },
                {
                  key: 'range',
                  label: t('vehicles.range', 'Range'),
                  ...currentFieldValue(
                    previewTarget.entry,
                    'rated_range',
                    (state) => (state.rated_range != null
                      ? formatDistance(state.rated_range)
                      : '—'),
                    t,
                  ),
                },
                {
                  key: 'odometer',
                  label: t('vehicles.odometer', 'Odometer'),
                  ...currentFieldValue(
                    previewTarget.entry,
                    'odometer',
                    (state) => (state.odometer != null
                      ? formatDistance(state.odometer)
                      : '—'),
                    t,
                  ),
                },
                {
                  key: 'software',
                  label: t('vehicles.software', 'Software'),
                  ...currentFieldValue(
                    previewTarget.entry,
                    'software_version',
                    (state) => state.software_version || '—',
                    t,
                  ),
                },
                {
                  key: 'security',
                  label: t('vehicles.preview.security', 'Security'),
                  ...currentFieldValue(
                    previewTarget.entry,
                    'is_locked',
                    (state) => (state.is_locked
                      ? t('vehicles.locked', 'Locked')
                      : t('vehicles.unlocked', 'Unlocked')),
                    t,
                  ),
                },
                {
                  key: 'charging',
                  label: t('vehicles.preview.charging', 'Charging'),
                  ...currentFieldValue(
                    previewTarget.entry,
                    'is_charging',
                    (state) => (state.is_charging
                      ? t('common.active', 'Active')
                      : t('common.inactive', 'Inactive')),
                    t,
                  ),
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
                  to: '/notifications/inbox',
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
    </PageLayout>
  );
}
