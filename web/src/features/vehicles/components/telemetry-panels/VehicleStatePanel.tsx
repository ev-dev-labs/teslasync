import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity, Lightbulb, Car, ShieldAlert, User, Key, Settings, Gauge, Monitor, MapPin,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { GlassPanel } from '@/components/ui'
import { useUnits } from '@/hooks/useUnits'

interface VehicleStatePanelProps {
  /** Flattened live signal bag from `useVehicleLive` (values are `unknown`). */
  live: Record<string, unknown>
  sseConnected: boolean
}

/**
 * Render a count. A finite number — including `0` — renders verbatim so a
 * genuine "zero devices" reads differently from a missing signal. Anything
 * non-numeric (undefined / string / boolean) collapses to an em-dash.
 *
 * Replaces the previous `(value as string) || '—'`, which both lied about the
 * type (the field is a `number`) and silently swallowed a legitimate `0`.
 */
function formatCount(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—'
}

/** Render a non-empty string value; missing / blank / non-string → em-dash. */
function formatText(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : '—'
}

const MUTED_CLASS = 'text-[var(--text-muted)]'

interface StateRowProps {
  icon: LucideIcon
  label: string
  value: ReactNode
  /**
   * Tri-state colour control:
   *  - `undefined` → always render `activeClass` (informational rows).
   *  - `true`      → render `activeClass` (active status).
   *  - `false`     → render the muted colour (inactive status).
   */
  active?: boolean
  /** Text colour when active / informational. Defaults to primary text. */
  activeClass?: string
}

function StateRow({
  icon: Icon,
  label,
  value,
  active,
  activeClass = 'text-[var(--text-primary)]',
}: StateRowProps) {
  return (
    <div className="flex items-center justify-between">
      <span className={cn('text-xs flex items-center gap-1', MUTED_CLASS)}>
        <Icon className="h-3 w-3" aria-hidden="true" /> {label}
      </span>
      <span className={cn('text-xs font-medium', active === false ? MUTED_CLASS : activeClass)}>
        {value}
      </span>
    </div>
  )
}

export function VehicleStatePanel({ live, sseConnected }: VehicleStatePanelProps) {
  const { t } = useTranslation()
  const { formatSpeed } = useUnits()

  const offLabel = t('common.off', 'Off')

  // Turn signal is a free-form string ('Left' / 'Right' / 'Off' / …). Treat a
  // blank or explicit 'Off' as inactive; anything else is a live indication.
  const turnSignalRaw = typeof live.lightsTurnSignal === 'string' ? live.lightsTurnSignal : ''
  const turnSignalActive = turnSignalRaw !== '' && turnSignalRaw !== 'Off'

  const speedLimitActive = Boolean(live.speedLimitMode)
  const currentLimit = typeof live.currentSpeedLimit === 'number' ? live.currentSpeedLimit : undefined

  return (
    <GlassPanel className="p-6 h-full">
      <h3 className="section-title flex items-center gap-2 mb-5">
        <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />{' '}
        {t('telemetry.vehicleState', 'Vehicle State')}
        {sseConnected && (
          <span
            className="ml-auto flex items-center gap-1 text-2xs text-emerald-300"
            role="status"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" aria-hidden="true" />
            {t('telemetry.live', 'Live')}
          </span>
        )}
      </h3>
      <div className="space-y-3">
        {/* Lights */}
        <StateRow
          icon={Lightbulb}
          label={t('telemetry.highBeams', 'High Beams')}
          value={live.lightsHighBeams ? t('common.on', 'On') : offLabel}
          active={Boolean(live.lightsHighBeams)}
          activeClass="text-cyan-300"
        />
        <StateRow
          icon={Car}
          label={t('telemetry.turnSignal', 'Turn Signal')}
          value={turnSignalActive ? turnSignalRaw : offLabel}
          active={turnSignalActive}
          activeClass="text-amber-300"
        />
        <StateRow
          icon={ShieldAlert}
          label={t('telemetry.hazards', 'Hazards')}
          value={live.lightsHazards ? t('common.active', 'Active') : offLabel}
          active={Boolean(live.lightsHazards)}
          activeClass="text-rose-300"
        />

        <div className="border-t border-[var(--border-subtle)]" />

        {/* Driver & Keys */}
        <StateRow
          icon={User}
          label={t('telemetry.driverSeat', 'Driver Seat')}
          value={
            live.driverSeatOccupied
              ? t('telemetry.seatOccupied', 'Occupied')
              : t('telemetry.seatEmpty', 'Empty')
          }
          active={Boolean(live.driverSeatOccupied)}
          activeClass="text-green-400"
        />
        <StateRow
          icon={Key}
          label={t('telemetry.pairedKeys', 'Paired Keys')}
          value={formatCount(live.pairedKeyCount)}
        />

        <div className="border-t border-[var(--border-subtle)]" />

        {/* Access Modes */}
        <StateRow
          icon={Car}
          label={t('telemetry.valetMode', 'Valet Mode')}
          value={live.valetMode ? t('common.enabled', 'Enabled') : offLabel}
          active={Boolean(live.valetMode)}
          activeClass="text-purple-400"
        />
        <StateRow
          icon={Settings}
          label={t('telemetry.serviceMode', 'Service Mode')}
          value={live.serviceMode ? t('common.active', 'Active') : offLabel}
          active={Boolean(live.serviceMode)}
          activeClass="text-amber-400"
        />
        <StateRow
          icon={Gauge}
          label={t('telemetry.speedLimit', 'Speed Limit')}
          value={speedLimitActive ? formatSpeed(currentLimit) : offLabel}
          active={speedLimitActive}
          activeClass="text-cyan-300"
        />
        <StateRow
          icon={Monitor}
          label={t('telemetry.centerDisplay', 'Center Display')}
          value={formatText(live.centerDisplay)}
        />
        <StateRow
          icon={MapPin}
          label={t('telemetry.homelinkDevices', 'HomeLink Devices')}
          value={formatCount(live.homelinkDeviceCount)}
        />
      </div>
    </GlassPanel>
  )
}
