import {
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  Map as MapGL,
  Source,
  Layer,
  Marker as MarkerGL,
  Popup as PopupGL,
  useMap as useMapGL,
  NavigationControl,
  AttributionControl,
} from 'react-map-gl/maplibre'
import type { MapRef } from 'react-map-gl/maplibre'
import type { StyleSpecification } from 'maplibre-gl'
import type { Feature, LineString, Polygon } from 'geojson'
import { getMapConfig } from '@/api/settings'
import { FullscreenButton } from '@/components/ui/FullscreenButton'
import { cn } from '@/lib/cn'

// ─── Coordinate helpers (Leaflet-compatible) ────────────────────────────────

/** `[lat, lng]` tuple or `{ lat, lng }` object — mirrors Leaflet's LatLng inputs. */
export type LatLngExpression = [number, number] | { lat: number; lng: number }
/** @deprecated alias kept for call-sites that imported the previous name. */
export type LatLngLike = LatLngExpression

function toLL(c: LatLngExpression): { lat: number; lng: number } {
  const lat = Array.isArray(c) ? c[0] : c.lat
  const lng = Array.isArray(c) ? c[1] : c.lng
  return { lat: lat ?? 0, lng: lng ?? 0 }
}

/** GeoJSON `[lng, lat]` position order. */
function toPos(c: LatLngExpression): [number, number] {
  const { lat, lng } = toLL(c)
  return [lng, lat]
}

// ─── Base tile providers + style switching ──────────────────────────────────

export type MapStyle = 'dark' | 'satellite' | 'streets' | 'terrain'

type TileDef = { url: string; attribution: string }

const freeTiles: Record<MapStyle, TileDef> = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>', // i18n-ignore (brand name in HTML attribution required by tile provider terms)
  },
  streets: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', // i18n-ignore (brand name)
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>', // i18n-ignore (brand name)
  },
}

function azureTiles(key: string): Record<MapStyle, TileDef> {
  const base = 'https://atlas.microsoft.com/map/tile?api-version=2024-04-01&subscription-key=' + key
  return {
    dark: { url: `${base}&tilesetId=microsoft.base.darkgrey&zoom={z}&x={x}&y={y}`, attribution: '&copy; Azure Maps' },
    streets: { url: `${base}&tilesetId=microsoft.base.road&zoom={z}&x={x}&y={y}`, attribution: '&copy; Azure Maps' },
    satellite: { url: `${base}&tilesetId=microsoft.imagery&zoom={z}&x={x}&y={y}`, attribution: '&copy; Azure Maps' },
    terrain: { url: `${base}&tilesetId=microsoft.base.road&zoom={z}&x={x}&y={y}`, attribution: '&copy; Azure Maps' },
  }
}

function googleTiles(key: string): Record<MapStyle, TileDef> {
  return {
    dark: { url: `https://mt1.google.com/vt/lyrs=r&x={x}&y={y}&z={z}&key=${key}`, attribution: '&copy; Google Maps' },
    streets: { url: `https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&key=${key}`, attribution: '&copy; Google Maps' },
    satellite: { url: `https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}&key=${key}`, attribution: '&copy; Google Maps' },
    terrain: { url: `https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}&key=${key}`, attribution: '&copy; Google Maps' },
  }
}

/**
 * Translate a Leaflet-style raster URL template into a MapLibre `tiles` array.
 * MapLibre has no `{s}` subdomain or `{r}` retina token, so we strip `{r}` and
 * fan `{s}` out into explicit a/b/c subdomain URLs (MapLibre load-balances
 * requests across the array).
 */
function toRasterTiles(url: string): string[] {
  const cleaned = url.replace('{r}', '')
  if (cleaned.includes('{s}')) {
    return ['a', 'b', 'c'].map((s) => cleaned.replace('{s}', s))
  }
  return [cleaned]
}

/** Minimal dark base style so tiles paint over a backdrop, not a white flash. */
const BASE_MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#0b0b0f' } }],
}

// ─── MapContainer ───────────────────────────────────────────────────────────

