import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDrive, getDrivePositions, getVehicle } from '../api'
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup } from 'react-leaflet'
import { LatLngExpression } from 'leaflet'
import {
  ArrowLeft, Route, Clock, Gauge, Battery, Zap, TrendingUp,
  MapPin, Navigation, Flag, Thermometer, Mountain, BarChart3,
  BatteryCharging, Activity, ArrowUpRight, ArrowDownRight, Share2,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, BarChart, Bar, ComposedChart, ReferenceLine, Legend,
} from 'recharts'
import { GlassPanel, FadeIn, StaggerContainer, StaggerItem, Skeleton } from '../components/ui'
import { AnimatedNumber, RadialGauge } from '../components/Widgets'
import { useUnits } from '../hooks/useUnits'

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color }}>●</span> {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
        </p>
      ))}
    </div>
  )
}

function StatCard({ icon: Icon, color, value, label }: { icon: typeof Route; color: string; value: React.ReactNode; label: string }) {
  return (
    <GlassPanel className="p-4 text-center">
      <Icon className="h-4 w-4 mx-auto mb-1" style={{ color }} />
      <p className="text-lg font-bold text-[var(--text-primary)]">{value}</p>
      <p className="text-[10px] text-[var(--text-muted)]">{label}</p>
    </GlassPanel>
  )
}

