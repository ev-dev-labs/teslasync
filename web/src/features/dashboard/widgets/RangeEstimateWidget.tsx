import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, ChartTooltip, EmbeddedChart,
  PatternedBar, ResponsiveContainer, Tooltip, XAxis, YAxis, axisTick,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { Badge, Caption } from '@/components/ui';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { convertDistanceFromSI, type DistanceUnitPref } from '@/lib/unitConversion';
import { fmtNumber, isFiniteNumber } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetRankedList } from './shared';
import { useDataState } from '@/hooks/useDataState';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { usePackPresentation } from './designPacks/PackBoundary';
import type { WidgetProps } from './types';

/**
 * Format an SI range (metres) for display in the user's distance unit.
 *
 * A genuinely-absent reading (null / undefined / NaN) renders the em-dash
 * placeholder rather than a fabricated "0 km": a coalesced zero is
 * indistinguishable from "no data" and reads as a dead battery. A real,
 * finite zero is preserved and shown as "0 <unit>". Exported for unit testing.
 */
export function formatRange(
  meters: number | null | undefined,
  distanceUnit: DistanceUnitPref,
): string {
  if (!isFiniteNumber(meters)) return '—';
  return `${fmtNumber(convertDistanceFromSI(meters, distanceUnit), 0)} ${distanceUnit}`;
}

export default function RangeEstimateWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { fmtNumber: formatNumber } = useNumberFormatting();
  const packId = usePackPresentation();
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const query = useVehicleState(id);
  const {
    data: stateData,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;
  const trust = useDataState(query, { provenance: query.data?.live ? 'live' : 'cached', maxAgeMs: 120_000 });
  /* SI-floor: state.rated_range / state.ideal_range arrive in METERS. */
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const state = stateData?.state;
  const ratedRange = isFiniteNumber(state?.rated_range) ? formatRange(state.rated_range, distanceUnit) : null;
  const idealRange = isFiniteNumber(state?.ideal_range)
    ? formatRange(state.ideal_range, distanceUnit)
    : null;
  const compact = size.cols === 1 && size.rows === 1;
  const rated = isFiniteNumber(state?.rated_range) && state.rated_range >= 0 ? state.rated_range : null;
  const ideal = isFiniteNumber(state?.ideal_range) && state.ideal_range >= 0 ? state.ideal_range : null;
  const battery = isFiniteNumber(state?.battery_level) && state.battery_level >= 0 && state.battery_level <= 100
    ? state.battery_level : null;
  const comparisonTitle = t('dashboardWidgets.battery.rangeEstimateComparison', 'Rated and ideal range comparison');
  const comparisonData = useMemo(() => [
    { label: t('widget.ratedRange', 'Rated range'), range: rated == null ? null : convertDistanceFromSI(rated, distanceUnit) },
    { label: t('widget.idealRange', 'Ideal range'), range: ideal == null ? null : convertDistanceFromSI(ideal, distanceUnit) },
  ], [rated, ideal, distanceUnit, t]);
  const comparisonColumns = useMemo(() => [
    { key: 'label', label: t('dashboardWidgets.battery.rangeEstimateType', 'Range type') },
    { key: 'range', label: t('widget.range', 'Range'),
      format: (value: unknown) => isFiniteNumber(value) ? `${formatNumber(value, 0)} ${distanceUnit}` : '—' },
  ], [distanceUnit, formatNumber, t]);
  const details = (
    <div className="flex min-w-0 flex-col gap-3">
      <WidgetRankedList order="source" compact={compact} wrapContent items={[
        { id: 'ideal-range', label: t('widget.idealRange', 'Ideal range'), value: ideal,
          formattedValue: ideal == null ? '—' : formatRange(ideal, distanceUnit) },
        { id: 'battery', label: t('widget.battery', 'Battery'), value: battery,
          formattedValue: battery == null ? '—' : `${formatNumber(battery, 0)}%` },
      ]} />
      <Caption>
        {t('dashboardWidgets.battery.rangeEstimateDisclaimer', 'Estimates are not guarantees of real-world range.')}
      </Caption>
    </div>
  );

  return (
    <WidgetShell
      title={t('widget.range', 'Range')}
      loading={isLoading}
      dataState={stateData != null || isLoading || isError || error ? trust : undefined}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      <InstrumentPresentation family="bars" compact={compact} icon={<Gauge />}
        headline={<WidgetBigNumber label={t('widget.ratedRange', 'Rated range')}
          value={rated == null ? null : formatRange(rated, distanceUnit)} animated={false} />}
        context={<Badge variant="neutral">{t('dashboardWidgets.battery.rangeEstimateBadge', 'Estimate')}</Badge>}
        instrument={
          <EmbeddedChart title={comparisonTitle} ariaLabel={comparisonTitle}
            height={compact ? 140 : 180} mobileHeight={compact ? 140 : 180}
            empty={rated == null && ideal == null} emptyMessage={t('widget.noRange', 'No range data')}
            data={comparisonData} dataColumns={comparisonColumns}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonData} margin={{ top: 20, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={chartTokens.gridStroke}
                  strokeDasharray={packId === 'v7' ? undefined : '3 3'} vertical={false} />
                <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval={0} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false}
                  domain={[0, 'auto']} unit={` ${distanceUnit}`} tickFormatter={value => formatNumber(value, 0)} />
                <Tooltip content={<ChartTooltip precision={0} />} />
                <Bar dataKey="range" name={t('widget.range', 'Range')} unit={distanceUnit}
                  fill="var(--theme-primary)" maxBarSize={compact ? 32 : 46} isAnimationActive={false}
                  shape={packId === 'v7' ? <PatternedBar /> : undefined}
                  radius={packId === 'v7' ? 0 : packId === 'v5' ? [4, 4, 0, 0] : [6, 6, 0, 0]}
                  label={{ position: 'top', fill: 'var(--text-secondary)',
                    formatter: (value: unknown) => isFiniteNumber(value) ? formatNumber(value, 0) : '—' }} />
              </BarChart>
            </ResponsiveContainer>
          </EmbeddedChart>
        }
        details={details}>
        <div className="flex min-w-0 flex-col gap-3">
          <WidgetBigNumber
            label={t('widget.ratedRange', 'Rated range')}
            value={ratedRange}
            animated={false}
          />
          {idealRange && (
            <WidgetRankedList
              order="source"
              items={[{
                id: 'ideal-range',
                label: t('widget.idealRange', 'Ideal range'),
                value: state?.ideal_range,
                formattedValue: idealRange,
              }]}
            />
          )}
          {!state && (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Gauge className="h-6 w-6" />}
              message={t('widget.noRange', 'No range data')}
              className="py-4"
            />
          )}
        </div>
      </InstrumentPresentation>
    </WidgetShell>
  );
}
