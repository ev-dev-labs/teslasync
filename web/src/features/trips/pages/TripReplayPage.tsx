import { useMemo, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Gauge, Battery, Zap, Mountain, Thermometer,
  Navigation, MapPin, RefreshCw,
} from 'lucide-react';
import { PageLayout } from '@/components/layout';
import { deriveDataState } from '@/api/dataState';
import { GlassPanel, Button, BUTTON_BASE, BUTTON_VARIANTS, PanelTitle, Text } from '@/components/ui';
import {
  PlaybackControls,
  type TimelineMarker,
  type TimelinePreviewPoint,
} from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { Sparkline } from '@/components/charts';
import { useDrive } from '@/api/hooks/useDriving';
import { useUnits } from '@/hooks/useUnits';
import {
  convertDistanceFromSI,
  convertSpeedFromSI,
  convertTempFromSI,
  convertPowerFromSI,
  formatPower,
} from '@/lib/unitConversion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTripReplay } from '@/hooks/useTripReplay';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { haversineDistance } from '@/lib/geo';
import { formatDate } from '@/lib/dateFormat';
import { fmtInt as formatInt } from '@/lib/numberFormat';
import { asFiniteNumber } from '@/lib/typeGuards';

import { cn } from '@/lib/cn';
import { chartTokens } from '@/lib/tokens';
import {
  computeReplayMarkers,
  nearestMarker,
  type ReplayMarker,
} from '@/features/driving/lib/replayMarkers';
import { replayMarkerLabel } from '@/features/driving/lib/replayMarkerLabel';
import type { DrivePosition } from '@/types/driving';
import { TripReplayMap } from '@/features/trips/components/TripReplayMap';
import { TripReplayReadout } from '@/features/trips/components/TripReplayReadout';
import { TripReplayElevation, type TripReplayElevationPoint } from '@/features/trips/components/TripReplayElevation';
import {
  TripReplayCharts,
  type TripReplayChartPoint,
} from '@/features/trips/components/TripReplayCharts';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { TripReplaySummaryBrief } from '../components/operationalbrief-all/TripReplaySummaryBrief';

type ReplayQuantity = 'speed' | 'power' | 'batteryLevel' | 'elevation' | 'ratedRange' | 'outsideTemp';
type ReplayPosition = DrivePosition & {
  sourceTimestamps: Record<ReplayQuantity, number | null>;
  sourceOrigins: Record<ReplayQuantity, 'position' | 'telemetry' | 'unknown'>;
};

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

/** Format ms duration as "H:MM:SS" or "MM:SS" with locale-aware digits. Non-finite/negative input
 *  collapses to "00:00" so an upstream data bug surfaces as a sane
 *  placeholder instead of "NaN:NaN" leaking into the UI. */
