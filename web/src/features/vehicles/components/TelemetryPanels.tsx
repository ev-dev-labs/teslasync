import { useTranslation } from 'react-i18next'
import {
  Battery, Thermometer, Gauge, Navigation, Eye, BatteryCharging,
  Cog, Shield, ShieldAlert, DoorClosed, Car, Fan, Snowflake,
  CircleDot, Headphones, Navigation2, MapPin, Lock, Unlock, Zap,
  Activity, Lightbulb, Key, User, Monitor, Settings,
} from 'lucide-react'
import { cn } from '@/lib/cn';
import { GlassPanel } from '@/components/ui/GlassPanel'
import { Badge } from '@/components/ui/Badge'
import { FadeIn } from '@/components/motion/FadeIn'
import { StaggerContainer } from '@/components/motion/StaggerContainer'
import { StaggerItem } from '@/components/motion/StaggerItem'
import { MetricCard } from '@/components/data-display/MetricCard'
import { useSettings } from '@/hooks/useSettings'
import { cleanNil } from '@/lib/cleanNil'
import { fmtNumber, fmtInt, fmtWithUnit, fmtPercent } from '@/lib/numberFormat'
import type { VehicleState } from '@/api/types'
import type {
  MotorSnapshot,
  ClimateSnapshot,
  SecurityEvent,
  TirePressureSnapshot,
  ChargingTelemetry,
  MediaSnapshot,
  LocationSnapshot,
} from '@/api/types'

/* ─── Shared helpers ─── */

