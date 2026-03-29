import { useQuery } from '@tanstack/react-query'
import { useSettings } from '../hooks/useSettings'
import { getVehicles, getFleetAnalytics } from '../api'
import { GlassPanel } from '../components/ui'
import { Car } from 'lucide-react'

export default function QuickStats() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const { data: analytics } = useQuery({ queryKey: ['fleet-analytics'], queryFn: () => getFleetAnalytics(30) })
  const { convertDistance, distanceUnit } = useSettings()

  const vehicle = vehicles?.[0]

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{background: 'var(--bg)'}}>
      <div className="w-full max-w-md space-y-4">
        {/* Vehicle card */}
        <GlassPanel className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-neon-cyan/10 flex items-center justify-center">
              <Car className="h-5 w-5 text-neon-cyan" />
            </div>
            <div>
              <p className="text-lg font-bold" style={{color:'var(--text-primary)'}}>{vehicle?.display_name || 'Tesla'}</p>
              <p className="text-xs text-[var(--text-muted)]">{vehicle?.model} · {vehicle?.state}</p>
            </div>
          </div>
        </GlassPanel>

        {/* Key metrics */}
        <div className="grid grid-cols-2 gap-3">
          <GlassPanel className="p-4 text-center">
            <p className="text-2xl font-bold text-neon-cyan">{convertDistance(analytics?.total_distance_km ?? 0).toFixed(0)}</p>
            <p className="text-[10px] text-[var(--text-muted)]">{distanceUnit} Driven</p>
          </GlassPanel>
          <GlassPanel className="p-4 text-center">
            <p className="text-2xl font-bold text-neon-green">{analytics?.total_drives || 0}</p>
            <p className="text-[10px] text-[var(--text-muted)]">Drives</p>
          </GlassPanel>
          <GlassPanel className="p-4 text-center">
            <p className="text-2xl font-bold text-neon-amber">{analytics?.total_energy_kwh?.toFixed(0) || '0'}</p>
            <p className="text-[10px] text-[var(--text-muted)]">kWh Used</p>
          </GlassPanel>
          <GlassPanel className="p-4 text-center">
            <p className="text-2xl font-bold text-neon-purple">${analytics?.total_cost?.toFixed(0) || '0'}</p>
            <p className="text-[10px] text-[var(--text-muted)]">Total Cost</p>
          </GlassPanel>
        </div>

        {/* Footer */}
        <p className="text-center text-[10px] text-[var(--text-muted)]">
          Powered by TeslaSync · <a href="/" className="text-neon-cyan hover:underline">Open Dashboard</a>
        </p>
      </div>
    </div>
  )
}
