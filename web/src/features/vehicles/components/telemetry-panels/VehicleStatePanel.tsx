import { useTranslation } from 'react-i18next'
import {
  Activity, Lightbulb, Car, ShieldAlert, User, Key, Settings, Gauge, Monitor, MapPin,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { GlassPanel } from '@/components/ui'
import { useUnits } from '@/hooks/useUnits'

interface VehicleStatePanelProps {
  live: Record<string, unknown>
  sseConnected: boolean
}

export function VehicleStatePanel({ live, sseConnected }: VehicleStatePanelProps) {
  const { t } = useTranslation()
  const { formatSpeed } = useUnits()

  return (
    <GlassPanel className="p-6 h-full">
      <h3 className="section-title flex items-center gap-2 mb-5">
        <Activity className="h-4 w-4 text-cyan-300" /> Vehicle State
        {sseConnected && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-300">
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
              live.lightsHighBeams ? 'text-cyan-300' : 'text-[var(--text-muted)]',
            )}
          >
            {live.lightsHighBeams ? 'On' : 'Off'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
            <Car className="h-3 w-3" /> Turn Signal
          </span>
          <span
            className={cn(
              'text-xs font-medium',
              live.lightsTurnSignal && live.lightsTurnSignal !== 'Off'
                ? 'text-amber-300'
                : 'text-[var(--text-muted)]',
            )}
          >
            {(live.lightsTurnSignal as string) || 'Off'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
            <ShieldAlert className="h-3 w-3" /> Hazards
          </span>
          <span
            className={cn(
              'text-xs font-medium',
              live.lightsHazards ? 'text-rose-300' : 'text-[var(--text-muted)]',
            )}
          >
            {live.lightsHazards ? 'Active' : 'Off'}
          </span>
        </div>

        <div className="border-t border-[var(--border-subtle)]" />

        {/* Driver & Keys */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
            <User className="h-3 w-3" /> Driver Seat
          </span>
          <span
            className={cn(
              'text-xs font-medium',
              live.driverSeatOccupied ? 'text-green-400' : 'text-[var(--text-muted)]',
            )}
          >
            {live.driverSeatOccupied ? 'Occupied' : 'Empty'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
            <Key className="h-3 w-3" /> Paired Keys
          </span>
          <span className="text-xs font-medium text-[var(--text-primary)]">
            {(live.pairedKeyCount as string) || '—'}
          </span>
        </div>

        <div className="border-t border-[var(--border-subtle)]" />

        {/* Access Modes */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
            <Car className="h-3 w-3" /> Valet Mode
          </span>
          <span
            className={cn(
              'text-xs font-medium',
              live.valetMode ? 'text-purple-400' : 'text-[var(--text-muted)]',
            )}
          >
            {live.valetMode ? 'Enabled' : 'Off'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
            <Settings className="h-3 w-3" /> Service Mode
          </span>
          <span
            className={cn(
              'text-xs font-medium',
              live.serviceMode ? 'text-amber-400' : 'text-[var(--text-muted)]',
            )}
          >
            {live.serviceMode ? 'Active' : 'Off'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
            <Gauge className="h-3 w-3" /> Speed Limit
          </span>
          <span
            className={cn(
              'text-xs font-medium',
              live.speedLimitMode ? 'text-cyan-300' : 'text-[var(--text-muted)]',
            )}
          >
            {live.speedLimitMode
              ? formatSpeed(live.currentSpeedLimit as number)
              : t('common.off', 'Off')}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
            <Monitor className="h-3 w-3" /> Center Display
          </span>
          <span className="text-xs font-medium text-[var(--text-primary)]">
            {(live.centerDisplay as string) || '—'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
            <MapPin className="h-3 w-3" /> HomeLink Devices
          </span>
          <span className="text-xs font-medium text-[var(--text-primary)]">
            {(live.homelinkDeviceCount as string) || '—'}
          </span>
        </div>
      </div>
    </GlassPanel>
  )
}
