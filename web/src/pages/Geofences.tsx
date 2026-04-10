import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getGeofences, createGeofence, updateGeofence, deleteGeofence, Geofence } from '../api'
import { MapPin, Plus, Pencil, Trash2, X, Check, Globe, Ruler, Map as MapIcon, List, Zap, Navigation, RefreshCw } from 'lucide-react'
import { PageHeader, GlassPanel, StaggerContainer, StaggerItem, Skeleton, EmptyState, TabNav, FadeIn, Button, Input } from '../components/ui'
import { RadialGauge } from '../components/Widgets'
import { useToast } from '../components/Toast'
import { useSettings } from '../hooks/useSettings'
import { CHART_COLORS } from '../lib/colors'
import { fmtNumber } from '../lib/numberFormat'
import { motion, AnimatePresence } from 'framer-motion'
import { MapContainer, Circle, Marker, Popup, useMapEvents } from 'react-leaflet'
import { MapTileLayer, MapInvalidator } from '../components/MapTileLayer'
import { MapLayerSwitcher } from '../components/MapLayerSwitcher'
import type { MapStyle } from '../components/MapTileLayer'
import L from 'leaflet'
import clsx from 'clsx'
import { usePageTitle } from '../hooks/usePageTitle'

interface FormData {
  name: string
  latitude: string
  longitude: string
  radius: string
  cost_per_kwh: string
}

const emptyForm: FormData = { name: '', latitude: '', longitude: '', radius: '50', cost_per_kwh: '' }


