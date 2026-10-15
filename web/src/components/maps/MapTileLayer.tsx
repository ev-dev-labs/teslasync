import { TileLayer, useMap } from 'react-leaflet'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { getMapConfig } from '@/api/settings'
import { FullscreenButton } from '@/components/ui/FullscreenButton'
import { useDataSaverPolicy } from '@/hooks/useLowBandwidthMode'

export type MapStyle = 'dark' | 'satellite' | 'streets' | 'terrain'

interface MapTileLayerProps {
  style?: MapStyle
}

type TileDef = { url: string; attribution: string }

const freeTiles: Record<MapStyle, TileDef> = {
  dark: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', // i18n-ignore (brand name)
  },
  streets: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
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

export function MapTileLayer({ style = 'dark' }: MapTileLayerProps) {
  const { data: mapConfig } = useQuery({
    queryKey: ['map-config'],
    queryFn: getMapConfig,
    staleTime: 5 * 60 * 1000,
  })
  // PWA-07: satellite and terrain basemaps are photographic raster tiles and
  // are by far the heaviest thing a map page downloads. Under low-bandwidth
  // mode they fall back to the lightweight dark street basemap. The
  // provider selection below is untouched — an operator who configured Azure
  // or Google still gets their provider, just its cheapest style.
  const { richMapTiles } = useDataSaverPolicy()
  const effectiveStyle: MapStyle = richMapTiles ? style : 'dark'

  let tiles: Record<MapStyle, TileDef> = freeTiles
  if (mapConfig?.provider === 'azure' && mapConfig.api_key) {
    tiles = azureTiles(mapConfig.api_key)
  } else if (mapConfig?.provider === 'google' && mapConfig.api_key) {
    tiles = googleTiles(mapConfig.api_key)
  }

  const t = tiles[effectiveStyle] || tiles.dark
  return (
    <TileLayer
      url={t.url}
      attribution={t.attribution}
      // CARTO's former anonymous dark tiles now return an API-key watermark.
      // Darken only OSM's raster layer, leaving route and marker colors intact.
      className={tiles === freeTiles && t === freeTiles.dark
        ? '[filter:invert(1)_hue-rotate(180deg)_brightness(0.85)]'
        : undefined}
      // Defer tile requests until the pan/zoom gesture settles so a drag does
      // not fire a request storm on a constrained link.
      updateWhenIdle={!richMapTiles}
    />
  )
}

/** Forces Leaflet to recalculate tile positions after the container mounts or resizes. */
export function MapInvalidator() {
  const map = useMap()
  useEffect(() => {
    const invalidate = () => map.invalidateSize({ animate: false })
    const timer = setTimeout(invalidate, 100)
    const container = map.getContainer()
    const observer = container && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(invalidate)
      : undefined
    if (container && observer) observer.observe(container)
    return () => {
      clearTimeout(timer)
      observer?.disconnect()
    }
  }, [map])
  return null
}

/**
 * Fullscreen overlay for leaflet maps.
 *
 * Must be rendered as a child of `<MapContainer>`. Uses `useMap()`
 * to grab the active leaflet map instance, then portals a small
 * `<FullscreenButton>` chip into the leaflet container's DOM
 * (`map.getContainer()`) so the button positions itself in the
 * map corner instead of having to be styled by every page that
 * adopts it.
 *
 * Fullscreen changes also invalidate size explicitly so the control works
 * on maps that do not mount the resize-observing `MapInvalidator`.
 *
 * The `:fullscreen` rule in `web/src/index.css` sizes the leaflet
 * container to the viewport so the map fills the screen.
 */
export interface MapFullscreenControlProps {
  /**
   * Corner of the map to mount the button in. Defaults to
   * `topright`. RTL pages typically pass `topleft` so the control
   * stays on the page's "trailing edge" in the user's reading
   * direction.
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

export function MapFullscreenControl({
  position = 'topright',
  ariaLabelEnter,
  ariaLabelExit,
}: MapFullscreenControlProps) {
  const map = useMap()
  // Set the ref synchronously during render — `map.getContainer()`
  // returns the same `.leaflet-container` div across the lifetime of
  // the map, so this is safe and idempotent. Doing it here (instead
  // of in a `useEffect`) means the FullscreenButton's own mount-time
  // listener can read a populated ref on first paint, even though
  // child effects run before parent effects in React's commit
  // ordering.
  const containerRef = useRef<HTMLElement | null>(null)
  containerRef.current = map.getContainer()

  // Keep fullscreen sizing correct even without a MapInvalidator child.
  useEffect(() => {
    const onChange = () => {
      requestAnimationFrame(() => map.invalidateSize())
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [map])

  const container = map.getContainer()
  if (!container) return null

  return createPortal(
    <div
      // Sits above the leaflet panes (z-400 is above marker
      // shadows = 600… leaflet's own controls live at 800; we use
      // 800 here so the button stays clickable above marker
      // popups too).
      className={`leaflet-control absolute z-map-tile-control m-2 pointer-events-auto ${POSITION_CLASS[position] ?? POSITION_CLASS.topright}`}
      // The leaflet container uses pointer-events for map drags —
      // the wrapper here MUST re-enable them on the button so
      // clicks register.
    >
      <FullscreenButton
        targetRef={containerRef}
        ariaLabelEnter={ariaLabelEnter}
        ariaLabelExit={ariaLabelExit}
        size="md"
        className="h-11 w-11 p-0 md:h-9 md:w-9 bg-surface-2 border border-[var(--control-border)] text-[var(--text-secondary)] shadow-e1"
      />
    </div>,
    container,
  )
}
