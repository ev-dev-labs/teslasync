import { useQuery } from '@tanstack/react-query'
import { getVehicles, getVehicleState, getVehiclePositions, getGeofences, getDrives, Vehicle, VehicleState, Position, getVehicleStatus } from '../api'
import { MapContainer, TileLayer, Marker, Polyline, Popup, Circle, CircleMarker, useMapEvents } from 'react-leaflet'
import { LatLngExpression, divIcon } from 'leaflet'
import { PageHeader, GlassPanel, StatusBadge, FadeIn, Skeleton } from '../components/ui'
import { RadialGauge, MetricBar } from '../components/Widgets'
import { Navigation, Battery, Gauge, Thermometer, MapPin, Play, Pause, SkipForward, Zap, Shield, Lock, Eye, History } from 'lucide-react'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import clsx from 'clsx'

interface ChargerInfo {
  ID: number
  AddressInfo: {
    Title: string
    AddressLine1: string
    Latitude: number
    Longitude: number
  }
  NumberOfPoints: number | null
  Connections?: Array<{
    ConnectionTypeID?: number
    PowerKW?: number
  }>
}

type ChargerFilter = 'all' | 'supercharger' | 'ccs' | 'chademo'

const CHARGER_FILTER_LABELS: Record<ChargerFilter, string> = {
  all: 'All',
  supercharger: 'Supercharger',
  ccs: 'CCS',
  chademo: 'CHAdeMO',
}

// Connection type IDs from OpenChargeMap
const CHARGER_CONNECTION_IDS: Record<string, number[]> = {
  supercharger: [30, 27], // Tesla Supercharger / Tesla connector
  ccs: [33, 32],          // CCS (Type 1 & 2)
  chademo: [2],           // CHAdeMO
}

function filterChargers(chargers: ChargerInfo[], filter: ChargerFilter): ChargerInfo[] {
  if (filter === 'all') return chargers
  const ids = CHARGER_CONNECTION_IDS[filter] ?? []
  return chargers.filter(c =>
    c.Connections?.some(conn => ids.includes(conn.ConnectionTypeID ?? 0))
  )
}

const fetchChargers = async (lat: number, lng: number): Promise<ChargerInfo[]> => {
  const res = await fetch(
    `https://api.openchargemap.io/v3/poi/?output=json&latitude=${lat}&longitude=${lng}&distance=25&distanceunit=KM&maxresults=50&compact=true&verbose=false`
  )
  return res.json()
}

function ChargerLayer({ chargers }: { chargers: ChargerInfo[] }) {
  return (
    <>
      {chargers.map(c => (
        <CircleMarker
          key={c.ID}
          center={[c.AddressInfo.Latitude, c.AddressInfo.Longitude]}
          radius={6}
          pathOptions={{ color: '#10b981', fillColor: '#10b981', fillOpacity: 0.8 }}
        >
          <Popup>
            <div style={{ color: 'var(--text-primary)', fontSize: '12px' }}>
              <b>{c.AddressInfo.Title}</b><br />
              {c.AddressInfo.AddressLine1}<br />
              {c.NumberOfPoints} connectors<br />
              {c.Connections?.[0]?.PowerKW && `${c.Connections[0].PowerKW} kW`}
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </>
  )
}

function MapCenterWatcher({ onCenterChange }: { onCenterChange: (lat: number, lng: number) => void }) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useMapEvents({
    moveend(e) {
      const center = e.target.getCenter()
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onCenterChange(center.lat, center.lng)
      }, 500)
    },
  })
  return null
}

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
  if (speed < 60) return '#00f0ff'
  if (speed < 100) return '#f59e0b'
  return '#ef4444'
}