function GeofenceCard({ geofence, onEdit, onDelete, color, isSelected, onSelect }: {
  geofence: Geofence; onEdit: () => void; onDelete: () => void; color: string; isSelected: boolean; onSelect: () => void
}) {
  const { convertDistance, distanceUnit } = useSettings()
  return (
    <GlassPanel hover glow="purple" className={clsx('p-5 transition-all duration-200 group cursor-pointer', isSelected && 'border-neon-purple/30 bg-neon-purple/5')}>
      <div className="flex items-start gap-4" onClick={onSelect}>
        <div className="flex h-11 w-11 items-center justify-center rounded-xl shrink-0 ring-1"
          style={{ backgroundColor: `${color}15`, color, borderColor: `${color}30` }}>
          <MapPin className="h-5 w-5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">{geofence.name}</h3>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{ backgroundColor: `${color}15`, color, border: `1px solid ${color}30` }}>
              {geofence.radius}m
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
            <span className="flex items-center gap-1 font-mono">
              <Globe className="h-3 w-3" /> {geofence.latitude.toFixed(6)}, {geofence.longitude.toFixed(6)}
            </span>
            <span className="flex items-center gap-1">
              <Ruler className="h-3 w-3" /> {fmtNumber(convertDistance(geofence.radius / 1000), geofence.radius >= 1000 ? 1 : 2)} {distanceUnit}
            </span>
            {geofence.cost_per_kwh != null && (
              <span className="flex items-center gap-1 text-neon-green">
                <Zap className="h-3 w-3" /> ${fmtNumber(geofence.cost_per_kwh, 2)}/kWh
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={e => { e.stopPropagation(); onEdit() }}
            className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-white/5 hover:text-neon-cyan transition-colors"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete() }}
            className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-neon-red/10 hover:text-neon-red transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </GlassPanel>
  )
}

function GeofenceForm({ editing, form, setForm, onSubmit, onCancel, isSaving }: {
  editing: number | 'new'
  form: FormData
  setForm: (f: FormData | ((prev: FormData) => FormData)) => void
  onSubmit: () => void
  onCancel: () => void
  isSaving: boolean
}) {
  const [locStatus, setLocStatus] = useState<string | null>(null)

  const reverseGeocode = async (lat: number, lon: number) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18`
      )
      const data = await res.json()
      return data.display_name?.split(',').slice(0, 3).join(',').trim() || ''
    } catch {
      return ''
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
    >
      <GlassPanel className="p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neon-cyan/10 text-neon-cyan">
            {editing === 'new' ? <Plus className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          </div>
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">{editing === 'new' ? 'Create Geofence' : 'Edit Geofence'}</h3>
            <p className="text-xs text-[var(--text-muted)]">Click on the map to set the location, or enter coordinates manually</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          <div>
            <Input
              label="Name"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="Home"
            />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wider">Latitude</label>
              <button
                type="button"
                title="Use current location"
                onClick={() => {
                  if (!navigator.geolocation) { setLocStatus('denied'); return }
                  setLocStatus('locating')
                  navigator.geolocation.getCurrentPosition(
                    pos => {
                      setForm(f => ({ ...f, latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) }))
                      setLocStatus('success')
                      setTimeout(() => setLocStatus(null), 2000)
                      // Auto-fill name via reverse geocoding
                      reverseGeocode(pos.coords.latitude, pos.coords.longitude).then(name => {
                        if (name) setForm(f => f.name ? f : { ...f, name })
                      })
                    },
                    () => { setLocStatus('denied') },
                    { enableHighAccuracy: true, timeout: 10000 }
                  )
                }}
                disabled={locStatus === 'locating'}
                className={clsx(
                  'p-1 rounded-md transition-all duration-200',
                  locStatus === 'success' ? 'text-neon-green bg-neon-green/10'
                    : locStatus === 'denied' ? 'text-red-400 bg-red-500/10'
                    : locStatus === 'locating' ? 'text-neon-cyan animate-pulse'
                    : 'text-neon-cyan/60 hover:text-neon-cyan hover:bg-neon-cyan/10'
                )}
              >
                {locStatus === 'locating' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  : locStatus === 'success' ? <Check className="h-3.5 w-3.5" />
                  : locStatus === 'denied' ? <X className="h-3.5 w-3.5" />
                  : <Navigation className="h-3.5 w-3.5" />}
              </button>
            </div>
            <Input
              type="number"
              step="any"
              value={form.latitude}
              onChange={e => setForm({ ...form, latitude: e.target.value })}
              className="w-full px-3 py-2 text-sm font-mono"
              placeholder="37.7749"
            />
          </div>
          <div>
            <Input
              label="Longitude"
              type="number"
              step="any"
              value={form.longitude}
              onChange={e => setForm({ ...form, longitude: e.target.value })}
              className="font-mono"
              placeholder="-122.4194"
            />
          </div>
          <div>
            <Input
              label="Radius (m)"
              type="number"
              value={form.radius}
              onChange={e => setForm({ ...form, radius: e.target.value })}
              placeholder="50"
              min={10}
              max={50000}
            />
          </div>
          <div>
            <Input
              label="Cost per kWh ($)"
              type="number"
              step="0.01"
              value={form.cost_per_kwh}
              onChange={e => setForm({ ...form, cost_per_kwh: e.target.value })}
              className="font-mono"
              placeholder="0.12 (optional)"
              min={0}
            />
            <p className="text-[10px] text-gray-600 mt-1">Used for charging cost calculation</p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            variant="primary"
            icon={<Check className="h-4 w-4" />}
            onClick={onSubmit}
            disabled={isSaving || !form.name || !form.latitude || !form.longitude}
            loading={isSaving}
          >
            Save
          </Button>
          <Button variant="secondary" icon={<X className="h-4 w-4" />} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </GlassPanel>
    </motion.div>
  )
}

function ClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) { onClick(e.latlng.lat, e.latlng.lng) },
  })
  return null
}

export default function Geofences() {
  usePageTitle('Geofences')
  const queryClient = useQueryClient()
  const toast = useToast()
  const { convertDistance, distanceUnit } = useSettings()
  const { data: geofences, isLoading } = useQuery({ queryKey: ['geofences'], queryFn: getGeofences })

  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark')
  const [form, setForm] = useState<FormData>(emptyForm)
  const [view, setView] = useState<'map' | 'list'>('map')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const createMut = useMutation({
    mutationFn: (data: Omit<Geofence, 'id'>) => createGeofence(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['geofences'] }); setEditing(null); toast.success('Geofence created') },
    onError: (err: Error) => { toast.error('Failed to create geofence', err.message) },
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Omit<Geofence, 'id'> }) => updateGeofence(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['geofences'] }); setEditing(null); toast.success('Geofence updated') },
    onError: (err: Error) => { toast.error('Failed to update geofence', err.message) },
  })
  const deleteMut = useMutation({
    mutationFn: deleteGeofence,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['geofences'] }); toast.success('Geofence deleted') },
    onError: (err: Error) => { toast.error('Failed to delete geofence', err.message) },
  })

  function startEdit(g: Geofence) {
    setEditing(g.id)
    setForm({ name: g.name, latitude: String(g.latitude), longitude: String(g.longitude), radius: String(g.radius), cost_per_kwh: g.cost_per_kwh != null ? String(g.cost_per_kwh) : '' })
  }

  function startCreate() {
    setEditing('new')
    setForm(emptyForm)
  }

  function handleSubmit() {
    const payload = {
      name: form.name,
      latitude: parseFloat(form.latitude),
      longitude: parseFloat(form.longitude),
      radius: parseFloat(form.radius),
      cost_per_kwh: form.cost_per_kwh ? parseFloat(form.cost_per_kwh) : null,
    }
    if (editing === 'new') {
      createMut.mutate(payload)
    } else if (typeof editing === 'number') {
      updateMut.mutate({ id: editing, data: payload })
    }
  }

  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (editing !== null) {
      setForm(f => ({ ...f, latitude: lat.toFixed(6), longitude: lng.toFixed(6) }))
    }
  }, [editing])

  const isSaving = createMut.isPending || updateMut.isPending

  // Map center: average of geofences or default
  const center = useMemo(() => {
    if (!geofences?.length) return [37.7749, -122.4194] as [number, number]
    if (selectedId) {
      const sel = geofences.find(g => g.id === selectedId)
      if (sel) return [sel.latitude, sel.longitude] as [number, number]
    }
    const lat = geofences.reduce((s, g) => s + g.latitude, 0) / geofences.length
    const lng = geofences.reduce((s, g) => s + g.longitude, 0) / geofences.length
    return [lat, lng] as [number, number]
  }, [geofences, selectedId])

  const totalArea = geofences?.reduce((s, g) => s + Math.PI * (g.radius / 1000) ** 2, 0) ?? 0
  const avgRadius = geofences?.length ? geofences.reduce((s, g) => s + g.radius, 0) / geofences.length : 0

  const markerIcon = L.divIcon({
    className: '',
    html: '<div style="width:12px;height:12px;background:#a855f7;border-radius:50%;border:2px solid rgba(168,85,247,0.3);box-shadow:0 0 10px rgba(168,85,247,0.5)"></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  })

  return (
    <div className="space-y-8">
      <PageHeader
        title="Geofences"
        subtitle="Define locations for contextual tracking, automation, and alerts"
        actions={
          <div className="flex items-center gap-2">
            <TabNav
              tabs={[
                { key: 'map', label: 'Map', icon: <MapIcon className="h-3.5 w-3.5" /> },
                { key: 'list', label: 'List', icon: <List className="h-3.5 w-3.5" /> },
              ]}
              active={view}
              onChange={k => setView(k as 'map' | 'list')}
            />
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={startCreate}>
              Add
            </Button>
          </div>
        }
      />

      {/* Summary */}
      {geofences && geofences.length > 0 && (
        <FadeIn>
          <GlassPanel className="p-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 items-center">
              <RadialGauge value={geofences.length} max={Math.max(geofences.length, 10)} label="Zones" unit="" color="#a855f7" />
              <div className="text-center">
                <p className="text-lg font-bold text-[var(--text-primary)]">{Math.round(avgRadius)}m</p>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Avg Radius</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-[var(--text-primary)]">{fmtNumber(totalArea * convertDistance(1) ** 2, 2)} {distanceUnit}²</p>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Total Area</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-neon-purple">{geofences.filter(g => g.radius >= 500).length}</p>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Large Zones (500m+)</p>
              </div>
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      <AnimatePresence>
        {editing !== null && (
          <GeofenceForm
            editing={editing}
            form={form}
            setForm={setForm}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(null)}
            isSaving={isSaving}
          />
        )}
      </AnimatePresence>

      {isLoading ? (
        <Skeleton className="h-64 sm:h-96" />
      ) : view === 'map' ? (
        <FadeIn>
          <GlassPanel className="p-0 overflow-hidden relative" style={{ height: 'min(500px, 60vh)' }}>
            <MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />
            <MapContainer center={center} zoom={12} className="h-full w-full" style={{ background: '#0a0a0f' }}>
              <MapTileLayer style={mapStyle} />
            <MapInvalidator />
              <ClickHandler onClick={handleMapClick} />

              {geofences?.map((g, i) => {
                const color = CHART_COLORS[i % CHART_COLORS.length]
                return (
                  <div key={g.id}>
                    <Circle
                      center={[g.latitude, g.longitude]}
                      radius={g.radius}
                      pathOptions={{
                        color,
                        fillColor: color,
                        fillOpacity: selectedId === g.id ? 0.25 : 0.1,
                        weight: selectedId === g.id ? 3 : 1.5,
                        opacity: selectedId === g.id ? 0.9 : 0.5,
                      }}
                      eventHandlers={{ click: () => setSelectedId(g.id) }}
                    />
                    <Marker position={[g.latitude, g.longitude]} icon={markerIcon}>
                      <Popup>
                        <div className="text-xs">
                          <strong>{g.name}</strong><br />
                          {g.radius}m radius<br />
                          <button
                            onClick={() => startEdit(g)}
                            style={{ color: '#00f0ff', border: 'none', background: 'none', cursor: 'pointer', padding: 0, marginTop: '4px', fontSize: '11px' }}
                          >
                            Edit
                          </button>
                        </div>
                      </Popup>
                    </Marker>
                  </div>
                )
              })}

              {/* Preview circle for form */}
              {editing !== null && form.latitude && form.longitude && (
                <Circle
                  center={[parseFloat(form.latitude), parseFloat(form.longitude)]}
                  radius={parseFloat(form.radius) || 50}
                  pathOptions={{ color: '#00f0ff', fillColor: '#00f0ff', fillOpacity: 0.15, weight: 2, dashArray: '8 4' }}
                />
              )}
            </MapContainer>
          </GlassPanel>
        </FadeIn>
      ) : geofences && geofences.length > 0 ? (
        <StaggerContainer className="space-y-3">
          {geofences.map((g: Geofence, i: number) => (
            <StaggerItem key={g.id}>
              <GeofenceCard
                geofence={g}
                color={CHART_COLORS[i % CHART_COLORS.length]}
                isSelected={selectedId === g.id}
                onSelect={() => setSelectedId(g.id === selectedId ? null : g.id)}
                onEdit={() => startEdit(g)}
                onDelete={() => {
                  if (confirm(`Delete geofence "${g.name}"?`)) deleteMut.mutate(g.id)
                }}
              />
            </StaggerItem>
          ))}
        </StaggerContainer>
      ) : (
        <EmptyState
          icon={<MapPin className="h-8 w-8" />}
          title="No geofences defined"
          description="Add a geofence to track when your vehicle arrives or leaves a location."
        />
      )}
    </div>
  )
}

