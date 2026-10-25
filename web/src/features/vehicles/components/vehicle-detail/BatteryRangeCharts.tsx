import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Battery, Route } from 'lucide-react'

import { GlassPanel, PanelTitle, Text } from '@/components/ui'
import { AnimatedNumber } from '@/components/data-display'
import {
  LinearGauge, ChartTooltip, CHART_COLORS,
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ChartLegend,
  AREA_DEFAULTS, areaGradient, EmbeddedChart, type ChartDataColumn,
} from '@/components/charts'
import { EmptyState } from '@/components/feedback'
import { useUnits } from '@/hooks/useUnits'
import { convertDistanceFromSI } from '@/lib/unitConversion'
import { isFiniteNumber } from '@/lib/numberFormat'
import { formatDate } from '@/lib/dateFormat'
import { cn } from '@/lib/cn'
import { typography } from '@/lib/tokens'
import type { VehicleState, Drive } from '@/api/types'
import { batteryColor } from './helpers'
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface BatteryRangeChartsProps {
  state: VehicleState
  drives: Drive[] | undefined
}

const valueClass = cn('block', typography.size.xl, typography.weight.bold, typography.color.primary)

export function BatteryRangeCharts({ state, drives }: BatteryRangeChartsProps) {
  const { precision: displayPrecision } = useNumberFormatting();
  const { t } = useTranslation()
  const { unitPrefs } = useUnits()

  // Runtime null-safety: `VehicleState` types these as `number`, but the Go
  // API can serialise a genuine `null` for a vehicle that has never reported
  // battery/range. Absent readings stay null so the gauge, chart, and
  // headlines render their unknown state — never a fabricated zero and
  // never NaN.
  const batteryLevel = isFiniteNumber(state.battery_level) ? state.battery_level : null
  const ratedRange = isFiniteNumber(state.rated_range) ? state.rated_range : null

  const batteryChartData = useMemo(() => [
    { name: t('common.current', 'Current'), value: batteryLevel },
    { name: t('common.remaining', 'Remaining'), value: batteryLevel == null ? null : Math.max(0, 100 - batteryLevel) },
  ], [batteryLevel, t])

  const driveChartData = useMemo(() =>
    (drives ?? []).map((d) => ({
      date: formatDate(d.start_ts),
      distance: Math.round(convertDistanceFromSI(d.distance_m ?? 0, unitPrefs.distance)),
      duration: Math.round((d.duration_s ?? 0) / 60),
    })).reverse(),
  [drives, unitPrefs.distance])

  const ratedRangeDisplay = useMemo(
    () => (ratedRange == null ? null : convertDistanceFromSI(ratedRange, unitPrefs.distance)),
    [ratedRange, unitPrefs.distance],
  )

  const batteryColumns = useMemo<ChartDataColumn[]>(
    () => [
      { key: 'name', label: t('common.category', 'Category') },
      { key: 'value', label: t('common.percentage', '%'), format: (v) => (v == null ? '—' : `${v}%`) },
    ],
    [t],
  );

  const driveColumns = useMemo<ChartDataColumn[]>(
    () => [
      { key: 'date', label: t('common.date', 'Date') },
      {
        key: 'distance',
        label: `${t('common.distance', 'Distance')} (${unitPrefs.distance})`,
        format: (v) => String(v ?? 0),
      },
      {
        key: 'duration',
        label: t('common.duration', 'Duration (min)'),
        format: (v) => String(v ?? 0),
      },
    ],
    [t, unitPrefs.distance],
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Battery bar chart */}
      <GlassPanel className="p-6">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Battery className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('vehicles.detail.batteryOverview', 'Battery overview')}
        </PanelTitle>
        <div className="flex items-center gap-4 mb-4">
          <LinearGauge
            value={batteryLevel}
            max={100}
            label={t('common.battery', 'Battery')}
            unit="%"
            color={batteryColor(batteryLevel ?? NaN)}
            size={100}
            className="w-32 shrink-0"
          />
          <div className="flex-1">
            <GlassPanel variant="embedded" className="p-3 mb-2">
              <Text variant="caption">{t('common.battery', 'Battery')}</Text>
              <AnimatedNumber value={batteryLevel} suffix="%" className={valueClass} />
            </GlassPanel>
            <GlassPanel variant="embedded" className="p-3">
              <Text variant="caption">{t('common.range', 'Range')}</Text>
              <AnimatedNumber
                value={ratedRangeDisplay}
                decimals={displayPrecision}
                suffix={` ${unitPrefs.distance}`}
                className={valueClass}
              />
            </GlassPanel>
          </div>
        </div>
        <div className="h-48">
          <EmbeddedChart
            title={t('vehicles.detail.batteryOverview', 'Battery overview')}
            ariaLabel={t('vehicles.detail.batteryAria', 'Battery current and remaining levels bar chart')}
            data={batteryChartData}
            dataColumns={batteryColumns}
            fluid
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={batteryChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} />
                <YAxis stroke="var(--text-muted)" fontSize={12} domain={[0, 100]} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="value" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </EmbeddedChart>
        </div>
      </GlassPanel>

      {/* Recent drives distance trend chart */}
      <GlassPanel className="p-6">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Route className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('vehicles.detail.driveTrend', 'Drive distance trend')}
        </PanelTitle>
        {driveChartData.length > 0 ? (
          <div className="h-64">
            <EmbeddedChart
              chartKey="battery-drive-trend"
              title={t('vehicles.detail.driveTrend', 'Drive distance trend')}
              ariaLabel={t('vehicles.detail.driveTrendAria', 'Recent drive distance and duration area chart')}
              data={driveChartData}
              dataColumns={driveColumns}
              fluid
            >
              {({ hiddenSeries }) => (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={driveChartData}>
                    {areaGradient('driveTrendDistGrad', CHART_COLORS[0])}
                    {areaGradient('driveTrendDurGrad', CHART_COLORS[1])}
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                    <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={11} />
                    <YAxis stroke="var(--text-muted)" fontSize={11} />
                    <Tooltip content={<ChartTooltip />} />
                    <ChartLegend />
                    <Area
                      {...AREA_DEFAULTS}
                      dataKey="distance"
                      name={`${t('common.distance', 'Distance')} (${unitPrefs.distance})`}
                      stroke={CHART_COLORS[0]}
                      fill="url(#driveTrendDistGrad)"
                      hide={hiddenSeries?.isHidden('distance') ?? false}
                    />
                    <Area
                      {...AREA_DEFAULTS}
                      dataKey="duration"
                      name={t('common.duration', 'Duration')}
                      stroke={CHART_COLORS[1]}
                      fill="url(#driveTrendDurGrad)"
                      hide={hiddenSeries?.isHidden('duration') ?? false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </EmbeddedChart>
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Route className="h-8 w-8" />}
            message={t('vehicles.detail.noDriveData', 'No drive data for chart')}
          />
        )}
      </GlassPanel>
    </div>
  )
}
