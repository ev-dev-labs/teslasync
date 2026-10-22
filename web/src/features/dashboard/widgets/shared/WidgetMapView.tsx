import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, MapTileLayer, MapInvalidator } from '@/components/maps';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';

interface WidgetMapViewProps {
  center: [number, number];
  zoom?: number;
  compact?: boolean;
  children?: ReactNode;
  className?: string;
  emptyMessage?: string;
  isEmpty?: boolean;
  /** Accessible name for the map region, announced to screen readers. */
  ariaLabel?: string;
}

/**
 * True only when `center` is a finite `[lat, lng]` pair leaflet can render.
 * Non-finite coordinates (NaN / ±Infinity — e.g. from a half-loaded vehicle
 * state payload) make leaflet throw "Invalid LatLng object", which would crash
 * the whole widget; we fall back to the empty state instead.
 */
function isRenderableCenter(center: [number, number] | null | undefined): boolean {
  return (
    Array.isArray(center) &&
    center.length === 2 &&
    Number.isFinite(center[0]) &&
    Number.isFinite(center[1])
  );
}

/**
 * True while the app runs its light theme. `ThemeProvider` mirrors the
 * resolved color scheme onto `document.documentElement` (`light-mode`
 * class), so the primitive reads that marker — observed, so a mid-session
 * theme switch re-resolves the tiles — instead of requiring a
 * `ThemeProvider` ancestor. Consumer widget tests render the real
 * `WidgetMapView` provider-free and must keep working.
 */
function useLightMode(): boolean {
  const read = (): boolean =>
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('light-mode');
  const [light, setLight] = useState<boolean>(read);
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const root = document.documentElement;
    const observer = new MutationObserver(() => setLight(read()));
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    setLight(read());
    return () => observer.disconnect();
  }, []);
  return light;
}

/**
 * Shared leaflet frame for the dashboard map widgets. Speaks the `mapSvg`
 * language from the widget-redesign spec: a quiet 10px tile well on the
 * theme surface, muted theme-aware tiles (light streets / dark raster) with
 * light/dark parity, and a 160px content floor so the map never collapses
 * inside an auto-height row. Leaflet motion is gesture feedback only; the
 * global reduced-motion safety net neutralises its transitions.
 */
export function WidgetMapView({
  center,
  zoom = 13,
  compact = false,
  children,
  className,
  emptyMessage,
  isEmpty = false,
  ariaLabel,
}: WidgetMapViewProps) {
  const { t } = useTranslation('dashboard');
  const lightMode = useLightMode();

  if (isEmpty || !isRenderableCenter(center)) {
    return (
      <EmptyState
        /* no-action: transient empty state — surfaces when source data is missing or coordinates are invalid; no specific recovery action available */
        message={emptyMessage ?? t('widget.mapView.noData', 'No location data available')}
        className="py-4"
      />
    );
  }

  const interactive = !compact;

  return (
    <div
      role="region"
      aria-label={ariaLabel ?? t('widget.mapView.label', 'Map')}
      className={cn('relative flex min-h-40 flex-1 flex-col w-full rounded-shape-lg overflow-hidden border border-[var(--border-subtle)]', className)}
    >
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom={interactive}
        zoomControl={interactive}
        dragging={interactive}
        className="min-h-0 flex-1 w-full bg-[var(--surface-2)]"
      >
        {/* Light/dark parity: plain street tiles in the light theme, the
            dark raster in the dark theme. The low-bandwidth override inside
            <MapTileLayer> still wins on constrained links. */}
        <MapTileLayer style={lightMode ? 'streets' : 'dark'} />
        <MapInvalidator />
        {children}
      </MapContainer>
    </div>
  );
}