export interface MapContainerProps {
  /** Initial map center as `[lat, lng]` (or `{ lat, lng }`). */
  center: LatLngExpression
  /** Initial zoom level. */
  zoom: number
  children?: ReactNode
  className?: string
  style?: CSSProperties
  /** Enable wheel zoom (default true). Maps to MapLibre `scrollZoom`. */
  scrollWheelZoom?: boolean
  /** Show the +/- zoom control (default true). */
  zoomControl?: boolean
  /** Enable drag-to-pan (default true). Maps to MapLibre `dragPan`. */
  dragging?: boolean
  /** Show the attribution control (default true). */
  attributionControl?: boolean
  minZoom?: number
  maxZoom?: number
  /** Accepted for Leaflet API compatibility; MapLibre animates natively. */
  fadeAnimation?: boolean
  zoomAnimation?: boolean
  markerZoomAnimation?: boolean
}

/**
 * Root map surface, rendered on MapLibre GL via react-map-gl.
 *
 * Presents the same external prop API as the previous Leaflet `<MapContainer>`
 * (center, zoom, scrollWheelZoom, zoomControl, dragging, className, style) so
 * consuming pages compose it unchanged. Provides the react-map-gl context that
 * <MapTileLayer>, <Marker>, <Polyline>, <CircleMarker>, <Circle>,
 * <MapInvalidator> and <MapFullscreenControl> attach to.
 *
 * Native touch gestures (pinch-zoom, drag-pan, two-finger rotate) are enabled
 * by default — the reason the module moved to WebGL rendering.
 */
export function MapContainer({
  center,
  zoom,
  children,
  className,
  style,
  scrollWheelZoom = true,
  zoomControl = true,
  dragging = true,
  attributionControl = true,
  minZoom,
  maxZoom,
}: MapContainerProps) {
  const { lat, lng } = toLL(center)
  return (
    <div className={cn('relative h-full w-full overflow-hidden', className)} style={style}>
      <MapGL
        initialViewState={{ longitude: lng, latitude: lat, zoom: zoom ?? 1 }}
        mapStyle={BASE_MAP_STYLE}
        attributionControl={false}
        scrollZoom={scrollWheelZoom}
        dragPan={dragging}
        minZoom={minZoom}
        maxZoom={maxZoom}
        style={{ position: 'absolute', inset: 0 }}
      >
        {zoomControl ? <NavigationControl position="top-left" showCompass={false} /> : null}
        {attributionControl ? <AttributionControl position="bottom-right" /> : null}
        {children}
      </MapGL>
    </div>
  )
}

// ─── MapTileLayer ───────────────────────────────────────────────────────────

export interface MapTileLayerProps {
  style?: MapStyle
}

/**
 * Base raster basemap layer + provider/style switching. Reads the configured
 * tile provider (`free` | `azure` | `google`) from the API and renders the
 * selected style as a MapLibre raster <Source>/<Layer>. Must be a child of
 * <MapContainer>. Re-keys the source on URL change so switching styles cleanly
 * swaps the tile set.
 */
export function MapTileLayer({ style = 'dark' }: MapTileLayerProps) {
  const { data: mapConfig } = useQuery({
    queryKey: ['map-config'],
    queryFn: getMapConfig,
    staleTime: 5 * 60 * 1000,
  })

  let tiles: Record<MapStyle, TileDef> = freeTiles
  if (mapConfig?.provider === 'azure' && mapConfig.api_key) {
    tiles = azureTiles(mapConfig.api_key)
  } else if (mapConfig?.provider === 'google' && mapConfig.api_key) {
    tiles = googleTiles(mapConfig.api_key)
  }

  const def = tiles[style] ?? tiles.dark
  const tileUrls = toRasterTiles(def.url)

  return (
    <Source
      key={tileUrls.join('|')}
      id="teslasync-basemap"
      type="raster"
      tiles={tileUrls}
      tileSize={256}
      attribution={def.attribution}
    >
      <Layer id="teslasync-basemap-layer" type="raster" />
    </Source>
  )
}

