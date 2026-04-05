import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getLocationSnapshots, getLocationSnapshotLatest } from '../api'
import { request } from '../api/client'
import { PageHeader, GlassPanel, FadeIn, Skeleton } from '../components/ui'
import { Navigation, MapPin, Home, Building, Star, Clock, AlertTriangle, TrendingUp, Route, Compass, Timer, TrafficCone } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import clsx from 'clsx'
import { useSettings } from '../hooks/useSettings'
import { formatDateTime } from '../lib/dateFormat'

/* ------------------------------------------------------------------ */
/*  Chart tooltip                                                      */
/* ------------------------------------------------------------------ */

interface NavTooltipPayload { name: string; value: number; color?: string }
function NavTooltip({ active, payload, label }: { active?: boolean; payload?: NavTooltipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color }}>●</span> {p.name}: {p.value === 1 ? 'Yes' : 'No'}
        </p>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Location status card                                               */
/* ------------------------------------------------------------------ */

function LocationStatusCard({
  label,
  icon: Icon,
  active,
  loading,
}: {
  label: string
  icon: React.ElementType
  active: boolean
  loading: boolean
}) {
  return (
    <div className="glass-card p-4 sm:p-5 flex flex-col items-center gap-3">
      {loading ? (
        <Skeleton className="h-20 w-full rounded-lg" />
      ) : (
        <>
          <div className={clsx(
            'w-12 h-12 rounded-full flex items-center justify-center',
            active ? 'bg-neon-green/20' : 'bg-white/5',
          )}>
            <Icon className={clsx('h-6 w-6', active ? 'text-neon-green' : 'text-[var(--text-muted)]')} />
          </div>
          <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            {label}
          </p>
          <div className="flex items-center gap-2">
            <span className={clsx(
              'h-2.5 w-2.5 rounded-full',
              active ? 'bg-neon-green shadow-[0_0_6px_rgba(16,185,129,0.6)]' : 'bg-white/10',
            )} />
            <span className={clsx(
              'text-sm font-semibold',
              active ? 'text-neon-green' : 'text-[var(--text-muted)]',
            )}>
              {active ? 'Yes' : 'No'}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Traffic delay badge                                                */
/* ------------------------------------------------------------------ */

function TrafficDelayBadge({ minutes }: { minutes: number | null | undefined }) {
  const val = minutes ?? 0
  const severity = val === 0 ? 'green' : val <= 5 ? 'amber' : 'red'
  const colorMap = {
    green: { text: 'text-neon-green', bg: 'bg-neon-green/20', border: 'border-neon-green/30' },
    amber: { text: 'text-neon-amber', bg: 'bg-neon-amber/20', border: 'border-neon-amber/30' },
    red: { text: 'text-neon-red', bg: 'bg-neon-red/20', border: 'border-neon-red/30' },
  } as const
  const c = colorMap[severity]
  const label = val === 0 ? 'No delay' : `${val} min delay`

  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium border', c.bg, c.text, c.border)}>
      <TrafficCone className="h-3 w-3" />
      {label}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/*  Stat card                                                          */
/* ------------------------------------------------------------------ */

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = 'text-neon-cyan',
}: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  color?: string
}) {
  return (
    <div className="glass-card p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={clsx('h-4 w-4', color)} />
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </p>
      </div>
      <p className={clsx('text-2xl font-bold', color)}>{value}</p>
      {sub && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{sub}</p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main page component                                                */
/* ------------------------------------------------------------------ */

export default function NavigationRoute() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null
  const { convertDistance, distanceUnit } = useSettings()

  /* Latest snapshot for active navigation & location status */
  const { data: latest, isLoading: loadingLatest } = useQuery({
    queryKey: ['location-snapshot-latest', vehicleId],
    queryFn: () => getLocationSnapshotLatest(vehicleId!),
    enabled: vehicleId !== null,
    refetchInterval: 10000,
  })

  // Live signals for real-time at-home/work/favorite status
  const { data: liveSignals } = useQuery<{ signals: Record<string, { value: unknown }> }>({
    queryKey: ['live-location-signals', vehicleId],
    queryFn: () => request(`/signals/${vehicleId}/live`),
    enabled: vehicleId !== null,
    refetchInterval: 5000,
  })

  // Extract live location booleans (prefer live over stale DB snapshot)
  const isAtHome = liveSignals?.signals?.LocatedAtHome?.value === true || latest?.located_at_home === true
  const isAtWork = liveSignals?.signals?.LocatedAtWork?.value === true || latest?.located_at_work === true
  const isAtFavorite = liveSignals?.signals?.LocatedAtFavorite?.value === true || latest?.located_at_favorite === true

  /* History for charts and recent destinations table */
  const { data: history, isLoading: loadingHistory } = useQuery({
    queryKey: ['location-snapshots', vehicleId],
    queryFn: () => getLocationSnapshots(vehicleId!, 200),
    enabled: vehicleId !== null,
    refetchInterval: 10000,
  })

  /* ---- Chart data: presence booleans over time ---- */
  const presenceChartData = useMemo(() => {
    if (!history || history.length === 0) return []
    return history.slice().reverse().map(s => ({
      time: formatDateTime(s.created_at),
      home: s.located_at_home ? 1 : 0,
      work: s.located_at_work ? 1 : 0,
      favorite: s.located_at_favorite ? 1 : 0,
    }))
  }, [history])

  /* ---- Recent destinations (rows with a destination_name) ---- */
  const recentDestinations = useMemo(() => {
    if (!history || history.length === 0) return []
    return history
      .filter(s => s.destination_name)
      .slice(0, 50)
      .map(s => ({
        time: formatDateTime(s.created_at),
        destination: s.destination_name ?? '—',
        miles: s.miles_to_arrival,
        minutes: s.minutes_to_arrival,
        delay: s.route_traffic_delay_min,
      }))
  }, [history])

  /* ---- Navigation stats ---- */
  const stats = useMemo(() => {
    if (!history || history.length === 0) {
      return {
        uniqueDestinations: 0,
        avgDistance: 0,
        mostCommon: '—',
        totalDelay: 0,
      }
    }

    const withDest = history.filter(s => s.destination_name)
    const destNames = withDest.map(s => s.destination_name!)
    const uniqueSet = new Set(destNames)

    /* Most common destination */
    const freq: Record<string, number> = {}
    for (const n of destNames) {
      freq[n] = (freq[n] ?? 0) + 1
    }
    let mostCommon = '—'
    let maxCount = 0
    for (const [name, count] of Object.entries(freq)) {
      if (count > maxCount) {
        maxCount = count
        mostCommon = name
      }
    }

    /* Avg distance */
    const distances = withDest
      .map(s => s.miles_to_arrival)
      .filter((v): v is number => v != null && v > 0)
    const avgDistance = distances.length > 0
      ? distances.reduce((a, b) => a + b, 0) / distances.length
      : 0

    /* Total traffic delay */
    const totalDelay = history
      .map(s => s.route_traffic_delay_min ?? 0)
      .reduce((a, b) => a + b, 0)

    return {
      uniqueDestinations: uniqueSet.size,
      avgDistance,
      mostCommon,
      totalDelay,
    }
  }, [history])

  /* ---- Active navigation state ---- */
  const hasActiveNav = latest != null
    && latest.destination_name != null
    && latest.destination_name.length > 0

  const isLoading = loadingLatest || loadingHistory

  return (
    <FadeIn>
      {/* ---- Header & vehicle selector ---- */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader
          title="Navigation"
          subtitle="Active routes, destinations, and location intelligence"
          icon={<Compass className="h-7 w-7 text-neon-cyan" />}
        />
        {vehicles && vehicles.length > 1 && (
          <select
            value={vehicleId ?? ''}
            onChange={e => setSelectedVehicle(Number(e.target.value))}
            className="glass-card px-3 py-2 text-sm rounded-lg border-0 focus:ring-1 focus:ring-neon-cyan/50"
            style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
          >
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.display_name || v.vin}</option>)}
          </select>
        )}
      </div>

      {/* ============================================================ */}
      {/*  1. Active Navigation Card                                    */}
      {/* ============================================================ */}
      <GlassPanel className="p-5 sm:p-6 mb-6 sm:mb-8">
        <div className="flex items-center gap-3 mb-4">
          <Navigation className="h-5 w-5 text-neon-cyan" />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Active Navigation</h3>
        </div>

        {loadingLatest ? (
          <Skeleton className="h-28 rounded-xl" />
        ) : hasActiveNav ? (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
            {/* Destination info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="h-5 w-5 text-neon-cyan shrink-0" />
                <p className="text-lg font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                  {latest!.destination_name}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-4 mt-3">
                {latest!.miles_to_arrival != null && (
                  <div className="flex items-center gap-1.5">
                    <Route className="h-4 w-4 text-neon-cyan" />
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {convertDistance(latest!.miles_to_arrival * 1.60934).toFixed(1)} {distanceUnit}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>remaining</span>
                  </div>
                )}
                {latest!.minutes_to_arrival != null && (
                  <div className="flex items-center gap-1.5">
                    <Timer className="h-4 w-4 text-neon-cyan" />
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {Math.round(latest!.minutes_to_arrival)} min
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>ETA</span>
                  </div>
                )}
                {latest!.route_traffic_delay_min != null && latest!.route_traffic_delay_min > 0 && (
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4 text-neon-amber" />
                    <span className="text-sm font-medium text-neon-amber">
                      +{latest!.route_traffic_delay_min} min traffic
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* GPS state indicator */}
            <div className="flex flex-col items-center gap-1">
              <span className={clsx(
                'h-3 w-3 rounded-full',
                latest!.gps_state
                  ? 'bg-neon-green shadow-[0_0_8px_rgba(16,185,129,0.6)]'
                  : 'bg-neon-red shadow-[0_0_8px_rgba(239,68,68,0.6)]',
              )} />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                GPS {latest!.gps_state ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Navigation className="h-10 w-10 text-[var(--text-muted)] opacity-30" />
            <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>No active route</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Navigation data will appear here when a route is active
            </p>
          </div>
        )}
      </GlassPanel>

      {/* ============================================================ */}
      {/*  2. Location Status — 3 cards                                 */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <LocationStatusCard
          label="At Home"
          icon={Home}
          active={isAtHome}
          loading={loadingLatest}
        />
        <LocationStatusCard
          label="At Work"
          icon={Building}
          active={isAtWork}
          loading={loadingLatest}
        />
        <LocationStatusCard
          label="At Favorite"
          icon={Star}
          active={isAtFavorite}
          loading={loadingLatest}
        />
      </div>

      {/* ============================================================ */}
      {/*  3. Route Traffic Delay                                       */}
      {/* ============================================================ */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <div className="flex items-center gap-3 mb-3">
          <TrafficCone className="h-5 w-5 text-neon-amber" />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Route Traffic Delay</h3>
        </div>

        {loadingLatest ? (
          <Skeleton className="h-16 rounded-xl" />
        ) : (
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-2">
              <span className={clsx(
                'text-3xl font-bold',
                (latest?.route_traffic_delay_min ?? 0) === 0
                  ? 'text-neon-green'
                  : (latest?.route_traffic_delay_min ?? 0) <= 5
                    ? 'text-neon-amber'
                    : 'text-neon-red',
              )}>
                {latest?.route_traffic_delay_min ?? 0}
              </span>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>min</span>
            </div>
            <TrafficDelayBadge minutes={latest?.route_traffic_delay_min} />
          </div>
        )}
      </GlassPanel>

      {/* ============================================================ */}
      {/*  4. Recent Destinations Table                                 */}
      {/* ============================================================ */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <div className="flex items-center gap-3 mb-4">
          <Clock className="h-5 w-5 text-neon-cyan" />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Recent Destinations</h3>
        </div>

        {loadingHistory ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : recentDestinations.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">
            No destination history available
          </div>
        ) : (
          <div className="overflow-x-auto max-h-72 overflow-y-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Time</th>
                  <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Destination</th>
                  <th className="text-right py-2 px-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Distance</th>
                  <th className="text-right py-2 px-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>ETA</th>
                  <th className="text-right py-2 px-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Delay</th>
                </tr>
              </thead>
              <tbody>
                {recentDestinations.map((row, i) => (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-2 px-3 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {row.time}
                    </td>
                    <td className="py-2 px-3 font-medium max-w-[200px] truncate" style={{ color: 'var(--text-primary)' }}>
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-neon-cyan shrink-0" />
                        <span className="truncate">{row.destination}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {row.miles != null ? `${convertDistance(row.miles * 1.60934).toFixed(1)} ${distanceUnit}` : '—'}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {row.minutes != null ? `${Math.round(row.minutes)} min` : '—'}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <TrafficDelayBadge minutes={row.delay} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassPanel>

      {/* ============================================================ */}
      {/*  5. Presence Chart (Home / Work / Favorite over time)         */}
      {/* ============================================================ */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <div className="flex items-center gap-3 mb-4">
          <TrendingUp className="h-5 w-5 text-neon-cyan" />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Home / Work / Favorite Presence</h3>
        </div>

        {loadingHistory ? (
          <Skeleton className="h-72 rounded-xl" />
        ) : presenceChartData.length === 0 ? (
          <div className="flex items-center justify-center h-72 text-[var(--text-muted)] text-sm">
            No presence history data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={presenceChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis
                domain={[0, 1]}
                ticks={[0, 1]}
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                tickFormatter={v => (v === 1 ? 'Yes' : 'No')}
              />
              <Tooltip content={<NavTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="stepAfter" dataKey="home" name="At Home" stroke="#10b981" strokeWidth={2} dot={false} />
              <Line type="stepAfter" dataKey="work" name="At Work" stroke="#a855f7" strokeWidth={2} dot={false} />
              <Line type="stepAfter" dataKey="favorite" name="At Favorite" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </GlassPanel>

      {/* ============================================================ */}
      {/*  6. Navigation Stats                                          */}
      {/* ============================================================ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {isLoading ? (
          [1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)
        ) : (
          <>
            <StatCard
              icon={MapPin}
              label="Unique Destinations"
              value={stats.uniqueDestinations}
              sub="distinct locations"
              color="text-neon-cyan"
            />
            <StatCard
              icon={Route}
              label="Avg Trip Distance"
              value={stats.avgDistance > 0 ? `${convertDistance(stats.avgDistance * 1.60934).toFixed(1)} ${distanceUnit}` : '—'}
              sub={`${distanceUnit} to arrival average`}
              color="text-neon-green"
            />
            <StatCard
              icon={Star}
              label="Most Common Dest"
              value={stats.mostCommon}
              sub="most frequent destination"
              color="text-neon-amber"
            />
            <StatCard
              icon={TrafficCone}
              label="Total Traffic Delay"
              value={`${stats.totalDelay} min`}
              sub="cumulative delay"
              color="text-neon-red"
            />
          </>
        )}
      </div>
    </FadeIn>
  )
}
