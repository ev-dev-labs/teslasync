import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Gauge, Battery, Zap, Mountain, Thermometer,
  Navigation, MapPin, Clock, Route, TrendingUp,
  ArrowUpRight, ArrowDownRight, Activity,
} from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Button } from '@/components/ui';
import { PlaybackControls } from '@/components/ui/PlaybackControls';
import { StatCard, MetricCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import {
  ChartContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, chartGrid, axisTick, fmt,
  CHART_COLORS,
} from '@/components/charts';
import { ElevationProfile, type ElevationDataPoint } from '@/components/charts';
import {
  MapContainer, Polyline, CircleMarker, useMap,
  MapTileLayer, MapInvalidator, MapLayerSwitcher,
  AnimatedMarker,
  type MapStyle,
} from '@/components/maps';
import { useDrive } from '@/api/hooks/useDriving';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTripReplay } from '@/hooks/useTripReplay';
import { haversineDistance } from '@/lib/geo';
import { formatDate } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import type { LatLngExpression } from 'leaflet';
import { latLngBounds } from 'leaflet';
import type { DrivePosition } from '@/types/driving';

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

/** Format ms duration as "HH:MM:SS" or "MM:SS" */
function fmtDuration(ms: number): string {
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

/** Compute heading angle between two points (degrees, 0=north). */
function computeHeading(p1: DrivePosition, p2: DrivePosition): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLon = toRad(p2.longitude - p1.longitude);
  const y = Math.sin(dLon) * Math.cos(toRad(p2.latitude));
  const x =
    Math.cos(toRad(p1.latitude)) * Math.sin(toRad(p2.latitude)) -
    Math.sin(toRad(p1.latitude)) * Math.cos(toRad(p2.latitude)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Get speed color for a km/h value. */
function speedColor(kmh: number): string {
  if (kmh < 30) return '#10b981';       // green — slow
  if (kmh < 60) return '#22d3ee';       // cyan — moderate
  if (kmh < 100) return '#f59e0b';      // amber — fast
  return '#ef4444';                      // red — very fast
}

/* ---- Map bounds fitter (runs once) ---- */
function FitBounds({ trail }: { trail: LatLngExpression[] }) {
  const map = useMap();
  useMemo(() => {
    if (trail.length > 1) {
      const bounds = latLngBounds(
        trail.map((p) =>
          Array.isArray(p) ? [p[0] as number, p[1] as number] as [number, number] : [0, 0] as [number, number],
        ),
      );
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
    } else if (trail.length === 1) {
      map.setView(trail[0] as [number, number], 15);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trail.length]);
  return null;
}

/* ================================================================== */
/*  Page Component                                                     */
/* ================================================================== */

export default function TripReplayPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  usePageTitle(t('replay.title', 'Trip Replay'));

  const { data: drive, isLoading, error } = useDrive(id ?? '');
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark');

  const {
    convertDistance, convertSpeed, convertTemp,
    distanceUnit, speedUnit, tempUnit,
  } = useSettings();

  /* ---- Normalize positions ---- */
  const positions: DrivePosition[] = useMemo(() => {
    if (!drive) return [];
    const pos = drive.positions ?? [];
    return pos
      .map((p: any) => ({
        latitude: p.latitude ?? 0,
        longitude: p.longitude ?? 0,
        speed: p.speed ?? null,
        power: p.power ?? null,
        batteryLevel: p.batteryLevel ?? p.battery_level ?? 0,
        timestamp: p.timestamp ?? p.created_at ?? p.createdAt ?? '',
        elevation: p.elevation ?? null,
        insideTemp: p.insideTemp ?? p.inside_temp ?? null,
        outsideTemp: p.outsideTemp ?? p.outside_temp ?? null,
        idealRange: p.idealRange ?? p.ideal_range ?? null,
        ratedRange: p.ratedRange ?? p.rated_range ?? null,
        odometer: p.odometer ?? null,
        fanStatus: p.fanStatus ?? p.fan_status ?? null,
        isClimateOn: p.isClimateOn ?? p.is_climate_on ?? null,
      } as DrivePosition))
      .filter((p) => p.latitude !== 0 || p.longitude !== 0);
  }, [drive]);

  /* ---- Replay hook ---- */
  const [replay, controls] = useTripReplay(positions);

  /* ---- Map trail ---- */
  const trail: LatLngExpression[] = useMemo(
    () => positions.map((p) => [p.latitude, p.longitude] as [number, number]),
    [positions],
  );

  const startPos = trail[0] as [number, number] | undefined;
  const endPos = trail.length > 1
    ? (trail[trail.length - 1] as [number, number])
    : undefined;
  const centerPos: [number, number] = startPos
    ?? (drive?.startLatitude && drive?.startLongitude
      ? [drive.startLatitude, drive.startLongitude]
      : [47.6, -122.3]);

  /* ---- Speed-colored segments ---- */
  const speedSegments = useMemo(() => {
    const segs: { positions: LatLngExpression[]; color: string }[] = [];
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1];
      const curr = positions[i];
      const color = speedColor(curr.speed ?? 0);
      segs.push({
        positions: [
          [prev.latitude, prev.longitude],
          [curr.latitude, curr.longitude],
        ],
        color,
      });
    }
    return segs;
  }, [positions]);

  /* ---- Current marker heading ---- */
  const heading = useMemo(() => {
    const idx = replay.currentIndex;
    if (positions.length < 2) return 0;
    const next = idx < positions.length - 1 ? idx + 1 : idx;
    const prev = next > 0 ? next - 1 : 0;
    return computeHeading(positions[prev], positions[next]);
  }, [replay.currentIndex, positions]);

  /* ---- Elevation profile data ---- */
  const elevationData: ElevationDataPoint[] = useMemo(() => {
    let cumDist = 0;
    return positions.map((p, i) => {
      if (i > 0) {
        cumDist += haversineDistance(
          positions[i - 1].latitude, positions[i - 1].longitude,
          p.latitude, p.longitude,
        );
      }
      return {
        index: i,
        distance: Number((convertDistance(cumDist / 1000)).toFixed(2)),
        elevation: p.elevation ?? 0,
        speed: p.speed != null ? convertSpeed(p.speed) : 0,
      };
    });
  }, [positions, convertDistance, convertSpeed]);

  /* ---- Speed + Power timeline data ---- */
  const timelineData = useMemo(() => {
    if (positions.length === 0) return [];
    const t0 = new Date(positions[0].timestamp).getTime();
    return positions.map((p, i) => {
      const elapsedMin = (new Date(p.timestamp).getTime() - t0) / 60_000;
      return {
        index: i,
        time: Number(elapsedMin.toFixed(1)),
        speed: p.speed != null ? convertSpeed(p.speed) : 0,
        power: p.power ?? 0,
      };
    });
  }, [positions, convertSpeed]);

  /* ---- Timeline cursor ---- */
  const cursorTime = useMemo(() => {
    if (timelineData.length === 0) return undefined;
    return timelineData[replay.currentIndex]?.time;
  }, [timelineData, replay.currentIndex]);

  /* ---- Current stat values ---- */
  const cp = replay.currentPosition;

  /* ---- Drive summary stats ---- */
  const distanceKm = drive?.distance ?? 0;
  const durationMin = drive?.durationMin ?? 0;
  const efficiency = distanceKm > 0 && drive?.socStart != null && drive?.socEnd != null
    ? ((drive.socStart - drive.socEnd) / convertDistance(distanceKm)) * 1000
    : null;

  return (
    <PageContainer
      title={t('replay.title', 'Trip Replay')}
      subtitle={drive
        ? `${t('replay.drive', 'Drive')} #${drive.id} — ${formatDate(drive.startDate)}${drive.startAddress && drive.endAddress ? ` · ${drive.startAddress} → ${drive.endAddress}` : ''}`
        : undefined}
      loading={isLoading}
      error={error instanceof Error ? error : error ? new Error(String(error)) : null}
      actions={
        <Link to={`/drives/${id}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t('replay.backToDrive', 'Back to Drive')}
          </Button>
        </Link>
      }
    >
      {positions.length === 0 && !isLoading ? (
        <FadeIn>
          <EmptyState
            icon={<MapPin className="h-10 w-10" />}
            message={t('replay.noGps', 'No GPS data available for this drive. Trip replay requires valid position coordinates from Fleet Telemetry.')}
          />
        </FadeIn>
      ) : (
      <>
      {/* ================================================================ */}
      {/*  Section 1 — Map                                                 */}
      {/* ================================================================ */}
      <FadeIn>
        <GlassPanel className="relative overflow-hidden rounded-xl h-[450px]">
          {positions.length > 0 ? (
            <MapContainer
              center={centerPos}
              zoom={13}
              className="h-full w-full z-0"
              scrollWheelZoom
              zoomControl={false}
            >
              <MapTileLayer style={mapStyle} />
              <MapInvalidator />
              <FitBounds trail={trail} />

              {/* Speed-colored route */}
              {speedSegments.map((seg, i) => (
                <Polyline
                  key={i}
                  positions={seg.positions}
                  pathOptions={{ color: seg.color, weight: 4, opacity: 0.8 }}
                />
              ))}

              {/* Start marker */}
              {startPos && (
                <CircleMarker
                  center={startPos}
                  radius={6}
                  pathOptions={{ color: '#10b981', fillColor: '#10b981', fillOpacity: 1, weight: 2 }}
                />
              )}

              {/* End marker */}
              {endPos && (
                <CircleMarker
                  center={endPos}
                  radius={6}
                  pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1, weight: 2 }}
                />
              )}

              {/* Animated car marker */}
              {replay.currentPosition && (
                <AnimatedMarker
                  position={[replay.currentPosition.latitude, replay.currentPosition.longitude]}
                  heading={heading}
                  color="#00b4d8"
                />
              )}

              <MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />
            </MapContainer>
          ) : (
            <EmptyState
              icon={<MapPin className="h-8 w-8" />}
              message={t('replay.map.noPositions', 'No position data available for this drive')}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ================================================================ */}
      {/*  Section 2 — Playback Controls                                   */}
      {/* ================================================================ */}
      <FadeIn delay={0.05}>
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
        />
      </FadeIn>

      {/* ================================================================ */}
      {/*  Section 3 — Current Stats Bar                                   */}
      {/* ================================================================ */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-white/70">
            {t('replay.currentStats', 'Current Position Stats')}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <MetricCard
              label={t('replay.stat.speed', 'Speed')}
              value={cp?.speed != null ? `${fmtNumber(convertSpeed(cp.speed))} ${speedUnit}` : '—'}
              icon={<Gauge className="h-4 w-4" />}
              color="cyan"
            />
            <MetricCard
              label={t('replay.stat.power', 'Power')}
              value={cp?.power != null ? `${fmtNumber(cp.power, 1)} kW` : '—'}
              icon={<Zap className="h-4 w-4" />}
              color="cyan"
            />
            <MetricCard
              label={t('replay.stat.battery', 'Battery')}
              value={cp ? `${fmtInt(cp.batteryLevel)}%` : '—'}
              icon={<Battery className="h-4 w-4" />}
              color="cyan"
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
                ? `${fmtNumber(convertDistance(cp.ratedRange))} ${distanceUnit}`
                : '—'}
              icon={<Navigation className="h-4 w-4" />}
              color="cyan"
            />
            <MetricCard
              label={t('replay.stat.temp', 'Temperature')}
              value={cp?.outsideTemp != null
                ? `${fmtNumber(convertTemp(cp.outsideTemp))} ${tempUnit}`
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
          onClickIndex={controls.seekTo}
          height={200}
          distanceUnit={distanceUnit}
        />
      </FadeIn>

      {/* ================================================================ */}
      {/*  Section 5 — Speed + Power Timeline                              */}
      {/* ================================================================ */}
      <FadeIn delay={0.2}>
        <ChartContainer
          title={t('replay.timeline.title', 'Speed & Power Timeline')}
          subtitle={t('replay.timeline.subtitle', 'Click to seek replay position')}
          height={220}
        >
          {timelineData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart
                data={timelineData}
                className="cursor-pointer"
                onClick={(state) => {
                  if (!state) return;
                  const idx = state.activeTooltipIndex;
                  if (typeof idx === 'number' && idx >= 0 && idx < timelineData.length) {
                    controls.seekTo(timelineData[idx].index);
                  }
                }}
              >
                <defs>
                  <linearGradient id="speedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS[0]} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLORS[0]} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="powerGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS[1]} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLORS[1]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...chartGrid} />
                <XAxis
                  dataKey="time"
                  {...axisTick}
                  tickFormatter={(v: number) => `${fmt(v, 0)}m`}
                />
                <YAxis
                  yAxisId="speed"
                  {...axisTick}
                  tickFormatter={(v: number) => fmt(v, 0)}
                  label={{ value: speedUnit, angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#9ca3af' } }}
                />
                <YAxis
                  yAxisId="power"
                  orientation="right"
                  {...axisTick}
                  tickFormatter={(v: number) => fmt(v, 0)}
                  label={{ value: 'kW', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: '#9ca3af' } }}
                />
                <Tooltip
                  contentStyle={{ background: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                  labelFormatter={(v: number) => `${fmt(v, 1)} min`}
                />
                <Area
                  yAxisId="speed"
                  type="monotone"
                  dataKey="speed"
                  name={t('replay.timeline.speed', 'Speed')}
                  stroke={CHART_COLORS[0]}
                  fill="url(#speedGrad)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Area
                  yAxisId="power"
                  type="monotone"
                  dataKey="power"
                  name={t('replay.timeline.power', 'Power')}
                  stroke={CHART_COLORS[1]}
                  fill="url(#powerGrad)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                {cursorTime != null && (
                  <ReferenceLine
                    x={cursorTime}
                    stroke="#00b4d8"
                    strokeWidth={2}
                    strokeDasharray="4 2"
                    yAxisId="speed"
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState
              icon={<Activity className="h-6 w-6" />}
              message={t('replay.timeline.noData', 'No telemetry data available')}
            />
          )}
        </ChartContainer>
      </FadeIn>

      {/* ================================================================ */}
      {/*  Section 6 — Drive Summary                                       */}
      {/* ================================================================ */}
      <FadeIn delay={0.25}>
        <GlassPanel className="p-6">
          <h3 className="mb-4 text-sm font-semibold text-white/70">
            {t('replay.summary.title', 'Drive Summary')}
          </h3>
          <StaggerContainer className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StaggerItem>
              <StatCard
                label={t('replay.summary.distance', 'Distance')}
                value={fmtNumber(convertDistance(distanceKm))}
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
                value={drive?.elevationGain != null ? fmtInt(drive.elevationGain) : '—'}
                unit={drive?.elevationGain != null ? 'm' : undefined}
                icon={<ArrowUpRight className="h-4 w-4" />}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('replay.summary.elevLoss', 'Elevation Loss')}
                value={drive?.elevationLoss != null ? fmtInt(drive.elevationLoss) : '—'}
                unit={drive?.elevationLoss != null ? 'm' : undefined}
                icon={<ArrowDownRight className="h-4 w-4" />}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('replay.summary.maxSpeed', 'Max Speed')}
                value={drive?.speedMax != null ? fmtNumber(convertSpeed(drive.speedMax)) : '—'}
                unit={drive?.speedMax != null ? speedUnit : undefined}
                icon={<Gauge className="h-4 w-4" />}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('replay.summary.avgSpeed', 'Avg Speed')}
                value={drive?.speedAvg != null ? fmtNumber(convertSpeed(drive.speedAvg)) : '—'}
                unit={drive?.speedAvg != null ? speedUnit : undefined}
                icon={<Gauge className="h-4 w-4" />}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('replay.summary.battery', 'Battery')}
                value={drive?.socStart != null && drive?.socEnd != null
                  ? `${fmtInt(drive.socStart)}% → ${fmtInt(drive.socEnd)}%`
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