// ─── MapInvalidator ─────────────────────────────────────────────────────────

/**
 * Nudges MapLibre to re-measure its container shortly after mount. MapLibre
 * already tracks container resizes automatically, but an explicit resize covers
 * panels that expand/animate into their final size on the first frame.
 */
export function MapInvalidator() {
  const { current: map } = useMapGL()
  useEffect(() => {
    if (!map) return
    const timer = setTimeout(() => map.resize(), 100)
    return () => clearTimeout(timer)
  }, [map])
  return null
}

// ─── MapFullscreenControl ───────────────────────────────────────────────────

export interface MapFullscreenControlProps {
  /**
   * Corner of the map to mount the button in. Defaults to `topright`. RTL pages
   * typically pass `topleft` so the control stays on the reading direction's
   * trailing edge.
   */
  position?: 'topleft' | 'topright' | 'bottomleft' | 'bottomright'
  /** Override the "Enter fullscreen" accessible label. */
  ariaLabelEnter?: string
  /** Override the "Exit fullscreen" accessible label. */
  ariaLabelExit?: string
}

const POSITION_CLASS: Record<NonNullable<MapFullscreenControlProps['position']>, string> = {
  topleft: 'top-2 left-2',
  topright: 'top-2 right-2',
  bottomleft: 'bottom-2 left-2',
  bottomright: 'bottom-2 right-2',
}

/**
 * Fullscreen overlay for MapLibre maps. Must be rendered inside <MapContainer>.
 * Grabs the active map via `useMap()` and portals a <FullscreenButton> chip
 * into the map's container element so it positions itself in the map corner.
 * On enter/exit fullscreen we call `map.resize()` on the next animation frame
 * to defend against browsers that defer the container resize by a frame.
 */
export function MapFullscreenControl({
  position = 'topright',
  ariaLabelEnter,
  ariaLabelExit,
}: MapFullscreenControlProps) {
  const { current: map } = useMapGL()
  const containerRef = useRef<HTMLElement | null>(null)
  const container = map ? map.getContainer() : null
  containerRef.current = container

  useEffect(() => {
    if (!map) return
    const onChange = () => requestAnimationFrame(() => map.resize())
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [map])

  if (!container) return null

  return createPortal(
    <div
      // Sits above the MapLibre canvas; `pointer-events-auto` re-enables clicks
      // over the gesture-capturing canvas.
      className={cn('maplibregl-ctrl absolute z-[800] m-2 pointer-events-auto', POSITION_CLASS[position])}
    >
      <FullscreenButton
        targetRef={containerRef}
        ariaLabelEnter={ariaLabelEnter}
        ariaLabelExit={ariaLabelExit}
        className="bg-[var(--surface-1)]/90 border border-[var(--border-default)] text-[var(--text-primary)] shadow"
      />
    </div>,
    container,
  )
}

// ─── Marker + Popup (DOM overlays with Leaflet-style API) ───────────────────

type MarkerPopupCtx = { longitude: number; latitude: number; open: boolean; close: () => void }
const MarkerPopupContext = createContext<MarkerPopupCtx | null>(null)

/** Focusable, keyboard-operable wrapper for interactive (popup/clickable) markers. */
function InteractiveMarker({
  label,
  onActivate,
  children,
}: {
  label?: string
  onActivate: () => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label ?? t('maps.markerLabel', 'Map marker')}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onActivate()
        }
      }}
      className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
    >
      {children}
    </div>
  )
}

export interface MarkerProps {
  position: LatLngExpression
  /** A React element icon (e.g. from `vehicleIcon()`); falls back to the themed dot. */
  icon?: unknown
  /** Accessible label used when the marker is interactive (has a popup/click). */
  title?: string
  eventHandlers?: LayerEventHandlers
  children?: ReactNode
}

