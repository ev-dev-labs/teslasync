import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDrive, getDrivePositions, getDriveTelemetry, getVehicle } from '../api'
import { useState } from 'react'
import { MapContainer, Polyline, CircleMarker, Popup, useMap } from 'react-leaflet'
import { MapTileLayer, MapInvalidator } from '../components/MapTileLayer'
import { MapLayerSwitcher } from '../components/MapLayerSwitcher'
import type { MapStyle } from '../components/MapTileLayer'
import { LatLngExpression, latLngBounds } from 'leaflet'
import {
  ArrowLeft, Route, Clock, Gauge, Battery, Zap, TrendingUp,
  MapPin, Navigation, Flag, Thermometer, Mountain, BarChart3,
  BatteryCharging, Activity, ArrowUpRight, ArrowDownRight, Share2, CircleDot,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, BarChart, Bar, ComposedChart, ReferenceLine, Legend,
} from 'recharts'
import { GlassPanel, FadeIn, StaggerContainer, StaggerItem, Skeleton } from '../components/ui'
import { AnimatedNumber, RadialGauge } from '../components/Widgets'
import { useUnits } from '../hooks/useUnits'
import { formatDate, formatTime, formatDateTime } from '../lib/dateFormat'
import { ChartTooltip } from '../components/Charts'
import { fmtNumber, fmtWithUnit, fmtPercent, fmtInt } from '../lib/numberFormat'

function StatCard({ icon: Icon, color, value, label }: { icon: typeof Route; color: string; value: React.ReactNode; label: string }) {
  return (
    <GlassPanel className="p-4 text-center">
      <Icon className="h-4 w-4 mx-auto mb-1" style={{ color }} />
      <p className="text-lg font-bold text-[var(--text-primary)]">{value}</p>
      <p className="text-[10px] text-[var(--text-muted)]">{label}</p>
    </GlassPanel>
  )
}

// Auto-fit map to show the entire drive route
function FitBounds({ trail }: { trail: LatLngExpression[] }) {
  const map = useMap()
  if (trail.length > 1) {
    const bounds = latLngBounds(trail.map(p => {
      if (Array.isArray(p)) return [p[0] as number, p[1] as number] as [number, number]
      return [0, 0] as [number, number]
    }))
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [30, 30] })
    }
  } else if (trail.length === 1) {
    const p = trail[0] as [number, number]
    map.setView(p, 15)
  }
  return null
}