function InfoTile({
  icon: Icon,
  label,
  value,
  color = 'text-[var(--text-primary)]',
  sub,
}: {
  icon: React.ElementType
  label: string
  value: string | number | boolean
  color?: string
  sub?: string
}) {
  const display = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value
  return (
    <GlassPanel className="p-4 overflow-hidden">
      <div className="flex items-center gap-2 text-[var(--text-muted)] text-xs mb-1.5 min-w-0">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <p className={cn('text-lg font-semibold truncate', color)} title={String(display)}>
        {display}
      </p>
      {sub && <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </GlassPanel>
  )
}

/* ═══════════════════════════════════════════════════════════════════
 * TELEMETRY GRID — quick stat tiles
 * ═══════════════════════════════════════════════════════════════════ */

interface TelemetryGridProps {
  state: VehicleState
}

export function TelemetryGrid({ state }: TelemetryGridProps) {
  const { t } = useTranslation()
  const { convertDistance, convertSpeed, convertTemp, distanceUnit, speedUnit, tempUnit } =
    useSettings()

  return (
    <StaggerContainer className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      <StaggerItem>
        <InfoTile
          icon={Battery}
          label={t('common.battery', 'Battery')}
          value={`${fmtInt(state.battery_level)}%`}
          color={
            state.battery_level > 50
              ? 'text-neon-green'
              : state.battery_level > 20
                ? 'text-neon-amber'
                : 'text-neon-red'
          }
          sub={`${fmtNumber(convertDistance(state.rated_range))} ${distanceUnit} range`}
        />
      </StaggerItem>
      <StaggerItem>
        <InfoTile
          icon={Gauge}
          label={t('common.speed', 'Speed')}
          value={`${fmtNumber(convertSpeed(state.speed))} ${speedUnit}`}
          sub={state.speed > 0 ? 'Driving' : 'Parked'}
        />
      </StaggerItem>
      <StaggerItem>
        <InfoTile
          icon={Thermometer}
          label={t('common.inside', 'Inside')}
          value={`${fmtNumber(convertTemp(state.inside_temp))}${tempUnit}`}
          sub={`Outside: ${fmtNumber(convertTemp(state.outside_temp))}${tempUnit}`}
        />
      </StaggerItem>
      <StaggerItem>
        <InfoTile
          icon={Navigation}
          label={t('common.odometer', 'Odometer')}
          value={`${fmtInt(convertDistance(state.odometer))} ${distanceUnit}`}
        />
      </StaggerItem>
      <StaggerItem>
        <InfoTile
          icon={BatteryCharging}
          label={t('common.charger', 'Charger')}
          value={state.is_charging ? `${fmtInt(state.charger_power)} kW` : 'Not charging'}
          color={state.is_charging ? 'text-neon-green' : 'text-[var(--text-muted)]'}
          sub={
            state.is_charging && state.time_to_full_charge != null
              ? `Full in ${fmtNumber(state.time_to_full_charge)}h`
              : undefined
          }
        />
      </StaggerItem>
      <StaggerItem>
        <InfoTile
          icon={Eye}
          label={t('common.sentry', 'Sentry')}
          value={state.sentry_mode ? 'Active' : 'Off'}
          color={state.sentry_mode ? 'text-neon-red' : 'text-[var(--text-muted)]'}
        />
      </StaggerItem>
    </StaggerContainer>
  )
}

/* ═══════════════════════════════════════════════════════════════════
 * LIVE TELEMETRY PANELS
 * ═══════════════════════════════════════════════════════════════════ */

interface LiveTelemetryProps {
  motorData: MotorSnapshot | null | undefined
  climateData: ClimateSnapshot | null | undefined
  securityData: SecurityEvent | null | undefined
  tireData: TirePressureSnapshot | null | undefined
  chargingTelemetry: ChargingTelemetry | null | undefined
  mediaData: MediaSnapshot | null | undefined
  locationData: LocationSnapshot | null | undefined
  live: Record<string, unknown>
  sseConnected: boolean
}

export function LiveTelemetryPanels({
  motorData,
  climateData,
  securityData,
  tireData,
  chargingTelemetry,
  mediaData,
  locationData,
  live,
  sseConnected,
}: LiveTelemetryProps) {
  const { t } = useTranslation()
  const { convertTemp, convertPressure, convertDistance, convertSpeed, tempUnit, pressureUnit, distanceUnit, speedUnit } =
    useSettings()

  return (
    <>
      {/* Section header with live indicator */}
      <FadeIn delay={0.12}>
        <div className="flex items-center gap-3 mt-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
          </span>
          <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
            {t('common.liveTelemetry', 'Live Telemetry')}
          </h2>
        </div>
      </FadeIn>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ── Powertrain ── */}
        <FadeIn delay={0.14}>
          <GlassPanel className="p-6 h-full">
            <h3 className="section-title flex items-center gap-2 mb-5">
              <Cog className="h-4 w-4 text-neon-cyan" /> {t('common.powertrain', 'Powertrain')}
            </h3>
            {motorData ? (
              <div className="space-y-4">
                {/* Motor state badge */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-muted)]">Motor State</span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold border',
                      motorData.di_state === 'Enabled'
                        ? 'border-green-500/30 bg-green-500/10 text-green-400'
                        : motorData.di_state === 'Standby'
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                          : 'border-gray-500/30 bg-gray-500/10 text-[var(--text-muted)]',
                    )}
                  >
                    <CircleDot className="h-3 w-3" />
                    {cleanNil(motorData.di_state) ?? 'Unknown'}
                  </span>
                </div>

                {/* Torque gauge */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[var(--text-muted)]">Torque</span>
                    <span className="text-[var(--text-primary)] font-mono">
                      {motorData.di_torque != null ? fmtInt(motorData.di_torque) : '—'} Nm
                    </span>
                  </div>
                  <div className="relative h-3 rounded-full bg-white/[0.04] overflow-hidden">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
                    {motorData.di_torque != null && (
                      <div
                        className={cn(
                          'absolute inset-y-0 rounded-full transition-all duration-300',
                          motorData.di_torque >= 0 ? 'bg-green-500/60' : 'bg-red-500/60',
                        )}
                        style={
                          motorData.di_torque >= 0
                            ? {
                                left: '50%',
                                width: `${Math.min((Math.abs(motorData.di_torque) / 500) * 50, 50)}%`,
                              }
                            : {
                                right: '50%',
                                width: `${Math.min((Math.abs(motorData.di_torque) / 500) * 50, 50)}%`,
                              }
                        }
                      />
                    )}
                  </div>
                  <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-0.5">
                    <span>-500</span>
                    <span>0</span>
                    <span>+500</span>
                  </div>
                </div>

                {/* Axle Speed */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-muted)]">Axle Speed</span>
                  <span className="text-sm font-mono text-[var(--text-primary)]">
                    {motorData.di_axle_speed != null ? fmtInt(motorData.di_axle_speed) : '—'} RPM
                  </span>
                </div>

                {/* Stator Temperature */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-muted)]">Stator Temp</span>
                  <span
                    className={cn(
                      'text-sm font-mono',
                      motorData.di_stator_temp != null && motorData.di_stator_temp > 80
                        ? 'text-red-400'
                        : 'text-[var(--text-primary)]',
                    )}
                  >
                    {motorData.di_stator_temp != null
                      ? `${fmtNumber(convertTemp(motorData.di_stator_temp))} ${tempUnit}`
                      : '—'}
                  </span>
                </div>

                {/* Throttle position bar */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[var(--text-muted)]">Throttle Position</span>
                    <span className="text-[var(--text-primary)] font-mono">
                      {motorData.pedal_position != null
                        ? `${fmtPercent(motorData.pedal_position * 100)}`
                        : '—'}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-neon-cyan/60 transition-all duration-300"
                      style={{ width: `${(motorData.pedal_position ?? 0) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Brake indicator */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-muted)]">Brake</span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 text-xs font-semibold',
                      motorData.brake_pedal ? 'text-red-400' : 'text-[var(--text-muted)]',
                    )}
                  >
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        motorData.brake_pedal ? 'bg-red-400' : 'bg-gray-600',
                      )}
                    />
                    {motorData.brake_pedal ? 'Active' : 'Inactive'}
                  </span>
                </div>

                {/* G-Forces */}
                <div className="grid grid-cols-2 gap-3">
                  <MetricCard
                    label="Lateral G"
                    value={
                      motorData.lateral_accel != null
                        ? `${motorData.lateral_accel > 0 ? '+' : ''}${fmtNumber(motorData.lateral_accel)}g`
                        : '—'
                    }
                  />
                  <MetricCard
                    label="Longitudinal G"
                    value={
                      motorData.longitudinal_accel != null
                        ? `${motorData.longitudinal_accel > 0 ? '+' : ''}${fmtNumber(motorData.longitudinal_accel)}g`
                        : '—'
                    }
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)] text-center py-6">
                No motor data available
              </p>
            )}
          </GlassPanel>
        </FadeIn>

        {/* ── Climate ── */}
        <FadeIn delay={0.16}>
          <GlassPanel className="p-6 h-full">
            <h3 className="section-title flex items-center gap-2 mb-5">
              <Thermometer className="h-4 w-4 text-neon-cyan" /> {t('common.climate', 'Climate')}
            </h3>
            {climateData ? (
              <div className="space-y-4">
                {/* Cabin + Outside temps */}
                <div className="grid grid-cols-2 gap-3">
                  <MetricCard
                    label="Cabin"
                    value={
                      climateData.inside_temp != null
                        ? fmtNumber(convertTemp(climateData.inside_temp))
                        : '—'
                    }
                    subtitle={tempUnit}
                  />
                  <MetricCard
                    label="Outside"
                    value={
                      climateData.outside_temp != null
                        ? fmtNumber(convertTemp(climateData.outside_temp))
                        : '—'
                    }
                    subtitle={tempUnit}
                  />
                </div>

                {/* Target temps */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-muted)]">Left Zone</span>
                    <span className="text-sm font-mono text-[var(--text-primary)]">
                      {climateData.hvac_left_temp_request != null
                        ? `${fmtNumber(convertTemp(climateData.hvac_left_temp_request))} ${tempUnit}`
                        : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-muted)]">Right Zone</span>
                    <span className="text-sm font-mono text-[var(--text-primary)]">
                      {climateData.hvac_right_temp_request != null
                        ? `${fmtNumber(convertTemp(climateData.hvac_right_temp_request))} ${tempUnit}`
                        : '—'}
                    </span>
                  </div>
                </div>

                {/* HVAC Power bar */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[var(--text-muted)]">HVAC Power</span>
                    <span className="text-[var(--text-primary)] font-mono">
                      {climateData.hvac_power != null
                        ? `${fmtWithUnit(climateData.hvac_power, 'kW')}`
                        : '—'}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-neon-cyan/60 transition-all duration-300"
                      style={{
                        width: `${Math.min(((climateData.hvac_power ?? 0) / 8) * 100, 100)}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Fan Speed */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                    <Fan className="h-3 w-3" /> Fan Speed
                  </span>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5, 6].map((level) => (
                      <div
                        key={level}
                        className={cn(
                          'h-3 rounded-sm transition-colors',
                          level === 1
                            ? 'w-1.5'
                            : level === 2
                              ? 'w-2'
                              : level === 3
                                ? 'w-2.5'
                                : level === 4
                                  ? 'w-3'
                                  : level === 5
                                    ? 'w-3.5'
                                    : 'w-4',
                          (climateData.hvac_fan_speed ?? 0) >= level
                            ? 'bg-neon-cyan/70'
                            : 'bg-white/[0.06]',
                        )}
                      />
                    ))}
                    <span className="text-xs font-mono text-[var(--text-primary)] ml-1.5">
                      {climateData.hvac_fan_speed ?? 0}
                    </span>
                  </div>
                </div>

                {/* System badges */}
                <div className="flex flex-wrap gap-2 pt-1">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium border',
                      climateData.defrost_mode
                        ? 'border-blue-400/30 bg-blue-400/10 text-blue-400'
                        : 'border-white/[0.06] bg-white/[0.02] text-[var(--text-muted)]',
                    )}
                  >
                    <Snowflake className="h-3 w-3" /> Defrost{' '}
                    {climateData.defrost_mode ? 'ON' : 'OFF'}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium border',
                      climateData.battery_heater_on
                        ? 'border-amber-400/30 bg-amber-400/10 text-amber-400'
                        : 'border-white/[0.06] bg-white/[0.02] text-[var(--text-muted)]',
                    )}
                  >
                    <Zap className="h-3 w-3" /> Battery Heater{' '}
                    {climateData.battery_heater_on ? 'ON' : 'OFF'}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium border',
                      climateData.cabin_overheat_mode &&
                        climateData.cabin_overheat_mode !== 'Off'
                        ? 'border-red-400/30 bg-red-400/10 text-red-400'
                        : 'border-white/[0.06] bg-white/[0.02] text-[var(--text-muted)]',
                    )}
                  >
                    <ShieldAlert className="h-3 w-3" /> Overheat Protection{' '}
                    {climateData.cabin_overheat_mode ?? 'Off'}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)] text-center py-6">
                No climate data available
              </p>
            )}
          </GlassPanel>
        </FadeIn>

        {/* ── Security ── */}
        <FadeIn delay={0.18}>
          <GlassPanel className="p-6 h-full">
            <h3 className="section-title flex items-center gap-2 mb-5">
              <Shield className="h-4 w-4 text-neon-cyan" /> {t('common.security', 'Security')}
            </h3>
            {securityData ? (
              <div className="space-y-4">
                {/* Lock status */}
                <div className="flex items-center gap-4">
                  <div
                    className={cn(
                      'rounded-xl p-3 border',
                      securityData.locked
                        ? 'border-green-500/30 bg-green-500/10'
                        : 'border-amber-500/30 bg-amber-500/10',
                    )}
                  >
                    {securityData.locked ? (
                      <Lock className="h-6 w-6 text-green-400" />
                    ) : (
                      <Unlock className="h-6 w-6 text-amber-400" />
                    )}
                  </div>
                  <div>
                    <p
                      className={cn(
                        'text-lg font-semibold',
                        securityData.locked ? 'text-green-400' : 'text-amber-400',
                      )}
                    >
                      {securityData.locked ? t('common.locked', 'Locked') : t('common.unlocked', 'Unlocked')}
                    </p>
                    <p className="text-[10px] text-white/40">{t('telemetry.lockStatus', 'Vehicle lock status')}</p>
                  </div>
                </div>

                {/* Sentry Mode */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                    <Eye className="h-3 w-3" /> Sentry Mode
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold border',
                      securityData.sentry_mode
                        ? 'border-red-500/30 bg-red-500/10 text-red-400'
                        : 'border-white/[0.06] bg-white/[0.02] text-[var(--text-muted)]',
                    )}
                  >
                    <ShieldAlert className="h-3 w-3" />
                    {securityData.sentry_mode ? 'Active' : 'Inactive'}
                  </span>
                </div>

                {/* Door State */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                    <DoorClosed className="h-3 w-3" /> Door State
                  </span>
                  <span className="text-sm font-mono text-[var(--text-primary)]">
                    {securityData.door_state ?? '—'}
                  </span>
                </div>

                {/* Windows grid */}
                <div>
                  <p className="text-xs text-[var(--text-muted)] mb-2">Windows</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ['FD', securityData.fd_window],
                        ['FP', securityData.fp_window],
                        ['RD', securityData.rd_window],
                        ['RP', securityData.rp_window],
                      ] as const
                    ).map(([label, val]) => (
                      <div
                        key={label}
                        className="flex items-center justify-between rounded-lg bg-white/[0.02] border border-white/[0.06] px-3 py-2"
                      >
                        <span className="text-[11px] text-[var(--text-muted)]">{label}</span>
                        <span
                          className={cn(
                            'text-[11px] font-semibold',
                            val === 'Closed'
                              ? 'text-green-400'
                              : val
                                ? 'text-amber-400'
                                : 'text-[var(--text-muted)]',
                          )}
                        >
                          {val ?? '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* HomeLink + Guest Mode */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                    <Car className="h-3 w-3" /> HomeLink
                  </span>
                  <span
                    className={cn(
                      'text-xs font-medium',
                      securityData.homelink_nearby
                        ? 'text-green-400'
                        : 'text-[var(--text-muted)]',
                    )}
                  >
                    {securityData.homelink_nearby ? 'Nearby' : 'Not detected'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                    <Shield className="h-3 w-3" /> Guest Mode
                  </span>
                  <span
                    className={cn(
                      'text-xs font-medium',
                      securityData.guest_mode
                        ? 'text-amber-400'
                        : 'text-[var(--text-muted)]',
                    )}
                  >
                    {securityData.guest_mode ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)] text-center py-6">
                No security data available
              </p>
            )}
          </GlassPanel>
        </FadeIn>

        {/* ── Vehicle State (Live SSE) ── */}
        <FadeIn delay={0.19}>
          <GlassPanel className="p-6 h-full">
            <h3 className="section-title flex items-center gap-2 mb-5">
              <Activity className="h-4 w-4 text-neon-cyan" /> Vehicle State
              {sseConnected && (
                <span className="ml-auto flex items-center gap-1 text-[10px] text-neon-green">
                  <span className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" />
                  Live
                </span>
              )}
            </h3>
            <div className="space-y-3">
              {/* Lights */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <Lightbulb className="h-3 w-3" /> High Beams
                </span>
                <span
                  className={cn(
                    'text-xs font-medium',
                    (live as Record<string, unknown>).lightsHighBeams
                      ? 'text-neon-cyan'
                      : 'text-[var(--text-muted)]',
                  )}
                >
                  {(live as Record<string, unknown>).lightsHighBeams ? 'On' : 'Off'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <Car className="h-3 w-3" /> Turn Signal
                </span>
                <span
                  className={cn(
                    'text-xs font-medium',
                    (live as Record<string, unknown>).lightsTurnSignal &&
                      (live as Record<string, unknown>).lightsTurnSignal !== 'Off'
                      ? 'text-neon-amber'
                      : 'text-[var(--text-muted)]',
                  )}
                >
                  {((live as Record<string, unknown>).lightsTurnSignal as string) || 'Off'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <ShieldAlert className="h-3 w-3" /> Hazards
                </span>
                <span
                  className={cn(
                    'text-xs font-medium',
                    (live as Record<string, unknown>).lightsHazards
                      ? 'text-neon-red'
                      : 'text-[var(--text-muted)]',
                  )}
                >
                  {(live as Record<string, unknown>).lightsHazards ? 'Active' : 'Off'}
                </span>
              </div>

              <div className="border-t border-white/5" />

              {/* Driver & Keys */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <User className="h-3 w-3" /> Driver Seat
                </span>
                <span
                  className={cn(
                    'text-xs font-medium',
                    (live as Record<string, unknown>).driverSeatOccupied
                      ? 'text-green-400'
                      : 'text-[var(--text-muted)]',
                  )}
                >
                  {(live as Record<string, unknown>).driverSeatOccupied ? 'Occupied' : 'Empty'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <Key className="h-3 w-3" /> Paired Keys
                </span>
                <span className="text-xs font-medium text-[var(--text-primary)]">
                  {((live as Record<string, unknown>).pairedKeyCount as string) || '—'}
                </span>
              </div>

              <div className="border-t border-white/5" />

              {/* Access Modes */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <Car className="h-3 w-3" /> Valet Mode
                </span>
                <span
                  className={cn(
                    'text-xs font-medium',
                    (live as Record<string, unknown>).valetMode
                      ? 'text-purple-400'
                      : 'text-[var(--text-muted)]',
                  )}
                >
                  {(live as Record<string, unknown>).valetMode ? 'Enabled' : 'Off'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <Settings className="h-3 w-3" /> Service Mode
                </span>
                <span
                  className={cn(
                    'text-xs font-medium',
                    (live as Record<string, unknown>).serviceMode
                      ? 'text-amber-400'
                      : 'text-[var(--text-muted)]',
                  )}
                >
                  {(live as Record<string, unknown>).serviceMode ? 'Active' : 'Off'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <Gauge className="h-3 w-3" /> Speed Limit
                </span>
                <span
                  className={cn(
                    'text-xs font-medium',
                    (live as Record<string, unknown>).speedLimitMode
                      ? 'text-neon-cyan'
                      : 'text-[var(--text-muted)]',
                  )}
                >
                  {(live as Record<string, unknown>).speedLimitMode
                    ? `${fmtNumber(convertSpeed((live as Record<string, unknown>).currentSpeedLimit as number))} ${speedUnit}`
                    : t('common.off', 'Off')}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <Monitor className="h-3 w-3" /> Center Display
                </span>
                <span className="text-xs font-medium text-[var(--text-primary)]">
                  {((live as Record<string, unknown>).centerDisplay as string) || '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> HomeLink Devices
                </span>
                <span className="text-xs font-medium text-[var(--text-primary)]">
                  {((live as Record<string, unknown>).homelinkDeviceCount as string) || '—'}
                </span>
              </div>
            </div>
          </GlassPanel>
        </FadeIn>

        {/* ── Tire Pressure ── */}
        <FadeIn delay={0.2}>
          <GlassPanel className="p-6 h-full">
            <h3 className="section-title flex items-center gap-2 mb-5">
              <Gauge className="h-4 w-4 text-neon-cyan" />{' '}
              {t('common.tirePressure', 'Tire Pressure')}
            </h3>
            {tireData ? (
              <TirePressurePanel tireData={tireData} convertPressure={convertPressure} pressureUnit={pressureUnit} />
            ) : (
              <p className="text-xs text-[var(--text-muted)] text-center py-6">
                No tire pressure data available
              </p>
            )}
          </GlassPanel>
        </FadeIn>

        {/* ── Energy & Charging ── */}
        <FadeIn delay={0.22}>
          <GlassPanel className="p-6 h-full">
            <h3 className="section-title flex items-center gap-2 mb-5">
              <BatteryCharging className="h-4 w-4 text-neon-cyan" /> Energy &amp; Charging
            </h3>
            {chargingTelemetry ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <MetricCard
                    label="Pack Voltage"
                    value={
                      chargingTelemetry.pack_voltage != null
                        ? fmtNumber(chargingTelemetry.pack_voltage)
                        : '—'
                    }
                    subtitle="V"
                  />
                  <MetricCard
                    label="Pack Current"
                    value={
                      chargingTelemetry.pack_current != null
                        ? fmtNumber(chargingTelemetry.pack_current)
                        : '—'
                    }
                    subtitle="A"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-muted)]">Energy Remaining</span>
                  <span className="text-sm font-mono text-[var(--text-primary)]">
                    {chargingTelemetry.energy_remaining != null
                      ? `${fmtWithUnit(chargingTelemetry.energy_remaining, 'kWh')}`
                      : '—'}
                  </span>
                </div>

                {/* BMS State */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-muted)]">BMS State</span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold border',
                      chargingTelemetry.bms_state === 'Standby'
                        ? 'border-green-500/30 bg-green-500/10 text-green-400'
                        : chargingTelemetry.bms_state === 'Charge'
                          ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400'
                          : chargingTelemetry.bms_state === 'Fault'
                            ? 'border-red-500/30 bg-red-500/10 text-red-400'
                            : 'border-gray-500/30 bg-gray-500/10 text-[var(--text-muted)]',
                    )}
                  >
                    {chargingTelemetry.bms_state ?? 'Unknown'}
                  </span>
                </div>

                {/* Cell voltage spread */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-muted)]">Cell Voltage Spread</span>
                  <span
                    className={cn(
                      'text-sm font-mono',
                      chargingTelemetry.brick_voltage_max != null &&
                        chargingTelemetry.brick_voltage_min != null &&
                        chargingTelemetry.brick_voltage_max -
                          chargingTelemetry.brick_voltage_min >
                          0.05
                        ? 'text-amber-400'
                        : 'text-[var(--text-primary)]',
                    )}
                  >
                    {chargingTelemetry.brick_voltage_max != null &&
                    chargingTelemetry.brick_voltage_min != null
                      ? `${fmtWithUnit((chargingTelemetry.brick_voltage_max - chargingTelemetry.brick_voltage_min) * 1000, 'mV')}`
                      : '—'}
                  </span>
                </div>

                {/* Battery heater */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-muted)]">Battery Heater</span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium border',
                      chargingTelemetry.battery_heater_on
                        ? 'border-amber-400/30 bg-amber-400/10 text-amber-400'
                        : 'border-white/[0.06] bg-white/[0.02] text-[var(--text-muted)]',
                    )}
                  >
                    <Zap className="h-3 w-3" />{' '}
                    {chargingTelemetry.battery_heater_on ? 'Active' : 'Off'}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)] text-center py-6">
                No charging telemetry available
              </p>
            )}
          </GlassPanel>
        </FadeIn>

        {/* ── Media & Navigation ── */}
        <FadeIn delay={0.24}>
          <GlassPanel className="p-6 h-full">
            <h3 className="section-title flex items-center gap-2 mb-5">
              <Headphones className="h-4 w-4 text-neon-purple" /> Media &amp; Navigation
            </h3>
            <div className="space-y-5">
              {/* Now Playing */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
                  Now Playing
                </p>
                {mediaData ? (
                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-2">
                    <p className="text-sm font-bold text-[var(--text-primary)] truncate">
                      {cleanNil(mediaData.now_playing_title) || 'Nothing playing'}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] truncate">
                      {cleanNil(mediaData.now_playing_artist) || 'Unknown artist'}
                    </p>
                    <div className="flex items-center gap-2">
                      {cleanNil(mediaData.playback_source) && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-[var(--text-muted)]">
                          {cleanNil(mediaData.playback_source)}
                        </span>
                      )}
                      {cleanNil(mediaData.playback_status) && (
                        <Badge
                          color={
                            mediaData.playback_status === 'Playing'
                              ? 'green'
                              : mediaData.playback_status === 'Paused'
                                ? 'amber'
                                : 'neutral'
                          }
                        >
                          {cleanNil(mediaData.playback_status)}
                        </Badge>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">No media data</p>
                )}
              </div>

              {/* Navigation destination */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 flex items-center gap-1">
                  <Navigation2 className="h-3 w-3" /> Navigation
                </p>
                {locationData ? (
                  <div className="space-y-3">
                    {locationData.destination_name ? (
                      <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4">
                        <p className="text-sm font-bold text-[var(--text-primary)] truncate flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-neon-cyan flex-shrink-0" />
                          {locationData.destination_name}
                        </p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-secondary)]">
                          {locationData.miles_to_arrival != null && (
                            <span>
                              {fmtNumber(convertDistance(locationData.miles_to_arrival))}{' '}
                              {distanceUnit}
                            </span>
                          )}
                          {locationData.minutes_to_arrival != null && (
                            <span>{fmtInt(locationData.minutes_to_arrival)} min</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-[var(--text-muted)]">No active destination</p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      {locationData.located_at_home && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                          🏠 Home
                        </span>
                      )}
                      {locationData.located_at_work && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          🏢 Work
                        </span>
                      )}
                      {locationData.located_at_favorite && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                          ⭐ Favorite
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">No location data</p>
                )}
              </div>
            </div>
          </GlassPanel>
        </FadeIn>
      </div>
    </>
  )
}

