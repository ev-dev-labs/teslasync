import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigation, MapPin, Clock, Zap, Route } from 'lucide-react';
import { Badge } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useTrips } from '@/api/hooks/useTrips';
import { useSettings } from '@/hooks/useSettings';
import { formatDurationRange } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { kmToMiles } from '@/lib/unitConversion';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export default function TripSummaryWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { convertDistance, distanceUnit } = useSettings();

  const { data, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useTrips({
    limit: 5,
  });

  const trips = useMemo(() => data ?? [], [data]);
  const lastTrip = trips[0] ?? null;
  const recentTrips = trips.slice(0, 3);

  const isCompact = size.cols <= 1;

  const displayDist = (km: number) => convertDistance(kmToMiles(km ?? 0));

  return (
    <WidgetShell
      title={t('widget.tripSummary', 'Trip Summary')}
      icon={<Navigation className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
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
                <Badge className="text-[10px]">
                  {t('widget.lastTrip', 'Last Trip')}
                </Badge>
                <span className="text-[10px] text-[var(--text-muted)]">
                  {formatDate(lastTrip.start_date)}
                </span>
              </div>

              {/* Start → End */}
              <p className="text-xs text-[var(--text-secondary)] truncate mb-2">
                {lastTrip.name ?? t('widget.tripUnnamed', 'Unnamed trip')}
              </p>

              {/* Stats grid */}
              <div className={isCompact ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-4 gap-2'}>
                <StatCard
                  label={t('widget.distance', 'Distance')}
                  value={`${fmtNumber(displayDist(lastTrip.total_distance_km ?? 0), 1)} ${distanceUnit}`}
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
              <h4 className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                {t('widget.recentTrips', 'Recent Trips')}
              </h4>
              {recentTrips.slice(1).map((trip) => (
                <div
                  key={trip.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors min-h-[44px]"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[var(--text-secondary)] truncate">
                      {trip.name ?? t('widget.tripUnnamed', 'Unnamed trip')}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      {formatDate(trip.start_date)}
                    </p>
                  </div>
                  {!isCompact && (
                    <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                      <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                        {fmtNumber(displayDist(trip.total_distance_km ?? 0), 1)} {distanceUnit}
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)] tabular-nums">
                        {formatDurationRange(trip.start_date, trip.end_date)}
                      </span>
                      <Badge className="text-[10px]">
                        {fmtInt(trip.drive_count ?? 0)} {t('widget.drivesShort', 'drv')}
                      </Badge>
                    </div>
                  )}
                  {isCompact && (
                    <span className="text-xs text-[var(--text-secondary)] tabular-nums flex-shrink-0 ml-2">
                      {fmtNumber(displayDist(trip.total_distance_km ?? 0), 1)} {distanceUnit}
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
