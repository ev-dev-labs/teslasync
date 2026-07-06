import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigation, MapPin, Clock, Zap, Route } from 'lucide-react';
import { Badge } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useTrips } from '@/api/hooks/useTrips';
import { useUnits } from '@/hooks/useUnits';
import { formatDurationRange } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';

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
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const { formatDateShort: formatDate } = useDateFormat();

  const { data, isLoading, isFetching, isStale, isError, error, dataUpdatedAt, refetch } =
    useTrips({ limit: 5 });

  const trips = useMemo(() => data ?? [], [data]);
  const lastTrip = trips[0] ?? null;
  const recentTrips = trips.slice(0, 3);

  const isCompact = size.cols <= 1;

  const displayDist = (meters: number | null | undefined) =>
    convertDistanceFromSI(meters ?? 0, distanceUnit);

  return (
    <WidgetShell
      title={t('widget.tripSummary', 'Trip Summary')}
      icon={<Navigation className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      error={error ? String(error) : null}
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
        <div className="flex flex-col gap-3 h-full">
          {/* Last trip summary */}
          {lastTrip && (
            <div className="rounded-lg bg-white/[0.03] p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Badge className="text-2xs">
                  {t('widget.lastTrip', 'Last Trip')}
                </Badge>
                <span className="text-2xs text-[var(--text-muted)]">
                  {formatDate(lastTrip.start_date)}
                </span>
              </div>

              {/* Start → End */}
              <p className="text-xs text-[var(--text-secondary)] truncate mb-2">
                {tripName(lastTrip.name, t('widget.tripUnnamed', 'Unnamed trip'))}
              </p>

              {/* Stats grid */}
              <div className={isCompact ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-4 gap-2'}>
                <StatCard
                  label={t('widget.distance', 'Distance')}
                  value={`${fmtNumber(displayDist(lastTrip.total_distance_m), 1)} ${distanceUnit}`}
                  icon={<MapPin className="h-3 w-3" />}
                />
                <StatCard
                  label={t('widget.duration', 'Duration')}
                  value={formatDurationRange(lastTrip.start_date, lastTrip.end_date)}
                  icon={<Clock className="h-3 w-3" />}
                />
                <StatCard
                  label={t('widget.drives', 'Drives')}
                  value={fmtInt(lastTrip.drive_count ?? 0)}
                  icon={<Route className="h-3 w-3" />}
                />
                <StatCard
                  label={t('widget.chargeStops', 'Charge Stops')}
                  value={fmtInt(lastTrip.charge_count ?? 0)}
                  icon={<Zap className="h-3 w-3" />}
                />
              </div>
            </div>
          )}

          {/* Recent trips list */}
          {recentTrips.length > 1 && (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
              <h4 className="text-2xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                {t('widget.recentTrips', 'Recent Trips')}
              </h4>
              {recentTrips.slice(1).map((trip) => (
                <div
                  key={trip.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors min-h-[44px]"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[var(--text-secondary)] truncate">
                      {tripName(trip.name, t('widget.tripUnnamed', 'Unnamed trip'))}
                    </p>
                    <p className="text-2xs text-[var(--text-muted)]">
                      {formatDate(trip.start_date)}
                    </p>
                  </div>
                  {!isCompact && (
                    <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                      <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                        {fmtNumber(displayDist(trip.total_distance_m), 1)} {distanceUnit}
                      </span>
                      <span className="text-2xs text-[var(--text-muted)] tabular-nums">
                        {formatDurationRange(trip.start_date, trip.end_date)}
                      </span>
                      <Badge className="text-2xs">
                        {fmtInt(trip.drive_count ?? 0)} {t('widget.drivesShort', 'drv')}
                      </Badge>
                    </div>
                  )}
                  {isCompact && (
                    <span className="text-xs text-[var(--text-secondary)] tabular-nums flex-shrink-0 ml-2">
                      {fmtNumber(displayDist(trip.total_distance_m), 1)} {distanceUnit}
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