/* ─── Tire Pressure sub-component ─── */

function TirePressurePanel({
  tireData,
  convertPressure,
  pressureUnit,
}: {
  tireData: TirePressureSnapshot
  convertPressure: (bar: number) => number
  pressureUnit: string
}) {
  const toDisplay = (bar: number | null) => (bar != null ? convertPressure(bar) : null)
  const tires = [
    { label: 'FL', pressure: toDisplay(tireData.front_left) },
    { label: 'FR', pressure: toDisplay(tireData.front_right) },
    { label: 'RL', pressure: toDisplay(tireData.rear_left) },
    { label: 'RR', pressure: toDisplay(tireData.rear_right) },
  ]

  const getColor = (val: number | null) => {
    if (val == null) return 'text-[var(--text-muted)]'
    const lowCrit = convertPressure(2.068)
    const lowWarn = convertPressure(2.413)
    const highWarn = convertPressure(3.103)
    const highCrit = convertPressure(3.447)
    if (val < lowCrit || val > highCrit) return 'text-red-400'
    if (val < lowWarn || val > highWarn) return 'text-amber-400'
    return 'text-green-400'
  }

  const getBorder = (val: number | null) => {
    if (val == null) return 'border-gray-600/30'
    const lowCrit = convertPressure(2.068)
    const lowWarn = convertPressure(2.413)
    const highWarn = convertPressure(3.103)
    const highCrit = convertPressure(3.447)
    if (val < lowCrit || val > highCrit) return 'border-red-500/30'
    if (val < lowWarn || val > highWarn) return 'border-amber-500/30'
    return 'border-green-500/30'
  }

  const lowWarn = convertPressure(2.413)
  const highWarn = convertPressure(3.103)
  const allGood = tires.every(
    (t) => t.pressure != null && t.pressure >= lowWarn && t.pressure <= highWarn,
  )
  const lowCrit = convertPressure(2.068)
  const highCrit = convertPressure(3.447)
  const anyBad = tires.some(
    (t) => t.pressure != null && (t.pressure < lowCrit || t.pressure > highCrit),
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {tires.map((t) => (
          <div
            key={t.label}
            className={cn(
              'rounded-xl border bg-white/[0.02] p-4 text-center',
              getBorder(t.pressure),
            )}
          >
            <p className="text-[10px] text-[var(--text-muted)] mb-1">{t.label}</p>
            <p className={cn('text-xl font-bold font-mono', getColor(t.pressure))}>
              {t.pressure != null ? fmtNumber(t.pressure) : '—'}
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">{pressureUnit}</p>
          </div>
        ))}
      </div>
      <div className="text-center">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold border',
            allGood
              ? 'border-green-500/30 bg-green-500/10 text-green-400'
              : anyBad
                ? 'border-red-500/30 bg-red-500/10 text-red-400'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-400',
          )}
        >
          {allGood ? '✓ All Normal' : anyBad ? '✗ Attention Needed' : '⚠ Check Pressure'}
        </span>
      </div>
    </div>
  )
}