export default function DriveDetail() {
  const { id } = useParams<{ id: string }>()
  const driveId = Number(id)
  const u = useUnits()
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark')

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

  const { data: telemetry } = useQuery({
    queryKey: ['drive-telemetry', driveId],
    queryFn: () => getDriveTelemetry(driveId),
    enabled: !!driveId && !!drive,
  })

  const drivePositions = positions ?? []
  const driveTelemetry = telemetry ?? []

  // Build route from telemetry (preferred — more granular) or positions (fallback)
  const routeSource = driveTelemetry.length > 0
    ? driveTelemetry.filter(t => t.latitude && t.longitude && (t.latitude !== 0 || t.longitude !== 0)).map(t => ({ lat: t.latitude!, lng: t.longitude!, speed: t.speed ?? 0 }))
    : drivePositions.filter(p => p.latitude && p.longitude).map(p => ({ lat: p.latitude, lng: p.longitude, speed: p.speed ?? 0 }))

  const trail: LatLngExpression[] = routeSource.map(p => [p.lat, p.lng])

  const startPos = trail[0] as [number, number] | undefined
  const endPos = trail[trail.length - 1] as [number, number] | undefined
  const centerPos = startPos ?? (drive?.start_latitude && drive?.start_longitude ? [drive.start_latitude, drive.start_longitude] as [number, number] : [47.6, -122.3])

  // Speed-colored trail segments
  const speedSegments: { positions: LatLngExpression[]; color: string }[] = []
  for (let i = 1; i < routeSource.length; i++) {
    const prev = routeSource[i - 1]
    const curr = routeSource[i]
    const speed = curr.speed
    let color = '#10b981'
    if (speed >= 100) color = '#ef4444'
    else if (speed >= 60) color = '#f59e0b'
    else if (speed >= 30) color = '#00f0ff'
    speedSegments.push({
      positions: [[prev.lat, prev.lng], [curr.lat, curr.lng]],
      color,
    })
  }

  // Build enriched chart data: prefer telemetry if available, fallback to positions
  const chartData = driveTelemetry.length > 0
    ? driveTelemetry.map(t => ({
        time: new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        speed: u.speedVal(t.speed ?? 0),
        battery: t.battery_level ?? t.soc ?? 0,
        elevation: t.elevation ?? 0,
        power: t.power ?? 0,
        insideTemp: t.inside_temp != null ? u.tempVal(t.inside_temp) : null,
        outsideTemp: t.outside_temp != null ? u.tempVal(t.outside_temp) : null,
        driverTemp: t.driver_temp != null ? u.tempVal(t.driver_temp) : null,
        passengerTemp: t.passenger_temp != null ? u.tempVal(t.passenger_temp) : null,
        idealRange: t.ideal_range != null ? u.distanceVal(t.ideal_range) : null,
        ratedRange: t.rated_range != null ? u.distanceVal(t.rated_range) : null,
        estRange: t.est_range != null ? u.distanceVal(t.est_range) : null,
        odometer: t.odometer != null ? u.distanceVal(t.odometer) : null,
        soc: t.soc,
        usableSoc: t.usable_soc,
        tireFl: t.tire_pressure_fl != null ? u.pressureVal(t.tire_pressure_fl) : null,
        tireFr: t.tire_pressure_fr != null ? u.pressureVal(t.tire_pressure_fr) : null,
        tireRl: t.tire_pressure_rl != null ? u.pressureVal(t.tire_pressure_rl) : null,
        tireRr: t.tire_pressure_rr != null ? u.pressureVal(t.tire_pressure_rr) : null,
        climateOn: t.is_climate_on ?? null,
        fanStatus: t.fan_status ?? null,
      }))
    : drivePositions.map((p, _i) => ({
        time: new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        speed: u.speedVal(p.speed ?? 0),
        battery: p.battery_level,
        elevation: p.elevation ?? 0,
        power: p.power ?? 0,
        insideTemp: p.inside_temp != null ? u.tempVal(p.inside_temp) : null,
        outsideTemp: p.outside_temp != null ? u.tempVal(p.outside_temp) : null,
        driverTemp: null as number | null,
        passengerTemp: null as number | null,
        idealRange: p.ideal_range != null ? u.distanceVal(p.ideal_range) : null,
        ratedRange: p.rated_range != null ? u.distanceVal(p.rated_range) : null,
        estRange: null as number | null,
        odometer: p.odometer != null ? u.distanceVal(p.odometer) : null,
        soc: null as number | null,
        usableSoc: null as number | null,
        tireFl: null as number | null,
        tireFr: null as number | null,
        tireRl: null as number | null,
        tireRr: null as number | null,
        climateOn: null as boolean | null,
        fanStatus: null as number | null,
      }))

  // === Computed Stats — prefer drive-level fields from API, fallback to chartData ===
  const maxSpeed = drive?.speed_max != null ? u.speedVal(drive.speed_max) : Math.max(...chartData.map(d => d.speed), 0)
  const movingSpeeds = chartData.filter(d => d.speed > 0).map(d => d.speed)
  const minSpeed = drive?.speed_min != null ? u.speedVal(drive.speed_min) : (movingSpeeds.length > 0 ? Math.min(...movingSpeeds) : 0)
  const avgSpeed = drive?.speed_avg != null ? u.speedVal(drive.speed_avg) : (chartData.length > 0 ? chartData.reduce((s, d) => s + d.speed, 0) / chartData.length : 0)

  const elevGain = drive?.elevation_gain != null ? drive.elevation_gain : chartData.reduce((sum, d, i) => {
    if (i === 0) return 0
    const diff = d.elevation - chartData[i - 1].elevation
    return diff > 0 ? sum + diff : sum
  }, 0)
  const elevLoss = drive?.elevation_loss != null ? drive.elevation_loss : chartData.reduce((sum, d, i) => {
    if (i === 0) return 0
    const diff = d.elevation - chartData[i - 1].elevation
    return diff < 0 ? sum + Math.abs(diff) : sum
  }, 0)

  const odometerStart = drive?.start_odometer != null ? u.distanceVal(drive.start_odometer) : (chartData.length > 0 ? (chartData[0].odometer ?? 0) : 0)
  const odometerEnd = drive?.end_odometer != null ? u.distanceVal(drive.end_odometer) : (chartData.length > 0 ? (chartData[chartData.length - 1].odometer ?? 0) : 0)

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
  const driverTemps = chartData.filter(d => d.driverTemp !== null).map(d => d.driverTemp!)
  const passengerTemps = chartData.filter(d => d.passengerTemp !== null).map(d => d.passengerTemp!)
  const avgInsideTemp = insideTemps.length > 0 ? insideTemps.reduce((a, b) => a + b, 0) / insideTemps.length : null
  const avgOutsideTemp = outsideTemps.length > 0 ? outsideTemps.reduce((a, b) => a + b, 0) / outsideTemps.length : null
  const hasAnyTemp = insideTemps.length > 0 || outsideTemps.length > 0 || driverTemps.length > 0 || passengerTemps.length > 0

  // Climate stats
  const climateOnCount = chartData.filter(d => d.climateOn === true).length
  const climateOffCount = chartData.filter(d => d.climateOn === false).length
  const climateStatus = climateOnCount > 0 ? (climateOnCount >= climateOffCount ? 'On' : 'Mostly Off') : (climateOffCount > 0 ? 'Off' : null)
  const fanValues = chartData.map(d => d.fanStatus).filter((v): v is number => v != null)
  const avgFanSpeed = fanValues.length > 0 ? fanValues.reduce((a, b) => a + b, 0) / fanValues.length : null
  const maxFanSpeed = fanValues.length > 0 ? Math.max(...fanValues) : null

  // Range stats
  const startRange = chartData.length > 0 ? (chartData[0].idealRange ?? chartData[0].ratedRange) : null
  const endRange = chartData.length > 0 ? (chartData[chartData.length - 1].idealRange ?? chartData[chartData.length - 1].ratedRange) : null

  // Tire pressure stats
  const hasTirePressure = chartData.some(d => d.tireFl !== null || d.tireFr !== null || d.tireRl !== null || d.tireRr !== null)

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
    ? fmtNumber((drive.start_battery_level - drive.end_battery_level) / u.distanceVal(drive.distance) * 10)
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
    const summary = `🚗 Drove ${u.distance(drive.distance)} in ${Math.round(drive.duration_min)} min at ${consumptionWhKm > 0 ? u.efficiency(consumptionWhKm) : '?'} efficiency. Battery: ${batteryFrom}%→${batteryTo}%. Max speed: ${fmtInt(maxSpeed)} ${u.speedUnit}`
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
              {drive.start_address && drive.end_address
                ? <>{drive.start_address} → {drive.end_address}</>
                : 'Drive Details'}
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              {vehicle?.display_name || 'Vehicle'} &middot; {formatDate(drive.start_date)}
              {' '}&middot; {formatTime(drive.start_date)}
              {drive.end_date && ` → ${formatTime(drive.end_date)}`}
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
            <span className="flex items-center gap-1 text-neon-green"><Flag className="h-3 w-3" />{formatTime(drive.start_date)}</span>
            <span className="text-[var(--text-muted)]">{Math.floor(drive.duration_min / 60)}h {Math.round(drive.duration_min % 60)}m</span>
            <span className="flex items-center gap-1 text-neon-red"><Flag className="h-3 w-3" />{drive.end_date ? formatTime(drive.end_date) : 'In progress'}</span>
          </div>
          <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
            <div className="h-full rounded-full" style={{ width: '100%', background: 'linear-gradient(to right, #10b981, #00f0ff)' }} />
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Stat Cards — 2 rows */}
      <StaggerContainer className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <StaggerItem><StatCard icon={Route} color="#00f0ff" value={<AnimatedNumber value={u.distanceVal(drive.distance)} decimals={1} suffix={' ' + u.distanceUnit} />} label="Distance" /></StaggerItem>
        <StaggerItem><StatCard icon={Clock} color="#f59e0b" value={`${Math.floor(drive.duration_min / 60)}h ${Math.round(drive.duration_min % 60)}m`} label="Duration" /></StaggerItem>
        <StaggerItem><StatCard icon={Gauge} color="#a855f7" value={<AnimatedNumber value={maxSpeed} suffix={' ' + u.speedUnit} />} label="Max Speed" /></StaggerItem>
        <StaggerItem><StatCard icon={TrendingUp} color="#10b981" value={<AnimatedNumber value={drive.speed_avg != null ? u.speedVal(drive.speed_avg) : avgSpeed} decimals={0} suffix={' ' + u.speedUnit} />} label="Avg Speed" /></StaggerItem>
        <StaggerItem><StatCard icon={Battery} color="#10b981" value={`${drive.soc_start ?? drive.start_battery_level ?? '?'}% → ${drive.soc_end ?? drive.end_battery_level ?? '?'}%`} label="SOC" /></StaggerItem>
        <StaggerItem><StatCard icon={Zap} color="#f59e0b" value={`${fmtWithUnit(powerMax, 'kW', 0)}`} label="Max Power" /></StaggerItem>
        <StaggerItem><StatCard icon={Navigation} color="#10b981" value={<AnimatedNumber value={drive.elevation_gain ?? elevGain} decimals={0} suffix=" m ↑" />} label="Elev. Gain" /></StaggerItem>
        <StaggerItem><StatCard icon={Navigation} color="#ef4444" value={<AnimatedNumber value={drive.elevation_loss ?? elevLoss} decimals={0} suffix=" m ↓" />} label="Elev. Loss" /></StaggerItem>
      </StaggerContainer>

      {/* Battery heater status */}
      {drive.battery_heater_on != null && (
        <FadeIn delay={0.075}>
          <GlassPanel className="p-3">
            <div className="flex items-center justify-center gap-2 text-xs">
              <BatteryCharging className="h-3.5 w-3.5 text-neon-amber" />
              <span className="text-[var(--text-secondary)]">Battery Heater:</span>
              <span className={drive.battery_heater_on ? 'text-neon-amber font-medium' : 'text-[var(--text-muted)]'}>
                {drive.battery_heater_on ? 'Active' : 'Off'}
              </span>
            </div>
          </GlassPanel>
        </FadeIn>
      )}

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
              <p className="text-lg font-bold text-neon-amber">{energyConsumedWh > 1000 ? `${fmtWithUnit((energyConsumedWh / 1000), 'kWh', 2)}` : `${Math.round(energyConsumedWh)} Wh`}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Energy Recovered</p>
              <p className="text-lg font-bold text-neon-green">{energyRecoveredWh > 1000 ? `${fmtWithUnit((energyRecoveredWh / 1000), 'kWh', 2)}` : `${Math.round(energyRecoveredWh)} Wh`}</p>
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
                <p className="text-lg font-bold text-neon-amber">{fmtNumber(avgPower)} <span className="text-xs text-[var(--text-muted)]">kW</span></p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-[var(--text-muted)] mb-1">Min Speed</p>
                <p className="text-lg font-bold text-gray-300">{minSpeed > 0 ? `${fmtInt(minSpeed)} ${u.speedUnit}` : `0 ${u.speedUnit}`}</p>
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
              <p className="text-lg font-bold text-neon-amber">{energyConsumedWh > 1000 ? `${fmtWithUnit((energyConsumedWh / 1000), 'kWh', 2)}` : `${Math.round(energyConsumedWh)} Wh`}</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Energy Recovered</p>
              <p className="text-lg font-bold text-neon-green">{energyRecoveredWh > 1000 ? `${fmtWithUnit((energyRecoveredWh / 1000), 'kWh', 2)}` : `${Math.round(energyRecoveredWh)} Wh`}</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Net Consumption</p>
              <p className="text-lg font-bold text-neon-cyan">{(energyConsumedWh - energyRecoveredWh) > 1000 ? `${fmtWithUnit(((energyConsumedWh - energyRecoveredWh) / 1000), 'kWh', 2)}` : `${Math.round(energyConsumedWh - energyRecoveredWh)} Wh`}</p>
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
          <div className="h-64 sm:h-80 lg:h-96 relative">
            <MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />
            <MapContainer center={centerPos as [number, number]} zoom={trail.length > 1 ? 13 : 3} scrollWheelZoom className="h-full w-full">
              <MapTileLayer style={mapStyle} />
              <MapInvalidator />
              <FitBounds trail={trail} />
              {speedSegments.map((seg, i) => (
                <Polyline key={i} positions={seg.positions} pathOptions={{ color: seg.color, weight: 4, opacity: 0.8 }} />
              ))}
              {startPos && (
                <CircleMarker center={startPos} radius={8} pathOptions={{ color: '#10b981', fillColor: '#10b981', fillOpacity: 1, weight: 2 }}>
                  <Popup><span className="text-xs font-bold">Start</span><br /><span className="text-xs">{formatDateTime(drive.start_date)}</span></Popup>
                </CircleMarker>
              )}
              {endPos && (
                <CircleMarker center={endPos} radius={8} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1, weight: 2 }}>
                  <Popup><span className="text-xs font-bold">End</span><br /><span className="text-xs">{drive.end_date ? formatDateTime(drive.end_date) : 'In progress'}</span></Popup>
                </CircleMarker>
              )}
            </MapContainer>
          </div>
          <div className="flex items-center justify-between px-4 py-3 text-xs">
            <span className="flex items-center gap-1.5 text-neon-green"><Flag className="h-3 w-3" /> Start: {formatTime(drive.start_date)}</span>
            {trail.length > 1 && (
              <div className="flex items-center gap-3 text-[var(--text-muted)]">
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded" style={{ background: '#10b981' }} /> &lt;{Math.round(u.speedVal(30))}</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded" style={{ background: '#00f0ff' }} /> {Math.round(u.speedVal(30))}-{Math.round(u.speedVal(60))}</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded" style={{ background: '#f59e0b' }} /> {Math.round(u.speedVal(60))}-{Math.round(u.speedVal(100))}</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded" style={{ background: '#ef4444' }} /> &gt;{Math.round(u.speedVal(100))}</span>
                <span>{u.speedUnit}</span>
              </div>
            )}
            {drive.end_date && <span className="flex items-center gap-1.5 text-neon-red"><Flag className="h-3 w-3" /> End: {formatTime(drive.end_date)}</span>}
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
              {drive.start_address
                ? <p className="font-bold text-[var(--text-primary)] text-sm">{drive.start_address}</p>
                : startPos
                  ? <p className="font-mono text-sm text-[var(--text-primary)]">{fmtNumber(startPos[0], 4)}°{startPos[0] >= 0 ? 'N' : 'S'}, {fmtNumber(Math.abs(startPos[1]), 4)}°{startPos[1] >= 0 ? 'E' : 'W'}</p>
                  : drive.start_latitude && drive.start_longitude
                    ? <p className="font-mono text-sm text-[var(--text-primary)]">{fmtNumber(drive.start_latitude, 4)}°{drive.start_latitude >= 0 ? 'N' : 'S'}, {fmtNumber(Math.abs(drive.start_longitude), 4)}°{drive.start_longitude >= 0 ? 'E' : 'W'}</p>
                    : <p className="text-sm text-[var(--text-muted)]">No position data</p>
              }
              <p className="text-xs text-[var(--text-muted)]">{formatDateTime(drive.start_date)}</p>
              <p className="text-xs text-[var(--text-secondary)]">Battery: {drive.start_battery_level ?? '?'}% · Range: {drive.start_range_km != null ? `${Math.round(u.distanceVal(drive.start_range_km))} ${u.distanceUnit}` : '—'}</p>
            </div>
            <div>
              <div className="flex items-center gap-2 text-neon-red mb-1">
                <Flag className="h-4 w-4" /> Destination
              </div>
              {drive.end_address
                ? <p className="font-bold text-[var(--text-primary)] text-sm">{drive.end_address}</p>
                : endPos
                  ? <p className="font-mono text-sm text-[var(--text-primary)]">{fmtNumber(endPos[0], 4)}°{endPos[0] >= 0 ? 'N' : 'S'}, {fmtNumber(Math.abs(endPos[1]), 4)}°{endPos[1] >= 0 ? 'E' : 'W'}</p>
                  : drive.end_latitude && drive.end_longitude
                    ? <p className="font-mono text-sm text-[var(--text-primary)]">{fmtNumber(drive.end_latitude, 4)}°{drive.end_latitude >= 0 ? 'N' : 'S'}, {fmtNumber(Math.abs(drive.end_longitude), 4)}°{drive.end_longitude >= 0 ? 'E' : 'W'}</p>
                    : <p className="text-sm text-[var(--text-muted)]">{drive.end_date ? 'No position data' : 'In progress'}</p>
              }
              <p className="text-xs text-[var(--text-muted)]">{drive.end_date ? formatDateTime(drive.end_date) : 'In progress'}</p>
              <p className="text-xs text-[var(--text-secondary)]">Battery: {drive.end_battery_level ?? '?'}% · Range: {drive.end_range_km != null ? `${Math.round(u.distanceVal(drive.end_range_km))} ${u.distanceUnit}` : '—'}</p>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* === CHARTS SECTION === */}
      {chartData.length > 1 && (() => {
        // Compute Mean/Max/Min for each signal
        const stat = (vals: (number | null)[]) => {
          const v = vals.filter((x): x is number => x != null)
          if (v.length === 0) return null
          return { mean: v.reduce((a, b) => a + b, 0) / v.length, max: Math.max(...v), min: Math.min(...v) }
        }
        const speedStats = stat(chartData.map(d => d.speed))
        const powerStats = stat(chartData.map(d => d.power))
        const idealRangeStats = stat(chartData.map(d => d.idealRange))
        const estRangeStats = stat(chartData.map(d => d.estRange ?? d.ratedRange))
        const socStats = stat(chartData.map(d => d.battery > 0 ? d.battery : null))
        const usableSocStats = stat(chartData.map(d => d.usableSoc))
        const batteryHeaterOn = drive?.battery_heater_on

        type LegendItem = { color: string; dash?: boolean; label: string; mean: string; max: string; min: string }
        const legendItems: LegendItem[] = []
        if (speedStats) legendItems.push({ color: '#3b82f6', label: `Speed`, mean: `${fmtNumber(speedStats.mean)} ${u.speedUnit}`, max: `${fmtNumber(speedStats.max)} ${u.speedUnit}`, min: `${fmtInt(speedStats.min)} ${u.speedUnit}` })
        if (idealRangeStats) legendItems.push({ color: '#c084fc', dash: true, label: `Range (ideal)`, mean: `${fmtInt(idealRangeStats.mean)} ${u.distanceUnit}`, max: `${fmtInt(idealRangeStats.max)} ${u.distanceUnit}`, min: `${fmtInt(idealRangeStats.min)} ${u.distanceUnit}` })
        if (estRangeStats) legendItems.push({ color: '#a855f7', dash: true, label: `Range (est.)`, mean: `${fmtInt(estRangeStats.mean)} ${u.distanceUnit}`, max: `${fmtInt(estRangeStats.max)} ${u.distanceUnit}`, min: `${fmtInt(estRangeStats.min)} ${u.distanceUnit}` })
        if (socStats) legendItems.push({ color: '#84cc16', label: `SOC`, mean: `${fmtPercent(socStats.mean)}`, max: `${fmtPercent(socStats.max)}`, min: `${fmtPercent(socStats.min)}` })
        if (usableSocStats) legendItems.push({ color: '#22d3ee', label: `Usable SOC`, mean: `${fmtPercent(usableSocStats.mean)}`, max: `${fmtPercent(usableSocStats.max)}`, min: `${fmtPercent(usableSocStats.min)}` })
        legendItems.push({ color: '#ef4444', dash: true, label: `Battery Heater`, mean: batteryHeaterOn ? 'On' : 'Off', max: batteryHeaterOn ? 'On' : 'Off', min: batteryHeaterOn ? 'On' : 'Off' })
        if (powerStats) legendItems.push({ color: '#f59e0b', label: `Power`, mean: `${fmtWithUnit(powerStats.mean, 'kW', 2)}`, max: `${fmtWithUnit(powerStats.max, 'kW', 0)}`, min: `${fmtWithUnit(powerStats.min, 'kW', 0)}` })

        return (
        <>
          {/* Row 1: Comprehensive Drive Chart (TeslaMate-style) */}
          <FadeIn delay={0.12}>
            <GlassPanel className="p-6">
              <h3 className="section-title flex items-center gap-2 mb-4">
                <Activity className="h-4 w-4 text-neon-cyan" /> Drive
              </h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis yAxisId="power" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} unit=" kW" />
                    <YAxis yAxisId="speed" hide />
                    <Tooltip content={<ChartTooltip />} />
                    <ReferenceLine yAxisId="power" y={0} stroke="rgba(255,255,255,0.1)" />
                    <Area yAxisId="speed" type="monotone" dataKey="speed" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.08} strokeWidth={1.5} name={`Speed (${u.speedUnit})`} />
                    {chartData.some(d => d.idealRange !== null) && (
                      <Line yAxisId="speed" type="monotone" dataKey="idealRange" stroke="#c084fc" strokeWidth={1} dot={false} name={`Range ideal (${u.distanceUnit})`} strokeDasharray="4 2" />
                    )}
                    {chartData.some(d => d.estRange !== null || d.ratedRange !== null) && (
                      <Line yAxisId="speed" type="monotone" dataKey={chartData.some(d => d.estRange !== null) ? 'estRange' : 'ratedRange'} stroke="#a855f7" strokeWidth={1} dot={false} name={`Range est. (${u.distanceUnit})`} strokeDasharray="4 2" />
                    )}
                    <Line yAxisId="speed" type="monotone" dataKey="battery" stroke="#84cc16" strokeWidth={1.5} dot={false} name="SOC %" />
                    {chartData.some(d => d.usableSoc !== null) && (
                      <Line yAxisId="speed" type="monotone" dataKey="usableSoc" stroke="#22d3ee" strokeWidth={1} dot={false} name="Usable SOC %" />
                    )}
                    <Line yAxisId="power" type="monotone" dataKey="power" stroke="#f59e0b" strokeWidth={2} dot={false} name="Power kW" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {/* Rich legend with Mean/Max/Min stats */}
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[10px] leading-tight">
                {legendItems.map(item => (
                  <span key={item.label} className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="inline-block w-4 border-t-2" style={{ borderColor: item.color, borderStyle: item.dash ? 'dashed' : 'solid' }} />
                    <strong style={{ color: item.color }}>{item.label}</strong>
                    <span className="text-[var(--text-muted)]">Mean: {item.mean}</span>
                    <span className="text-[var(--text-muted)]">Max: {item.max}</span>
                    <span className="text-[var(--text-muted)]">Min: {item.min}</span>
                  </span>
                ))}
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
                <div className="flex items-center gap-4 mb-3 text-xs">
                  <span className="flex items-center gap-1 text-neon-green"><ArrowUpRight className="h-3 w-3" />{Math.round(elevGain)} m gain</span>
                  <span className="flex items-center gap-1 text-neon-red"><ArrowDownRight className="h-3 w-3" />{Math.round(elevLoss)} m loss</span>
                  <span className="text-[var(--text-muted)]">Net: {Math.round(elevGain - elevLoss)} m</span>
                </div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                      <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis yAxisId="elev" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} domain={['dataMin - 5', 'dataMax + 5']} />
                      <YAxis yAxisId="speed" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 10, color: '#9ca3af' }} />
                      <Area yAxisId="elev" type="monotone" dataKey="elevation" stroke="#10b981" fill="#10b981" fillOpacity={0.2} strokeWidth={2} name="Elevation (m)" />
                      <Line yAxisId="speed" type="monotone" dataKey="speed" stroke="#a855f7" strokeWidth={1.5} dot={false} name={`Speed (${u.speedUnit})`} strokeOpacity={0.6} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </GlassPanel>
            </FadeIn>
          </div>

          {/* Row 3: Temperature + Speed Histogram */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {hasAnyTemp && (
              <FadeIn delay={0.18}>
                <GlassPanel className="p-6">
                  <h3 className="section-title flex items-center gap-2 mb-4">
                    <Thermometer className="h-4 w-4 text-orange-400" /> Temperatures
                  </h3>
                  {/* Temperature & Climate summary stats */}
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {avgOutsideTemp != null && (
                      <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                        <p className="text-[9px] text-[var(--text-muted)]">Outside Temperature</p>
                        <p className="text-sm font-bold text-blue-400">{fmtNumber(avgOutsideTemp)}{u.tempUnit}</p>
                      </div>
                    )}
                    {avgInsideTemp != null && (
                      <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                        <p className="text-[9px] text-[var(--text-muted)]">Inside Temperature</p>
                        <p className="text-sm font-bold text-orange-400">{fmtNumber(avgInsideTemp)}{u.tempUnit}</p>
                      </div>
                    )}
                    {driverTemps.length > 0 && (
                      <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                        <p className="text-[9px] text-[var(--text-muted)]">Driver Temperature</p>
                        <p className="text-sm font-bold text-rose-400">{fmtNumber(driverTemps.reduce((a, b) => a + b, 0) / driverTemps.length)}{u.tempUnit}</p>
                      </div>
                    )}
                    {passengerTemps.length > 0 && (
                      <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                        <p className="text-[9px] text-[var(--text-muted)]">Passenger Temperature</p>
                        <p className="text-sm font-bold text-purple-400">{fmtNumber(passengerTemps.reduce((a, b) => a + b, 0) / passengerTemps.length)}{u.tempUnit}</p>
                      </div>
                    )}
                    {climateStatus != null && (
                      <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                        <p className="text-[9px] text-[var(--text-muted)]">Climate</p>
                        <p className={`text-sm font-bold ${climateStatus === 'On' ? 'text-neon-green' : 'text-gray-400'}`}>{climateStatus}</p>
                      </div>
                    )}
                    {maxFanSpeed != null && (
                      <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                        <p className="text-[9px] text-[var(--text-muted)]">Fan Status</p>
                        <p className="text-sm font-bold text-cyan-400">Avg {fmtInt(avgFanSpeed)} · Max {maxFanSpeed}</p>
                      </div>
                    )}
                  </div>
                  {/* Temperature chart with all 4 lines */}
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
                        {driverTemps.length > 0 && (
                          <Line type="monotone" dataKey="driverTemp" stroke="#fb7185" strokeWidth={2} dot={false} name={'Driver ' + u.tempUnit} connectNulls />
                        )}
                        {passengerTemps.length > 0 && (
                          <Line type="monotone" dataKey="passengerTemp" stroke="#a855f7" strokeWidth={2} dot={false} name={'Passenger ' + u.tempUnit} connectNulls />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </GlassPanel>
              </FadeIn>
            )}

            <FadeIn delay={0.2} className="h-full">
              <GlassPanel className="p-6 h-full flex flex-col">
                <h3 className="section-title flex items-center gap-2 mb-4">
                  <BarChart3 className="h-4 w-4 text-neon-purple" /> Speed Histogram
                </h3>
                <div className="flex-1 min-h-[14rem]">
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
                <span>Max Power: <strong className="text-neon-amber">{fmtInt(powerMax)} kW</strong></span>
                <span>Max Regen: <strong className="text-neon-cyan">{fmtInt(powerMin)} kW</strong></span>
                <span>Avg: <strong className="text-[var(--text-primary)]">{fmtNumber(avgPower)} kW</strong></span>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* Row 5: Tire Pressure During Drive */}
          {hasTirePressure && (() => {
            const tpVals = (key: 'tireFl' | 'tireFr' | 'tireRl' | 'tireRr') => {
              const vals = chartData.map(d => d[key]).filter((v): v is number => v != null && v > 0)
              return { min: vals.length > 0 ? Math.min(...vals) : null, max: vals.length > 0 ? Math.max(...vals) : null }
            }
            const fl = tpVals('tireFl'), fr = tpVals('tireFr'), rl = tpVals('tireRl'), rr = tpVals('tireRr')
            const tpStats = [
              { label: 'Front Left', color: '#3b82f6', ...fl },
              { label: 'Front Right', color: '#10b981', ...fr },
              { label: 'Rear Left', color: '#f59e0b', ...rl },
              { label: 'Rear Right', color: '#ef4444', ...rr },
            ]
            return (
              <FadeIn delay={0.24}>
                <GlassPanel className="p-6">
                  <h3 className="section-title flex items-center gap-2 mb-4">
                    <CircleDot className="h-4 w-4 text-neon-cyan" /> Tire Pressure
                  </h3>
                  {/* Summary stats */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
                    {tpStats.map(tp => (
                      <div key={tp.label} className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3">
                        <p className="text-[10px] font-semibold mb-2" style={{ color: tp.color }}>{tp.label}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          Min (above zero): <strong className="text-[var(--text-primary)]">{tp.min != null ? `${fmtNumber(tp.min)}${u.pressureUnit}` : '—'}</strong>
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                          Max: <strong className="text-[var(--text-primary)]">{tp.max != null ? `${fmtNumber(tp.max)}${u.pressureUnit}` : '—'}</strong>
                        </p>
                      </div>
                    ))}
                  </div>
                  {/* Chart */}
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                        <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} domain={['dataMin - 0.5', 'dataMax + 0.5']} />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 10, color: '#9ca3af' }} />
                        <Line type="monotone" dataKey="tireFl" stroke="#3b82f6" strokeWidth={2} dot={false} name={`FL (${u.pressureUnit})`} connectNulls />
                        <Line type="monotone" dataKey="tireFr" stroke="#10b981" strokeWidth={2} dot={false} name={`FR (${u.pressureUnit})`} connectNulls />
                        <Line type="monotone" dataKey="tireRl" stroke="#f59e0b" strokeWidth={2} dot={false} name={`RL (${u.pressureUnit})`} connectNulls />
                        <Line type="monotone" dataKey="tireRr" stroke="#ef4444" strokeWidth={2} dot={false} name={`RR (${u.pressureUnit})`} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </GlassPanel>
              </FadeIn>
            )
          })()}
        </>
        )
      })()}
    </div>
  )
}

