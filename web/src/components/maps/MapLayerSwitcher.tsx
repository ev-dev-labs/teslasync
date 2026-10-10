import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { typography } from '@/lib/tokens'
import { Button } from '../ui/Button'
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
        'absolute bottom-6 start-2 end-2 z-map-control grid w-fit max-w-full grid-cols-4 gap-1 rounded-shape-sm border border-[var(--control-border)] bg-[var(--surface-1)] p-1 shadow-e2',
        // Windows High Contrast / forced-colors mode.
        // Pin a system-colour wrapper so the
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
          <Button
            key={l.id}
            variant="ghost"
            size="auto"
            wrapLabel
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
              'min-h-11 min-w-11 gap-1 px-2 py-1 md:min-h-d-row md:min-w-d-row',
              typography.size.xs,
              typography.weight.medium,
              // Give each tile-style button its own
              // system-colour border and explicit selected fill so the
              // active selection remains distinguishable.
              'border forced-colors:border-[ButtonBorder]',
              active
                ? 'border-[var(--control-border-hover)] bg-[var(--surface-2)] text-[var(--text-primary)] forced-colors:[forced-color-adjust:none] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText] forced-colors:hover:bg-[Highlight]'
                : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] forced-colors:bg-[ButtonFace] forced-colors:text-[ButtonText]',
            )}
          >
            <span aria-hidden="true" className="shrink-0">{l.icon}</span>
            <span className="hidden min-w-0 break-words sm:inline">{label}</span>
          </Button>
        )
      })}
    </div>
  )
}
