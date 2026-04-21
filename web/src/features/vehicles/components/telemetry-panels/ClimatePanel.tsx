import { useTranslation } from 'react-i18next'
import { Thermometer, Fan, Snowflake, Zap, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import { GlassPanel } from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import { useSettings } from '@/hooks/useSettings'
import { fmtNumber, fmtWithUnit } from '@/lib/numberFormat'
import type { ClimateSnapshot } from '@/api/types'

interface ClimatePanelProps {
  climateData: ClimateSnapshot | null | undefined
}

export function ClimatePanel({ climateData }: ClimatePanelProps) {
  const { t } = useTranslation()
  const { convertTemp, tempUnit } = useSettings()

  return (
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
                climateData.defrost_mode && climateData.defrost_mode !== 'Off'
                  ? 'border-blue-400/30 bg-blue-400/10 text-blue-400'
                  : 'border-white/[0.06] bg-white/[0.02] text-[var(--text-muted)]',
              )}
            >
              <Snowflake className="h-3 w-3" /> Defrost{' '}
              {climateData.defrost_mode && climateData.defrost_mode !== 'Off' ? climateData.defrost_mode : 'OFF'}
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
  )
}
