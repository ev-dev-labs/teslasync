import { useMemo, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Gauge, Battery, Zap, Mountain, Thermometer,
  Navigation, MapPin, Clock, Route, TrendingUp,
  ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Button } from '@/components/ui';
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
import { useSettings } from '@/hooks/useSettings';
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
function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Format drive duration in minutes as "Xh Ym" */
function fmtDriveTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ================================================================== */
/*  Page Component                                                     */
/* ================================================================== */

/**
 * Phase-45 / Prompt 26 — TripReplayPage with bidirectional map ↔ chart
 * cursor sync.
 *
 * The page owns three rendered surfaces (map, scrubber, speed+power
 * chart) and threads a single source of truth — `replay.currentIndex`
 * from {@link useTripReplay} — through all of them via the shared
 * `handleSeekToIndex` callback.
 *
 * Sync wiring:
 *   - Replay tick           → useTripReplay advances currentIndex →
 *                             TripReplayMap re-renders its marker AND
 *                             TripReplayCharts re-renders its ReferenceLine
 *   - Scrubber drag         → controls.seekToProgress → currentIndex
 *   - Map polyline click    → TripReplayMap onSeekToIndex → seekTo(idx)
 *   - Chart click / hover   → TripReplayCharts → ChartTimeRangeProvider →
 *                             ChartCursorBridge → onSeekToIndex → seekTo(idx)
 *
 * `prefers-reduced-motion: reduce` swaps the AnimatedMarker for a snap
 * CircleMarker and disables the underlying Leaflet pan/zoom animations.
 *
 * Phase-43 / Prompt 0026 — SI cutover:
 *   Position-derived fields (speed, outsideTemp, ratedRange, cumulative
 *   distance from haversine) are SI canonical. They go through
 *   `convertXFromSI` from `@/lib/unitConversion` via `useUnits`.
 *   Drive-level summary fields (`drive.distanceMi`, `maxSpeedMph`,
 *   `avgSpeedMph`) are genuine miles/mph after the SQL adapter boundary
 *   in `internal/database/drive_repo.go`, so they remain on the legacy
 *   `useSettings` helpers (locked-policy continuation from Phase-43/0022
 *   `useDriveDetailData`).
 */
