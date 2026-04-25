import { useTranslation } from 'react-i18next'
import { Lock, Unlock, Shield, Wind, Cpu } from 'lucide-react'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { FadeIn } from '@/components/motion/FadeIn'
import { TeslaCarViz, parseModelKey } from '@/components/data-display/TeslaCarViz'
import { RadialGauge } from '@/components/charts/RadialGauge'
import { MetricBar } from '@/components/data-display/MetricBar'
import { useSettings } from '@/hooks/useSettings'
import { fmtNumber } from '@/lib/numberFormat'
import { batteryColor } from '@/lib/colors'
import type { Vehicle, VehicleState } from '@/api/types'

/** Color constants matching original production palette */
const COLOR = {
  CYAN: '#00f0ff',
  PURPLE: '#a855f7',
  DARK: '#374151',
  MUTED: '#6b7280',
  BAD: '#ef4444',
}

function boolColor(flag: boolean): string {
  return flag ? '#10b981' : '#ef4444'
}

function boolColorMuted(flag: boolean): string {
  return flag ? '#10b981' : COLOR.MUTED
}

interface VehicleGaugesProps {
  vehicle: Vehicle
  state: VehicleState
}

export function VehicleGauges({ vehicle, state }: VehicleGaugesProps) {
  const { t } = useTranslation()
  const { convertDistance, convertSpeed, distanceUnit, speedUnit } = useSettings()

  const chips = [
    {
      icon: state.is_locked ? Lock : Unlock,
      label: state.is_locked ? t('common.locked', 'Locked') : t('common.unlocked', 'Unlocked'),
      color: boolColor(state.is_locked),
    },
    {
      icon: Shield,
      label: state.sentry_mode ? t('common.sentryOn', 'Sentry ON') : t('common.sentryOff', 'Sentry OFF'),
      color: state.sentry_mode ? COLOR.BAD : COLOR.MUTED,
    },
    {
      icon: Wind,
      label: state.is_climate_on ? t('common.climateOn', 'Climate ON') : t('common.climateOff', 'Climate OFF'),
      color: state.is_climate_on ? COLOR.CYAN : COLOR.MUTED,
    },
    {
      icon: Cpu,
      label: state.software_version || 'N/A',
      color: COLOR.PURPLE,
    },
  ]

  return (
    <FadeIn delay={0.05}>
      <GlassPanel className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-neon-cyan/[0.02] via-transparent to-neon-purple/[0.02]" />
        <div className="relative grid grid-cols-1 lg:grid-cols-[auto,1fr] gap-8 p-6 lg:p-8">
          {/* Car visualization */}
          <div className="flex items-center justify-center">
            <TeslaCarViz
              batteryLevel={state.battery_level}
              isCharging={state.is_charging}
              isLocked={state.is_locked}
              isClimateOn={state.is_climate_on}
              sentryMode={state.sentry_mode}
              speed={state.speed}
              size="lg"
              model={parseModelKey(vehicle?.model)}
            />
          </div>

          {/* Gauges + metrics */}
          <div className="flex flex-col gap-6">
            {/* Radial gauge row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 justify-items-center">
              <RadialGauge
                value={state.battery_level}
                max={100}
                label={t('common.battery', 'Battery')}
                unit="%"
                color={batteryColor(state.battery_level)}
                size={110}
              />
              <RadialGauge
                value={Math.round(convertDistance(state.rated_range))}
                max={Math.round(convertDistance(600))}
                label={t('common.range', 'Range')}
                unit={distanceUnit}
                color={COLOR.CYAN}
                size={110}
              />
              <RadialGauge
                value={Math.round(convertSpeed(state.speed))}
                max={Math.round(convertSpeed(250))}
                label={t('common.speed', 'Speed')}
                unit={speedUnit}
                color={state.speed > 0 ? COLOR.PURPLE : COLOR.DARK}
                size={110}
              />
              <RadialGauge
                value={state.charger_power}
                max={250}
                label={t('common.power', 'Power')}
                unit="kW"
                color={boolColorMuted(state.is_charging)}
                size={110}
              />
            </div>

            {/* Metric bars */}
            <div className="space-y-3">
              <MetricBar
                value={state.battery_level}
                max={100}
                color={batteryColor(state.battery_level)}
                label={t('common.batteryLevel', 'Battery Level')}
                sublabel={`${fmtNumber(state.battery_level, 0)}%`}
              />
              <MetricBar
                value={convertDistance(state.rated_range)}
                max={convertDistance(600)}
                color={COLOR.CYAN}
                label={t('common.estimatedRange', 'Estimated Range')}
                sublabel={`${fmtNumber(convertDistance(state.rated_range))} ${distanceUnit}`}
              />
              {state.is_charging && (
                <MetricBar
                  value={convertSpeed(state.charge_rate)}
                  max={state.charger_power || 100}
                  color="#10b981"
                  label={t('common.chargeRate', 'Charge Rate')}
                  sublabel={`${fmtNumber(convertSpeed(state.charge_rate))} ${speedUnit} added`}
                />
              )}
            </div>

            {/* Quick info chips */}
            <div className="flex flex-wrap gap-2">
              {chips.map((chip) => (
                <span
                  key={chip.label}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium border border-white/[0.06] bg-white/[0.02]"
                >
                  <chip.icon className="h-3 w-3" style={{ color: chip.color }} />
                  <span className="text-[var(--text-secondary)]">{chip.label}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </GlassPanel>
    </FadeIn>
  )
}