/** Themed vehicle marker — a glowing, pulsing dot (matches the prior DivIcon). */
function VehicleDot() {
  return (
    <div className="relative h-7 w-7" aria-hidden>
      <span className="absolute inset-0 rounded-full bg-cyan-400/25 animate-ping" />
      <span className="absolute inset-[5px] rounded-full border-2 border-white bg-cyan-400 shadow-[0_0_10px_rgba(0,240,255,0.9)]" />
    </div>
  )
}

/**
 * Point marker rendered as a react-map-gl DOM overlay. Preserves the Leaflet
 * `position` / `icon` / `eventHandlers` / child-`<Popup>` API. When it carries a
 * popup or click handler it becomes a focusable, keyboard-operable button with a
 * ≥44px touch target; otherwise it is a decorative overlay.
 */
export function Marker({ position, icon, title, eventHandlers, children }: MarkerProps) {
  const [open, setOpen] = useState(false)
  const { lat, lng } = toLL(position)
  const interactive = Boolean(children) || Boolean(eventHandlers?.click)
  const visual = isValidElement(icon) ? icon : <VehicleDot />
  const activate = () => {
    setOpen((o) => !o)
    eventHandlers?.click?.({ latlng: { lat, lng } })
  }
  return (
    <>
      <MarkerGL longitude={lng} latitude={lat} anchor="center" onClick={activate}>
        {interactive ? (
          <InteractiveMarker label={title} onActivate={activate}>
            {visual}
          </InteractiveMarker>
        ) : (
          <div aria-hidden>{visual}</div>
        )}
      </MarkerGL>
      <MarkerPopupContext.Provider value={{ longitude: lng, latitude: lat, open, close: () => setOpen(false) }}>
        {children}
      </MarkerPopupContext.Provider>
    </>
  )
}

export interface PopupProps {
  children?: ReactNode
}

/**
 * Popup bound to the enclosing <Marker>/<CircleMarker> (via context, so it also
 * works when wrapped in a helper component). Shown when its parent is clicked.
 */
export function Popup({ children }: PopupProps) {
  const ctx = useContext(MarkerPopupContext)
  if (!ctx || !ctx.open) return null
  return (
    <PopupGL
      longitude={ctx.longitude}
      latitude={ctx.latitude}
      anchor="bottom"
      offset={18}
      closeOnClick={false}
      onClose={() => ctx.close()}
    >
      {children}
    </PopupGL>
  )
}

// ─── Vector path options ────────────────────────────────────────────────────

export interface PathOptions {
  color?: string
  weight?: number
  opacity?: number
  fillColor?: string
  fillOpacity?: number
  dashArray?: string | number[]
}

/** Leaflet-style click event carrying the clicked coordinate. */
export interface MapLayerMouseEvent {
  latlng: { lat: number; lng: number }
}

/** Subset of Leaflet's `eventHandlers` map that consumers rely on. */
export interface LayerEventHandlers {
  click?: (e: MapLayerMouseEvent) => void
}

function parseDash(dashArray: string | number[] | undefined, width: number): number[] | undefined {
  if (!dashArray) return undefined
  const nums = Array.isArray(dashArray)
    ? dashArray
    : dashArray.split(/[\s,]+/).map(Number).filter((n) => !Number.isNaN(n))
  if (nums.length === 0) return undefined
  const w = width > 0 ? width : 1
  return nums.map((n) => n / w)
}

// ─── CircleMarker (pixel-radius dot) ────────────────────────────────────────

export interface CircleMarkerProps {
  center: LatLngExpression
  /** Radius in screen pixels. */
  radius: number
  color?: string
  weight?: number
  fillColor?: string
  fillOpacity?: number
  pathOptions?: PathOptions
  title?: string
  eventHandlers?: LayerEventHandlers
  children?: ReactNode
}

/**
 * Fixed-pixel circular marker (Leaflet `<CircleMarker>`), rendered as a
 * react-map-gl DOM overlay so it keeps a constant screen size. When it carries
 * a popup or click handler it gains a focusable ≥44px hit target; otherwise it
 * is a lightweight decorative dot (e.g. heatmap points).
 */