export function fmtDuration(ms: number, locale?: string): string {
  const totalSec = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const zero = formatInt(0, locale);
  const mm = formatInt(m, locale).padStart(2, zero);
  const ss = formatInt(s, locale).padStart(2, zero);
  return h > 0 ? `${formatInt(h, locale)}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Format drive duration in minutes as "Xh Ym" with locale-aware digits. Rounds to whole minutes
 *  first so a fractional input (e.g. 59.6 from `durationS / 60`) rolls over
 *  correctly to "1h 0m" instead of rendering the impossible "60m". Non-finite
 *  or non-positive input collapses to "0m" so a bad `durationS` can't leak a
 *  "NaNm" placeholder into the summary band. */
export function fmtDriveTime(min: number, locale?: string): string {
  const totalMin = Number.isFinite(min) && min > 0 ? Math.round(min) : 0;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${formatInt(h, locale)}h ${formatInt(m, locale)}m` : `${formatInt(m, locale)}m`;
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
  const { fmtNumber, fmtInt, locale } = useNumberFormatting();
  const formatDriveTime = useCallback((min: number) => fmtDriveTime(min, locale), [locale]);
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  usePageTitle(t('replay.title', 'Trip Replay'));

  const driveQuery = useDrive(id ?? '');
  const { data: drive } = driveQuery;
  // `live` describes summary enrichment, not the source of replay samples.
  const summaryProvenance = drive?.live === true
    ? 'live'
    : drive?.endTs != null || drive?.live === false ? 'historical' : 'unknown';
  const driveState = deriveDataState(driveQuery, { provenance: summaryProvenance });
  const { reduce } = useMotionPreference();

  // Display preferences for position-derived SI fields.
  const { unitPrefs } = useUnits();


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
    (positionTs: number): { ts: number; row: Record<string, unknown> } | null => {
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
        return telemetryByTs[lo - 1];
      }
      return telemetryByTs[lo];
    },
    [telemetryByTs],
  );

  const positions: ReplayPosition[] = useMemo(() => {
    if (!drive) return [];
    const pos = drive.positions ?? [];
    return pos
      .filter((raw: unknown) => {
        if (raw == null || typeof raw !== 'object') return false;
        const p = raw as Record<string, unknown>;
        return typeof p.latitude === 'number' && Number.isFinite(p.latitude)
          && Math.abs(p.latitude) <= 90
          && typeof p.longitude === 'number' && Number.isFinite(p.longitude)
          && Math.abs(p.longitude) <= 180;
      })
      .map((raw: unknown) => {
        const p = raw as Record<string, unknown>;
        const tsStr = (p.timestamp as string) ?? (p.created_at as string) ?? (p.createdAt as string) ?? '';
        const positionTs = tsStr ? new Date(tsStr).getTime() : NaN;
        // Merge nearest telemetry row to fill power/battery/elevation/etc.
        const telemetry = nearestTelemetry(positionTs);
        const t = telemetry?.row ?? {};
        const sourceOrigins: ReplayPosition['sourceOrigins'] = {
          speed: 'unknown', power: 'unknown', batteryLevel: 'unknown',
          elevation: 'unknown', ratedRange: 'unknown', outsideTemp: 'unknown',
        };
        const sourceTimestamp = (k: ReplayQuantity, snake?: string): number | null => {
          const fromPos = p[k] ?? (snake ? p[snake] : undefined);
          const value = fromPos ?? t[k] ?? (snake ? t[snake] : undefined);
          sourceOrigins[k] = typeof value === 'number' && Number.isFinite(value)
            ? fromPos != null ? 'position' : 'telemetry'
            : 'unknown';
          if (typeof value !== 'number' || !Number.isFinite(value)) return null;
          const ts = fromPos != null ? positionTs : telemetry?.ts;
          return ts != null && Number.isFinite(ts) ? ts : null;
        };
        const pick = <V,>(k: string, snake?: string): V | null => {
          const fromPos = (p[k] as V | null | undefined) ?? (snake ? (p[snake] as V | null | undefined) : undefined);
          if (fromPos !== undefined && fromPos !== null) return fromPos as V;
          const fromTel = (t[k] as V | null | undefined) ?? (snake ? (t[snake] as V | null | undefined) : undefined);
          return (fromTel ?? null) as V | null;
        };
        return {
          latitude: p.latitude as number,
          longitude: p.longitude as number,
          speed: asFiniteNumber(pick<number>('speed')),
          power: asFiniteNumber(pick<number>('power')),
          // DrivePosition requires a number; NaN keeps an unobserved SOC
          // distinct from a measured 0 without changing the wire contract.
          batteryLevel: asFiniteNumber(pick<number>('batteryLevel', 'battery_level')) ?? Number.NaN,
          timestamp: tsStr,
          sourceTimestamps: {
            speed: sourceTimestamp('speed'),
            power: sourceTimestamp('power'),
            batteryLevel: sourceTimestamp('batteryLevel', 'battery_level'),
            elevation: sourceTimestamp('elevation'),
            ratedRange: sourceTimestamp('ratedRange', 'rated_range'),
            outsideTemp: sourceTimestamp('outsideTemp', 'outside_temp'),
          },
          sourceOrigins,
          elevation: asFiniteNumber(pick<number>('elevation')),
          insideTemp: asFiniteNumber(pick<number>('insideTemp', 'inside_temp')),
          outsideTemp: asFiniteNumber(pick<number>('outsideTemp', 'outside_temp')),
          idealRange: asFiniteNumber(pick<number>('idealRange', 'ideal_range')),
          ratedRange: asFiniteNumber(pick<number>('ratedRange', 'rated_range')),
          odometer: pick<number>('odometer'),
          fanStatus: pick<number>('fanStatus', 'fan_status'),
          isClimateOn: (p.isClimateOn ?? p.is_climate_on ?? t.isClimateOn ?? t.is_climate_on) as DrivePosition['isClimateOn'],
        } as ReplayPosition;
      });
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
      label: replayMarkerLabel(t, fmtInt, m.kind, m.count),
      count: m.count,
    })),
    [replayMarkers, t, fmtInt],
  );

  /* ---- URL deep-linking: ?at=0.42&play=1 (debounced 300ms) ---- */
  const [searchParams, setSearchParams] = useSearchParams();
  const restoredDriveRef = useRef<string | null>(null);
  const writeDriveRef = useRef<string | null>(null);
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore each record, even when the next drive has the same sample count.
  useEffect(() => {
    if (!id || restoredDriveRef.current === id) return;
    if (positions.length === 0 || String(drive?.id) !== id) return;
    restoredDriveRef.current = id;
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
  }, [id, drive?.id, positions.length, controls, searchParams]);

  // Persist (debounced) — write `at` and `play` to the URL.
  useEffect(() => {
    if (!id || restoredDriveRef.current !== id) return;
    if (positions.length === 0) return;
    // The restoration effect has not committed its playhead in this render.
    if (writeDriveRef.current !== id) {
      writeDriveRef.current = id;
      return;
    }
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
  }, [id, replay.progress, replay.isPlaying, positions.length, setSearchParams]);

  /* ---- Elevation profile data ---- */
  // Keep every sample index, including unknown altitude, so elevation
  // seeking follows the same playhead as the map without bridging gaps.
  const elevationData: TripReplayElevationPoint[] = useMemo(() => {
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
        elevation: p.elevation,
        speed: p.speed != null ? convertSpeedFromSI(p.speed, unitPrefs.speed) : null,
      };
    });
  }, [positions, unitPrefs.distance, unitPrefs.speed]);

  /* ---- Speed + Power timeline data (shared with TripReplayCharts) ---- */
  const timelineData: TripReplayChartPoint[] = useMemo(() => {
    if (positions.length === 0) return [];
    return positions.map((p, i) => {
      const offset = replay.timeline[i];
      // Keep the sample index without inventing a time for an unknown timestamp.
      const elapsedMin = offset != null ? offset / 60_000 : Number.NaN;
      return {
        index: i,
        time: Number(elapsedMin.toFixed(3)),
        speed: p.speed != null ? convertSpeedFromSI(p.speed, unitPrefs.speed) : null,
        power: p.power != null ? convertPowerFromSI(p.power, unitPrefs.power) : null,
      };
    });
  }, [positions, replay.timeline, unitPrefs.speed, unitPrefs.power]);

  /* ---- Hover preview sampler for the scrubber ---- */
  const getPreviewAt = useCallback(
    (normalized: number): TimelinePreviewPoint | null => {
      if (!replay.canPlay) return null;
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
        power: p.power != null ? formatPower(p.power, unitPrefs) : undefined,
        soc: Number.isFinite(p.batteryLevel) ? `${fmtInt(p.batteryLevel)}%` : undefined,
        elevation: p.elevation != null ? `${fmtInt(p.elevation)} m` : undefined,
      };
    },
    [positions, replay.canPlay, replay.totalTime, unitPrefs, fmtNumber, fmtInt],
  );

  /* ---- Speed sparkline behind the scrubber ---- */
  const speedSparkData = useMemo(() => {
    // Sparkline accepts only numbers; omit this decoration rather than
    // turn an unknown reading into a measured stop. Primary series keep gaps.
    if (positions.length === 0 || positions.some((p) => p.speed == null || !Number.isFinite(p.speed))) return [] as number[];
    // Downsample to ~80 points so the sparkline isn't a noisy mess.
    const target = 80;
    if (positions.length <= target) {
      return positions.map((p) => p.speed as number);
    }
    const stride = positions.length / target;
    const out: number[] = [];
    for (let i = 0; i < target; i++) {
      const idx = Math.min(positions.length - 1, Math.floor(i * stride));
      out.push(positions[idx].speed as number);
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
        ? 'rounded-md ring-1 ring-[var(--focus-ring)] ring-offset-1 ring-offset-[var(--panel-bg)]'
        : undefined;
    },
    [activeMarker],
  );

  /* ---- Current stat values ---- */
  const cp = replay.currentPosition;
  const quantitySources = [
    ['speed', t('replay.stat.speed', 'Speed')],
    ['power', t('replay.stat.power', 'Power')],
    ['batteryLevel', t('replay.stat.battery', 'Battery')],
    ['elevation', t('replay.stat.elevation', 'Elevation')],
    ['ratedRange', t('replay.stat.range', 'Range')],
    ['outsideTemp', t('replay.stat.temp', 'Temperature')],
  ] as const;

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
    <PageLayout
      title={t('replay.title', 'Trip Replay')}
      subtitle={t('help.replay.power', 'Instantaneous battery power at this point on the trip. Negative values indicate regenerative braking (energy flowing back into the pack); positive values indicate motor draw.')}
      metadataActions={drive
        ? (
          <Text variant="bodySm" className="max-w-full [overflow-wrap:anywhere]">
            {`${t('replay.drive', 'Drive')} #${drive.id} — ${formatDate(drive.startTs)}${drive.startAddress && drive.endAddress ? ` · ${drive.startAddress} → ${drive.endAddress}` : ''}`}
          </Text>
        )
        : undefined}
      loading={driveState.status === 'initial'}
      error={driveState.fatalError}
      query={driveQuery}
      breadcrumbLabels={{
        '/drives/:id': drive
          ? `${drive.startAddress ?? t('replay.drive', 'Drive')} → ${drive.endAddress ?? ''}`
          : `${t('replay.drive', 'Drive')} #${id}`,
      }}
      secondaryActions={
        <div className="flex flex-wrap items-center justify-end gap-2" data-tour="drive-replay-share">
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 min-w-11 md:min-h-9 md:min-w-9"
            onClick={() => driveQuery.refetch()}
            aria-label={t('replay.refresh', 'Refresh replay data')}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Link
            to={`/drives/${id}`}
            className={cn(BUTTON_BASE, BUTTON_VARIANTS.ghost, 'min-h-11 min-w-11 max-w-full px-3 py-1.5 md:min-h-9')}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
            <Text variant="bodySm" className="min-w-0 break-words">{t('replay.backToDrive', 'Back to Drive')}</Text>
          </Link>
        </div>
      }
    >
      {/* ================================================================ */}
      {/*  Section 1 — One summary surface, unframed measurement grid      */}
      {/*  Summary fields come from the drive record, not the GPS trail, so */}
      {/*  they render even when a drive has no position coordinates.        */}
      {/* ================================================================ */}
      <FadeIn>
        <TripReplaySummaryBrief drive={drive} source={driveState} elevation={elevStats} formatDriveTime={formatDriveTime} />
        <dl className="flex flex-wrap gap-x-4 gap-y-2 pt-2" aria-label={t('calculationDetails.sources', 'Data sources')}>
          <div data-testid="replay-summary-source" data-provenance={summaryProvenance}>
            <Text as="dt" variant="caption">{t('replay.summary.title', 'Drive Summary')}</Text>
            <Text as="dd" variant="caption">{summaryProvenance === 'live'
              ? t('provenance.live', 'Live')
              : summaryProvenance === 'historical'
                ? t('provenance.historical', 'Historical')
                : t('provenance.unknown', 'Unknown source')}</Text>
          </div>
          <div data-testid="replay-route-source" data-provenance={positions.length > 0 ? 'historical' : 'unknown'}>
            <Text as="dt" variant="caption">{t('replay.map.ariaLabel', 'Trip route map')}</Text>
            <Text as="dd" variant="caption">{positions.length > 0
              ? t('provenance.historical', 'Historical')
              : t('provenance.unknown', 'Unknown source')}</Text>
          </div>
          <div data-testid="replay-derived-source" data-provenance="inferred">
            <Text as="dt" variant="caption">
              {t('replay.summary.efficiency', 'Efficiency')}{' · '}
              {t('replay.summary.elevGain', 'Elevation Gain')}{' · '}
              {t('replay.summary.elevLoss', 'Elevation Loss')}{' · '}
              {t('replay.elevation.title', 'Elevation profile')}{' · '}
              {t('replay.overview.label', 'Event overview')}
            </Text>
            <Text as="dd" variant="caption">{t('provenance.inferred', 'Estimated')}</Text>
          </div>
        </dl>
      </FadeIn>

        <>
          {/* ============================================================ */}
          {/*  Section 2 — Replay hero: route map + live position stats     */}
          {/*  One stage owns map, live readouts and transport.             */}
          {/*  The desktop readouts align with the map, not six tall cards. */}
          {/* ============================================================ */}
          <FadeIn delay={0.05}>
            <GlassPanel role="region"
              aria-label={t('replay.map.section', 'Route map and live position')}
              className="flex flex-col overflow-hidden"
            >
              <div className="contents lg:order-first lg:grid lg:min-w-0 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
              <div className="order-first min-w-0 h-[320px] sm:h-[380px] lg:order-none lg:h-[440px]">
                {positions.length > 0 ? <TripReplayMap
                  positions={positions}
                  currentIndex={replay.currentIndex}
                  onSeekToIndex={handleSeekToIndex}
                  reduceMotion={reduce}
                  height="100%"
                  embedded
                /> : (
                  <div className="flex h-full items-center justify-center p-6">
                    <EmptyState /* no-action: GPS samples are unavailable; refresh is provided in the page header */
                      icon={<MapPin className="h-10 w-10" />}
                      message={t('replay.noGps', 'No GPS data available for this drive. Trip replay requires valid position coordinates from Fleet Telemetry.')}
                    />
                  </div>
                )}
              </div>
              <div className="order-last flex min-w-0 flex-col border-t border-[var(--border-subtle)] p-3 lg:order-none lg:border-t-0 lg:border-s sm:p-4" data-testid="replay-current-stats">
                <PanelTitle className="px-3 pb-2 sm:px-4">
                  {t('replay.currentStats', 'Current Position Stats')}
                </PanelTitle>
                <Text variant="caption" className="px-3 pb-2 sm:px-4 [overflow-wrap:anywhere]">
                  {t('common.timestamp', 'Timestamp')}: {cp && Number.isFinite(new Date(cp.timestamp).getTime())
                    ? <time dateTime={cp.timestamp}>{new Date(cp.timestamp).toISOString()}</time>
                    : t('common.unknown', 'Unknown')}
                </Text>
                <div className="grid flex-1 grid-cols-2 sm:grid-cols-3 lg:grid-cols-2">
                  <TripReplayReadout
                    label={t('replay.stat.speed', 'Speed')}
                    value={cp?.speed != null && Number.isFinite(cp.speed)
                      ? `${fmtNumber(convertSpeedFromSI(cp.speed, unitPrefs.speed))} ${unitPrefs.speed}`
                      : '—'}
                    icon={<Gauge className="h-4 w-4" />}
                    className={cn(cardHighlight(['fast-segment']))}
                  />
                  <TripReplayReadout
                    label={t('replay.stat.power', 'Power')}
                    value={formatPower(cp?.power, unitPrefs)}
                    icon={<Zap className="h-4 w-4" />}
                    className={cn(cardHighlight(['regen-peak', 'charge-start', 'charge-stop']))}
                    help={{
                      i18nKey: 'help.replay.power',
                      defaultValue:
                        'Instantaneous battery power at this point on the trip. Negative values indicate regenerative braking (energy flowing back into the pack); positive values indicate motor draw.',
                    }}
                  />
                  <TripReplayReadout
                    label={t('replay.stat.battery', 'Battery')}
                    value={cp && Number.isFinite(cp.batteryLevel) ? `${fmtInt(cp.batteryLevel)}%` : '—'}
                    icon={<Battery className="h-4 w-4" />}
                    className={cn(cardHighlight(['low-soc', 'charge-start', 'charge-stop']))}
                    help={{
                      i18nKey: 'help.replay.battery',
                      defaultValue:
                        "State-of-charge percentage at this point. Drops indicate energy use; rises indicate regen or DC-fast-charging during a drive.",
                    }}
                  />
                  <TripReplayReadout
                    label={t('replay.stat.elevation', 'Elevation')}
                    value={cp?.elevation != null && Number.isFinite(cp.elevation) ? `${fmtInt(cp.elevation)} m` : '—'}
                    icon={<Mountain className="h-4 w-4" />}
                  />
                  <TripReplayReadout
                    label={t('replay.stat.range', 'Range')}
                    value={cp?.ratedRange != null && Number.isFinite(cp.ratedRange)
                      ? `${fmtNumber(convertDistanceFromSI(cp.ratedRange, unitPrefs.distance))} ${unitPrefs.distance}`
                      : '—'}
                    icon={<Navigation className="h-4 w-4" />}
                    help={{
                      i18nKey: 'help.replay.range',
                      defaultValue:
                        'Estimated rated range remaining at this position based on EPA rated efficiency. Differs from real-world range, which depends on speed, terrain, climate, and load.',
                    }}
                  />
                  <TripReplayReadout
                    label={t('replay.stat.temp', 'Temperature')}
                    value={cp?.outsideTemp != null && Number.isFinite(cp.outsideTemp)
                      ? `${fmtNumber(convertTempFromSI(cp.outsideTemp, unitPrefs.temperature))} ${unitPrefs.temperature}`
                      : '—'}
                    icon={<Thermometer className="h-4 w-4" />}
                  />
                </div>
                <dl className="grid gap-2 border-t border-[var(--border-subtle)] px-3 pt-3 sm:px-4">
                  {quantitySources.map(([quantity, label]) => {
                    const sourceTs = positions[replay.currentIndex]?.sourceTimestamps[quantity] ?? null;
                    const origin = positions[replay.currentIndex]?.sourceOrigins[quantity] ?? 'unknown';
                    // Telemetry power is projected from pack voltage × current.
                    const provenance = origin === 'unknown' ? 'unknown'
                      : origin === 'telemetry' && quantity === 'power' ? 'inferred' : 'historical';
                    const positionTs = cp ? new Date(cp.timestamp).getTime() : Number.NaN;
                    const known = cp != null && Number.isFinite(cp[quantity]);
                    // Signed age is relative to the GPS frame. Nearest alignment
                    // can select a future row, which must not appear age zero.
                    const age = sourceTs != null && Number.isFinite(positionTs)
                      ? `${fmtNumber((positionTs - sourceTs) / 1000)} s`
                      : t('common.unknown', 'Unknown');
                    return (
                      <div key={quantity} className="min-w-0" data-testid={`replay-source-${quantity}`}
                        data-source={origin} data-provenance={provenance}>
                        <Text as="dt" variant="caption">{label}{!known && ` · ${t('common.unknown', 'Unknown')}`}</Text>
                        <Text as="dd" variant="caption">
                          {t('calculationDetails.source', 'Source')}: {origin === 'position'
                            ? t('dashboard.grid.positionHeading', 'Position')
                            : origin === 'telemetry'
                              ? t('driveDetail.report.telemetry', 'Telemetry')
                              : t('common.unknown', 'Unknown')}
                          {' · '}{provenance === 'historical'
                            ? t('provenance.historical', 'Historical')
                            : provenance === 'inferred'
                              ? t('provenance.inferred', 'Estimated')
                              : t('provenance.unknown', 'Unknown source')}
                        </Text>
                        <Text as="dd" variant="caption" className="[overflow-wrap:anywhere]">
                          {t('common.timestamp', 'Timestamp')}: {sourceTs != null
                            ? <time dateTime={new Date(sourceTs).toISOString()}>{new Date(sourceTs).toISOString()}</time>
                            : t('common.unknown', 'Unknown')}
                          {' · '}{t('statistics.age', 'Age')}: {age}
                        </Text>
                      </div>
                    );
                  })}
                </dl>
              </div>
              </div>

          {/* ============================================================ */}
          {/*  Section 3 — Playback transport stays attached to the map     */}
          {/* ============================================================ */}
            <div className="border-t border-[var(--border-subtle)]" data-tour="drive-replay-scrubber">
              {replay.canPlay ? <PlaybackControls
                framed={false}
                className="p-3 sm:p-4"
                isPlaying={replay.isPlaying}
                speed={replay.speed}
                progress={replay.progress}
                elapsed={fmtDuration(replay.elapsedTime, locale)}
                total={fmtDuration(replay.totalTime, locale)}
                onPlay={controls.play}
                onPause={controls.pause}
                onRestart={() => controls.seekToProgress(0)}
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
                    <Sparkline data={speedSparkData} color={chartTokens.series[0]} height={24} width={400} />
                  ) : undefined
                }
              /> : (
                <div className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
                  <Button disabled variant="secondary">
                    {t('replay.controls.play', 'Play')}
                  </Button>
                  <Text variant="bodySm">
                    {t('replay.controls.progress', 'Playback progress')}: {t('common.unavailable', 'Unavailable')}
                    {' · '}{positions.length === 0
                      ? t('replay.map.noPositions', 'No position data available for this drive')
                      : `${t('common.timestamp', 'Timestamp')} / ${t('common.duration', 'Duration')}: ${t('common.unavailable', 'Unavailable')}`}
                  </Text>
                </div>
              )}
            </div>
            </GlassPanel>
          </FadeIn>

          {/* ============================================================ */}
          {/*  Section 4 — Timeline charts bento (elevation + speed/power)   */}
          {/*  Side-by-side on xl to use horizontal space; both share the   */}
          {/*  playhead cursor via replay.currentIndex.                      */}
          {/* ============================================================ */}
          <FadeIn delay={0.15}>
            <section
              aria-label={t('replay.timeline.section', 'Trip elevation and speed timelines')}
              className="grid grid-cols-1 gap-4 xl:gap-5 xl:grid-cols-2"
            >
              <TripReplayElevation
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
                powerUnit={unitPrefs.power}
                onSeekToIndex={handleSeekToIndex}
                height={220}
              />
            </section>
          </FadeIn>
        </>
    </PageLayout>
  );
}
