import { useTranslation } from 'react-i18next'
import { Lock, Unlock, Shield, Wind, Cpu } from 'lucide-react'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { FadeIn } from '@/components/motion/FadeIn'
import { TeslaCarViz, parseModelKey } from '@/components/data-display/TeslaCarViz'
import { LinearGauge } from '@/components/charts/LinearGauge'
import { MetricBar } from '@/components/data-display/MetricBar'
import { useUnits } from '@/hooks/useUnits'
import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion'
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

/**
 * Gauge upper bounds are expressed in SI so the LinearGauge percent fill
 * reflects the same physical quantity regardless of
 * the user's display preference (km/h vs mph, km vs mi).
 *   600 mi  ≈ 965_606 m         — practical upper bound for rated range
 *   250 mph ≈ 111.76 m/s        — practical upper bound for vehicle speed
 *   100 mph ≈ 160_934.4 m/h     — supercharger-class charge-rate ceiling
 */
const MAX_RANGE_METERS = 600 * 1609.344
const MAX_SPEED_MPS = 250 * 0.44704
const MAX_CHARGE_RATE_METERS_PER_HOUR = 100 * 1609.344

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
  const { unitPrefs, formatDistance } = useUnits()

  // Telemetry numerics can arrive absent (missing signal / cold cache) even
  // though the wire type says `number`. Coalesce to 0 at the point of use so
  // the SI→display conversions stay finite and the gauges/bars never receive
  // NaN (which paints a broken arc / an infinite-width bar).
  const batteryLevel = state.battery_level ?? 0
  const ratedRange = state.rated_range ?? 0
  const speed = state.speed ?? 0
  const chargeRate = state.charge_rate ?? 0
  const chargerPower = state.charger_power ?? 0

  const chips = [
    {
      id: 'lock',
      icon: state.is_locked ? Lock : Unlock,
      label: state.is_locked ? t('common.locked', 'Locked') : t('common.unlocked', 'Unlocked'),
      color: boolColor(state.is_locked),
    },
    {
      id: 'sentry',
      icon: Shield,
      label: state.sentry_mode ? t('common.sentryOn', 'Sentry ON') : t('common.sentryOff', 'Sentry OFF'),
      color: state.sentry_mode ? COLOR.BAD : COLOR.MUTED,
    },
    {
      id: 'climate',
      icon: Wind,
      label: state.is_climate_on ? t('common.climateOn', 'Climate ON') : t('common.climateOff', 'Climate OFF'),
      color: state.is_climate_on ? COLOR.CYAN : COLOR.MUTED,
    },
    {
      id: 'software',
      icon: Cpu,
      label: state.software_version || t('common.notAvailable', 'N/A'),
      color: COLOR.PURPLE,
    },
  ]

  // Pre-convert SI values to user-pref numerics so LinearGauge / MetricBar
  // receive matching value/max pairs in the SAME unit.
  const rangeDisplay = convertDistanceFromSI(ratedRange, unitPrefs.distance)
  const rangeMax = convertDistanceFromSI(MAX_RANGE_METERS, unitPrefs.distance)
  const speedDisplay = convertSpeedFromSI(speed, unitPrefs.speed)
  const speedMax = convertSpeedFromSI(MAX_SPEED_MPS, unitPrefs.speed)
  // ChargeRate is delivered as distance-per-hour (m/h) — convert through the
  // distance pref, then label as `<unit>/h` to match the Tesla UX.
  const chargeRateDisplay = convertDistanceFromSI(chargeRate, unitPrefs.distance)
  const chargeRateMax = convertDistanceFromSI(MAX_CHARGE_RATE_METERS_PER_HOUR, unitPrefs.distance)

  return (
    <FadeIn delay={0.05}>
      <GlassPanel className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-neon-cyan/[0.02] via-transparent to-neon-purple/[0.02]" />
        <div className="relative grid grid-cols-1 lg:grid-cols-[auto,1fr] gap-8 p-6 lg:p-8">
          {/* Car visualization */}
          <div className="flex items-center justify-center">
            <TeslaCarViz
              batteryLevel={batteryLevel}
              isCharging={state.is_charging}
              isLocked={state.is_locked}
              isClimateOn={state.is_climate_on}
              sentryMode={state.sentry_mode}
              speed={speed}
              size="lg"
              model={parseModelKey(vehicle?.model)}
            />
          </div>

          {/* Gauges + metrics */}
          <div className="flex flex-col gap-6">
            {/* Gauge row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <LinearGauge
                value={batteryLevel}
                max={100}
                label={t('common.battery', 'Battery')}
                unit="%"
                color={batteryColor(batteryLevel)}
                size={110}
              />
              <LinearGauge
                value={Math.round(rangeDisplay)}
                max={Math.round(rangeMax)}
                label={t('common.range', 'Range')}
                unit={unitPrefs.distance}
                color={COLOR.CYAN}
                size={110}
              />
              <LinearGauge
                value={Math.round(speedDisplay)}
                max={Math.round(speedMax)}
                label={t('common.speed', 'Speed')}
                unit={unitPrefs.speed}
                color={speed > 0 ? COLOR.PURPLE : COLOR.DARK}
                size={110}
              />
              <LinearGauge
                value={chargerPower}
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
                value={batteryLevel}
                max={100}
                color={batteryColor(batteryLevel)}
                label={t('common.batteryLevel', 'Battery Level')}
                sublabel={`${fmtNumber(batteryLevel, 0)}%`}
              />
              <MetricBar
                value={rangeDisplay}
                max={rangeMax}
                color={COLOR.CYAN}
                label={t('common.estimatedRange', 'Estimated Range')}
                sublabel={formatDistance(ratedRange)}
              />
              {state.is_charging && (
                <MetricBar
                  value={chargeRateDisplay}
                  max={chargeRateMax}
                  color="#10b981"
                  label={t('common.chargeRate', 'Charge Rate')}
                  sublabel={`${formatDistance(chargeRate)}/h`}
                />
              )}
            </div>

            {/* Quick info chips */}
            <div className="flex flex-wrap gap-2">
              {chips.map((chip) => (
                <span
                  key={chip.id}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border border-white/[0.06] bg-white/[0.02]"
                >
                  <chip.icon className="h-3 w-3" style={{ color: chip.color }} aria-hidden="true" />
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
