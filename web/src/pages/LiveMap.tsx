import { useQuery } from '@tanstack/react-query'
import { getVehicles, getVehicleState, getVehiclePositions, getGeofences, getDrives, Vehicle, VehicleState, Position, getVehicleStatus } from '../api'
import { MapContainer, TileLayer, Marker, Polyline, Popup, Circle, CircleMarker, useMap, useMapEvents } from 'react-leaflet'
import { LatLngExpression, LatLng, divIcon } from 'leaflet'
import { PageHeader, GlassPanel, StatusBadge, FadeIn, Skeleton } from '../components/ui'
import { RadialGauge, MetricBar } from '../components/Widgets'
import { Navigation, Battery, Gauge, Thermometer, MapPin, Play, Pause, SkipForward, Zap, Shield, Lock, Eye, Maximize2, Minimize2, Crosshair, Ruler, LocateFixed } from 'lucide-react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTheme } from '../components/ThemeProvider'
import clsx from 'clsx'

function createVehicleIcon(status: string, heading: number = 0) {
  const color = status === 'driving' ? '#00f0ff' : status === 'charging' ? '#10b981' : status === 'online' ? '#10b981' : '#6b7280'
  return divIcon({
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    html: `<div style="transform:rotate(${heading}deg);filter:drop-shadow(0 0 12px ${color})">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <circle cx="20" cy="20" r="18" fill="${color}15" stroke="${color}" stroke-width="2"/>
        <circle cx="20" cy="20" r="12" fill="${color}25"/>
        <path d="M20 8 L27 26 L20 21 L13 26 Z" fill="${color}" opacity="0.9"/>
        <circle cx="20" cy="20" r="3" fill="${color}"/>
      </svg>
    </div>`,
  })
}

