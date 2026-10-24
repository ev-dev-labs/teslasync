import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFleetStates, useVehicles } from '@/api/hooks/useVehicles';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useDataState } from '@/hooks/useDataState';
import { useTicker } from '@/hooks/useTicker';
import { combineDataStates } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS } from '@/lib/constants';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { PrefetchLink } from '@/components/layout';
import { VisuallyHidden } from '@/components/a11y';
import { Icons } from '@/lib/icons';
import { cn } from '@/lib/cn';
import { buildFleetPosture, formatObservationAge, type VehiclePosture } from '../components/fleet-posture';
import { WidgetBigNumber, WidgetDetailCard, type DetailEntry } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function FleetPostureWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const vehicles = safeArray(vehiclesQuery.data);
  const fleetStates = useFleetStates(vehicles);
  const { vehicleId: selectedVehicleId } = useSelectedVehicle();
  const scopedId = vehicleId ?? selectedVehicleId;
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === scopedId) ?? null;
  const discoveryState = useDataState(vehiclesQuery);
  const entries = safeArray(fleetStates.data);
  const fleetState = useDataState(
    vehicles.length === 0 && discoveryState.hasData
      ? { ...fleetStates, data: [] }
      : fleetStates,
    {
      provenance: entries.every((entry) => entry.freshness === 'fresh') ? 'live' : 'cached',
      partial: vehicles.length > 0 && (entries.length < vehicles.length || entries.some((entry) => entry.state == null || entry.stale)),
      unavailable: vehicles.length === 0 && discoveryState.hasData,
    },
  );
  const states = vehicles.length > 0 ? [discoveryState, fleetState] : [discoveryState];
  const retry = () => {
    void vehiclesQuery.refetch();
    if (vehicles.length > 0) void fleetStates.refetch();
  };
  const dataState = {
    ...combineDataStates(states),
    data: vehiclesQuery.data,
    hasData: states.some((state) => state.hasData),
    retry,
  };

  // Age labels (newest evidence + per-vehicle last-seen) read the clock at
  // render time; the shared 30s ticker keeps them honest between polls.
  useTicker();

  const posture = useMemo(
    () => buildFleetPosture(vehicles, fleetStates.data, Date.now(), fleetStates.summary),
    [vehicles, fleetStates.data, fleetStates.summary],
  );
  const resolving = fleetStates.isPending || posture.pending;
  const totalsPending = resolving && !posture.fromServerSummary;
  const isError = fleetStates.isError;

  const headline = totalsPending
    ? t('dashboard.fleetPosture.headline.resolving', 'Resolving live state for {{count}} vehicle(s).', {
      count: posture.total,
    })
    : isError
      ? t(
        'dashboard.fleetPosture.headline.unavailable',
        'Live state could not be read. Showing the last known readings, which are no longer being refreshed.',
      )
      : posture.attentionCount > 0
        ? t(
          'dashboard.fleetPosture.headline.attention',
          '{{verified}} of {{total}} vehicles verified. {{attention}} need attention.',
          {
            verified: posture.verifiedCount,
            total: posture.total,
            attention: posture.attentionCount,
          },
        )
        : t('dashboard.fleetPosture.headline.ok', 'All {{total}} vehicles verified from current telemetry.', {
          total: posture.total,
        });

  const pill = totalsPending
    ? { text: t('dashboard.fleetPosture.badge.resolving', 'Checking live state'), variant: 'neutral' as const }
    : isError
      ? { text: t('dashboard.fleetPosture.badge.unavailable', 'Live state unavailable'), variant: 'warning' as const }
      : posture.attentionCount > 0
        ? {
          text: t('dashboard.fleetPosture.badge.attention', '{{count}} need attention', { count: posture.attentionCount }),
          variant: 'warning' as const,
        }
        : { text: t('dashboard.fleetPosture.badge.fresh', 'Fresh'), variant: 'success' as const };

  const coveragePct = posture.total > 0 ? Math.round((posture.verifiedCount / posture.total) * 100) : 0;
  const newestAge = formatObservationAge(posture.summary.newestObservedAt, t);
  const scopeVehicle = selectedVehicle ?? vehicles[0] ?? null;

  const orderedVehicles = useMemo(() => {
    if (scopeVehicle == null) return posture.vehicles;
    return [...posture.vehicles].sort((a, b) => {
      if (a.vehicle.id === scopeVehicle.id) return -1;
      if (b.vehicle.id === scopeVehicle.id) return 1;
      return 0;
    });
  }, [posture.vehicles, scopeVehicle]);

  const rowEntries: DetailEntry[] = orderedVehicles.map((row) => ({
    id: row.vehicle.id,
    label: row.vehicle.display_name || row.vehicle.vin || t('dashboard.fleetPosture.unnamedVehicle', 'Selected vehicle'),
    sublabel: rowSublabel(row, t),
    value: '',
    status: rowDotStatus(row),
    badge: scopeVehicle != null && row.vehicle.id === scopeVehicle.id
      ? { text: t('dashboard.fleetPosture.row.active', 'Active'), variant: 'info' as const }
      : undefined,
  }));

  return (
    <WidgetShell
      dataState={dataState}
      updatedAt={fleetStates.dataUpdatedAt ?? 0}
      isFetching={vehiclesQuery.isFetching || fleetStates.isFetching}
      isStale={vehiclesQuery.isStale || fleetStates.isStale || entries.some((entry) => entry.stale)}
      isError={vehiclesQuery.isError || fleetStates.isError}
      refreshIntervalMs={INTERVALS.STANDARD}
      onRefresh={retry}
      help={{
        i18nKey: 'dashboard.fleetPosture.help',
        defaultValue: 'Verified live-state coverage and evidence age across your fleet.',
      }}
      title={t('dashboard.fleetPosture.title', 'Fleet posture')}
      footer={scopeVehicle != null ? (
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 truncate text-xs text-[var(--text-muted)]">{headline}</span>
          <PrefetchLink
            to={`/vehicles/${scopeVehicle.id}`}
            className={cn(
              'inline-flex shrink-0 items-center gap-1 text-xs font-medium',
              'text-[var(--accent-primary)] hover:underline',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
            )}
          >
            {t('dashboard.fleetPosture.openVehicle', 'Open vehicle')}
            <Icons.drillThrough className="h-3 w-3" aria-hidden="true" />
          </PrefetchLink>
        </div>
      ) : undefined}
    >
      <section aria-label={t('dashboard.fleetPosture.title', 'Fleet posture')} className="min-w-0" data-testid="fleet-posture">
        {/* Posture changes are announced, not just repainted. */}
        <VisuallyHidden as="p" liveRegion data-testid="fleet-posture-announcement">
          {headline}
        </VisuallyHidden>

        {posture.total === 0 && !totalsPending ? (
          <EmptyState
            /* no-action: empty fleet — vehicles appear here once registered; no widget-local recovery action */
            message={t('dashboard.fleetPosture.emptyFleet', 'No vehicles registered yet. Vehicles will appear here once they are added to your fleet.')}
            className="py-4"
          />
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <WidgetBigNumber
                value={totalsPending ? null : posture.verifiedCount}
                unit={posture.total > 0 ? `/ ${posture.total}` : undefined}
                label={t('dashboard.fleetPosture.metric.verified', 'Verified')}
                animated={false}
              />
              <Badge variant={pill.variant} size="sm">{pill.text}</Badge>
            </div>

            <div>
              <div
                role="meter"
                aria-label={t('dashboard.fleetPosture.coverage', 'Coverage')}
                aria-valuenow={totalsPending ? undefined : coveragePct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuetext={totalsPending ? undefined : `${coveragePct}%`}
                className="h-2 w-full min-w-0 overflow-hidden rounded-full bg-[var(--surface-2)]"
              >
                <div
                  className="h-full rounded-full bg-[var(--semantic-success)] transition-all duration-slow motion-reduce:transition-none"
                  style={{ width: `${totalsPending ? 0 : coveragePct}%` }}
                />
              </div>
              <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
                <span className="tabular-nums">
                  {t('dashboard.fleetPosture.coverageLabel', 'Coverage {{pct}}%', { pct: totalsPending ? '—' : coveragePct })}
                </span>
                <span className="min-w-0 truncate text-end">
                  {newestAge
                    ? t('dashboard.fleetPosture.newestEvidence', 'Newest evidence {{age}}', { age: newestAge })
                    : t('dashboard.fleetPosture.metric.oldestNone', 'no verified observation')}
                </span>
              </div>
            </div>

            <WidgetDetailCard
              entries={rowEntries}
              emptyMessage={t('dashboard.fleetPosture.emptyFleet', 'No vehicles registered yet. Vehicles will appear here once they are added to your fleet.')}
            />
          </div>
        )}
      </section>
    </WidgetShell>
  );
}

