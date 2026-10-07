import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Battery } from 'lucide-react';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { containerPolicy, useCardPlacement } from '@/components/layout/layout-reference';
import {
  LinearGauge, ChartTooltip, CHART_COLORS, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, EmbeddedChart, type ChartDataColumn,
} from '@/components/charts';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { chartTokens } from '@/lib/tokens';
import type { VehicleState } from '@/api/types';
import { batteryColor } from '../vehicle-detail/helpers';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

/** Compatibility extraction preserves the gauge/readouts BEFORE the bar plot.
 * ChartCard has no prefix slot; nesting it here would add a second surface or
 * move source content. EmbeddedChart remains the exact non-exporting engine. */
export function VehicleBatteryChart({ state, height: heightOverride }: { state: VehicleState; height?: number }) {
  const placement = useCardPlacement();
  const height = heightOverride ?? containerPolicy(placement?.width ?? 0).chartHeight;
  const { precision: displayPrecision, fmtInt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  // Inherited chart coercions retained verbatim; this layout cohort does not
  // change numeric semantics, settings, units or precision.
  const batteryLevel = state.battery_level ?? 0;
  const batteryChartData = useMemo(() => [
    { name: t('common.current', 'Current'), value: batteryLevel },
    { name: t('common.remaining', 'Remaining'), value: Math.max(0, 100 - batteryLevel) },
  ], [batteryLevel, t]);
  const sourceMetrics: readonly StatMetric[] = [
    { metricId: 'percent', occurrenceId: 'battery', label: t('common.battery', 'Battery'), rawValue: state.battery_level,
      display: { formatter: raw => ({ value: `${fmtInt(raw)}%`, unit: '' }) } },
    { metricId: 'distance', occurrenceId: 'range', label: t('common.range', 'Range'), rawValue: state.rated_range,
      display: { formatter: raw => ({ value: `${fmtNumber(convertDistanceFromSI(raw, unitPrefs.distance), displayPrecision)} ${unitPrefs.distance}`, unit: '' }) } },
  ];
  const metrics = useOperationalMetrics(sourceMetrics);
  const batteryColumns = useMemo<ChartDataColumn[]>(() => [
    { key: 'name', label: t('common.category', 'Category') },
    { key: 'value', label: t('common.percentage', '%'), format: (v) => `${v}%` },
  ], [t]);
  return (
    <GlassPanel className="h-full min-w-0 p-6">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Battery className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
        {t('vehicles.detail.batteryOverview', 'Battery overview')}
      </PanelTitle>
      <div className="mb-4 flex min-w-0 flex-wrap items-center gap-4">
        <LinearGauge value={batteryLevel} max={100} label={t('common.battery', 'Battery')}
          unit="%" color={batteryColor(batteryLevel)} size={100} className="w-32 shrink-0" />
        <div className="min-w-0 flex-1 basis-48">
          <OperationalBrief compact testId="vehicle-battery-readouts"
            eyebrow={t('vehicles.evidenceBrief.eyebrow', 'Vehicle evidence')}
            title={t('vehicles.detail.batteryReadouts', 'Returned battery readouts')}
            description={t('vehicles.detail.batteryReadoutContext', 'Battery and rated range from the supplied vehicle-state snapshot; the retained gauge and bar plot keep their original chart semantics.')}
            statusLabel={t('vehicles.detail.batterySnapshotStatus', 'Vehicle-state snapshot returned')}
            scope={t('vehicles.detail.batterySnapshotScope', 'No per-reading timestamp is supplied for these two readouts.')}
            provenance={t('vehicles.detail.batterySnapshotSource', 'Supplied vehicle-state response')}
            metrics={metrics} />
        </div>
      </div>
      <EmbeddedChart title={t('vehicles.detail.batteryOverview', 'Battery overview')}
        ariaLabel={t('vehicles.detail.batteryAria', 'Battery current and remaining levels bar chart')}
        data={batteryChartData} dataColumns={batteryColumns} height={height} mobileHeight={height} fluid={false}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={batteryChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} />
            <XAxis dataKey="name" stroke={chartTokens.axisStroke} fontSize={12} />
            <YAxis stroke={chartTokens.axisStroke} fontSize={12} domain={[0, 100]} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="value" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </EmbeddedChart>
    </GlassPanel>
  );
}
