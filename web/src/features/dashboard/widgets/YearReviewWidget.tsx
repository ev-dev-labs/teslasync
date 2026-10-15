import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar } from 'lucide-react';
import { useDataState } from '@/hooks/useDataState';
import { EmptyState } from '@/components/feedback';
import { useYearReview } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import type { WidgetProps } from './types';
import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { isFiniteNumber } from '@/lib/numberFormat';

// The year-review endpoint emits distances in kilometres and speeds in km/h
// (server-side derivations of the SI columns). The SI-canonical converters
// expect metres / metres-per-second, so lift the API values back to SI before
// converting to the user's display unit.
const METERS_PER_KM = 1000;
const KMH_PER_MPS = 3.6; // 1 m/s === 3.6 km/h

export default function YearReviewWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber, locale } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const currentYear = new Date().getFullYear();
  const query = useYearReview(currentYear, id > 0 ? String(id) : undefined);
  const {
    data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch, } = query;
  const dataState = useDataState(query, { provenance: 'historical' });

  const { unitPrefs } = useUnits();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  // Lift the API's km / km/h back to SI (m, m/s), then convert to the user's
  // display unit. Feeding km straight into convertDistanceFromSI (which
  // expects metres) previously under-reported every figure by ~1000×.
  const displayDistance = toDistanceDisplay((data?.total_distance_km ?? 0) * METERS_PER_KM);

  // Find busiest month
  const busiestMonth = useMemo(() => {
    const stats = data?.monthly_stats ?? [];
    if (stats.length === 0) return '—';
    const best = stats.reduce((a, b) => (b.drives > a.drives ? b : a), stats[0]);
    if (!Number.isInteger(best.month) || best.month < 1 || best.month > 12) return '—';
    return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
      .format(new Date(Date.UTC(currentYear, best.month - 1, 1)));
  }, [data?.monthly_stats, locale, currentYear]);

  const coreStats = useMemo((): StatMetric[] => {
    if (!data) return [];
    return [
      {
        metricId: 'distance',
        label: t('widget.lifetimeStats.totalDistance', 'Total distance'),
        rawValue: data.total_distance_km == null ? null : data.total_distance_km * METERS_PER_KM,
        description: t('widget.yearReview.summary.distanceHelp', 'Reported year distance, normalized from kilometres to metres.'),
        display: { formatter: raw => ({ value: fmtNumber(convertDistanceFromSI(raw, distanceUnit)), unit: distanceUnit }) },
      },
      {
        metricId: 'count',
        label: t('widget.yearReview.totalDrives', 'Total drives'),
        rawValue: data.total_drives,
        description: t('widget.yearReview.summary.drivesHelp', 'Reported drive count for this calendar year.'),
      },
      {
        metricId: 'energy',
        label: t('widget.yearReview.energyUsed', 'Energy used'),
        rawValue: data.total_energy_kwh == null ? null : data.total_energy_kwh * 1000,
        description: t('widget.yearReview.summary.energyHelp', 'Reported year energy, normalized from kWh to Wh; original kWh display retained.'),
        display: { formatter: raw => ({ value: fmtNumber(raw / 1000), unit: 'kWh' }) },
      },
      {
        metricId: 'mass',
        label: t('widget.yearReview.co2Saved', 'CO₂ saved'),
        rawValue: data.co2_offset_kg,
        description: t('widget.yearReview.summary.carbonHelp', 'Source-reported CO₂ offset for this calendar year, in kilograms.'),
        display: { formatter: raw => ({ value: fmtNumber(raw), unit: 'kg' }) },
      },
      {
        metricId: 'text',
        label: t('widget.yearReview.busiestMonth', 'Best month'),
        rawValue: busiestMonth === '—' ? null : busiestMonth,
        description: t('widget.yearReview.summary.monthHelp', 'Month with the most source-reported drives, using the existing selection rule and localized month name.'),
      },
      {
        metricId: 'distance',
        label: t('widget.yearReview.longestDrive', 'Longest drive'),
        rawValue: data.longest_drive?.distance_km == null ? null : data.longest_drive.distance_km * METERS_PER_KM,
        description: t('widget.yearReview.summary.longestHelp', 'Source longest drive in this year, normalized from kilometres to metres.'),
        display: { formatter: raw => ({ value: fmtNumber(convertDistanceFromSI(raw, distanceUnit)), unit: distanceUnit }) },
      },
    ];
  }, [data, distanceUnit, busiestMonth, t, fmtNumber]);

  const wideStats = useMemo((): StatMetric[] => {
    if (!data) return [];
    return [
      {
        metricId: 'duration',
        label: t('widget.yearReview.drivingTime', 'Driving time'),
        rawValue: data.total_driving_minutes == null ? null : data.total_driving_minutes * 60,
        description: t('widget.yearReview.summary.durationHelp', 'Source driving minutes normalized to seconds; the original hour display is retained.'),
        display: { formatter: raw => ({ value: fmtNumber(raw / 3600), unit: 'h' }) },
      },
      {
        metricId: 'speed',
        label: t('widget.yearReview.topSpeed', 'Top speed'),
        rawValue: data.fastest_speed_kmh == null ? null : data.fastest_speed_kmh / KMH_PER_MPS,
        description: t('widget.yearReview.summary.speedHelp', 'Source peak speed normalized from km/h to m/s; not average speed.'),
        display: { formatter: raw => ({ value: fmtNumber(convertSpeedFromSI(raw, speedUnit)), unit: speedUnit }) },
      },
    ];
  }, [data, speedUnit, t, fmtNumber]);

  const allStats = useMemo(
    () => (isWide ? [...coreStats, ...wideStats] : coreStats),
    [isWide, coreStats, wideStats],
  );

  // Compact: single big number
  if (isCompact) {
    return (
      <WidgetShell
        title={t('widget.yearReview.title', 'Year in review') + ` ${currentYear}`}
        dataState={data || isLoading || isError ? dataState : undefined}
        loading={isLoading}
        error={error ? String(error) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}
      >
        {data ? (
          <WidgetBigNumber
            value={isFiniteNumber(data.total_distance_km) ? fmtNumber(displayDistance) : null}
            subtitle={`${distanceUnit} ${t('widget.yearReview.inYear', 'in {year}').replace('{year}', String(currentYear))}`}
            align="center"
          />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Calendar className="h-5 w-5" />}
            message={t('widget.yearReview.noData', 'No year-in-review data')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  // Standard / Wide
  return (
    <WidgetShell
      dataState={data || isLoading || isError ? dataState : undefined}
      title={t('widget.yearReview.title', 'Year in review') + ` ${currentYear}`}
      icon={<Calendar className="h-3.5 w-3.5 text-violet-400" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {data ? (
        <DashboardSourceBrief
          metrics={allStats}
          state={dataState}
          eyebrow={t('widget.yearReview.summary.eyebrow', 'Calendar-year history')}
          title={t('widget.yearReview.summary.title', 'Year operating summary')}
          description={t('widget.yearReview.summary.description', 'Calendar-year totals for the resolved vehicle. The current year may be incomplete; exact source coverage and observation bounds are not supplied.')}
          scope={t('widget.yearReview.summary.scope', 'Vehicle {{id}} · year {{year}}', { id, year: currentYear })}
          testId="year-review-operational-brief"
        />
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Calendar className="h-5 w-5" />}
          message={t('widget.yearReview.noData', 'No year-in-review data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