function rowDotStatus(row: VehiclePosture): DetailEntry['status'] {
  switch (row.category) {
    case 'reporting':
      return 'success';
    case 'offline':
      return 'neutral';
    case 'unverified':
    case 'stale':
      return 'warning';
    case 'failed':
      return 'error';
    case 'missing':
      return 'info';
    default:
      return 'neutral';
  }
}

function rowSublabel(row: VehiclePosture, t: ReturnType<typeof useTranslation>['t']): string {
  const age = formatObservationAge(row.observedAt, t);
  if (row.category === 'pending') {
    return t('dashboard.fleetPosture.scope.checking', 'Checking');
  }
  if (row.verified && row.status != null) {
    return `${row.status} · ${t('dashboard.fleetPosture.row.telemetryLive', 'telemetry live')}`;
  }
  const categoryFallback: Record<string, string> = {
    reporting: 'Reporting',
    offline: 'Offline',
    unverified: 'Unverified',
    stale: 'Last known',
    missing: 'No state',
    failed: 'Unreachable',
  };
  const categoryLabel = t(`dashboard.fleetPosture.category.${row.category}`, categoryFallback[row.category] ?? row.category);
  return age ? `${categoryLabel} · ${t('dashboard.fleetPosture.row.lastSeen', 'last seen {{age}}', { age })}` : categoryLabel;
}