export function CircleMarker({
  center,
  radius,
  color,
  weight,
  fillColor,
  fillOpacity,
  pathOptions,
  title,
  eventHandlers,
  children,
}: CircleMarkerProps) {
  const [open, setOpen] = useState(false)
  const { lat, lng } = toLL(center)
  const o: PathOptions = { color, weight, fillColor, fillOpacity, ...pathOptions }
  const size = Math.max(2, (radius ?? 4) * 2)
  const stroke = o.color && o.color !== 'transparent' ? o.color : undefined
  const dotStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '9999px',
    backgroundColor: o.fillColor ?? o.color ?? '#22d3ee',
    opacity: o.fillOpacity ?? 1,
    border: stroke ? `${o.weight ?? 1}px solid ${stroke}` : undefined,
    boxSizing: 'border-box',
  }
  const interactive = Boolean(children) || Boolean(eventHandlers?.click)
  const dot = <span style={dotStyle} aria-hidden />
  const activate = () => {
    setOpen((op) => !op)
    eventHandlers?.click?.({ latlng: { lat, lng } })
  }
  return (
    <>
      <MarkerGL longitude={lng} latitude={lat} anchor="center" onClick={activate}>
        {interactive ? (
          <InteractiveMarker label={title} onActivate={activate}>
            {dot}
          </InteractiveMarker>
        ) : (
          dot
        )}
      </MarkerGL>
      <MarkerPopupContext.Provider value={{ longitude: lng, latitude: lat, open, close: () => setOpen(false) }}>
        {children}
      </MarkerPopupContext.Provider>
    </>
  )
}

// ─── Polyline (GeoJSON line) ────────────────────────────────────────────────

export interface PolylineProps {
  positions: LatLngExpression[]
  color?: string
  weight?: number
  opacity?: number
  pathOptions?: PathOptions
  eventHandlers?: LayerEventHandlers
}

/** Route/line rendered as a MapLibre GeoJSON line layer (Leaflet `<Polyline>`). */
export function Polyline({ positions, color, weight, opacity, pathOptions, eventHandlers }: PolylineProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const layerId = `ts-polyline-${uid}`
  const o: PathOptions = { color, weight, opacity, ...pathOptions }
  const width = o.weight ?? 3
  const dash = parseDash(o.dashArray, width)
  const data: Feature<LineString> = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: (positions ?? []).map(toPos) },
  }

  const { current: map } = useMapGL()
  const onClick = eventHandlers?.click
  useEffect(() => {
    if (!map || !onClick) return
    const handleClick = (e: { lngLat: { lat: number; lng: number } }) =>
      onClick({ latlng: { lat: e.lngLat.lat, lng: e.lngLat.lng } })
    const enter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }
    const leave = () => {
      map.getCanvas().style.cursor = ''
    }
    map.on('click', layerId, handleClick)
    map.on('mouseenter', layerId, enter)
    map.on('mouseleave', layerId, leave)
    return () => {
      map.off('click', layerId, handleClick)
      map.off('mouseenter', layerId, enter)
      map.off('mouseleave', layerId, leave)
    }
  }, [map, onClick, layerId])

  return (
    <Source id={`ts-polyline-src-${uid}`} type="geojson" data={data}>
      <Layer
        id={layerId}
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        paint={{
          'line-color': o.color ?? '#00f0ff',
          'line-width': width,
          'line-opacity': o.opacity ?? 1,
          ...(dash ? { 'line-dasharray': dash } : {}),
        }}
      />
    </Source>
  )
}

// ─── Circle (metric radius) ─────────────────────────────────────────────────

export interface CircleProps {
  center: LatLngExpression
  /** Radius in metres. */
  radius: number
  color?: string
  weight?: number
  fillColor?: string
  fillOpacity?: number
  pathOptions?: PathOptions
  children?: ReactNode
}

function circlePolygon(lat: number, lng: number, radiusM: number): Feature<Polygon> {
  const coords: [number, number][] = []
  const earth = 6378137
  const dLat = (radiusM / earth) * (180 / Math.PI)
  const dLng = dLat / Math.max(Math.cos((lat * Math.PI) / 180), 1e-6)
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * 2 * Math.PI
    coords.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)])
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } }
}

