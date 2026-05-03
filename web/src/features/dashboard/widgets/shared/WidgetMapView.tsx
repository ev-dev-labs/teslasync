import { type ReactNode } from 'react';
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
}

export function WidgetMapView({
  center,
  zoom = 13,
  compact = false,
  children,
  className,
  emptyMessage = 'No location data available',
  isEmpty = false,
}: WidgetMapViewProps) {
  if (isEmpty) {
    return <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={emptyMessage} className="py-4" />;
  }

  return (
    <div className={cn('h-full w-full rounded-lg overflow-hidden', className)}>
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom={!compact}
        zoomControl={!compact}
        dragging={!compact}
        className="h-full w-full"
        style={{ background: '#1a1a2e' }}
      >
        <MapTileLayer style="dark" />
        {children}
      </MapContainer>
    </div>
  );
}