export default function DriveDetail() {
  const { id } = useParams<{ id: string }>()
  const driveId = Number(id)
  const u = useUnits()

  const { data: drive } = useQuery({
    queryKey: ['drive', driveId],
    queryFn: () => getDrive(driveId),
  })

  const { data: vehicle } = useQuery({
    queryKey: ['vehicle', drive?.vehicle_id],
    queryFn: () => getVehicle(drive!.vehicle_id),
    enabled: !!drive,
  })

  const { data: positions } = useQuery({
    queryKey: ['drive-positions', driveId],
    queryFn: () => getDrivePositions(driveId!),
    enabled: !!driveId && !!drive,
  })

  const drivePositions = positions ?? []

  const trail: LatLngExpression[] = drivePositions
    .filter(p => p.latitude && p.longitude)
    .map(p => [p.latitude, p.longitude])

  const startPos = trail[0] as [number, number] | undefined
  const endPos = trail[trail.length - 1] as [number, number] | undefined
  const centerPos = startPos ?? [0, 0]

  // Speed-colored trail segments
  const speedSegments: { positions: LatLngExpression[]; color: string }[] = []
  const filteredPositions = drivePositions.filter(p => p.latitude && p.longitude)
  for (let i = 1; i < filteredPositions.length; i++) {
    const prev = filteredPositions[i - 1]
    const curr = filteredPositions[i]
    const speed = curr.speed ?? 0
    let color = '#10b981'
    if (speed >= 100) color = '#ef4444'
    else if (speed >= 60) color = '#f59e0b'
    else if (speed >= 30) color = '#00f0ff'
    speedSegments.push({
      positions: [[prev.latitude, prev.longitude], [curr.latitude, curr.longitude]],
      color,
    })
  }

  // Build comprehensive chart data from positions
  const chartData = drivePositions.map((p, _i) => ({
    time: new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    speed: u.speedVal(p.speed ?? 0),
    battery: p.battery_level,
    elevation: p.elevation ?? 0,
    power: p.power ?? 0,
    insideTemp: p.inside_temp != null ? u.tempVal(p.inside_temp) : null,
    outsideTemp: p.outside_temp != null ? u.tempVal(p.outside_temp) : null,
    idealRange: p.ideal_range != null ? u.distanceVal(p.ideal_range) : null,
    ratedRange: p.rated_range != null ? u.distanceVal(p.rated_range) : null,
    odometer: p.odometer != null ? u.distanceVal(p.odometer) : p.odometer,
  }))

  // === Computed Stats ===
  const maxSpeed = drive?.speed_max != null ? u.speedVal(drive.speed_max) : Math.max(...chartData.map(d => d.speed), 0)
  const movingSpeeds = chartData.filter(d => d.speed > 0).map(d => d.speed)
  const minSpeed = movingSpeeds.length > 0 ? Math.min(...movingSpeeds) : 0
  const avgSpeed = chartData.length > 0 ? chartData.reduce((s, d) => s + d.speed, 0) / chartData.length : 0

  const elevGain = chartData.reduce((sum, d, i) => {
    if (i === 0) return 0
    const diff = d.elevation - chartData[i - 1].elevation
    return diff > 0 ? sum + diff : sum
  }, 0)
  const elevLoss = chartData.reduce((sum, d, i) => {
    if (i === 0) return 0
    const diff = d.elevation - chartData[i - 1].elevation
    return diff < 0 ? sum + Math.abs(diff) : sum
  }, 0)

  const odometerStart = chartData.length > 0 ? chartData[0].odometer : 0
  const odometerEnd = chartData.length > 0 ? chartData[chartData.length - 1].odometer : 0

  const powerMax = drive?.power_max ?? Math.max(...chartData.map(d => d.power), 0)
  const powerMin = drive?.power_min ?? Math.min(...chartData.map(d => d.power), 0)
  const avgPower = chartData.length > 0 ? chartData.reduce((s, d) => s + d.power, 0) / chartData.length : 0

  // Energy consumed (net) from power data
  const durationHours = drive ? drive.duration_min / 60 : 0
  const energyConsumedWh = Math.abs(avgPower) * durationHours * 1000
  const energyRecoveredWh = chartData.length > 0
    ? chartData.filter(d => d.power < 0).reduce((s, d) => s + Math.abs(d.power), 0) * (durationHours / chartData.length) * 1000
    : 0
  const consumptionWhKm = drive && drive.distance > 0 ? energyConsumedWh / drive.distance : 0

  // Temperature stats
  const insideTemps = chartData.filter(d => d.insideTemp !== null).map(d => d.insideTemp!)
  const outsideTemps = chartData.filter(d => d.outsideTemp !== null).map(d => d.outsideTemp!)
  const avgInsideTemp = insideTemps.length > 0 ? insideTemps.reduce((a, b) => a + b, 0) / insideTemps.length : null
  const avgOutsideTemp = outsideTemps.length > 0 ? outsideTemps.reduce((a, b) => a + b, 0) / outsideTemps.length : null

  // Range stats
  const startRange = chartData.length > 0 ? (chartData[0].idealRange ?? chartData[0].ratedRange) : null
  const endRange = chartData.length > 0 ? (chartData[chartData.length - 1].idealRange ?? chartData[chartData.length - 1].ratedRange) : null

  // Speed histogram
  const speedBucketDefs = [
    { minKmh: 0, maxKmh: 20 },
    { minKmh: 20, maxKmh: 40 },
    { minKmh: 40, maxKmh: 60 },
    { minKmh: 60, maxKmh: 80 },
    { minKmh: 80, maxKmh: 100 },
    { minKmh: 100, maxKmh: 120 },
    { minKmh: 120, maxKmh: 999 },
  ]
  const speedBuckets = speedBucketDefs.map(b => ({
    range: b.maxKmh === 999
      ? `${Math.round(u.speedVal(b.minKmh))}+`
      : `${Math.round(u.speedVal(b.minKmh))}-${Math.round(u.speedVal(b.maxKmh))}`,
    min: u.speedVal(b.minKmh),
    max: u.speedVal(b.maxKmh),
    count: 0,
  }))
  chartData.forEach(d => {
    const bucket = speedBuckets.find(b => d.speed >= b.min && d.speed < b.max)
    if (bucket) bucket.count++
  })
  const speedHistData = speedBuckets.filter(b => b.count > 0).map(b => ({
    range: b.range,
    count: b.count,
    pct: chartData.length > 0 ? Math.round(b.count / chartData.length * 100) : 0,
  }))

  const efficiency = drive && drive.distance > 0 && drive.start_battery_level != null && drive.end_battery_level != null
    ? ((drive.start_battery_level - drive.end_battery_level) / u.distanceVal(drive.distance) * 10).toFixed(1)
    : null

  if (!drive) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="flex-1 space-y-2"><Skeleton className="h-7 w-48" /><Skeleton className="h-4 w-32" /></div>
        </div>
        <Skeleton className="h-36" />
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {[1,2,3,4,5,6,7,8].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64 sm:h-80 lg:h-96" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-72" /><Skeleton className="h-72" />
          <Skeleton className="h-72" /><Skeleton className="h-72" />
        </div>
      </div>
    )
  }

  const handleShare = () => {
    const batteryFrom = drive.start_battery_level ?? '?'
    const batteryTo = drive.end_battery_level ?? '?'
    const summary = `🚗 Drove ${u.distance(drive.distance)} in ${Math.round(drive.duration_min)} min at ${consumptionWhKm > 0 ? u.efficiency(consumptionWhKm) : '?'} efficiency. Battery: ${batteryFrom}%→${batteryTo}%. Max speed: ${maxSpeed.toFixed(0)} ${u.speedUnit}`
    navigator.clipboard.writeText(summary)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center gap-4">
          <Link to="/drives" className="rounded-xl p-2.5 text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-primary)] transition-all">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] flex items-center gap-3">
              <Route className="h-6 w-6 text-neon-cyan" />
              Drive Details
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              {vehicle?.display_name || 'Vehicle'} &middot; {new Date(drive.start_date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              {' '}&middot; {new Date(drive.start_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {drive.end_date && ` → ${new Date(drive.end_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
            </p>
          </div>
          <button
            onClick={handleShare}
            className="rounded-xl p-2.5 text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-primary)] transition-all"
            title="Share drive summary"
          >
            <Share2 className="h-5 w-5" />
          </button>
        </div>
      </FadeIn>

      {/* Hero Gauges */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-6 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-neon-cyan/[0.02] to-neon-purple/[0.02]" />
          <div className="relative flex flex-wrap items-center gap-6 lg:gap-10 justify-center">
            <RadialGauge value={u.distanceVal(drive.distance)} max={Math.max(u.distanceVal(drive.distance) * 1.5, 100)} label="Distance" unit={u.distanceUnit} color="#00f0ff" size={110} />
            <RadialGauge value={maxSpeed} max={u.speedVal(250)} label="Max Speed" unit={u.speedUnit} color="#a855f7" size={110} />
            <RadialGauge value={drive.duration_min} max={Math.max(drive.duration_min * 1.5, 60)} label="Duration" unit="min" color="#f59e0b" size={110} />
            {efficiency && <RadialGauge value={Number(efficiency)} max={30} label="Efficiency" unit={u.isMetric ? '%/100km' : '%/100mi'} color="#10b981" size={110} />}
            <RadialGauge value={u.efficiencyVal(consumptionWhKm)} max={Math.max(u.efficiencyVal(consumptionWhKm) * 1.5, 300)} label="Consumption" unit={u.efficiencyUnit} color="#ef4444" size={110} />
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Drive Timeline Bar */}
      <FadeIn delay={0.06}>
        <GlassPanel className="p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] mb-2">
            <span className="flex items-center gap-1 text-neon-green"><Flag className="h-3 w-3" />{new Date(drive.start_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <span className="text-[var(--text-muted)]">{Math.floor(drive.duration_min / 60)}h {Math.round(drive.duration_min % 60)}m</span>
            <span className="flex items-center gap-1 text-neon-red"><Flag className="h-3 w-3" />{drive.end_date ? new Date(drive.end_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'In progress'}</span>
          </div>
          <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
            <div className="h-full rounded-full" style={{ width: '100%', background: 'linear-gradient(to right, #10b981, #00f0ff)' }} />
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Stat Cards — 2 rows of 4 */}
      <StaggerContainer className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <StaggerItem><StatCard icon={Route} color="#00f0ff" value={<AnimatedNumber value={u.distanceVal(drive.distance)} decimals={1} suffix={' ' + u.distanceUnit} />} label="Distance" /></StaggerItem>
        <StaggerItem><StatCard icon={Clock} color="#f59e0b" value={`${Math.floor(drive.duration_min / 60)}h ${Math.round(drive.duration_min % 60)}m`} label="Duration" /></StaggerItem>
        <StaggerItem><StatCard icon={Gauge} color="#a855f7" value={<AnimatedNumber value={maxSpeed} suffix={' ' + u.speedUnit} />} label="Max Speed" /></StaggerItem>
        <StaggerItem><StatCard icon={TrendingUp} color="#10b981" value={<AnimatedNumber value={avgSpeed} decimals={0} suffix={' ' + u.speedUnit} />} label="Avg Speed" /></StaggerItem>
        <StaggerItem><StatCard icon={Battery} color="#10b981" value={`${drive.start_battery_level ?? '?'}% → ${drive.end_battery_level ?? '?'}%`} label="Battery" /></StaggerItem>
        <StaggerItem><StatCard icon={Zap} color="#f59e0b" value={`${powerMax.toFixed(0)} kW`} label="Max Power" /></StaggerItem>
        <StaggerItem><StatCard icon={Zap} color="#06b6d4" value={`${powerMin.toFixed(0)} kW`} label="Max Regen" /></StaggerItem>
        <StaggerItem><StatCard icon={Navigation} color="#6b7280" value={<AnimatedNumber value={elevGain} decimals={0} suffix=" m" />} label="Elev. Gain" /></StaggerItem>
      </StaggerContainer>

      {/* More Details Section */}
      <FadeIn delay={0.08}>
        <GlassPanel className="p-5">
          <h3 className="section-title flex items-center gap-2 mb-4">
            <Activity className="h-4 w-4 text-neon-cyan" /> More Details
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="text-center">
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Odometer (From → To)</p>
              <p className="text-lg font-bold text-neon-cyan">
                {odometerStart > 0 ? `${Math.round(odometerStart)} → ${Math.round(odometerEnd)}` : '—'} <span className="text-xs text-[var(--text-muted)]">{u.distanceUnit}</span>
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Range (Start → End)</p>
              <p className="text-lg font-bold text-neon-green">
                {startRange != null ? `${Math.round(startRange)} → ${endRange != null ? Math.round(endRange) : '?'}` : '—'} <span className="text-xs text-[var(--text-muted)]">{u.distanceUnit}</span>
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Elevation Summary</p>
              <div className="text-base font-bold">
                <span className="text-neon-green flex items-center justify-center gap-1"><ArrowUpRight className="h-3 w-3" />{Math.round(elevGain)} m</span>
                <span className="text-neon-red flex items-center justify-center gap-1"><ArrowDownRight className="h-3 w-3" />{Math.round(elevLoss)} m</span>
              </div>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Energy Consumed (net)</p>
              <p className="text-lg font-bold text-neon-amber">{energyConsumedWh > 1000 ? `${(energyConsumedWh / 1000).toFixed(2)} kWh` : `${Math.round(energyConsumedWh)} Wh`}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Energy Recovered</p>
              <p className="text-lg font-bold text-neon-green">{energyRecoveredWh > 1000 ? `${(energyRecoveredWh / 1000).toFixed(2)} kWh` : `${Math.round(energyRecoveredWh)} Wh`}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Consumption</p>
              <p className="text-lg font-bold text-neon-purple">{consumptionWhKm > 0 ? `${Math.round(u.efficiencyVal(consumptionWhKm))}` : '—'} <span className="text-xs text-[var(--text-muted)]">{u.efficiencyUnit}</span></p>
            </div>
          </div>
          {(avgInsideTemp !== null || avgOutsideTemp !== null || drive.inside_temp_avg !== null) && (
            <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-2 sm:grid-cols-4 gap-4">
              {(drive.outside_temp_avg ?? avgOutsideTemp) !== null && (
                <div className="text-center">
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">Avg Outside Temp</p>
                  <p className="text-lg font-bold text-blue-400">{u.temp((drive.outside_temp_avg ?? avgOutsideTemp) as number)}</p>
                </div>
              )}
              {(drive.inside_temp_avg ?? avgInsideTemp) !== null && (
                <div className="text-center">
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">Avg Inside Temp</p>
                  <p className="text-lg font-bold text-orange-400">{u.temp((drive.inside_temp_avg ?? avgInsideTemp) as number)}</p>
                </div>
              )}
              <div className="text-center">
                <p className="text-[10px] text-[var(--text-muted)] mb-1">Avg Power</p>
                <p className="text-lg font-bold text-neon-amber">{avgPower.toFixed(1)} <span className="text-xs text-[var(--text-muted)]">kW</span></p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-[var(--text-muted)] mb-1">Min Speed</p>
                <p className="text-lg font-bold text-gray-300">{minSpeed > 0 ? `${minSpeed.toFixed(0)} ${u.speedUnit}` : `0 ${u.speedUnit}`}</p>
              </div>
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* Energy Summary */}
      <FadeIn delay={0.09}>
        <GlassPanel className="p-5">
          <h3 className="section-title flex items-center gap-2 mb-4">
            <BatteryCharging className="h-4 w-4 text-neon-green" /> Energy Summary
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-center">
            <div>
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Energy Consumed</p>
              <p className="text-lg font-bold text-neon-amber">{energyConsumedWh > 1000 ? `${(energyConsumedWh / 1000).toFixed(2)} kWh` : `${Math.round(energyConsumedWh)} Wh`}</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Energy Recovered</p>
              <p className="text-lg font-bold text-neon-green">{energyRecoveredWh > 1000 ? `${(energyRecoveredWh / 1000).toFixed(2)} kWh` : `${Math.round(energyRecoveredWh)} Wh`}</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Net Consumption</p>
              <p className="text-lg font-bold text-neon-cyan">{(energyConsumedWh - energyRecoveredWh) > 1000 ? `${((energyConsumedWh - energyRecoveredWh) / 1000).toFixed(2)} kWh` : `${Math.round(energyConsumedWh - energyRecoveredWh)} Wh`}</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Efficiency</p>
              <p className="text-lg font-bold text-neon-purple">{consumptionWhKm > 0 ? `${Math.round(u.efficiencyVal(consumptionWhKm))} ${u.efficiencyUnit}` : '—'}</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Battery Used</p>
              <p className="text-lg font-bold text-neon-amber">
                {drive.start_battery_level != null && drive.end_battery_level != null ? `${drive.start_battery_level - drive.end_battery_level}%` : '—'}
                <span className="text-xs text-[var(--text-muted)] ml-1">{drive.start_battery_level ?? '?'}% → {drive.end_battery_level ?? '?'}%</span>
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Range Used</p>
              <p className="text-lg font-bold text-neon-green">{drive.start_range_km != null && drive.end_range_km != null ? `${Math.round(u.distanceVal(drive.start_range_km - drive.end_range_km))} ${u.distanceUnit}` : '—'}</p>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Route Map */}
      <FadeIn delay={0.1}>
        <GlassPanel className="overflow-hidden">
          <div className="p-4 pb-0">
            <h3 className="section-title flex items-center gap-2 mb-3">
              <MapPin className="h-4 w-4 text-neon-cyan" /> Route
            </h3>
          </div>
          <div className="h-64 sm:h-80 lg:h-96">
            <MapContainer center={centerPos as [number, number]} zoom={trail.length > 1 ? 13 : 3} scrollWheelZoom className="h-full w-full">
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://carto.com/">CARTO</a>'
              />
              {speedSegments.map((seg, i) => (
                <Polyline key={i} positions={seg.positions} pathOptions={{ color: seg.color, weight: 4, opacity: 0.8 }} />
              ))}
              {startPos && (
                <CircleMarker center={startPos} radius={8} pathOptions={{ color: '#10b981', fillColor: '#10b981', fillOpacity: 1, weight: 2 }}>
                  <Popup><span className="text-xs font-bold">Start</span><br /><span className="text-xs">{new Date(drive.start_date).toLocaleString()}</span></Popup>
                </CircleMarker>
              )}
              {endPos && (
                <CircleMarker center={endPos} radius={8} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1, weight: 2 }}>
                  <Popup><span className="text-xs font-bold">End</span><br /><span className="text-xs">{drive.end_date ? new Date(drive.end_date).toLocaleString() : 'In progress'}</span></Popup>
                </CircleMarker>
              )}
            </MapContainer>
          </div>
          <div className="flex items-center justify-between px-4 py-3 text-xs">
            <span className="flex items-center gap-1.5 text-neon-green"><Flag className="h-3 w-3" /> Start: {new Date(drive.start_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            {trail.length > 1 && (
              <div className="flex items-center gap-3 text-[var(--text-muted)]">
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded" style={{ background: '#10b981' }} /> &lt;{Math.round(u.speedVal(30))}</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded" style={{ background: '#00f0ff' }} /> {Math.round(u.speedVal(30))}-{Math.round(u.speedVal(60))}</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded" style={{ background: '#f59e0b' }} /> {Math.round(u.speedVal(60))}-{Math.round(u.speedVal(100))}</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded" style={{ background: '#ef4444' }} /> &gt;{Math.round(u.speedVal(100))}</span>
                <span>{u.speedUnit}</span>
              </div>
            )}
            {drive.end_date && <span className="flex items-center gap-1.5 text-neon-red"><Flag className="h-3 w-3" /> End: {new Date(drive.end_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Journey Details */}
      <FadeIn delay={0.11}>
        <GlassPanel className="p-5">
          <h3 className="section-title flex items-center gap-2 mb-4">
            <Navigation className="h-4 w-4 text-neon-cyan" /> Journey Details
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-2 text-neon-green mb-1">
                <MapPin className="h-4 w-4" /> Start
              </div>
              <p className="font-bold text-[var(--text-primary)]">{startPos ? <span className="font-mono text-sm">{startPos[0].toFixed(4)}°N, {Math.abs(startPos[1]).toFixed(4)}°W</span> : 'No position data'}</p>
              <p className="text-xs text-[var(--text-muted)]">{new Date(drive.start_date).toLocaleString()}</p>
              <p className="text-xs text-[var(--text-secondary)]">Battery: {drive.start_battery_level ?? '?'}% · Range: {drive.start_range_km != null ? `${Math.round(u.distanceVal(drive.start_range_km))} ${u.distanceUnit}` : '—'}</p>
            </div>
            <div>
              <div className="flex items-center gap-2 text-neon-red mb-1">
                <Flag className="h-4 w-4" /> Destination
              </div>
              <p className="font-bold text-[var(--text-primary)]">{endPos ? <span className="font-mono text-sm">{endPos[0].toFixed(4)}°N, {Math.abs(endPos[1]).toFixed(4)}°W</span> : 'No position data'}</p>
              <p className="text-xs text-[var(--text-muted)]">{drive.end_date ? new Date(drive.end_date).toLocaleString() : 'In progress'}</p>
              <p className="text-xs text-[var(--text-secondary)]">Battery: {drive.end_battery_level ?? '?'}% · Range: {drive.end_range_km != null ? `${Math.round(u.distanceVal(drive.end_range_km))} ${u.distanceUnit}` : '—'}</p>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* === CHARTS SECTION === */}
      {chartData.length > 1 && (
        <>
          {/* Row 1: Combined Speed/Range/SOC/Power chart */}
          <FadeIn delay={0.12}>
            <GlassPanel className="p-6">
              <h3 className="section-title flex items-center gap-2 mb-4">
                <Gauge className="h-4 w-4 text-neon-purple" /> Speed · Range · SOC · Power
              </h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis yAxisId="speed" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                    <YAxis yAxisId="power" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 10, color: '#9ca3af' }} />
                    <Area yAxisId="speed" type="monotone" dataKey="speed" stroke="#a855f7" fill="#a855f7" fillOpacity={0.05} strokeWidth={2} name={'Speed ' + u.speedUnit} />
                    {chartData.some(d => d.idealRange !== null) && (
                      <Line yAxisId="speed" type="monotone" dataKey="idealRange" stroke="#10b981" strokeWidth={1.5} dot={false} name={'Range (ideal) ' + u.distanceUnit} strokeDasharray="4 2" />
                    )}
                    {chartData.some(d => d.ratedRange !== null) && (
                      <Line yAxisId="speed" type="monotone" dataKey="ratedRange" stroke="#06b6d4" strokeWidth={1} dot={false} name={'Range (rated) ' + u.distanceUnit} strokeDasharray="2 2" />
                    )}
                    <Line yAxisId="power" type="monotone" dataKey="power" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Power kW" />
                    <ReferenceLine yAxisId="power" y={0} stroke="rgba(255,255,255,0.1)" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* Row 2: SOC % + Elevation Profile */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <FadeIn delay={0.14}>
              <GlassPanel className="p-6">
                <h3 className="section-title flex items-center gap-2 mb-4">
                  <BatteryCharging className="h-4 w-4 text-neon-green" /> SOC % Over Time
                </h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                      <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Area type="monotone" dataKey="battery" stroke="#10b981" fill="#10b981" fillOpacity={0.15} strokeWidth={2} name="SOC %" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </GlassPanel>
            </FadeIn>

            <FadeIn delay={0.16}>
              <GlassPanel className="p-6">
                <h3 className="section-title flex items-center gap-2 mb-4">
                  <Mountain className="h-4 w-4 text-neon-green" /> Elevation Profile
                </h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                      <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} domain={['dataMin - 5', 'dataMax + 5']} />
                      <Tooltip content={<ChartTooltip />} />
                      <Area type="monotone" dataKey="elevation" stroke="#10b981" fill="#10b981" fillOpacity={0.2} strokeWidth={2} name="Elevation m" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </GlassPanel>
            </FadeIn>
          </div>

          {/* Row 3: Temperature + Speed Histogram */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {(insideTemps.length > 0 || outsideTemps.length > 0) && (
              <FadeIn delay={0.18}>
                <GlassPanel className="p-6">
                  <h3 className="section-title flex items-center gap-2 mb-4">
                    <Thermometer className="h-4 w-4 text-orange-400" /> Temperatures
                  </h3>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                        <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 10, color: '#9ca3af' }} />
                        {outsideTemps.length > 0 && (
                          <Line type="monotone" dataKey="outsideTemp" stroke="#3b82f6" strokeWidth={2} dot={false} name={'Outside ' + u.tempUnit} connectNulls />
                        )}
                        {insideTemps.length > 0 && (
                          <Line type="monotone" dataKey="insideTemp" stroke="#f97316" strokeWidth={2} dot={false} name={'Inside ' + u.tempUnit} connectNulls />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </GlassPanel>
              </FadeIn>
            )}

            <FadeIn delay={0.2}>
              <GlassPanel className="p-6">
                <h3 className="section-title flex items-center gap-2 mb-4">
                  <BarChart3 className="h-4 w-4 text-neon-purple" /> Speed Histogram
                </h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={speedHistData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                      <XAxis dataKey="range" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} label={{ value: u.speedUnit, fill: 'var(--text-muted)', fontSize: 10, position: 'insideBottom', offset: -5 }} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="pct" fill="#a855f7" name="% of drive" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </GlassPanel>
            </FadeIn>
          </div>

          {/* Row 4: Power Profile (dedicated) */}
          <FadeIn delay={0.22}>
            <GlassPanel className="p-6">
              <h3 className="section-title flex items-center gap-2 mb-4">
                <Zap className="h-4 w-4 text-neon-amber" /> Power Profile
              </h3>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                    <Area type="monotone" dataKey="power" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} strokeWidth={2} name="Power kW" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 flex items-center justify-center gap-6 text-xs text-[var(--text-secondary)]">
                <span>Max Power: <strong className="text-neon-amber">{powerMax.toFixed(0)} kW</strong></span>
                <span>Max Regen: <strong className="text-neon-cyan">{powerMin.toFixed(0)} kW</strong></span>
                <span>Avg: <strong className="text-[var(--text-primary)]">{avgPower.toFixed(1)} kW</strong></span>
              </div>
            </GlassPanel>
          </FadeIn>
        </>
      )}
    </div>
  )
}
