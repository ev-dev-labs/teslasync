import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, MapPin } from 'lucide-react';
import { CircleMarker } from '@/components/maps';
import { Button, Caption, Icon, Text } from '@/components/ui';
import { useVehiclePositions, useVehicles } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetMapView } from './shared';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { usePackPresentation } from './designPacks/PackBoundary';
import type { WidgetProps } from './types';
import { useDataState } from '@/hooks/useDataState';
import { useRangeState } from '@/hooks/useRangeState';

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
    if (!p || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) ||
      Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180) continue;
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

export function centroid(points: ClusterPoint[]): [number, number] | null {
  if (points.length === 0) return null;
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
  const packId = usePackPresentation();
  const [locationsHidden, setLocationsHidden] = useState(false);
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const query = useVehiclePositions(id);
  const {
    data: positions,
    isLoading,
    isFetching,
    isStale,
    isError,
    error,
    dataUpdatedAt,
    refetch,
  } = query;
  const { startInstant, endInstantExclusive } = useRangeState({ defaultPresetId: '30d' });
  const safePositions = useMemo(() => {
    const items = Array.isArray(positions) ? positions : [];
    const startMs = Date.parse(startInstant);
    const endMs = Date.parse(endInstantExclusive);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return items;
    return items.filter((position) => {
      const timestamp = position?.ts;
      if (!timestamp) return true;
      const timestampMs = Date.parse(timestamp);
      return !Number.isFinite(timestampMs) || (timestampMs >= startMs && timestampMs < endMs);
    });
  }, [positions, startInstant, endInstantExclusive]);
  const dataState = useDataState({
    ...query,
    data: (error || isError) && safePositions.length === 0 ? undefined : !isLoading && !query.isPending ? query.data ?? null : query.data,
  }, { provenance: 'historical' });

  // Higher precision = finer grid; use coarser grid for compact
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;
  const precision = isCompact ? 200 : 500;

  const clusters = useMemo(
    () => clusterPositions(safePositions, precision),
    [safePositions, precision],
  );

  const center = useMemo<[number, number]>(() => centroid(clusters) ?? [0, 0], [clusters]);
  const isEmpty = clusters.length === 0;
  const hasUnknownTimestamps = safePositions.some(
    position => !position?.ts || !Number.isFinite(Date.parse(position.ts)),
  );

  const shellProps = {
    title: t('widget.positionHeatmap.title', 'Position heatmap'),
    loading: isLoading,
    dataState,
    // Forward the fetch error so a failure surfaces the shared QueryError
    // panel instead of masquerading as the "No position data" empty state.
    error: dataState.fatalError ? String(dataState.fatalError) : null,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
    // Keep an explicit privacy choice when recovering to Classic.
    actions: packId !== 'classic' || locationsHidden ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-11 w-11 p-0 md:h-9 md:w-9"
        aria-label={locationsHidden
          ? t('dashboardWidgets.maps.positionHeatmap.showLocations', 'Show locations')
          : t('dashboardWidgets.maps.positionHeatmap.hideLocations', 'Hide locations')}
        aria-pressed={locationsHidden}
        onClick={() => setLocationsHidden(hidden => !hidden)}
        icon={<Icon icon={locationsHidden ? Eye : EyeOff} size="md" />}
      />
    ) : undefined,
  };

  const presentMap = (map: ReactNode) => {
    const visibleMap = locationsHidden ? (
      <div
        role="region"
        aria-label={t('widget.positionHeatmap.title', 'Position heatmap')}
        className="flex min-h-40 items-center justify-center p-4"
      >
        <Caption>{t('dashboardWidgets.maps.positionHeatmap.locationsHidden', 'Locations hidden on this screen')}</Caption>
      </div>
    ) : map;

    return (
      <InstrumentPresentation
        family="map"
        compact={isCompact}
        icon={<Icon icon={MapPin} size="lg" />}
        headline={(
          <div className="min-w-0">
            <Text as="div" variant="subhead">{t('dashboardWidgets.maps.positionHeatmap.density', 'Position density')}</Text>
            <Caption>{t('dashboardWidgets.maps.positionHeatmap.visitedAreas', 'Visited areas')}</Caption>
          </div>
        )}
        context={<Caption>{t('dashboardWidgets.maps.positionHeatmap.history', 'Historical GPS samples')}</Caption>}
        instrument={visibleMap}
        details={(
          <div className="space-y-2">
            <div
              role="group"
              aria-label={t('dashboardWidgets.maps.positionHeatmap.densityScale', 'Relative sample density')}
              className="flex flex-wrap items-center gap-2"
            >
              <Caption>{t('dashboardWidgets.maps.positionHeatmap.lowDensity', 'Low density')}</Caption>
              <span aria-hidden="true" className="flex items-center gap-2">
                {[0, 0.5, 1].map(intensity => (
                  <span
                    key={intensity}
                    className="size-3 rounded-full"
                    style={{ backgroundColor: intensityColor(intensity) }}
                  />
                ))}
              </span>
              <Caption>{t('dashboardWidgets.maps.positionHeatmap.highDensity', 'High density')}</Caption>
            </div>
            <Caption as="p">
              {t('dashboardWidgets.maps.positionHeatmap.sampleScope', 'Density uses returned GPS samples, not visit counts. The selected range filters only those samples.')}
            </Caption>
            {hasUnknownTimestamps && (
              <Caption as="p">
                {t('dashboardWidgets.maps.positionHeatmap.unknownTimestamps', 'Samples without valid timestamps may fall outside the selected range.')}
              </Caption>
            )}
          </div>
        )}
      >
        {visibleMap}
      </InstrumentPresentation>
    );
  };

  // ─── Compact layout (1-col) ───
  if (isCompact) {
    return (
      <WidgetShell {...shellProps} noPadding>
        {presentMap(
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
          </WidgetMapView>,
        )}
      </WidgetShell>
    );
  }

  // ─── Standard / Wide layout ───
  return (
    <WidgetShell
      noPadding
      {...shellProps}
    >
      {presentMap(
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
        </WidgetMapView>,
      )}
    </WidgetShell>
  );
}
