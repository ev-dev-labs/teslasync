import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Map as MapIcon } from 'lucide-react';
import { CircleMarker } from '@/components/maps';
import { Badge } from '@/components/ui';
import { useVehiclePositions, useVehicles } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetMapView } from './shared';
import type { WidgetProps } from './types';

export interface ClusterPoint {
  lat: number;
  lon: number;
  count: number;
  /** Normalised density 0–1 */
  intensity: number;
}

/**
 * Grid-based density clustering: bucket positions by rounded lat/lon,
 * count visits per bucket, then normalise to 0–1 intensity.
 */
export function clusterPositions(
  positions: { latitude: number; longitude: number }[],
  precision: number,
): ClusterPoint[] {
  const buckets = new Map<string, { lat: number; lon: number; count: number }>();

  for (const p of positions) {
    if (p.latitude === 0 && p.longitude === 0) continue;
    const key = `${(p.latitude * precision | 0)}:${(p.longitude * precision | 0)}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.lat = (existing.lat * existing.count + p.latitude) / (existing.count + 1);
      existing.lon = (existing.lon * existing.count + p.longitude) / (existing.count + 1);
      existing.count += 1;
    } else {
      buckets.set(key, { lat: p.latitude, lon: p.longitude, count: 1 });
    }
  }

  let maxCount = 1;
  for (const b of buckets.values()) {
    if (b.count > maxCount) maxCount = b.count;
  }

  const result: ClusterPoint[] = [];
  for (const b of buckets.values()) {
    result.push({
      lat: b.lat,
      lon: b.lon,
      count: b.count,
      intensity: b.count / maxCount,
    });
  }
  return result;
}

export function centroid(points: ClusterPoint[]): [number, number] {
  if (points.length === 0) return [37.7749, -122.4194]; // fallback SF
  let latSum = 0;
  let lonSum = 0;
  for (const p of points) {
    latSum += p.lat;
    lonSum += p.lon;
  }
  return [latSum / points.length, lonSum / points.length];
}

/** Map intensity (0–1) to an RGBA colour string (cool cyan → hot magenta) */
export function intensityColor(intensity: number): string {
  // Clamp so malformed intensities can never emit out-of-gamut channels.
  const k = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;
  // Low: teal-500 → Mid: amber-500 → High: rose-500
  const r = Math.round(20 + k * 225);
  const g = Math.round(184 - k * 120);
  const b = Math.round(166 + k * 60);
  return `rgba(${r},${g},${b},${0.35 + k * 0.55})`;
}

export default function PositionHeatmapWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data: positions,
    isLoading,
    isFetching,
    isStale,
    isError,
    error,
    dataUpdatedAt,
    refetch,
  } = useVehiclePositions(id);

  const safePositions = positions ?? [];

  // Higher precision = finer grid; use coarser grid for compact
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;
  const precision = isCompact ? 200 : 500;

  const clusters = useMemo(
    () => clusterPositions(safePositions, precision),
    [safePositions, precision],
  );

  const center = useMemo(() => centroid(clusters), [clusters]);

  const totalPositions = safePositions.length;
  const isEmpty = clusters.length === 0;

  const shellProps = {
    loading: isLoading,
    // Forward the fetch error so a failure surfaces the shared QueryError
    // panel instead of masquerading as the "No position data" empty state.
    error: error ? String(error) : null,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  // ─── Compact layout (1-col) ───
  if (isCompact) {
    return (
      <WidgetShell {...shellProps} noPadding>
        <WidgetMapView
          center={center}
          zoom={11}
          compact
          isEmpty={isEmpty}
          emptyMessage={t('widget.positionHeatmap.noData', 'No position data')}
        >
          {/* marker-cluster:no heatmap — density visualization where intensity is encoded by circle radius and fill colour; clustering would collapse the spatial-density signal that is the entire purpose of this widget. */}
          {clusters.map((c, i) => (
            <CircleMarker
              key={i}
              center={[c.lat, c.lon]}
              radius={4 + c.intensity * 6}
              pathOptions={{
                color: 'transparent',
                fillColor: intensityColor(c.intensity),
                fillOpacity: 0.4 + c.intensity * 0.5,
              }}
            />
          ))}
        </WidgetMapView>
      </WidgetShell>
    );
  }

  // ─── Standard / Wide layout ───
  return (
    <WidgetShell
      title={t('widget.positionHeatmap.title', 'Position Heatmap')}
      icon={<MapIcon className="h-3.5 w-3.5 text-neon-cyan" />}
      noPadding
      actions={
        isWide && totalPositions > 0 ? (
          <Badge variant="neutral" size="sm">
            {t('widget.positionHeatmap.count', '{{count}} positions', {
              count: totalPositions,
            })}
          </Badge>
        ) : undefined
      }
      {...shellProps}
    >
      <WidgetMapView
        center={center}
        zoom={isWide ? 12 : 11}
        isEmpty={isEmpty}
        emptyMessage={t('widget.positionHeatmap.noData', 'No position data')}
      >
        {/* marker-cluster:no heatmap — density visualization where intensity is encoded by circle radius and fill colour; clustering would collapse the spatial-density signal that is the entire purpose of this widget. */}
        {clusters.map((c, i) => (
          <CircleMarker
            key={i}
            center={[c.lat, c.lon]}
            radius={6 + c.intensity * (isWide ? 14 : 10)}
            pathOptions={{
              color: 'transparent',
              fillColor: intensityColor(c.intensity),
              fillOpacity: 0.35 + c.intensity * 0.55,
            }}
          />
        ))}
      </WidgetMapView>
    </WidgetShell>
  );
}
