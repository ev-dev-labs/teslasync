import { cn } from '@/lib/cn'
import type { MapStyle } from './MapTileLayer'

interface MapLayerSwitcherProps {
  current: MapStyle
  onChange: (style: MapStyle) => void
}

const layers: { id: MapStyle; icon: string; label: string }[] = [
  { id: 'dark', icon: '🌑', label: 'Dark' },
  { id: 'satellite', icon: '🛰️', label: 'Satellite' },
  { id: 'streets', icon: '🗺️', label: 'Streets' },
  { id: 'terrain', icon: '⛰️', label: 'Terrain' },
]

export function MapLayerSwitcher({ current, onChange }: MapLayerSwitcherProps) {
  return (
    <div
      className={cn(
        'absolute bottom-6 left-2 z-[1000] flex gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-overlay)] backdrop-blur-md p-1 shadow-lg',
        // Phase-46 / Prompt 11 — Windows High Contrast / forced-colors mode.
        // The semi-transparent overlay surface + alpha border vanish under
        // `forced-colors: active`. Pin a system-colour wrapper so the
        // floating layer-switcher control stays visible against the
        // raster map tiles (which Leaflet renders unchanged in
        // forced-colors mode).
        'forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
      )}
    >
      {layers.map(l => (
        <button
          key={l.id}
          onClick={() => onChange(l.id)}
          title={l.label}
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
            // Phase-46 / Prompt 11 — give each tile-style button its own
            // system-colour border so the active selection (which only
            // differs by background tint normally) remains distinguishable.
            'forced-colors:border forced-colors:border-[ButtonBorder]',
            current === l.id
              ? 'bg-[var(--surface-2)] text-white shadow-sm'
              : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
          )}
        >
          <span>{l.icon}</span>
          <span className="hidden sm:inline">{l.label}</span>
        </button>
      ))}
    </div>
  )
}
