import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, MapTileLayer } from '@/components/maps';
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
      className={cn('h-full w-full rounded-lg overflow-hidden', className)}
    >
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom={interactive}
        zoomControl={interactive}
        dragging={interactive}
        className="h-full w-full bg-[#1a1a2e]"
      >
        <MapTileLayer style="dark" />
        {children}
      </MapContainer>
    </div>
  );
}
