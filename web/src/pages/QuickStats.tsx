import { useQuery } from '@tanstack/react-query'
import { useSettings } from '../hooks/useSettings'
import { getVehicles, getFleetAnalytics } from '../api'
import { GlassPanel, MetricCard } from '../components/ui'
import { Car } from 'lucide-react'
import { fmtInt } from '../lib/numberFormat'
import { usePageTitle } from '../hooks/usePageTitle'

export default function QuickStats() {
  usePageTitle('Quick Stats')
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
          <MetricCard label={`${distanceUnit} Driven`} value={fmtInt(convertDistance(analytics?.total_distance_km ?? 0))} color="cyan" />
          <MetricCard label="Drives" value={analytics?.total_drives || 0} color="green" />
          <MetricCard label="kWh Used" value={fmtInt(analytics?.total_energy_kwh)} color="amber" />
          <MetricCard label="Total Cost" value={`$${fmtInt(analytics?.total_cost)}`} color="purple" />
        </div>

        {/* Footer */}
        <p className="text-center text-[10px] text-[var(--text-muted)]">
          Powered by TeslaSync · <a href="/" className="text-neon-cyan hover:underline">Open Dashboard</a>
        </p>
      </div>
    </div>
  )
}
