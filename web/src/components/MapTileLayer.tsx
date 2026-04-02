import { TileLayer } from 'react-leaflet'

export type MapStyle = 'dark' | 'satellite' | 'streets' | 'terrain'

interface MapTileLayerProps {
  style?: MapStyle
}

const tiles: Record<MapStyle, { url: string; attribution: string }> = {
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

export function MapTileLayer({ style = 'dark' }: MapTileLayerProps) {
  const t = tiles[style] || tiles.dark
  return <TileLayer url={t.url} attribution={t.attribution} />
}
