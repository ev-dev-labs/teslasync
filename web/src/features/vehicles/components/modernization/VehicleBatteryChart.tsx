import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Battery } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
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
import { isFiniteNumber } from '@/lib/numberFormat';
import type { VehicleState } from '@/api/types';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

/** The gauge/readouts occupy the shared summary before the unchanged plot. */
export function VehicleBatteryChart({ state, height: heightOverride }: { state: VehicleState; height?: number }) {
  const placement = useCardPlacement();
  const height = heightOverride ?? containerPolicy(placement?.width ?? 0).chartHeight;
  const { precision: displayPrecision, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const batteryLevel = isFiniteNumber(state.battery_level) &&
    state.battery_level >= 0 && state.battery_level <= 100 ? state.battery_level : null;
  const batteryChartData = useMemo(() => [
    { name: t('common.current', 'Current'), value: batteryLevel },
    { name: t('common.remaining', 'Remaining'), value: batteryLevel == null ? null : 100 - batteryLevel },
  ], [batteryLevel, t]);
  const sourceMetrics: readonly StatMetric[] = [
    { metricId: 'percent', occurrenceId: 'battery', label: t('common.battery', 'Battery'),
      rawValue: batteryLevel ?? (state.battery_level == null ? state.battery_level : Number.NaN),
      display: { formatter: raw => ({ value: `${fmtNumber(raw, displayPrecision)}%`, unit: '' }) } },
    { metricId: 'distance', occurrenceId: 'range', label: t('common.range', 'Range'), rawValue: state.rated_range,
      display: { formatter: raw => ({ value: `${fmtNumber(convertDistanceFromSI(raw, unitPrefs.distance), displayPrecision)} ${unitPrefs.distance}`, unit: '' }) } },
  ];
  const metrics = useOperationalMetrics(sourceMetrics);
  const batteryColumns = useMemo<ChartDataColumn[]>(() => [
    { key: 'name', label: t('common.category', 'Category') },
    { key: 'value', label: t('common.percentage', '%'), format: (v) => isFiniteNumber(v) ? `${fmtNumber(v, displayPrecision)}%` : '—' },
  ], [t, fmtNumber, displayPrecision]);
  return (
    <LayoutCard
      title={t('vehicles.detail.batteryOverview', 'Battery overview')}
      icon={<Battery className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />}
      summary={<div className="flex min-w-0 flex-wrap items-center gap-4">
        <LinearGauge value={batteryLevel} max={100} label={t('common.battery', 'Battery')}
          preserveReadingAndScale unit="%" decimals={displayPrecision}
          tone={batteryLevel == null ? 'neutral' : batteryLevel > 60 ? 'success' : batteryLevel > 25 ? 'warning' : 'danger'}
          size={100} className="w-32 shrink-0" />
        <div className="min-w-0 flex-1 basis-48">
          <OperationalBrief compact variant="embedded" testId="vehicle-battery-readouts"
            eyebrow={t('vehicles.evidenceBrief.eyebrow', 'Vehicle evidence')}
            title={t('vehicles.detail.batteryReadouts', 'Returned battery readouts')}
            description={t('vehicles.detail.batteryReadoutContext', 'Battery and rated range from the supplied vehicle-state snapshot; the retained gauge and bar plot keep their original chart semantics.')}
            statusLabel={t('vehicles.detail.batterySnapshotStatus', 'Vehicle-state snapshot returned')}
            scope={t('vehicles.detail.batterySnapshotScope', 'No per-reading timestamp is supplied for these two readouts.')}
            provenance={t('vehicles.detail.batterySnapshotSource', 'Supplied vehicle-state response')}
            metrics={metrics} />
        </div>
      </div>}
    >
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
    </LayoutCard>
  );
}
