import { Navigation } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useTrips } from '@/api/hooks/useTrips';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { formatDurationMinutes, formatDurationRange } from '@/lib/dateConvert';
import { WidgetShell } from './WidgetShell';
import { WidgetStatGrid } from './shared';
import type { WidgetProps } from './types';
import { convertDistanceFromSI, convertEnergyFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDateLabels } from '@/hooks/useDateLabels';

/**
 * Resolve a human-readable trip label. A trip can arrive with a `null`,
 * empty, or whitespace-only `name`; all of those collapse to the shared
 * "unnamed" fallback so a row never renders a blank line.
 */
function tripName(name: string | null | undefined, fallback: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed.length > 0 ? trimmed : fallback;
}

export default function TripSummaryWidget(_props: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const { formatWeekdayName } = useDateLabels();

  const query = useTrips({ limit: 5 });
  const { data, isLoading, isFetching, isStale, isError, error, dataUpdatedAt, refetch } = query;
  const trust = useDataState({ ...query, data: data ?? undefined }, { provenance: 'historical' });

  const trips = data ?? [];
  const lastTrip = trips[0] ?? null;

  const displayDist = (meters: number | null | undefined) => {
    const value = knownNumber(meters);
    return value == null ? null : fmtNumber(convertDistanceFromSI(value, distanceUnit), 0);
  };
  const count = (value: unknown) => knownNumber(value) == null ? '—' : fmtInt(knownNumber(value));

  return (
    <WidgetShell
      title={t('widget.tripSummary', 'Trip summary')}
      icon={<Navigation className="h-3.5 w-3.5 text-cyan-300" />}
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
          {lastTrip && (
            <div className="min-w-0 space-y-2">
              <div className="min-w-0">
                <Text as="p" variant="bodySm" className="font-semibold [overflow-wrap:anywhere]">
                  {tripName(lastTrip.name, t('widget.tripUnnamed', 'Unnamed trip'))}
                </Text>
                <Text as="p" variant="caption" className="text-[var(--text-muted)]">
                  {formatWeekdayName(lastTrip.start_date)}
                  {' · '}
                  {knownNumber(lastTrip.total_duration_s) != null
                    ? formatDurationMinutes(lastTrip.total_duration_s / 60, { subMinuteLabel: `<1${t('widget.tripMinuteShort', 'm')}` })
                    : formatDurationRange(lastTrip.start_date, lastTrip.end_date)}
                </Text>
              </div>

              <WidgetStatGrid cols={3} stats={[
                { label: t('widget.distance', 'Distance'), value: displayDist(lastTrip.total_distance_m), unit: displayDist(lastTrip.total_distance_m) == null ? undefined : distanceUnit },
                {
                  label: t('widget.energy', 'Energy'),
                  value: knownNumber(lastTrip.total_energy_wh) == null
                    ? null
                    : fmtNumber(convertEnergyFromSI(lastTrip.total_energy_wh, unitPrefs.energy), unitPrefs.energy === 'kWh' ? 1 : 0),
                  unit: knownNumber(lastTrip.total_energy_wh) == null ? undefined : unitPrefs.energy,
                },
                { label: t('widget.stops', 'Stops'), value: count(lastTrip.charge_count) },
              ]} />
            </div>
          )}

        </div>
      )}
    </WidgetShell>
  );
}
