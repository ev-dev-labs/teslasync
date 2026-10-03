import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigation, MapPin, Clock, Zap, Route } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useTrips } from '@/api/hooks/useTrips';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { formatDurationRange } from '@/lib/dateFormat';

import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetStatGrid } from './shared';
import { dashboardTokens } from '../lib/dashboardTokens';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/**
 * Resolve a human-readable trip label. A trip can arrive with a `null`,
 * empty, or whitespace-only `name`; all of those collapse to the shared
 * "unnamed" fallback so a row never renders a blank line.
 */
function tripName(name: string | null | undefined, fallback: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed.length > 0 ? trimmed : fallback;
}

export default function TripSummaryWidget({ size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const { formatDateShort: formatDate } = useDateFormat();

  const query = useTrips({ limit: 5 });
  const { data, isLoading, isFetching, isStale, isError, error, dataUpdatedAt, refetch } = query;
  const trust = useDataState({ ...query, data: data ?? undefined }, { provenance: 'historical' });

  const trips = useMemo(() => data ?? [], [data]);
  const lastTrip = trips[0] ?? null;
  const recentTrips = trips.slice(0, 3);

  const isCompact = size.cols <= 1;

  const displayDist = (meters: number | null | undefined) => {
    const value = knownNumber(meters);
    return value == null ? '—' : `${fmtNumber(convertDistanceFromSI(value, distanceUnit))} ${distanceUnit}`;
  };
  const count = (value: unknown) => knownNumber(value) == null ? '—' : fmtInt(knownNumber(value));

  return (
    <WidgetShell
      title={t('widget.tripSummary', 'Trip summary')}
      icon={<Navigation className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      dataState={data != null || isLoading || isError || error ? trust : undefined}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {trips.length === 0 ? (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Navigation className="h-5 w-5" />}
          message={t('widget.noTrips', 'No trips recorded yet')}
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          {/* Last trip summary */}
          {lastTrip && (
            <div className="min-w-0 space-y-2">
              <div className="flex items-center gap-1.5 mb-2">
                <Badge className="text-2xs">
                  {t('widget.lastTrip', 'Last trip')}
                </Badge>
                <span className={dashboardTokens.unit}>
                  {formatDate(lastTrip.start_date)}
                </span>
              </div>

              {/* Start → End */}
              <p className={dashboardTokens.title}>
                {tripName(lastTrip.name, t('widget.tripUnnamed', 'Unnamed trip'))}
              </p>

              {/* Stats grid */}
              <WidgetStatGrid cols={isCompact ? 2 : 4} stats={[
                { label: t('widget.distance', 'Distance'), value: displayDist(lastTrip.total_distance_m), icon: <MapPin className="h-3 w-3" /> },
                { label: t('widget.duration', 'Duration'), value: formatDurationRange(lastTrip.start_date, lastTrip.end_date), icon: <Clock className="h-3 w-3" /> },
                { label: t('widget.drives', 'Drives'), value: count(lastTrip.drive_count), icon: <Route className="h-3 w-3" /> },
                { label: t('widget.chargeStops', 'Charge stops'), value: count(lastTrip.charge_count), icon: <Zap className="h-3 w-3" /> },
              ]} />
            </div>
          )}

          {/* Recent trips list */}
          {recentTrips.length > 1 && (
            <div className="min-w-0 space-y-1.5">
              <h4 className={dashboardTokens.metricLabel}>
                {t('widget.recentTrips', 'Recent trips')}
              </h4>
              {recentTrips.slice(1).map((trip) => (
                <div
                  key={trip.id}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className={dashboardTokens.metricLabel}>
                      {tripName(trip.name, t('widget.tripUnnamed', 'Unnamed trip'))}
                    </p>
                    <p className={dashboardTokens.unit}>
                      {formatDate(trip.start_date)}
                    </p>
                  </div>
                  {!isCompact && (
                    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                      <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                        {displayDist(trip.total_distance_m)}
                      </span>
                      <span className="text-2xs text-[var(--text-muted)] tabular-nums">
                        {formatDurationRange(trip.start_date, trip.end_date)}
                      </span>
                      <Badge className="text-2xs">
                        {count(trip.drive_count)} {t('widget.drivesShort', 'drv')}
                      </Badge>
                    </div>
                  )}
                  {isCompact && (
                    <span className="text-xs text-[var(--text-secondary)] tabular-nums flex-shrink-0 ml-2">
                      {displayDist(trip.total_distance_m)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </WidgetShell>
  );
}
