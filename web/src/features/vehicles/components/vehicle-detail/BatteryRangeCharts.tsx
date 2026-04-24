import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Battery, Route } from 'lucide-react'

import { GlassPanel } from '@/components/ui'
import { AnimatedNumber } from '@/components/data-display'
import {
  RadialGauge, ChartTooltip, CHART_COLORS,
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts'
import { EmptyState } from '@/components/feedback'
import { useSettings } from '@/hooks/useSettings'
import { formatDate } from '@/lib/dateFormat'
import type { VehicleState, Drive } from '@/api/types'
import { batteryColor } from './helpers'

interface BatteryRangeChartsProps {
  state: VehicleState
  drives: Drive[] | undefined
}

export function BatteryRangeCharts({ state, drives }: BatteryRangeChartsProps) {
  const { t } = useTranslation()
  const { convertDistance, distanceUnit } = useSettings()

  const batteryChartData = useMemo(() => [
    { name: t('common.current', 'Current'), value: state.battery_level },
    { name: t('common.remaining', 'Remaining'), value: 100 - state.battery_level },
  ], [state.battery_level, t])

  const driveChartData = useMemo(() =>
    (drives ?? []).map((d) => ({
      date: formatDate(d.start_ts),
      distance: Math.round(convertDistance(d.distance_mi)),
      duration: Math.round(d.duration_min),
    })).reverse(),
  [drives, convertDistance])

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Battery bar chart */}
      <GlassPanel className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Battery className="h-4 w-4 text-[var(--neon-cyan)]" />
          <span className="text-lg font-bold text-[var(--text-primary)]">
            {t('vehicles.detail.batteryOverview', 'Battery Overview')}
          </span>
        </div>
        <div className="flex items-center gap-4 mb-4">
          <RadialGauge
            value={state.battery_level}
            max={100}
            label={t('common.battery', 'Battery')}
            unit="%"
            color={batteryColor(state.battery_level)}
            size={100}
          />
          <div className="flex-1">
            <GlassPanel className="p-3 mb-2">
              <span className="text-xs text-[var(--text-muted)]">{t('common.battery', 'Battery')}</span>
              <AnimatedNumber value={state.battery_level} suffix="%" className="block text-xl font-bold text-[var(--text-primary)]" />
            </GlassPanel>
            <GlassPanel className="p-3">
              <span className="text-xs text-[var(--text-muted)]">{t('common.range', 'Range')}</span>
              <AnimatedNumber
                value={convertDistance(state.rated_range)}
                decimals={0}
                suffix={` ${distanceUnit}`}
                className="block text-xl font-bold text-[var(--text-primary)]"
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
        <div className="flex items-center gap-2 mb-4">
          <Route className="h-4 w-4 text-[var(--neon-cyan)]" />
          <span className="text-lg font-bold text-[var(--text-primary)]">
            {t('vehicles.detail.driveTrend', 'Drive Distance Trend')}
          </span>
        </div>
        {driveChartData.length > 0 ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={driveChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" stroke="rgba(255,255,255,0.4)" fontSize={11} />
                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="distance"
                  name={t('common.distance', 'Distance')}
                  stroke={CHART_COLORS[0]}
                  fill={CHART_COLORS[0]}
                  fillOpacity={0.15}
                />
                <Area
                  type="monotone"
                  dataKey="duration"
                  name={t('common.duration', 'Duration')}
                  stroke={CHART_COLORS[1]}
                  fill={CHART_COLORS[1]}
                  fillOpacity={0.1}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState
            icon={<Route className="h-8 w-8" />}
            message={t('vehicles.detail.noDriveData', 'No drive data for chart')}
          />
        )}
      </GlassPanel>
    </div>
  )
}
