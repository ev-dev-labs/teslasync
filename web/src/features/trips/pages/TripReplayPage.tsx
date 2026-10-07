import { useMemo, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Gauge, Battery, Zap, Mountain, Thermometer,
  Navigation, MapPin, Clock, Route, TrendingUp,
  ArrowUpRight, ArrowDownRight, RefreshCw,
} from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Button, PanelTitle } from '@/components/ui';
import {
  PlaybackControls,
  type TimelineMarker,
  type TimelinePreviewPoint,
} from '@/components/data-display';
import { StatCard, MetricCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { Sparkline, ElevationProfile, type ElevationDataPoint } from '@/components/charts';
import { useDrive } from '@/api/hooks/useDriving';
import { useUnits } from '@/hooks/useUnits';
import type { DistanceUnitPref, SpeedUnitPref } from '@/lib/unitConversion';
import {
  convertDistanceFromSI,
  convertSpeedFromSI,
  convertTempFromSI,
} from '@/lib/unitConversion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTripReplay } from '@/hooks/useTripReplay';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { haversineDistance } from '@/lib/geo';
import { formatDate } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import {
  computeReplayMarkers,
  nearestMarker,
  type ReplayMarker,
} from '@/features/driving/lib/replayMarkers';
import type { DrivePosition } from '@/types/driving';
import { TripReplayMap } from '@/features/trips/components/TripReplayMap';
import {
  TripReplayCharts,
  type TripReplayChartPoint,
} from '@/features/trips/components/TripReplayCharts';

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

/** Format ms duration as "HH:MM:SS" or "MM:SS". Non-finite/negative input
 *  collapses to "00:00" so an upstream data bug surfaces as a sane
 *  placeholder instead of "NaN:NaN" leaking into the UI. */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Format drive duration in minutes as "Xh Ym". Rounds to whole minutes
 *  first so a fractional input (e.g. 59.6 from `durationS / 60`) rolls over
 *  correctly to "1h 0m" instead of rendering the impossible "60m". Non-finite
 *  or non-positive input collapses to "0m" so a bad `durationS` can't leak a
 *  "NaNm" placeholder into the summary band. */
export function fmtDriveTime(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return '0m';
  const totalMin = Math.round(min);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ================================================================== */
/*  Page Component                                                     */
/* ================================================================== */

/**
 * TripReplayPage with bidirectional map ↔ chart
 * cursor sync.
 * The page owns three rendered surfaces (map, scrubber, speed+power
 * chart) and threads a single source of truth — `replay.currentIndex`
 * from {@link useTripReplay} — through all of them via the shared
 * `handleSeekToIndex` callback.
 * Sync wiring:
 *   - Replay tick           → useTripReplay advances currentIndex →
 *                             TripReplayMap re-renders its marker AND
 *                             TripReplayCharts re-renders its ReferenceLine
 *   - Scrubber drag         → controls.seekToProgress → currentIndex
 *   - Map polyline click    → TripReplayMap onSeekToIndex → seekTo(idx)
 *   - Chart click / hover   → TripReplayCharts → ChartTimeRangeProvider →
 *                             ChartCursorBridge → onSeekToIndex → seekTo(idx)
 * `prefers-reduced-motion: reduce` swaps the AnimatedMarker for a snap
 * CircleMarker and disables the underlying Leaflet pan/zoom animations.
 * SI display contract:
 *   Position-derived fields (speed, outsideTemp, ratedRange, cumulative
 *   distance from haversine) are SI canonical. They go through
 *   `convertXFromSI` from `@/lib/unitConversion` via `useUnits`.
 *   Drive summary values are adapted at the API boundary; this page keeps
 *   replay-specific display formatting at render time.
 */
export default function TripReplayPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  usePageTitle(t('replay.title', 'Trip Replay'));

  const driveQuery = useDrive(id ?? '');
  const { data: drive, isLoading, error } = driveQuery;
  const { reduce } = useMotionPreference();

  // Display preferences for position-derived SI fields.
  const { unitPrefs } = useUnits();


  const distanceUnit = unitPrefs.distance;

  const speedUnit = unitPrefs.speed;

  /* ---- Normalize positions ---- */
  // The /drives/{id} positions array carries only lat/lon/heading/speed
  // (see internal/api/drive_handler_detail.go drivePositionFieldMappings).
  // Power, battery, elevation, range, temperature etc. live on the parallel
  // telemetry array. Build a sorted index of telemetry by timestamp so we
  // can join each position to its nearest-by-ts telemetry row in O(log n).
  // Without this merge, the "Current Position Stats" panel renders 0% / —
  // for every metric except speed.
  const telemetryByTs = useMemo(() => {
    if (!drive) return [] as Array<{ ts: number; row: Record<string, unknown> }>;
    const tel = (drive as unknown as { telemetry?: Array<Record<string, unknown>> }).telemetry ?? [];
    return tel
      .map((row) => {
        const tsStr = (row.created_at as string) ?? (row.createdAt as string) ?? (row.timestamp as string) ?? '';
        const ts = tsStr ? new Date(tsStr).getTime() : NaN;
        return { ts, row };
      })
      .filter((x) => Number.isFinite(x.ts))
      .sort((a, b) => a.ts - b.ts);
  }, [drive]);

  const nearestTelemetry = useCallback(
    (positionTs: number): Record<string, unknown> | null => {
      if (telemetryByTs.length === 0 || !Number.isFinite(positionTs)) return null;
      let lo = 0;
      let hi = telemetryByTs.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (telemetryByTs[mid].ts < positionTs) lo = mid + 1;
        else hi = mid;
      }
      // lo is now the first index with ts >= positionTs; check predecessor too.
      if (lo > 0 && Math.abs(telemetryByTs[lo - 1].ts - positionTs) < Math.abs(telemetryByTs[lo].ts - positionTs)) {
        return telemetryByTs[lo - 1].row;
      }
      return telemetryByTs[lo].row;
    },
    [telemetryByTs],
  );

  const positions: DrivePosition[] = useMemo(() => {
    if (!drive) return [];
    const pos = drive.positions ?? [];
    return pos
      .map((raw: unknown) => {
        const p = raw as Record<string, unknown>;
        const tsStr = (p.timestamp as string) ?? (p.created_at as string) ?? (p.createdAt as string) ?? '';
        const positionTs = tsStr ? new Date(tsStr).getTime() : NaN;
        // Merge nearest telemetry row to fill power/battery/elevation/etc.
        const t = nearestTelemetry(positionTs) ?? {};
        const pick = <V,>(k: string, snake?: string): V | null => {
          const fromPos = (p[k] as V | null | undefined) ?? (snake ? (p[snake] as V | null | undefined) : undefined);
          if (fromPos !== undefined && fromPos !== null) return fromPos as V;
          const fromTel = (t[k] as V | null | undefined) ?? (snake ? (t[snake] as V | null | undefined) : undefined);
          return (fromTel ?? null) as V | null;
        };
        return {
          latitude: (p.latitude as number) ?? 0,
          longitude: (p.longitude as number) ?? 0,
          speed: (p.speed as number | null) ?? (t.speed as number | null) ?? null,
          power: pick<number>('power'),
          batteryLevel: pick<number>('batteryLevel', 'battery_level') ?? 0,
          timestamp: tsStr,
          elevation: pick<number>('elevation'),
          insideTemp: pick<number>('insideTemp', 'inside_temp'),
          outsideTemp: pick<number>('outsideTemp', 'outside_temp'),
          idealRange: pick<number>('idealRange', 'ideal_range'),
          ratedRange: pick<number>('ratedRange', 'rated_range'),
          odometer: pick<number>('odometer'),
          fanStatus: pick<number>('fanStatus', 'fan_status'),
          isClimateOn: (p.isClimateOn ?? p.is_climate_on ?? t.isClimateOn ?? t.is_climate_on) as DrivePosition['isClimateOn'],
        } as DrivePosition;
      })
      .filter((p) => p.latitude !== 0 || p.longitude !== 0);
  }, [drive, nearestTelemetry]);

  /* ---- Replay hook ---- */
  const [replay, controls] = useTripReplay(positions);

  /* ---- Single source of truth for "where on the trip are we?" ---- */
  const handleSeekToIndex = useCallback(
    (idx: number) => {
      controls.seekTo(idx);
    },
    [controls],
  );

  /* ---- Timeline markers ---- */
  const replayMarkers: ReplayMarker[] = useMemo(
    () => computeReplayMarkers(positions),
    [positions],
  );
  const scrubberMarkers: TimelineMarker[] = useMemo(
    () => replayMarkers.map((m) => ({
      at: m.at,
      kind: m.kind,
      label: m.label,
      count: m.count,
    })),
    [replayMarkers],
  );

  /* ---- URL deep-linking: ?at=0.42&play=1 (debounced 300ms) ---- */
  const [searchParams, setSearchParams] = useSearchParams();
  const restoredRef = useRef(false);
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore once positions are loaded.
  useEffect(() => {
    if (restoredRef.current) return;
    if (positions.length === 0) return;
    restoredRef.current = true;
    const atParam = searchParams.get('at');
    const playParam = searchParams.get('play');
    if (atParam != null) {
      const at = Number(atParam);
      if (Number.isFinite(at) && at >= 0 && at <= 1) {
        controls.seekToProgress(at);
      }
    }
    if (playParam === '1') {
      controls.play();
    }
  }, [positions.length]);

  // Persist (debounced) — write `at` and `play` to the URL.
  useEffect(() => {
    if (!restoredRef.current) return;
    if (positions.length === 0) return;
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    const snapshotProgress = replay.progress;
    const snapshotPlaying = replay.isPlaying;
    writeTimerRef.current = setTimeout(() => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (snapshotProgress > 0 && snapshotProgress < 1) {
            next.set('at', snapshotProgress.toFixed(3));
          } else {
            next.delete('at');
          }
          if (snapshotPlaying) next.set('play', '1');
          else next.delete('play');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => {
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    };
  }, [replay.progress, replay.isPlaying, positions.length, setSearchParams]);

  /* ---- Elevation profile data ---- */
  // PRE-EXISTING BUG fix: cumDist is meters from haversineDistance, but the
  // legacy code did `toDistanceDisplay(cumDist / 1000)` which fed kilometres
  // into a miles-based helper — this would reintroduce the same unit bug in
  // useDriveDetailData. Now we use convertDistanceFromSI on raw meters.
  const elevationData: ElevationDataPoint[] = useMemo(() => {
    let cumDistMeters = 0;
    return positions.map((p, i) => {
      if (i > 0) {
        cumDistMeters += haversineDistance(
          positions[i - 1].latitude, positions[i - 1].longitude,
          p.latitude, p.longitude,
        );
      }
      return {
        index: i,
        distance: Number(
          convertDistanceFromSI(cumDistMeters, unitPrefs.distance).toFixed(2),
        ),
        elevation: p.elevation ?? 0,
        speed: p.speed != null ? convertSpeedFromSI(p.speed, unitPrefs.speed) : 0,
      };
    });
  }, [positions, unitPrefs.distance, unitPrefs.speed]);

  /* ---- Speed + Power timeline data (shared with TripReplayCharts) ---- */
  const timelineData: TripReplayChartPoint[] = useMemo(() => {
    if (positions.length === 0) return [];
    const t0 = positions
      .map((p) => new Date(p.timestamp).getTime())
      .find((ts) => Number.isFinite(ts)) ?? 0;
    return positions.map((p, i) => {
      const ts = new Date(p.timestamp).getTime();
      const elapsedMin = Number.isFinite(ts) ? (ts - t0) / 60_000 : 0;
      return {
        index: i,
        time: Number(elapsedMin.toFixed(3)),
        speed: p.speed != null ? convertSpeedFromSI(p.speed, unitPrefs.speed) : 0,
        power: p.power ?? 0,
      };
    });
  }, [positions, unitPrefs.speed]);

  /* ---- Hover preview sampler for the scrubber ---- */
  const getPreviewAt = useCallback(
    (normalized: number): TimelinePreviewPoint | null => {
      if (positions.length === 0 || replay.totalTime <= 0) return null;
      const t0 = new Date(positions[0].timestamp).getTime();
      const targetMs = Math.max(0, Math.min(1, normalized)) * replay.totalTime;
      // Binary search for closest position.
      let lo = 0;
      let hi = positions.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const t = new Date(positions[mid].timestamp).getTime() - t0;
        if (t < targetMs) lo = mid + 1;
        else hi = mid;
      }
      const p = positions[lo];
      if (!p) return null;
      return {
        at: normalized,
        speed: p.speed != null
          ? `${fmtNumber(convertSpeedFromSI(p.speed, unitPrefs.speed))} ${unitPrefs.speed}`
          : undefined,
        power: p.power != null ? `${fmtNumber(p.power, 1)} kW` : undefined,
        soc: `${fmtInt(p.batteryLevel)}%`,
        elevation: p.elevation != null ? `${fmtInt(p.elevation)} m` : undefined,
      };
    },
    [positions, replay.totalTime, unitPrefs.speed],
  );

  /* ---- Speed sparkline behind the scrubber ---- */
  const speedSparkData = useMemo(() => {
    if (positions.length === 0) return [] as number[];
    // Downsample to ~80 points so the sparkline isn't a noisy mess.
    const target = 80;
    if (positions.length <= target) {
      return positions.map((p) => p.speed ?? 0);
    }
    const stride = positions.length / target;
    const out: number[] = [];
    for (let i = 0; i < target; i++) {
      const idx = Math.min(positions.length - 1, Math.floor(i * stride));
      out.push(positions[idx].speed ?? 0);
    }
    return out;
  }, [positions]);

  /* ---- Stat-card highlight: which marker is the playhead "on"? ---- */
  const activeMarker = useMemo(
    () => nearestMarker(replayMarkers, replay.progress, 0.02),
    [replayMarkers, replay.progress],
  );

  const cardHighlight = useCallback(
    (kinds: ReplayMarker['kind'][]): string | undefined => {
      if (!activeMarker) return undefined;
      return kinds.includes(activeMarker.kind)
        ? 'ring-2 ring-cyan-400/60 ring-offset-1 ring-offset-black/30'
        : undefined;
    },
    [activeMarker],
  );

  /* ---- Current stat values ---- */
  const cp = replay.currentPosition;

  /* ---- Drive summary stats ---- */
  // drive.distanceM is meters, drive.durationS is seconds.
  // Use convertDistanceFromSI/convertSpeedFromSI for SI-aware conversion.
  const distanceM = drive?.distanceM ?? 0;
  const durationS = drive?.durationS ?? 0;
  const distanceUserUnit = convertDistanceFromSI(distanceM, distanceUnit as DistanceUnitPref);
  const efficiency = distanceM > 0 && drive?.startBatteryPct != null && drive?.endBatteryPct != null
    ? ((drive.startBatteryPct - drive.endBatteryPct) / distanceUserUnit) * 1000
    : null;

  /* ---- Elevation gain / loss for the summary band ---- */
  // Elevation is SI metres on every position; sum positive/negative deltas so
  // the summary shows real climb/descent instead of the legacy '—' placeholder.
  const elevStats = useMemo(() => {
    let gain = 0;
    let loss = 0;
    let has = false;
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1].elevation;
      const curr = positions[i].elevation;
      if (prev == null || curr == null) continue;
      has = true;
      const diff = curr - prev;
      if (diff > 0) gain += diff;
      else loss += Math.abs(diff);
    }
    return { gain: Math.round(gain), loss: Math.round(loss), has };
  }, [positions]);

  return (
    <PageContainer
      title={t('replay.title', 'Trip Replay')}
      subtitle={drive
        ? `${t('replay.drive', 'Drive')} #${drive.id} — ${formatDate(drive.startTs)}${drive.startAddress && drive.endAddress ? ` · ${drive.startAddress} → ${drive.endAddress}` : ''}`
        : undefined}
      loading={isLoading}
      error={error instanceof Error ? error : error ? new Error(String(error)) : null}
      query={driveQuery}
      breadcrumbLabels={{
        '/drives/:id': drive
          ? `${drive.startAddress ?? t('replay.drive', 'Drive')} → ${drive.endAddress ?? ''}`
          : `${t('replay.drive', 'Drive')} #${id}`,
      }}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2" data-tour="drive-replay-share">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => driveQuery.refetch()}
            aria-label={t('replay.refresh', 'Refresh replay data')}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Link to={`/drives/${id}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
              {t('replay.backToDrive', 'Back to Drive')}
            </Button>
          </Link>
        </div>
      }
    >
      {/* ================================================================ */}
      {/*  Section 1 — Drive Summary KPI band (full-width metric grid)      */}
      {/*  Summary fields come from the drive record, not the GPS trail, so */}
      {/*  they render even when a drive has no position coordinates.        */}
      {/* ================================================================ */}
      <FadeIn>
        <section aria-label={t('replay.summary.title', 'Drive Summary')}>
          <StaggerContainer className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 lg:grid-cols-4 3xl:grid-cols-8">
            <StaggerItem>
              <StatCard
                label={t('replay.summary.distance', 'Distance')}
                value={fmtNumber(distanceUserUnit)}
                unit={distanceUnit}
                icon={<Route className="h-4 w-4" aria-hidden="true" />}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('replay.summary.duration', 'Duration')}
                value={fmtDriveTime(durationS / 60)}
                icon={<Clock className="h-4 w-4" aria-hidden="true" />}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('replay.summary.avgSpeed', 'Avg Speed')}
                value={drive?.avgSpeedMps != null ? fmtNumber(convertSpeedFromSI(drive.avgSpeedMps, speedUnit as SpeedUnitPref)) : '—'}
                unit={drive?.avgSpeedMps != null ? speedUnit : undefined}
                icon={<Gauge className="h-4 w-4" aria-hidden="true" />}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('replay.summary.maxSpeed', 'Max Speed')}
                value={drive?.maxSpeedMps != null ? fmtNumber(convertSpeedFromSI(drive.maxSpeedMps, speedUnit as SpeedUnitPref)) : '—'}
                unit={drive?.maxSpeedMps != null ? speedUnit : undefined}
                icon={<Gauge className="h-4 w-4" aria-hidden="true" />}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('replay.summary.efficiency', 'Efficiency')}
                value={efficiency != null ? fmtNumber(efficiency) : '—'}
                unit={efficiency != null ? (distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km') : undefined}
                icon={<TrendingUp className="h-4 w-4" aria-hidden="true" />}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('replay.summary.battery', 'Battery')}
                value={drive?.startBatteryPct != null && drive?.endBatteryPct != null
                  ? `${fmtInt(drive.startBatteryPct)}% → ${fmtInt(drive.endBatteryPct)}%`
                  : '—'}
                icon={<Battery className="h-4 w-4" aria-hidden="true" />}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('replay.summary.elevGain', 'Elevation Gain')}
                value={elevStats.has ? fmtInt(elevStats.gain) : '—'}
                unit={elevStats.has ? 'm' : undefined}
                icon={<ArrowUpRight className="h-4 w-4" aria-hidden="true" />}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('replay.summary.elevLoss', 'Elevation Loss')}
                value={elevStats.has ? fmtInt(elevStats.loss) : '—'}
                unit={elevStats.has ? 'm' : undefined}
                icon={<ArrowDownRight className="h-4 w-4" aria-hidden="true" />}
              />
            </StaggerItem>
          </StaggerContainer>
        </section>
      </FadeIn>

      {positions.length === 0 ? (
        /* No GPS trail — keep the section as a visible panel (never hide it).
           The KPI band above still shows the drive's summary stats. */
        <FadeIn delay={0.05}>
          <GlassPanel className="p-6 sm:p-8">
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<MapPin className="h-10 w-10" />}
              message={t('replay.noGps', 'No GPS data available for this drive. Trip replay requires valid position coordinates from Fleet Telemetry.')}
            />
          </GlassPanel>
        </FadeIn>
      ) : (
        <>
          {/* ============================================================ */}
          {/*  Section 2 — Replay hero: route map + live position stats     */}
          {/*  Map is the hero (spans 2 cols on xl+); the live-stats rail    */}
          {/*  sits beside it so values update as the playhead scrubs.       */}
          {/* ============================================================ */}
          <FadeIn delay={0.05}>
            <section
              aria-label={t('replay.map.section', 'Route map and live position')}
              className="grid grid-cols-1 gap-4 xl:gap-5 xl:grid-cols-3"
            >
              <div className="xl:col-span-2">
                <TripReplayMap
                  positions={positions}
                  currentIndex={replay.currentIndex}
                  onSeekToIndex={handleSeekToIndex}
                  reduceMotion={reduce}
                  height={440}
                />
              </div>
              <GlassPanel className="p-4 sm:p-5">
                <PanelTitle className="mb-3">
                  {t('replay.currentStats', 'Current Position Stats')}
                </PanelTitle>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  <MetricCard
                    label={t('replay.stat.speed', 'Speed')}
                    value={cp?.speed != null
                      ? `${fmtNumber(convertSpeedFromSI(cp.speed, unitPrefs.speed))} ${unitPrefs.speed}`
                      : '—'}
                    icon={<Gauge className="h-4 w-4" />}
                    color="cyan"
                    className={cn(cardHighlight(['fast-segment']))}
                  />
                  <MetricCard
                    label={t('replay.stat.power', 'Power')}
                    value={cp?.power != null ? `${fmtNumber(cp.power, 1)} kW` : '—'}
                    icon={<Zap className="h-4 w-4" />}
                    color="cyan"
                    className={cn(cardHighlight(['regen-peak', 'charge-start', 'charge-stop']))}
                    help={{
                      i18nKey: 'help.replay.power',
                      defaultValue:
                        'Instantaneous battery power at this point on the trip. Negative values indicate regenerative braking (energy flowing back into the pack); positive values indicate motor draw.',
                    }}
                  />
                  <MetricCard
                    label={t('replay.stat.battery', 'Battery')}
                    value={cp ? `${fmtInt(cp.batteryLevel)}%` : '—'}
                    icon={<Battery className="h-4 w-4" />}
                    color="cyan"
                    className={cn(cardHighlight(['low-soc', 'charge-start', 'charge-stop']))}
                    help={{
                      i18nKey: 'help.replay.battery',
                      defaultValue:
                        "State-of-charge percentage at this point. Drops indicate energy use; rises indicate regen or DC-fast-charging during a drive.",
                    }}
                  />
                  <MetricCard
                    label={t('replay.stat.elevation', 'Elevation')}
                    value={cp?.elevation != null ? `${fmtInt(cp.elevation)} m` : '—'}
                    icon={<Mountain className="h-4 w-4" />}
                    color="cyan"
                  />
                  <MetricCard
                    label={t('replay.stat.range', 'Range')}
                    value={cp?.ratedRange != null
                      ? `${fmtNumber(convertDistanceFromSI(cp.ratedRange, unitPrefs.distance))} ${unitPrefs.distance}`
                      : '—'}
                    icon={<Navigation className="h-4 w-4" />}
                    color="cyan"
                    help={{
                      i18nKey: 'help.replay.range',
                      defaultValue:
                        'Estimated rated range remaining at this position based on EPA rated efficiency. Differs from real-world range, which depends on speed, terrain, climate, and load.',
                    }}
                  />
                  <MetricCard
                    label={t('replay.stat.temp', 'Temperature')}
                    value={cp?.outsideTemp != null
                      ? `${fmtNumber(convertTempFromSI(cp.outsideTemp, unitPrefs.temperature))} ${unitPrefs.temperature}`
                      : '—'}
                    icon={<Thermometer className="h-4 w-4" />}
                    color="cyan"
                  />
                </div>
              </GlassPanel>
            </section>
          </FadeIn>

          {/* ============================================================ */}
          {/*  Section 3 — Playback scrubber (full-width transport bar)      */}
          {/* ============================================================ */}
          <FadeIn delay={0.1}>
            <div data-tour="drive-replay-scrubber">
              <PlaybackControls
                isPlaying={replay.isPlaying}
                speed={replay.speed}
                progress={replay.progress}
                elapsed={fmtDuration(replay.elapsedTime)}
                total={fmtDuration(replay.totalTime)}
                onPlay={controls.play}
                onPause={controls.pause}
                onStop={controls.stop}
                onSpeedChange={controls.setSpeed}
                onSeek={controls.seekToProgress}
                markers={scrubberMarkers}
                getPreviewAt={getPreviewAt}
                durationMs={replay.totalTime}
                enableKeyboardShortcuts
                onSeekBy={controls.seekBy}
                onSpeedRelative={controls.setSpeedRelative}
                onStepFrame={controls.stepFrame}
                scrubberBackground={
                  speedSparkData.length > 1 ? (
                    <Sparkline data={speedSparkData} color="#22d3ee" height={24} width={400} />
                  ) : undefined
                }
              />
            </div>
          </FadeIn>

          {/* ============================================================ */}
          {/*  Section 4 — Timeline charts bento (elevation + speed/power)   */}
          {/*  Side-by-side on 2xl to use horizontal space; both share the   */}
          {/*  playhead cursor via replay.currentIndex.                      */}
          {/* ============================================================ */}
          <FadeIn delay={0.15}>
            <section
              aria-label={t('replay.timeline.section', 'Trip elevation and speed timelines')}
              className="grid grid-cols-1 gap-4 xl:gap-5 2xl:grid-cols-2"
            >
              <ElevationProfile
                data={elevationData}
                currentIndex={replay.currentIndex}
                onClickIndex={handleSeekToIndex}
                height={220}
                distanceUnit={unitPrefs.distance}
              />
              <TripReplayCharts
                data={timelineData}
                currentIndex={replay.currentIndex}
                speedUnit={unitPrefs.speed}
                onSeekToIndex={handleSeekToIndex}
                height={220}
              />
            </section>
          </FadeIn>
        </>
      )}
    </PageContainer>
  );
}
