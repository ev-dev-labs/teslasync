import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Battery, Route } from 'lucide-react'

import { GlassPanel, PanelTitle, Text } from '@/components/ui'
import { AnimatedNumber } from '@/components/data-display'
import {
  RadialGauge, ChartTooltip, CHART_COLORS,
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
  AREA_DEFAULTS, areaGradient,
} from '@/components/charts'
import { EmptyState } from '@/components/feedback'
import { useUnits } from '@/hooks/useUnits'
import { convertDistanceFromSI } from '@/lib/unitConversion'
import { formatDate } from '@/lib/dateFormat'
import { cn } from '@/lib/cn'
import { typography } from '@/lib/tokens'
import type { VehicleState, Drive } from '@/api/types'
import { batteryColor } from './helpers'

interface BatteryRangeChartsProps {
  state: VehicleState
  drives: Drive[] | undefined
}

const valueClass = cn('block', typography.size.xl, typography.weight.bold, typography.color.primary)

export function BatteryRangeCharts({ state, drives }: BatteryRangeChartsProps) {
  const { t } = useTranslation()
  const { unitPrefs } = useUnits()

  // Runtime null-safety: `VehicleState` types these as `number`, but the Go
  // API can serialise a genuine `null` for a vehicle that has never reported
  // battery/range. Coerce once so every downstream consumer (gauge, chart,
  // headline) shares the same non-NaN value.
  const batteryLevel = state.battery_level ?? 0
  const ratedRange = state.rated_range ?? 0

  const batteryChartData = useMemo(() => [
    { name: t('common.current', 'Current'), value: batteryLevel },
    { name: t('common.remaining', 'Remaining'), value: Math.max(0, 100 - batteryLevel) },
  ], [batteryLevel, t])

  const driveChartData = useMemo(() =>
    (drives ?? []).map((d) => ({
      date: formatDate(d.start_ts),
      distance: Math.round(convertDistanceFromSI(d.distance_m ?? 0, unitPrefs.distance)),
      duration: Math.round((d.duration_s ?? 0) / 60),
    })).reverse(),
  [drives, unitPrefs.distance])

  const ratedRangeDisplay = useMemo(
    () => convertDistanceFromSI(ratedRange, unitPrefs.distance),
    [ratedRange, unitPrefs.distance],
  )

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Battery bar chart */}
      <GlassPanel className="p-6">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Battery className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('vehicles.detail.batteryOverview', 'Battery Overview')}
        </PanelTitle>
        <div className="flex items-center gap-4 mb-4">
          <RadialGauge
            value={batteryLevel}
            max={100}
            label={t('common.battery', 'Battery')}
            unit="%"
            color={batteryColor(batteryLevel)}
            size={100}
          />
          <div className="flex-1">
            <GlassPanel className="p-3 mb-2">
              <Text variant="caption">{t('common.battery', 'Battery')}</Text>
              <AnimatedNumber value={batteryLevel} suffix="%" className={valueClass} />
            </GlassPanel>
            <GlassPanel className="p-3">
              <Text variant="caption">{t('common.range', 'Range')}</Text>
              <AnimatedNumber
                value={ratedRangeDisplay}
                decimals={0}
                suffix={` ${unitPrefs.distance}`}
                className={valueClass}
              />
            </GlassPanel>
          </div>
        </div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={batteryChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="name" stroke="rgba(255,255,255,0.4)" fontSize={12} />
              <YAxis stroke="rgba(255,255,255,0.4)" fontSize={12} domain={[0, 100]} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="value" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </GlassPanel>

      {/* Recent drives distance trend chart */}
      <GlassPanel className="p-6">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Route className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('vehicles.detail.driveTrend', 'Drive Distance Trend')}
        </PanelTitle>
        {driveChartData.length > 0 ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={driveChartData}>
                {areaGradient('driveTrendDistGrad', CHART_COLORS[0])}
                {areaGradient('driveTrendDurGrad', CHART_COLORS[1])}
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" stroke="rgba(255,255,255,0.4)" fontSize={11} />
                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Area
                  {...AREA_DEFAULTS}
                  dataKey="distance"
                  name={`${t('common.distance', 'Distance')} (${unitPrefs.distance})`}
                  stroke={CHART_COLORS[0]}
                  fill="url(#driveTrendDistGrad)"
                />
                <Area
                  {...AREA_DEFAULTS}
                  dataKey="duration"
                  name={t('common.duration', 'Duration')}
                  stroke={CHART_COLORS[1]}
                  fill="url(#driveTrendDurGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
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