/** Geographic circle in metres (Leaflet `<Circle>`) as a MapLibre fill+line. */
export function Circle({ center, radius, color, weight, fillColor, fillOpacity, pathOptions }: CircleProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const o: PathOptions = { color, weight, fillColor, fillOpacity, ...pathOptions }
  const { lat, lng } = toLL(center)
  const data = circlePolygon(lat, lng, radius ?? 0)
  return (
    <Source id={`ts-circle-src-${uid}`} type="geojson" data={data}>
      <Layer
        id={`ts-circle-fill-${uid}`}
        type="fill"
        paint={{ 'fill-color': o.fillColor ?? o.color ?? '#3b82f6', 'fill-opacity': o.fillOpacity ?? 0.2 }}
      />
      <Layer
        id={`ts-circle-line-${uid}`}
        type="line"
        paint={{ 'line-color': o.color ?? '#3b82f6', 'line-width': o.weight ?? 2 }}
      />
    </Source>
  )
}

// ─── Rectangle + FeatureGroup ───────────────────────────────────────────────

export interface RectangleProps {
  bounds: [[number, number], [number, number]]
  color?: string
  weight?: number
  fillColor?: string
  fillOpacity?: number
  pathOptions?: PathOptions
}

/** Axis-aligned rectangle (Leaflet `<Rectangle>`) as a MapLibre fill+line. */
export function Rectangle({ bounds, color, weight, fillColor, fillOpacity, pathOptions }: RectangleProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const o: PathOptions = { color, weight, fillColor, fillOpacity, ...pathOptions }
  const sw = bounds?.[0] ?? [0, 0]
  const ne = bounds?.[1] ?? [0, 0]
  const [s, w] = sw
  const [n, e] = ne
  const ring: [number, number][] = [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ]
  const data: Feature<Polygon> = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  }
  return (
    <Source id={`ts-rect-src-${uid}`} type="geojson" data={data}>
      <Layer
        id={`ts-rect-fill-${uid}`}
        type="fill"
        paint={{ 'fill-color': o.fillColor ?? o.color ?? '#3b82f6', 'fill-opacity': o.fillOpacity ?? 0.15 }}
      />
      <Layer
        id={`ts-rect-line-${uid}`}
        type="line"
        paint={{ 'line-color': o.color ?? '#3b82f6', 'line-width': o.weight ?? 2 }}
      />
    </Source>
  )
}

export interface FeatureGroupProps {
  children?: ReactNode
}

/** Groups overlay children (Leaflet `<FeatureGroup>`); a transparent wrapper. */
export function FeatureGroup({ children }: FeatureGroupProps) {
  return <>{children}</>
}

// ─── useMap facade + latLngBounds (Leaflet-compatible imperative API) ───────

/** Minimal Leaflet-`LatLngBounds`-compatible bounds used by `fitBounds`. */
export class LatLngBoundsCompat {
  private _sw: { lat: number; lng: number } | null = null
  private _ne: { lat: number; lng: number } | null = null

  constructor(coords?: LatLngExpression[]) {
    for (const c of coords ?? []) this.extend(c)
  }

  extend(c: LatLngExpression): this {
    const p = toLL(c)
    if (!this._sw || !this._ne) {
      this._sw = { ...p }
      this._ne = { ...p }
    } else {
      this._sw = { lat: Math.min(this._sw.lat, p.lat), lng: Math.min(this._sw.lng, p.lng) }
      this._ne = { lat: Math.max(this._ne.lat, p.lat), lng: Math.max(this._ne.lng, p.lng) }
    }
    return this
  }

  getSouthWest(): { lat: number; lng: number } {
    return this._sw ?? { lat: 0, lng: 0 }
  }

  getNorthEast(): { lat: number; lng: number } {
    return this._ne ?? { lat: 0, lng: 0 }
  }

  isValid(): boolean {
    return this._sw !== null && this._ne !== null
  }