function speedToColor(speed: number | null): string {
  if (!speed || speed < 5) return '#6b7280'
  if (speed < 30) return '#10b981'
  if (speed < 60) return '#f59e0b'
  if (speed < 100) return '#ef4444'
  return '#8b5cf6'
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3
  const toRad = (d: number) => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function deriveHeading(positions: Position[]): number {
  if (positions.length < 2) return 0
  const p1 = positions[positions.length - 2]
  const p2 = positions[positions.length - 1]
  const dLon = (p2.longitude - p1.longitude) * Math.PI / 180
  const lat1r = p1.latitude * Math.PI / 180
  const lat2r = p2.latitude * Math.PI / 180
  const y = Math.sin(dLon) * Math.cos(lat2r)
  const x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
}

const speedLegendItems = [
  { label: 'Parked', color: '#6b7280' },
  { label: '0–30 km/h', color: '#10b981' },
  { label: '30–60', color: '#f59e0b' },
  { label: '60–100', color: '#ef4444' },
  { label: '100+', color: '#8b5cf6' },
]

function MapClickHandler({ measureMode, onMeasureClick, onCopyCoords }: {
  measureMode: boolean
  onMeasureClick: (latlng: LatLng) => void
  onCopyCoords: (lat: number, lng: number) => void
}) {
  useMapEvents({
    click(e) {
      if (measureMode) {
        onMeasureClick(e.latlng)
      } else {
        onCopyCoords(e.latlng.lat, e.latlng.lng)
      }
    },
  })
  return null
}

function MapFlyTo({ target, onComplete }: { target: LatLngExpression | null; onComplete: () => void }) {
  const map = useMap()
  useEffect(() => {
    if (target) {
      map.flyTo(target, 16)
      onComplete()
    }
  }, [target, map, onComplete])
  return null
}

function AutoCenterHandler({ enabled, positions }: { enabled: boolean; positions: LatLngExpression[] }) {
  const map = useMap()
  const posKey = JSON.stringify(positions)
  useEffect(() => {
    if (!enabled || positions.length === 0) return
    if (positions.length === 1) {
      map.setView(positions[0], map.getZoom(), { animate: false })
    } else {
      map.fitBounds(positions.map(p => p as [number, number]), { padding: [50, 50], animate: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, posKey, map])
  return null
}

function VehiclePanel({ vehicle, state, selected, onClick, onZoom }: {
  vehicle: Vehicle; state?: VehicleState | null; selected: boolean; onClick: () => void; onZoom?: () => void
}) {
  const status = getVehicleStatus(vehicle, state)
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full text-left p-3.5 rounded-xl transition-all duration-200 border',
        selected
          ? 'bg-neon-cyan/5 border-neon-cyan/20 shadow-[0_0_15px_rgba(0,240,255,0.08)]'
          : 'bg-white/[0.02] border-white/[0.04] hover:bg-white/[0.04] hover:border-white/[0.08]'
      )}
    >
      <div className="flex items-center justify-between mb-2.5">
        <div>
          <span className="text-sm font-semibold text-[var(--text-primary)] block">{vehicle.display_name || vehicle.vin}</span>
          <span className="text-[10px] text-gray-600">{vehicle.model} {vehicle.trim_badging}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {onZoom && (
            <button
              onClick={(e) => { e.stopPropagation(); onZoom() }}
              className="p-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] transition-colors"
              title="Zoom to vehicle"
            >
              <Crosshair className="h-3.5 w-3.5 text-neon-cyan" />
            </button>
          )}
          <StatusBadge status={status} size="sm" />
        </div>
      </div>
      {state && (
        <>
          <MetricBar label="Battery" value={state.battery_level} max={100} color={state.battery_level > 20 ? '#10b981' : '#ef4444'} />
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
            <span className="flex items-center gap-1.5 text-[var(--text-secondary)]"><Gauge className="h-3 w-3 text-neon-cyan" />{state.speed} km/h</span>
            <span className="flex items-center gap-1.5 text-[var(--text-secondary)]"><Navigation className="h-3 w-3 text-neon-cyan" />{Math.round(state.rated_range)} km</span>
            <span className="flex items-center gap-1.5 text-[var(--text-secondary)]"><Thermometer className="h-3 w-3 text-neon-amber" />{state.inside_temp}°/{state.outside_temp}°C</span>
            <span className="flex items-center gap-1.5 text-[var(--text-secondary)]"><Battery className="h-3 w-3 text-neon-green" />{state.power} kW</span>
          </div>
          {/* Status icons */}
          <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-white/[0.04]">
            <span className={clsx('flex items-center gap-1 text-[10px]', state.is_locked ? 'text-neon-green' : 'text-neon-red')}>
              <Lock className="h-3 w-3" /> {state.is_locked ? 'Locked' : 'Unlocked'}
            </span>
            {state.sentry_mode && <span className="flex items-center gap-1 text-[10px] text-neon-red"><Shield className="h-3 w-3" /> Sentry</span>}
            {state.is_climate_on && <span className="flex items-center gap-1 text-[10px] text-neon-cyan"><Thermometer className="h-3 w-3" /> HVAC</span>}
            {state.is_charging && <span className="flex items-center gap-1 text-[10px] text-neon-green"><Zap className="h-3 w-3" /> Charging</span>}
          </div>
        </>
      )}
    </button>
  )
}

export default function LiveMap() {
  const { data: vehicles, isLoading } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [replayMode, setReplayMode] = useState(false)
  const [replayIdx, setReplayIdx] = useState(0)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const replayTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const [measureMode, setMeasureMode] = useState(false)
  const [measurePoints, setMeasurePoints] = useState<LatLng[]>([])
  const [flyToTarget, setFlyToTarget] = useState<LatLngExpression | null>(null)
  const [autoCenter, setAutoCenter] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const { mode } = useTheme()

  const vehicleStates = useQuery({
    queryKey: ['all-vehicle-states', vehicles?.map(v => v.id)],
    queryFn: async () => {
      if (!vehicles) return {}
      const entries = await Promise.all(
        vehicles.map(async v => {
          try {
            const data = await getVehicleState(v.id)
            return [v.id, data.state ?? null] as const
          } catch {
            return [v.id, null] as const
          }
        })
      )
      return Object.fromEntries(entries) as Record<number, VehicleState | null>
    },
    enabled: !!vehicles && vehicles.length > 0,
    refetchInterval: 15_000,
  })

  const { data: trail } = useQuery({
    queryKey: ['vehicle-trail', selectedId],
    queryFn: () => getVehiclePositions(selectedId!, 500),
    enabled: selectedId !== null,
  })

  const { data: geofences } = useQuery({ queryKey: ['geofences'], queryFn: getGeofences })

  const { data: recentDrives } = useQuery({
    queryKey: ['recent-drives-map', selectedId],
    queryFn: () => getDrives(selectedId!, 5),
    enabled: selectedId !== null,
  })

  const states = vehicleStates.data ?? {}
  const markers = vehicles?.filter(v => states[v.id]?.latitude && states[v.id]?.longitude) ?? []
  const center: LatLngExpression = markers.length > 0
    ? [states[markers[0].id]!.latitude, states[markers[0].id]!.longitude]
    : [37.7749, -122.4194]

  const trailPositions: Position[] = trail?.filter(p => p.latitude && p.longitude) ?? []

  // Speed-colored trail segments
  const trailSegments: { positions: LatLngExpression[]; color: string }[] = []
  for (let i = 0; i < trailPositions.length - 1; i++) {
    const p1 = trailPositions[i]
    const p2 = trailPositions[i + 1]
    trailSegments.push({
      positions: [[p1.latitude, p1.longitude], [p2.latitude, p2.longitude]],
      color: speedToColor(p1.speed),
    })
  }

  // Drive replay
  const startReplay = useCallback(() => {
    if (trailPositions.length < 2) return
    setReplayMode(true)
    setReplayIdx(0)
    setReplayPlaying(true)
  }, [trailPositions.length])

  useEffect(() => {
    if (replayPlaying && replayMode) {
      replayTimer.current = setInterval(() => {
        setReplayIdx(prev => {
          if (prev >= trailPositions.length - 1) {
            setReplayPlaying(false)
            return prev
          }
          return prev + 1
        })
      }, 100)
    }
    return () => { if (replayTimer.current) clearInterval(replayTimer.current) }
  }, [replayPlaying, replayMode, trailPositions.length])

  const selectedState = selectedId ? states[selectedId] : null
  const replayPos = replayMode && trailPositions[replayIdx] ? trailPositions[replayIdx] : null

  const vehicleHeading = selectedId && trailPositions.length >= 2 ? deriveHeading(trailPositions) : 0
  const onlineCount = markers.length
  const totalCount = vehicles?.length ?? 0
  const vehiclePositions: LatLngExpression[] = markers.map(v => [states[v.id]!.latitude, states[v.id]!.longitude])
  const measureDistance = measurePoints.length === 2
    ? haversineDistance(measurePoints[0].lat, measurePoints[0].lng, measurePoints[1].lat, measurePoints[1].lng)
    : null
  const tileUrl = mode.colorScheme === 'light'
    ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      mapContainerRef.current?.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }, [])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2000)
  }, [])

  const onCopyCoords = useCallback((lat: number, lng: number) => {
    const text = `${lat.toFixed(6)}, ${lng.toFixed(6)}`
    navigator.clipboard.writeText(text).then(
      () => showToast(`Copied: ${text}`),
      () => showToast(`📍 ${text}`)
    )
  }, [showToast])

  const clearFlyTarget = useCallback(() => setFlyToTarget(null), [])

  const onMeasureClick = useCallback((latlng: LatLng) => {
    setMeasurePoints(prev => prev.length >= 2 ? [latlng] : [...prev, latlng])
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <PageHeader title="Live Map" subtitle="Real-time fleet tracking with drive replay and geofence visualization" />
        <span className="rounded-full bg-neon-green/10 px-2.5 py-1 text-[10px] text-neon-green whitespace-nowrap">
          {onlineCount}/{totalCount} online
        </span>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 h-auto lg:h-[calc(100vh-200px)]">
        {/* Enhanced Sidebar */}
        <FadeIn className="w-full lg:w-80 shrink-0 flex flex-col gap-3 overflow-y-auto pr-0 lg:pr-1">
          {/* Stats header */}
          <GlassPanel className="p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <div className="h-2 w-2 rounded-full bg-neon-green" style={{ boxShadow: '0 0 6px rgba(16,185,129,0.5)' }} />
                <span className="text-[var(--text-secondary)]">{markers.length} tracked</span>
              </div>
              <span className="text-[10px] text-gray-600 font-mono">Refresh 15s</span>
            </div>
          </GlassPanel>

          {/* Vehicle list */}
          <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible flex-1 lg:flex-none pb-2 lg:pb-0">
            {isLoading ? (
              Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-32 min-w-[260px] lg:min-w-0" />)
            ) : (
              vehicles?.map(v => (
                <div key={v.id} className="min-w-[260px] lg:min-w-0">
                  <VehiclePanel
                    vehicle={v}
                    state={states[v.id]}
                    selected={selectedId === v.id}
                    onClick={() => setSelectedId(selectedId === v.id ? null : v.id)}
                    onZoom={states[v.id]?.latitude ? () => setFlyToTarget([states[v.id]!.latitude, states[v.id]!.longitude]) : undefined}
                  />
                </div>
              ))
            )}
          </div>

          {/* Selected vehicle quick gauges */}
          {selectedState && (
            <GlassPanel className="p-4">
              <div className="grid grid-cols-3 gap-2">
                <RadialGauge value={selectedState.battery_level} max={100} label="Battery" unit="%" size={70} color="#10b981" />
                <RadialGauge value={selectedState.speed} max={200} label="Speed" unit="km/h" size={70} color="#00f0ff" />
                <RadialGauge value={Math.round(selectedState.rated_range)} max={600} label="Range" unit="km" size={70} color="#a855f7" />
              </div>
            </GlassPanel>
          )}

          {/* Drive replay controls */}
          {selectedId && trailPositions.length > 1 && (
            <GlassPanel className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-[var(--text-secondary)]">Drive Replay</span>
                <span className="text-[10px] text-gray-600">{trailPositions.length} points</span>
              </div>
              <div className="flex items-center gap-2">
                {!replayMode ? (
                  <button onClick={startReplay} className="glass-button !py-1.5 !px-3 text-xs text-neon-cyan">
                    <Play className="h-3 w-3" /> Replay Trail
                  </button>
                ) : (
                  <>
                    <button onClick={() => setReplayPlaying(!replayPlaying)} className="glass-button !py-1.5 !px-2.5 text-xs text-neon-cyan">
                      {replayPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                    </button>
                    <button onClick={() => { setReplayMode(false); setReplayPlaying(false) }} className="glass-button !py-1.5 !px-2.5 text-xs text-[var(--text-secondary)]">
                      <SkipForward className="h-3 w-3" />
                    </button>
                    <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full bg-neon-cyan rounded-full transition-all" style={{ width: `${(replayIdx / Math.max(1, trailPositions.length - 1)) * 100}%` }} />
                    </div>
                    <span className="text-[10px] text-[var(--text-muted)] font-mono">{replayIdx}/{trailPositions.length - 1}</span>
                  </>
                )}
              </div>
              {replayPos && (
                <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-[var(--text-muted)]">
                  <span><Gauge className="h-2.5 w-2.5 inline" /> {replayPos.speed ?? 0} km/h</span>
                  <span><Battery className="h-2.5 w-2.5 inline" /> {replayPos.battery_level}%</span>
                  <span><Navigation className="h-2.5 w-2.5 inline" /> {replayPos.elevation?.toFixed(0) ?? '—'}m</span>
                </div>
              )}
            </GlassPanel>
          )}

          {/* Recent drives for selected vehicle */}
          {recentDrives && recentDrives.length > 0 && (
            <GlassPanel className="p-3">
              <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">Recent Drives</p>
              <div className="space-y-1.5">
                {recentDrives.slice(0, 3).map(d => (
                  <div key={d.id} className="flex items-center justify-between text-[11px]">
                    <span className="text-[var(--text-secondary)]">{new Date(d.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    <span className="text-neon-cyan font-medium">{d.distance.toFixed(1)} km</span>
                    <span className="text-gray-600">{d.duration_min}m</span>
                  </div>
                ))}
              </div>
            </GlassPanel>
          )}
        </FadeIn>

        {/* Map */}
        <FadeIn delay={0.1} className="flex-1 min-h-[60vh]">
          <div ref={mapContainerRef} className="h-full relative rounded-2xl overflow-hidden border border-white/[0.06] shadow-[0_0_40px_rgba(0,240,255,0.03)]">
          <MapContainer center={center} zoom={12} scrollWheelZoom className="h-full w-full">
            <TileLayer
              key={tileUrl}
              url={tileUrl}
              attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            />

            {/* Geofence circles */}
            {geofences?.map(g => (
              <Circle
                key={g.id}
                center={[g.latitude, g.longitude]}
                radius={g.radius}
                pathOptions={{ color: '#a855f7', weight: 1.5, opacity: 0.6, fillColor: '#a855f7', fillOpacity: 0.05, dashArray: '6,4' }}
              />
            ))}

            {/* Vehicle markers */}
            {markers.map(v => {
              const s = states[v.id]!
              const status = getVehicleStatus(v, s)
              return (
                <Marker
                  key={v.id}
                  position={[s.latitude, s.longitude]}
                  icon={createVehicleIcon(status, v.id === selectedId ? vehicleHeading : 0)}
                  eventHandlers={{ click: () => setSelectedId(v.id) }}
                >
                  <Popup>
                    <div className="text-gray-900 min-w-[180px]">
                      <p className="font-semibold text-sm">{v.display_name || v.vin}</p>
                      <p className="text-xs text-[var(--text-muted)]">{v.model} {v.trim_badging}</p>
                      <div className="mt-2 text-xs space-y-1">
                        <p>🔋 Battery: {s.battery_level}%</p>
                        <p>⚡ Speed: {s.speed} km/h</p>
                        <p>📍 Range: {Math.round(s.rated_range)} km</p>
                        <p>🌡️ Temp: {s.inside_temp}°C / {s.outside_temp}°C</p>
                        <p>{s.is_locked ? '🔒' : '🔓'} {s.is_locked ? 'Locked' : 'Unlocked'}</p>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              )
            })}

            {/* Speed-colored trail */}
            {selectedId && !replayMode && trailSegments.map((seg, i) => (
              <Polyline key={i} positions={seg.positions} pathOptions={{ color: seg.color, weight: 3, opacity: 0.7 }} />
            ))}

            {/* Replay trail + marker */}
            {replayMode && replayPos && (
              <>
                <Polyline
                  positions={trailPositions.slice(0, replayIdx + 1).map(p => [p.latitude, p.longitude] as LatLngExpression)}
                  pathOptions={{ color: '#00f0ff', weight: 3, opacity: 0.8 }}
                />
                <CircleMarker
                  center={[replayPos.latitude, replayPos.longitude]}
                  radius={8}
                  pathOptions={{ color: '#00f0ff', weight: 2, fillColor: '#00f0ff', fillOpacity: 0.8 }}
                />
              </>
            )}

            <MapClickHandler measureMode={measureMode} onMeasureClick={onMeasureClick} onCopyCoords={onCopyCoords} />
            <MapFlyTo target={flyToTarget} onComplete={clearFlyTarget} />
            <AutoCenterHandler enabled={autoCenter} positions={vehiclePositions} />

            {measurePoints.map((pt, i) => (
              <CircleMarker key={`measure-${i}`} center={pt} radius={6} pathOptions={{ color: '#f59e0b', weight: 2, fillColor: '#f59e0b', fillOpacity: 0.8 }} />
            ))}
            {measurePoints.length === 2 && (
              <Polyline positions={measurePoints} pathOptions={{ color: '#f59e0b', weight: 2, opacity: 0.8, dashArray: '8,6' }} />
            )}
          </MapContainer>

          {/* Map control buttons */}
          <div className="absolute top-4 left-4 z-[1000] flex flex-col gap-2">
            <button onClick={toggleFullscreen} className="glass-panel p-2 hover:bg-white/[0.06] transition-colors" title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {isFullscreen ? <Minimize2 className="h-4 w-4 text-[var(--text-secondary)]" /> : <Maximize2 className="h-4 w-4 text-[var(--text-secondary)]" />}
            </button>
            <button
              onClick={() => { setMeasureMode(!measureMode); setMeasurePoints([]) }}
              className={clsx('glass-panel p-2 transition-colors', measureMode ? 'bg-amber-500/10 border-amber-500/20' : 'hover:bg-white/[0.06]')}
              title="Measure distance"
            >
              <Ruler className={clsx('h-4 w-4', measureMode ? 'text-amber-400' : 'text-[var(--text-secondary)]')} />
            </button>
            <button
              onClick={() => setAutoCenter(!autoCenter)}
              className={clsx('glass-panel p-2 transition-colors', autoCenter ? 'bg-neon-cyan/10 border-neon-cyan/20' : 'hover:bg-white/[0.06]')}
              title="Auto-center on vehicles"
            >
              <LocateFixed className={clsx('h-4 w-4', autoCenter ? 'text-neon-cyan' : 'text-[var(--text-secondary)]')} />
            </button>
          </div>

          {/* Speed legend overlay */}
          {selectedId && trailPositions.length > 1 && !replayMode && (
            <div className="absolute bottom-4 right-4 z-[1000] glass-panel p-3">
              <p className="text-[10px] text-[var(--text-secondary)] mb-1.5 font-medium">Speed Legend</p>
              <div className="space-y-1">
                {speedLegendItems.map(l => (
                  <div key={l.label} className="flex items-center gap-2 text-[10px]">
                    <div className="h-2 w-6 rounded-full" style={{ backgroundColor: l.color, boxShadow: `0 0 4px ${l.color}40` }} />
                    <span className="text-[var(--text-muted)]">{l.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Measurement distance display */}
          {measureDistance !== null && (
            <div className="absolute bottom-4 left-4 z-[1000] glass-panel p-3">
              <p className="text-[10px] text-[var(--text-secondary)] mb-1 font-medium flex items-center gap-1"><Ruler className="h-3 w-3 text-amber-400" /> Distance</p>
              <p className="text-sm font-semibold text-amber-400">
                {measureDistance < 1000 ? `${measureDistance.toFixed(0)} m` : `${(measureDistance / 1000).toFixed(2)} km`}
              </p>
            </div>
          )}

          {/* Geofence legend overlay */}
          {geofences && geofences.length > 0 && (
            <div className="absolute top-4 right-4 z-[1000] glass-panel p-2.5">
              <p className="text-[10px] text-[var(--text-secondary)] mb-1 font-medium flex items-center gap-1"><Eye className="h-3 w-3" /> Geofences</p>
              <div className="space-y-0.5">
                {geofences.slice(0, 5).map(g => (
                  <div key={g.id} className="flex items-center gap-1.5 text-[10px]">
                    <MapPin className="h-2.5 w-2.5 text-neon-purple" />
                    <span className="text-[var(--text-muted)]">{g.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Toast notification */}
          {toast && (
            <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-[1000] glass-panel px-4 py-2 text-xs text-[var(--text-secondary)] whitespace-nowrap">
              {toast}
            </div>
          )}
          </div>
        </FadeIn>
      </div>
    </div>
  )
}
