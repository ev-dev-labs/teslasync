import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import type { MapStyle } from './MapTileLayer'

interface MapLayerSwitcherProps {
  current: MapStyle
  onChange: (style: MapStyle) => void
}

const LAYERS: { id: MapStyle; icon: string; labelKey: string; defaultLabel: string }[] = [
  { id: 'dark', icon: '🌑', labelKey: 'maps.layerSwitcher.dark', defaultLabel: 'Dark' },
  { id: 'satellite', icon: '🛰️', labelKey: 'maps.layerSwitcher.satellite', defaultLabel: 'Satellite' },
  { id: 'streets', icon: '🗺️', labelKey: 'maps.layerSwitcher.streets', defaultLabel: 'Streets' },
  { id: 'terrain', icon: '⛰️', labelKey: 'maps.layerSwitcher.terrain', defaultLabel: 'Terrain' },
]

export function MapLayerSwitcher({ current, onChange }: MapLayerSwitcherProps) {
  const { t } = useTranslation()
  return (
    <div
      // A single-select set of style toggles — expose it as a labelled
      // group so screen-reader users understand the buttons belong together.
      role="group"
      aria-label={t('maps.layerSwitcher.label', 'Map style')}
      className={cn(
        'absolute bottom-6 left-2 z-[1000] flex gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-overlay)] backdrop-blur-md p-1 shadow-lg',
        // Windows High Contrast / forced-colors mode.
        // The semi-transparent overlay surface + alpha border vanish under
        // `forced-colors: active`. Pin a system-colour wrapper so the
        // floating layer-switcher control stays visible against the
        // raster map tiles (which Leaflet renders unchanged in
        // forced-colors mode).
        'forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
      )}
    >
      {LAYERS.map(l => {
        const label = t(l.labelKey, l.defaultLabel)
        const active = current === l.id
        return (
          <button
            key={l.id}
            // Explicit type so the control never acts as a form submit
            // button when a switcher is portalled inside a <form>.
            type="button"
            onClick={() => onChange(l.id)}
            title={label}
            // The text label is hidden below `sm`, leaving an icon-only
            // control — keep the accessible name on the button itself so
            // it is announced at every breakpoint.
            aria-label={label}
            aria-pressed={active}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
              // Give each tile-style button its own
              // system-colour border so the active selection (which only
              // differs by background tint normally) remains distinguishable.
              'forced-colors:border forced-colors:border-[ButtonBorder]',
              active
                ? 'bg-[var(--surface-2)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
            )}
          >
            <span aria-hidden="true">{l.icon}</span>
            <span className="hidden sm:inline">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