  contains(c: LatLngExpression): boolean {
    if (!this._sw || !this._ne) return false
    const p = toLL(c)
    return (
      p.lat >= this._sw.lat &&
      p.lat <= this._ne.lat &&
      p.lng >= this._sw.lng &&
      p.lng <= this._ne.lng
    )
  }
}

/** Build bounds from a list of coordinates (Leaflet `latLngBounds`). */
export function latLngBounds(coords?: LatLngExpression[]): LatLngBoundsCompat {
  return new LatLngBoundsCompat(coords)
}

function normalizePadding(p: [number, number] | number | undefined) {
  if (p == null) return 0
  if (typeof p === 'number') return p
  const [x, y] = p
  return { left: x ?? 0, right: x ?? 0, top: y ?? 0, bottom: y ?? 0 }
}

export interface LeafletMapCompat {
  fitBounds(bounds: LatLngBoundsCompat, opts?: { padding?: [number, number] | number }): void
  setView(center: LatLngExpression, zoom: number): void
  panTo(center: LatLngExpression, opts?: { duration?: number }): void
  flyTo(center: LatLngExpression, zoom?: number): void
  getBounds(): LatLngBoundsCompat
  getZoom(): number
  getCenter(): { lat: number; lng: number }
  resize(): void
  getContainer(): HTMLElement | null
  /** Escape hatch to the underlying MapLibre map instance. */
  getMaplibreMap(): MapRef | undefined
}

/**
 * Leaflet-compatible imperative map handle. Returns a stable facade whose camera
 * operations translate to MapLibre. MapLibre creates its map asynchronously, so
 * a camera op requested before the map is ready is applied once it loads.
 */
export function useMap(): LeafletMapCompat {
  const { current } = useMapGL()
  const mapRef = useRef<MapRef | undefined>(undefined)
  mapRef.current = current
  const pendingRef = useRef<((m: MapRef) => void) | null>(null)
  const facadeRef = useRef<LeafletMapCompat | null>(null)

  if (facadeRef.current === null) {
    const run = (op: (m: MapRef) => void) => {
      if (mapRef.current) op(mapRef.current)
      else pendingRef.current = op
    }
    facadeRef.current = {
      fitBounds: (bounds, opts) =>
        run((m) => {
          const sw = bounds.getSouthWest()
          const ne = bounds.getNorthEast()
          m.fitBounds(
            [
              [sw.lng, sw.lat],
              [ne.lng, ne.lat],
            ],
            { padding: normalizePadding(opts?.padding), duration: 0 },
          )
        }),
      setView: (center, zoom) =>
        run((m) => {
          const { lat, lng } = toLL(center)
          m.jumpTo({ center: [lng, lat], zoom })
        }),
      panTo: (center, opts) =>
        run((m) => {
          const { lat, lng } = toLL(center)
          m.panTo([lng, lat], opts?.duration != null ? { duration: opts.duration } : undefined)
        }),
      flyTo: (center, zoom) =>
        run((m) => {
          const { lat, lng } = toLL(center)
          m.flyTo(zoom != null ? { center: [lng, lat], zoom } : { center: [lng, lat] })
        }),
      getBounds: () => {
        const m = mapRef.current
        if (!m) return new LatLngBoundsCompat()
        const b = m.getBounds()
        return new LatLngBoundsCompat([
          [b.getSouth(), b.getWest()],
          [b.getNorth(), b.getEast()],
        ])
      },
      getZoom: () => mapRef.current?.getZoom() ?? 0,
      getCenter: () => {
        const c = mapRef.current?.getCenter()
        return { lat: c?.lat ?? 0, lng: c?.lng ?? 0 }
      },
      resize: () => mapRef.current?.resize(),
      getContainer: () => mapRef.current?.getContainer() ?? null,
      getMaplibreMap: () => mapRef.current,
    }
  }

  useEffect(() => {
    if (current && pendingRef.current) {
      pendingRef.current(current)
      pendingRef.current = null
    }
  }, [current])

  return facadeRef.current
}
