import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar } from 'lucide-react';

import { useYearReview } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { isFiniteNumber } from '@/lib/numberFormat';
import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';
import { useDataState } from '@/hooks/useDataState';
import { useDateLabels } from '@/hooks/useDateLabels';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';
import { EmptyState } from '@/components/feedback';
import { Badge } from '@/components/ui';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';

const METERS_PER_KM = 1000;
const METERS_PER_SECOND_PER_KMH = 3.6;

export default function YearReviewWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { fmtNumber } = useNumberFormatting();
  const { unitPrefs } = useUnits();
  const { formatMonthName } = useDateLabels('utc');
  const vehiclesQuery = useVehicles();
  const id = vehicleId ?? vehiclesQuery.data?.[0]?.id ?? 0;

  // Calendar year is an independent UTC calendar-business scope, not the
  // dashboard analysis range and not a timezone-dependent instant.
  const currentYear = new Date().getUTCFullYear();
  const query = useYearReview(currentYear, id > 0 ? String(id) : undefined);
  const { data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;
  const dataState = useDataState(query, { provenance: 'historical' });

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const isCompact = size.cols <= 1;

  const displayDistance = isFiniteNumber(data?.total_distance_km)
    ? convertDistanceFromSI((data?.total_distance_km ?? 0) * METERS_PER_KM, distanceUnit)
    : null;

  const bestMonth = useMemo(() => {
    const stats = data?.monthly_stats ?? [];
    if (stats.length === 0) return null;
    const valid = stats.filter((item) =>
      Number.isInteger(item.month) && item.month >= 1 && item.month <= 12
      && isFiniteNumber(item.drives),
    );
    if (valid.length === 0) return null;
    const best = valid.reduce((a, b) => b.drives > a.drives ? b : a, valid[0]);
    return formatMonthName(best.month);
  }, [data?.monthly_stats, formatMonthName]);

  const stats: StatGridItem[] = [
    {
      label: t('widget.lifetimeStats.totalDistance', 'Total distance'),
      value: displayDistance == null ? null : fmtNumber(displayDistance, 0),
      unit: distanceUnit,
    },
    {
      label: t('widget.yearReview.totalDrives', 'Total drives'),
      value: isFiniteNumber(data?.total_drives) ? fmtNumber(data?.total_drives ?? 0, 0) : null,
    },
    {
      label: t('widget.yearReview.longestDrive', 'Longest drive'),
      value: isFiniteNumber(data?.longest_drive?.distance_km)
        ? fmtNumber(convertDistanceFromSI((data?.longest_drive?.distance_km ?? 0) * METERS_PER_KM, distanceUnit), 0)
        : null,
      unit: distanceUnit,
    },
    {
      label: t('widget.yearReview.energyUsed', 'Energy used'),
      value: isFiniteNumber(data?.total_energy_kwh) ? fmtNumber(data?.total_energy_kwh ?? 0, 1) : null,
      unit: 'kWh',
    },
    {
      label: t('widget.yearReview.co2Saved', 'CO₂ saved'),
      value: isFiniteNumber(data?.co2_offset_kg) ? fmtNumber(data.co2_offset_kg, 1) : null,
      unit: 'kg',
    },
    {
      label: t('widget.yearReview.charges', 'Charges'),
      value: isFiniteNumber(data?.total_charge_sessions) ? fmtNumber(data.total_charge_sessions, 0) : null,
    },
    ...(size.cols >= 4 ? [
      {
        label: t('widget.yearReview.drivingTime', 'Driving time'),
        value: isFiniteNumber(data?.total_driving_minutes)
          ? fmtNumber((data?.total_driving_minutes ?? 0) / 60, 1)
          : null,
        unit: 'h',
      },
      {
        label: t('widget.yearReview.topSpeed', 'Top speed'),
        value: isFiniteNumber(data?.fastest_speed_kmh)
          ? fmtNumber(convertSpeedFromSI((data?.fastest_speed_kmh ?? 0) / METERS_PER_SECOND_PER_KMH, speedUnit), 0)
          : null,
        unit: speedUnit,
      },
    ] : []),
  ];

  const chips = [
    bestMonth == null ? null : {
      label: t('widget.yearReview.busiestMonth', 'Best month'),
      value: bestMonth,
    },
  ].filter((item): item is { label: string; value: string } => item != null);

  const shellProps = {
    title: `${t('widget.yearReview.title', 'Year in review')} ${currentYear}`,
    dataState: data != null || isLoading || isError ? dataState : undefined,
    loading: isLoading,
    error: error ? String(error) : null,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => { void refetch(); },
  };

  if (isCompact) {
    return (
      <WidgetShell {...shellProps} icon={<Calendar className="h-3.5 w-3.5 text-violet-400" />}>
        {data != null ? (
          <WidgetBigNumber
            value={displayDistance == null ? null : fmtNumber(displayDistance, 0)}
            unit={distanceUnit}
            subtitle={t('widget.yearReview.inYear', 'in {{year}}', { year: currentYear })}
            align="center"
          />
        ) : (
          <EmptyState
            icon={<Calendar className="h-5 w-5" />}
            message={t('widget.yearReview.noData', 'No year-in-review data')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  return (
    <WidgetShell {...shellProps} icon={<Calendar className="h-3.5 w-3.5 text-violet-400" />}>
      {data != null ? (
        <section
          aria-label={t('widget.yearReview.summary.title', 'Year operating summary')}
          data-testid="year-review-widget"
          className="flex min-w-0 flex-col gap-3"
        >
          <Badge variant="neutral" size="sm" className="self-start tabular-nums">
            {t('widget.yearReview.calendarYear', '{{year}} so far', { year: currentYear })}
          </Badge>
          <WidgetStatGrid stats={stats} cols={3} maxPerRow={3} />
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label={t('widget.yearReview.highlights', 'Year highlights')}>
              {chips.map((chip) => (
                <Badge key={chip.label} variant="neutral" size="sm">
                  {chip.label}: {chip.value}
                </Badge>
              ))}
            </div>
          )}
        </section>
      ) : (
        <EmptyState
          icon={<Calendar className="h-5 w-5" />}
          message={t('widget.yearReview.noData', 'No year-in-review data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
