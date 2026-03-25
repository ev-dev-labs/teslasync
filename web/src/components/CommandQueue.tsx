import { Trash2, Clock, AlertCircle, Loader2 } from 'lucide-react'
import { GlassPanel } from './ui'
import { useCommandQueue } from '../hooks/useCommandQueue'
import { formatDistanceToNow } from 'date-fns'

const commandLabels: Record<string, string> = {
  lock: 'Lock Doors',
  unlock: 'Unlock Doors',
  honk_horn: 'Honk Horn',
  flash_lights: 'Flash Lights',
  climate_on: 'Climate On',
  climate_off: 'Climate Off',
  charge_start: 'Start Charging',
  charge_stop: 'Stop Charging',
  set_sentry_mode: 'Sentry Mode',
  wake_up: 'Wake Up',
}

export function CommandQueue() {
  const { queuedCommands, removeCommand } = useCommandQueue()

  if (queuedCommands.length === 0) return null

  return (
    <GlassPanel className="p-4">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
        <Clock className="h-4 w-4 text-amber-400" />
        Queued Commands
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-bold">
          {queuedCommands.length}
        </span>
      </h3>
      <div className="space-y-2">
        {queuedCommands.map((cmd) => (
          <div
            key={cmd.id}
            className="flex items-center gap-3 p-2.5 rounded-lg border transition-colors"
            style={{ borderColor: 'var(--glass-border)', background: 'rgba(255,255,255,0.02)' }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[var(--text-primary)]">
                {commandLabels[cmd.command] || cmd.command}
              </p>
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                {cmd.vehicleName || `Vehicle #${cmd.vehicleId}`} · {formatDistanceToNow(cmd.timestamp, { addSuffix: true })}
              </p>
            </div>
            {cmd.status === 'syncing' && (
              <Loader2 className="h-3.5 w-3.5 text-neon-cyan animate-spin shrink-0" />
            )}
            {cmd.status === 'failed' && (
              <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
            )}
            {cmd.status === 'pending' && (
              <Clock className="h-3.5 w-3.5 text-amber-400/60 shrink-0" />
            )}
            <button
              onClick={() => removeCommand(cmd.id)}
              className="p-1 rounded-md text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Remove from queue"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </GlassPanel>
  )
}