export default function TripReplayPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  usePageTitle(t('replay.title', 'Trip Replay'));

  const { data: drive, isLoading, error } = useDrive(id ?? '');
  const { reduce } = useMotionPreference();

  // SI helpers + display preferences for position-derived fields.
  const { unitPrefs } = useUnits();
  // Legacy helpers retained for drive-level summary fields that are
  // genuine miles / mph after the SQL adapter boundary
  // (locked-policy continuation from Phase-43/0022).
  const { convertDistance, convertSpeed, distanceUnit, speedUnit } = useSettings();

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

  /* ---- Timeline markers (Phase-40 / Prompt 57) ---- */
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
  // legacy code did `convertDistance(cumDist / 1000)` which fed kilometres
  // into a miles-based helper — same bug pattern Phase-43/0022 fixed in
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
    const t0 = new Date(positions[0].timestamp).getTime();
    return positions.map((p, i) => {
      const elapsedMin = (new Date(p.timestamp).getTime() - t0) / 60_000;
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
  // Locked-policy: drive.distanceMi is genuine miles after the SQL adapter
  // boundary; legacy convertDistance is correct for it. Same for speed.
  const distanceMi = drive?.distanceMi ?? 0;
  const durationMin = drive?.durationMin ?? 0;
  const efficiency = distanceMi > 0 && drive?.startBatteryPct != null && drive?.endBatteryPct != null
    ? ((drive.startBatteryPct - drive.endBatteryPct) / convertDistance(distanceMi)) * 1000
    : null;

  return (
    <PageContainer
      title={t('replay.title', 'Trip Replay')}
      subtitle={drive
        ? `${t('replay.drive', 'Drive')} #${drive.id} — ${formatDate(drive.startTs)}${drive.startAddress && drive.endAddress ? ` · ${drive.startAddress} → ${drive.endAddress}` : ''}`
        : undefined}
      loading={isLoading}
      error={error instanceof Error ? error : error ? new Error(String(error)) : null}
      breadcrumbLabels={{
        '/drives/:id': drive
          ? `${drive.startAddress ?? t('replay.drive', 'Drive')} → ${drive.endAddress ?? ''}`
          : `Drive #${id}`,
      }}
      actions={
        <div className="flex items-center gap-2" data-tour="drive-replay-share">
          <Link to={`/drives/${id}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t('replay.backToDrive', 'Back to Drive')}
            </Button>
          </Link>
        </div>
      }
    >
      {positions.length === 0 && !isLoading ? (
        <FadeIn>
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<MapPin className="h-10 w-10" />}
            message={t('replay.noGps', 'No GPS data available for this drive. Trip replay requires valid position coordinates from Fleet Telemetry.')}
          />
        </FadeIn>
      ) : (
        <>
          {/* ================================================================ */}
          {/*  Section 1 — Map (Phase-45/26: factored sub-component)            */}
          {/* ================================================================ */}
          <FadeIn>
            <TripReplayMap
              positions={positions}
              currentIndex={replay.currentIndex}
              onSeekToIndex={handleSeekToIndex}
              reduceMotion={reduce}
            />
          </FadeIn>

          {/* ================================================================ */}
          {/*  Section 2 — Playback Controls                                   */}
          {/* ================================================================ */}
          <FadeIn delay={0.05}>
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

          {/* ================================================================ */}
          {/*  Section 3 — Current Stats Bar                                   */}
          {/* ================================================================ */}
          <FadeIn delay={0.1}>
            <GlassPanel className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-[var(--text-secondary)]">
                {t('replay.currentStats', 'Current Position Stats')}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
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
          </FadeIn>

          {/* ================================================================ */}
          {/*  Section 4 — Elevation Profile                                   */}
          {/* ================================================================ */}
          <FadeIn delay={0.15}>
            <ElevationProfile
              data={elevationData}
              currentIndex={replay.currentIndex}
              onClickIndex={handleSeekToIndex}
              height={200}
              distanceUnit={unitPrefs.distance}
            />
          </FadeIn>

          {/* ================================================================ */}
          {/*  Section 5 — Speed + Power Timeline (Phase-45/26: cursor-synced) */}
          {/* ================================================================ */}
          <FadeIn delay={0.2}>
            <TripReplayCharts
              data={timelineData}
              currentIndex={replay.currentIndex}
              speedUnit={unitPrefs.speed}
              onSeekToIndex={handleSeekToIndex}
            />
          </FadeIn>

          {/* ================================================================ */}
          {/*  Section 6 — Drive Summary                                       */}
          {/* ================================================================ */}
          <FadeIn delay={0.25}>
            <GlassPanel className="p-6">
              <h3 className="mb-4 text-sm font-semibold text-[var(--text-secondary)]">
                {t('replay.summary.title', 'Drive Summary')}
              </h3>
              <StaggerContainer className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StaggerItem>
                  <StatCard
                    label={t('replay.summary.distance', 'Distance')}
                    value={fmtNumber(convertDistance(distanceMi))}
                    unit={distanceUnit}
                    icon={<Route className="h-4 w-4" />}
                  />
                </StaggerItem>
                <StaggerItem>
                  <StatCard
                    label={t('replay.summary.duration', 'Duration')}
                    value={fmtDriveTime(durationMin)}
                    icon={<Clock className="h-4 w-4" />}
                  />
                </StaggerItem>
                <StaggerItem>
                  <StatCard
                    label={t('replay.summary.efficiency', 'Efficiency')}
                    value={efficiency != null ? fmtNumber(efficiency) : '—'}
                    unit={efficiency != null ? 'Wh/km' : undefined}
                    icon={<TrendingUp className="h-4 w-4" />}
                  />
                </StaggerItem>
                <StaggerItem>
                  <StatCard
                    label={t('replay.summary.elevGain', 'Elevation Gain')}
                    value={'—'}
                    icon={<ArrowUpRight className="h-4 w-4" />}
                  />
                </StaggerItem>
                <StaggerItem>
                  <StatCard
                    label={t('replay.summary.elevLoss', 'Elevation Loss')}
                    value={'—'}
                    icon={<ArrowDownRight className="h-4 w-4" />}
                  />
                </StaggerItem>
                <StaggerItem>
                  <StatCard
                    label={t('replay.summary.maxSpeed', 'Max Speed')}
                    value={drive?.maxSpeedMph != null ? fmtNumber(convertSpeed(drive.maxSpeedMph)) : '—'}
                    unit={drive?.maxSpeedMph != null ? speedUnit : undefined}
                    icon={<Gauge className="h-4 w-4" />}
                  />
                </StaggerItem>
                <StaggerItem>
                  <StatCard
                    label={t('replay.summary.avgSpeed', 'Avg Speed')}
                    value={drive?.avgSpeedMph != null ? fmtNumber(convertSpeed(drive.avgSpeedMph)) : '—'}
                    unit={drive?.avgSpeedMph != null ? speedUnit : undefined}
                    icon={<Gauge className="h-4 w-4" />}
                  />
                </StaggerItem>
                <StaggerItem>
                  <StatCard
                    label={t('replay.summary.battery', 'Battery')}
                    value={drive?.startBatteryPct != null && drive?.endBatteryPct != null
                      ? `${fmtInt(drive.startBatteryPct)}% → ${fmtInt(drive.endBatteryPct)}%`
                      : '—'}
                    icon={<Battery className="h-4 w-4" />}
                  />
                </StaggerItem>
              </StaggerContainer>
            </GlassPanel>
          </FadeIn>
        </>
      )}
    </PageContainer>
  );
}
