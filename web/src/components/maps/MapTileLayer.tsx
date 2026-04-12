import { TileLayer, useMap } from 'react-leaflet'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { getMapConfig } from '../../api'

export type MapStyle = 'dark' | 'satellite' | 'streets' | 'terrain'

interface MapTileLayerProps {
  style?: MapStyle
}

type TileDef = { url: string; attribution: string }

const freeTiles: Record<MapStyle, TileDef> = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
  },
  streets: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
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

  let tiles: Record<MapStyle, TileDef> = freeTiles
  if (mapConfig?.provider === 'azure' && mapConfig.api_key) {
    tiles = azureTiles(mapConfig.api_key)
  } else if (mapConfig?.provider === 'google' && mapConfig.api_key) {
    tiles = googleTiles(mapConfig.api_key)
  }

  const t = tiles[style] || tiles.dark
  return <TileLayer url={t.url} attribution={t.attribution} />
}

/** Forces Leaflet to recalculate tile positions after the container mounts or resizes. */
export function MapInvalidator() {
  const map = useMap()
  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 100)
    return () => clearTimeout(timer)
  }, [map])
  return null
}