function VehiclePanel({ vehicle, state, selected, onClick }: {
  vehicle: Vehicle; state?: VehicleState | null; selected: boolean; onClick: () => void
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
        <StatusBadge status={status} size="sm" />
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
  const [showChargers, setShowChargers] = useState(false)
  const [chargers, setChargers] = useState<ChargerInfo[]>([])
  const [chargerFilter, setChargerFilter] = useState<ChargerFilter>('all')
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null)
  const [historyMode, setHistoryMode] = useState(false)
  const [selectedDriveId, setSelectedDriveId] = useState<number | null>(null)
  const [playbackProgress, setPlaybackProgress] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const replayTimer = useRef<ReturnType<typeof setInterval> | null>(null)

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

  // History mode queries
  const { data: historyDrives } = useQuery({
    queryKey: ['drives-for-map', selectedId],
    queryFn: () => getDrives(selectedId!, 20),
    enabled: historyMode && selectedId !== null,
  })

  const { data: drivePositions } = useQuery({
    queryKey: ['drive-positions-map', selectedDriveId, selectedId],
    queryFn: () => getVehiclePositions(selectedId!, 5000),
    enabled: selectedDriveId !== null && selectedId !== null,
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

  // Fetch chargers when toggle is on and map center changes
  useEffect(() => {
    if (!showChargers) {
      setChargers([])
      return
    }
    const lat = mapCenter?.lat ?? (Array.isArray(center) ? (center as number[])[0] : 37.7749)
    const lng = mapCenter?.lng ?? (Array.isArray(center) ? (center as number[])[1] : -122.4194)
    let cancelled = false
    fetchChargers(lat, lng).then(data => {
      if (!cancelled) setChargers(data)
    }).catch(() => {
      if (!cancelled) setChargers([])
    })
    return () => { cancelled = true }
  }, [showChargers, mapCenter, center])

  const filteredChargers = filterChargers(chargers, chargerFilter)

  // History mode: filter positions within selected drive's time window
  const selectedDrive = historyDrives?.find(d => d.id === selectedDriveId) ?? null
  const driveTrail = useMemo(() => {
    if (!selectedDrive || !drivePositions) return []
    const start = new Date(selectedDrive.start_date).getTime()
    const end = selectedDrive.end_date ? new Date(selectedDrive.end_date).getTime() : Date.now()
    return drivePositions
      .filter(p => {
        const t = new Date(p.created_at).getTime()
        return t >= start && t <= end && p.latitude && p.longitude
      })
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  }, [selectedDrive, drivePositions])

  // History playback animation
  useEffect(() => {
    if (!isPlaying || !driveTrail.length) return
    const interval = setInterval(() => {
      setPlaybackProgress(p => {
        if (p >= 100) { setIsPlaying(false); return 100 }
        return p + 0.5
      })
    }, 50)
    return () => clearInterval(interval)
  }, [isPlaying, driveTrail])

  const playbackIdx = driveTrail.length > 0 ? Math.min(Math.floor((playbackProgress / 100) * (driveTrail.length - 1)), driveTrail.length - 1) : 0
  const playbackPos = driveTrail[playbackIdx] ?? null

  const selectedState = selectedId ? states[selectedId] : null
  const replayPos = replayMode && trailPositions[replayIdx] ? trailPositions[replayIdx] : null

  return (
    <div className="space-y-4">
      <PageHeader title="Live Map" subtitle="Real-time fleet tracking with drive replay and geofence visualization" />

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
        <FadeIn delay={0.1} className="flex-1 min-h-[60vh] relative rounded-2xl overflow-hidden border border-white/[0.06] shadow-[0_0_40px_rgba(0,240,255,0.03)]">
          <MapContainer center={center} zoom={12} scrollWheelZoom className="h-full w-full">
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
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
                  icon={createVehicleIcon(status, s.speed > 0 ? 0 : 0)}
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

            {/* History drive trail + playback marker */}
            {historyMode && driveTrail.length > 1 && (
              <>
                <Polyline
                  positions={driveTrail.map(p => [p.latitude, p.longitude] as LatLngExpression)}
                  pathOptions={{ color: '#f59e0b', weight: 3, opacity: 0.6 }}
                />
                {playbackPos && (
                  <CircleMarker
                    center={[playbackPos.latitude, playbackPos.longitude]}
                    radius={8}
                    pathOptions={{ color: '#f59e0b', weight: 2, fillColor: '#f59e0b', fillOpacity: 0.9 }}
                  />
                )}
              </>
            )}

            {/* Charger markers */}
            {showChargers && <ChargerLayer chargers={filteredChargers} />}

            {/* Watch map center for charger fetching */}
            <MapCenterWatcher onCenterChange={(lat, lng) => setMapCenter({ lat, lng })} />
          </MapContainer>

          {/* Charger controls overlay */}
          <div className="absolute top-4 left-4 z-[1000] flex flex-col gap-2">
            <button
              onClick={() => {
                setHistoryMode(!historyMode)
                if (historyMode) {
                  setSelectedDriveId(null)
                  setPlaybackProgress(0)
                  setIsPlaying(false)
                }
              }}
              className={clsx(
                'glass-panel px-3 py-2 text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer',
                historyMode ? 'text-neon-amber border-neon-amber/30' : 'text-[var(--text-secondary)]'
              )}
            >
              {historyMode ? <><History className="h-3.5 w-3.5" /> 📜 History</> : <><History className="h-3.5 w-3.5" /> 🗺️ Live</>}
            </button>
            <button
              onClick={() => setShowChargers(!showChargers)}
              className={clsx(
                'glass-panel px-3 py-2 text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer',
                showChargers ? 'text-neon-green border-neon-green/30' : 'text-[var(--text-secondary)]'
              )}
            >
              <Zap className="h-3.5 w-3.5" />
              {showChargers ? `⚡ ${filteredChargers.length} chargers nearby` : 'Show Chargers'}
            </button>
            {showChargers && (
              <div className="glass-panel p-2 flex flex-wrap gap-1">
                {(Object.keys(CHARGER_FILTER_LABELS) as ChargerFilter[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setChargerFilter(f)}
                    className={clsx(
                      'px-2 py-1 rounded text-[10px] font-medium transition-all cursor-pointer',
                      chargerFilter === f
                        ? 'bg-neon-green/20 text-neon-green'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                    )}
                  >
                    {CHARGER_FILTER_LABELS[f]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Speed legend overlay */}
          {selectedId && trailPositions.length > 1 && !replayMode && (
            <div className="absolute bottom-4 right-4 z-[1000] glass-panel p-3">
              <p className="text-[10px] text-[var(--text-secondary)] mb-1.5 font-medium">Speed Legend</p>
              <div className="space-y-1">
                {[{ speed: 'Parked', color: '#6b7280' }, { speed: '< 30 km/h', color: '#10b981' }, { speed: '30–60', color: '#00f0ff' }, { speed: '60–100', color: '#f59e0b' }, { speed: '100+', color: '#ef4444' }].map(l => (
                  <div key={l.speed} className="flex items-center gap-2 text-[10px]">
                    <div className="h-2 w-6 rounded-full" style={{ backgroundColor: l.color, boxShadow: `0 0 4px ${l.color}40` }} />
                    <span className="text-[var(--text-muted)]">{l.speed}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Geofence legend overlay */}
          {geofences && geofences.length > 0 && !historyMode && (
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

          {/* Drive History panel */}
          {historyMode && selectedId && (
            <div className="absolute top-4 right-4 w-72 glass-card p-4 rounded-xl z-[1000]">
              <h3 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <History className="h-4 w-4" /> Drive History
              </h3>

              {/* Drive list */}
              <div className="space-y-2 max-h-48 overflow-y-auto mb-3">
                {historyDrives?.map(d => (
                  <button key={d.id}
                    onClick={() => { setSelectedDriveId(d.id); setPlaybackProgress(0); setIsPlaying(false) }}
                    className={clsx('w-full text-left p-2 rounded-lg text-xs transition-colors', selectedDriveId === d.id ? 'bg-neon-cyan/20' : 'hover:bg-white/5')}>
                    <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{new Date(d.start_date).toLocaleDateString()}</p>
                    <p className="text-[var(--text-muted)]">{d.distance?.toFixed(1)} km · {Math.round(d.duration_min)} min</p>
                  </button>
                ))}
                {(!historyDrives || historyDrives.length === 0) && (
                  <p className="text-xs text-[var(--text-muted)]">No drives found</p>
                )}
              </div>

              {/* Playback controls */}
              {selectedDriveId && driveTrail.length > 0 && (
                <div className="border-t border-white/10 pt-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setIsPlaying(!isPlaying)} className="glass-button !py-1.5 !px-2.5 text-xs text-neon-cyan cursor-pointer">
                      {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                    </button>
                    <input type="range" min={0} max={100} value={playbackProgress}
                      onChange={e => { setPlaybackProgress(Number(e.target.value)); setIsPlaying(false) }}
                      className="flex-1 accent-[#00f0ff]" />
                  </div>
                  {playbackPos && (
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-[var(--text-muted)]">
                      <span><Gauge className="h-2.5 w-2.5 inline" /> {playbackPos.speed ?? 0} km/h</span>
                      <span><Battery className="h-2.5 w-2.5 inline" /> {playbackPos.battery_level}%</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </FadeIn>
      </div>
    </div>
  )
}
