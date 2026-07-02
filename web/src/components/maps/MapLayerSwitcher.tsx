import { useRef, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import type { MapStyle } from './MapTileLayer'

interface MapLayerSwitcherProps {
  current: MapStyle
  onChange: (style: MapStyle) => void
}

/**
 * Floating basemap-style switcher for the MapLibre GL maps.
 *
 * Renderer-agnostic by design: it emits a `MapStyle` value through
 * `onChange`, and the MapLibre-backed `<MapTileLayer>` consumes it to swap
 * the vector/raster source. Keeping the control decoupled from the map
 * instance is what lets the 5 call-sites (route replay, trip replay, vehicle
 * charts, drive-detail route map, map overview) keep their existing
 * `{ current, onChange }` contract unchanged while the underlying map moved
 * from Leaflet raster tiles to MapLibre GL WebGL vector tiles.
 *
 * Accessibility: implemented as a WAI-ARIA radio group with roving tabindex —
 * only the selected segment is in the tab order, and Arrow/Home/End move
 * selection between styles. Raw `<button>` segments (rather than the shared
 * <Button>) are intentional here: a segmented single-select control needs
 * per-segment `role="radio"` semantics plus the CSS-variable surface theming
 * that keeps it legible in both light and dark themes.
 */
export function MapLayerSwitcher({ current, onChange }: MapLayerSwitcherProps) {
  const { t } = useTranslation()
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  const layers: { id: MapStyle; icon: string; label: string }[] = [
    { id: 'dark', icon: '🌑', label: t('maps.layers.dark', 'Dark') },
    { id: 'satellite', icon: '🛰️', label: t('maps.layers.satellite', 'Satellite') },
    { id: 'streets', icon: '🗺️', label: t('maps.layers.streets', 'Streets') },
    { id: 'terrain', icon: '⛰️', label: t('maps.layers.terrain', 'Terrain') },
  ]

  const selectedIndex = layers.findIndex(l => l.id === current)
  // When `current` matches nothing, keep the first segment reachable by Tab so
  // the control never becomes a keyboard trap with no tabbable child.
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0

  const moveTo = (nextIndex: number) => {
    const count = layers.length
    if (count === 0) return
    const wrapped = ((nextIndex % count) + count) % count
    const layer = layers[wrapped]
    if (!layer) return
    onChange(layer.id)
    buttonRefs.current[wrapped]?.focus()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        moveTo(index + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        moveTo(index - 1)
        break
      case 'Home':
        e.preventDefault()
        moveTo(0)
        break
      case 'End':
        e.preventDefault()
        moveTo(layers.length - 1)
        break
      default:
        break
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('maps.layers.label', 'Map style')}
      className={cn(
        'absolute bottom-6 start-2 z-[1000] flex gap-1 rounded-lg border p-1 shadow-lg backdrop-blur-md',
        'border-[var(--border-subtle)] bg-[var(--surface-overlay)]',
        // Windows High Contrast / forced-colors mode.
        // The semi-transparent overlay surface + alpha border vanish under
        // `forced-colors: active`. Pin a system-colour wrapper so the
        // floating layer-switcher control stays visible against the map
        // canvas (which the WebGL renderer paints unchanged in
        // forced-colors mode).
        'forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
      )}
    >
      {layers.map((l, i) => {
        const active = current === l.id
        return (
          <button
            key={l.id}
            ref={el => {
              buttonRefs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={l.label}
            title={l.label}
            tabIndex={i === tabbableIndex ? 0 : -1}
            onClick={() => onChange(l.id)}
            onKeyDown={e => handleKeyDown(e, i)}
            className={cn(
              // ≥44×44 hit area (WCAG 2.5.5 / Apple HIG) so the control is
              // comfortably tappable on a 375px-wide phone; grows wider once
              // the text label appears at the `sm` breakpoint.
              'flex min-h-11 min-w-11 select-none items-center justify-center gap-1.5 whitespace-nowrap',
              'rounded-md px-2.5 text-[11px] font-medium transition-colors',
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500',
              'focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-overlay)]',
              // Give each tile-style segment its own system-colour border so
              // the active selection (which normally differs only by a
              // background tint) stays distinguishable in forced-colors mode.
              'forced-colors:border forced-colors:border-[ButtonBorder]',
              active
                ? 'bg-[var(--surface-2)] text-white shadow-sm forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
            )}
          >
            <span aria-hidden="true" className="text-base leading-none">
              {l.icon}
            </span>
            <span className="hidden sm:inline">{l.label}</span>
          </button>
        )
      })}
    </div>
  )
}
