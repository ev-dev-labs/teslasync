import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  MapPin, Clock, Zap, Battery, Mountain, Gauge, TrendingUp,
} from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { Grid } from '@/components/layout';
import { StatCard } from '@/components/data-display';
import { EmptyState, Skeleton } from '@/components/feedback';
import {
  ChartContainer, ChartGradient, chartGrid, axisTick,
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
  AREA_DEFAULTS,
} from '@/components/charts';
import {
  MapContainer, Polyline, CircleMarker,
  MapTileLayer,
  type LatLngExpression,
} from '@/components/maps';
import Logo from '@/components/ui/Logo';
import { useSharedDrive } from '@/api/hooks/useSharing';
import { FadeIn } from '@/components/motion';
import { formatDurationSecondsAsMinutes } from '@/lib/dateFormat';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import {
  convertDistanceFromSI,
  convertSpeedFromSI,
  type DistanceUnitPref,
} from '@/lib/unitConversion';
import { normalizeSharedDriveData } from '@/types/sharing';

/* ------------------------------------------------------------------ */
/*  Boundary constants                                                */
/* ------------------------------------------------------------------ */

// Kilometres-per-mile factor, used inline to convert Wh/km → Wh/mi for
// users on imperial preference (no SI helper exists for energy-per-distance
// efficiency yet).
const KM_PER_MILE = 1.609344;

// Metres-per-foot factor, used inline to convert SI-meter elevations to
// feet for imperial users. Elevation has no dedicated formatter in
// `lib/unitConversion` (DistanceUnitPref's 'ft' variant exists but is not
// derived by the standard distance preference), so a one-shot inline
// conversion keeps the public report honest about units.
const METERS_PER_FOOT = 0.3048;

const METERS_PER_KM = 1000;

/* ------------------------------------------------------------------ */
/*  Unit-aware helpers                                                */
/* ------------------------------------------------------------------ */

function elevationLabel(distancePref: DistanceUnitPref): string {
  return distancePref === 'mi' ? 'ft' : 'm';
}

function convertElevation(meters: number, distancePref: DistanceUnitPref): number {
  return distancePref === 'mi' ? meters / METERS_PER_FOOT : meters;
}

function efficiencyUnit(distancePref: DistanceUnitPref): string {
  return distancePref === 'mi' ? 'Wh/mi' : 'Wh/km';
}

function toEfficiencyDisplay(whPerKm: number, distancePref: DistanceUnitPref): number {
  return distancePref === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;
}

/* ------------------------------------------------------------------ */
/*  Expired / Error view                                              */
/* ------------------------------------------------------------------ */

function ExpiredShareView() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
      <div className="text-center space-y-4 max-w-md px-4">
        <div className="w-16 h-16 mx-auto rounded-full bg-white/[0.03] flex items-center justify-center">
          <MapPin className="h-8 w-8 text-[var(--text-muted)]" />
        </div>
        <h1
          className="text-xl font-bold text-[var(--text-primary)] outline-none"
          tabIndex={-1}
          data-route-focus-target="true"
        >
          {t('share.expired.title', 'Share Link Unavailable')}
        </h1>
        <p className="text-[var(--text-secondary)] text-sm">
          {t('share.expired.description', 'This shared drive link has expired or been revoked.')}
        </p>
        <a
          href="/"
          className="inline-block text-sm text-[var(--theme-primary)] hover:underline"
        >
          {t('share.expired.home', 'Go to TeslaSync')}
        </a>
      </div>
    </div>
  );
}

function SharedDriveLoading() {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('share.loading', 'Loading shared drive report…')}
      className="min-h-screen bg-[var(--bg-primary)]"
    >
      <header className="border-b border-[var(--border-subtle)] p-4">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="text-sm text-[var(--text-muted)]">
            {t('share.header', 'Shared Drive Report')}
          </span>
        </div>
      </header>
      <Skeleton className="h-[50vh] rounded-none" />
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <div className="space-y-2">
          <Skeleton className="h-8 w-72 max-w-full" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SharedDrivePage                                                   */
/* ------------------------------------------------------------------ */

// EXCEPTION: public share route is chrome-less so unauthenticated recipients see only the branded report.
export default function SharedDrivePage() {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation();
  const { data: rawData, isLoading, error } = useSharedDrive(token ?? '');
  const data = useMemo(() => normalizeSharedDriveData(rawData), [rawData]);
  const { unitPrefs, formatDistance, formatSpeed } = useUnits();
  const distancePref = unitPrefs.distance;
  const speedPref = unitPrefs.speed;
  const elevPref = elevationLabel(distancePref);
  const effPref = efficiencyUnit(distancePref);

  /* ---- Map data ---- */
  const mapPoints: LatLngExpression[] = useMemo(() => {
    const pts = data?.map_points ?? [];
    return pts.map((p) => [p.lat, p.lng] as [number, number]);
  }, [data?.map_points]);

  const center: [number, number] = useMemo(() => {
    if (mapPoints.length > 0) {
      const mid = mapPoints[Math.floor(mapPoints.length / 2)];
      return Array.isArray(mid) ? [mid[0] as number, mid[1] as number] : [47.6, -122.3];
    }
    return [47.6, -122.3];
  }, [mapPoints]);

  const startPos = mapPoints.length > 0
    ? (mapPoints[0] as [number, number])
    : undefined;
  const endPos = mapPoints.length > 1
    ? (mapPoints[mapPoints.length - 1] as [number, number])
    : undefined;

  /* ---- Elevation chart data ---- */
  // Pre-convert at memo time so chart consumers receive already-display-unit
  // values; tickFormatter / Tooltip only render the unit suffix.
  const elevationData = useMemo(
    () => (data?.elevation_profile ?? []).map((p) => ({
      // Wire ships per-point cumulative distance in SI metres; lift to the
      // viewer's display unit once and pass downstream to the renderer.
      distance: convertDistanceFromSI(p.distance_m, distancePref),
      // Wire ships elevation_m as SI metres; convert to feet for imperial
      // viewers.
      elevation: convertElevation(p.elevation_m, distancePref),
    })),
    [data?.elevation_profile, distancePref],
  );

  /* ---- Speed chart data ---- */
  const speedData = useMemo(
    () => (data?.speed_profile ?? []).map((p) => ({
      distance: convertDistanceFromSI(p.distance_m, distancePref),
      // Wire ships SI m/s (`speed_mps`); convertSpeedFromSI maps it straight
      // to the viewer's km/h or mph preference — no intermediate hop.
      speed: convertSpeedFromSI(p.speed_mps, speedPref),
    })),
    [data?.speed_profile, distancePref, speedPref],
  );

  /* ---- Loading state ---- */
  if (isLoading) {
    return <SharedDriveLoading />;
  }

  /* ---- Error / expired ---- */
  if (error || !data) {
    return <ExpiredShareView />;
  }

  const drive = data.drive;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Header */}
      <header className="p-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="text-[var(--text-muted)] text-sm">
            {t('share.header', 'Shared Drive Report')}
          </span>
        </div>
      </header>

      {/* Hero map */}
      {mapPoints.length > 1 && (
        <FadeIn>
          <div className="h-[50vh] relative">
            <MapContainer
              center={center}
              zoom={7}
              className="h-full w-full"
              scrollWheelZoom={false}
            >
              <MapTileLayer style="dark" />
              <Polyline
                positions={mapPoints}
                pathOptions={{ color: 'var(--theme-primary)', weight: 3, opacity: 0.8 }}
              />
              {startPos && (
                <CircleMarker
                  center={startPos}
                  radius={6}
                  pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 }}
                />
              )}
              {endPos && (
                <CircleMarker
                  center={endPos}
                  radius={6}
                  pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 }}
                />
              )}
            </MapContainer>
          </div>
        </FadeIn>
      )}

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Title */}
        <FadeIn>
          <div className="space-y-1">
            {/* a11y-landmark-ok: the "share link unavailable" heading above
                lives in a mutually-exclusive early-return branch, so only
                one of the two <h1> elements can ever be rendered. */}
            <h1
              className="text-2xl font-bold text-[var(--text-primary)] outline-none"
              tabIndex={-1}
              data-route-focus-target="true"
            >
              {data.title}
            </h1>
            {data.description && (
              <p className="text-[var(--text-secondary)]">{data.description}</p>
            )}
            <div className="flex items-center gap-3 text-sm text-[var(--text-muted)] mt-2">
              <span>{drive.date}</span>
              {drive.start_address && drive.end_address && (
                <span>{drive.start_address} → {drive.end_address}</span>
              )}
            </div>
          </div>
        </FadeIn>

        {/* Stats grid */}
        <FadeIn delay={0.05}>
          <Grid cols={{ default: 2, md: 4 }} gap={4}>
            <StatCard
              label={t('share.distance', 'Distance')}
              value={formatDistance(drive.distance_m, { precision: 1 })}
              icon={<MapPin className="h-4 w-4" />}
            />
            <StatCard
              label={t('share.duration', 'Duration')}
              value={formatDurationSecondsAsMinutes(drive.duration_s)}
              icon={<Clock className="h-4 w-4" />}
            />
            {drive.efficiency_wh_per_m != null && (
              <StatCard
                label={t('share.efficiency', 'Efficiency')}
                value={`${Math.round(toEfficiencyDisplay(drive.efficiency_wh_per_m * METERS_PER_KM, distancePref))} ${effPref}`}
                icon={<Zap className="h-4 w-4" />}
              />
            )}
            {drive.start_battery != null && drive.end_battery != null && (
              <StatCard
                label={t('share.battery', 'Battery')}
                value={`${drive.start_battery}% → ${drive.end_battery}%`}
                icon={<Battery className="h-4 w-4" />}
              />
            )}
            {drive.max_speed_mps != null && (
              <StatCard
                label={t('share.maxSpeed', 'Max Speed')}
                value={formatSpeed(drive.max_speed_mps, { precision: 0 })}
                icon={<Gauge className="h-4 w-4" />}
              />
            )}
            {drive.avg_speed_mps != null && (
              <StatCard
                label={t('share.avgSpeed', 'Avg Speed')}
                value={formatSpeed(drive.avg_speed_mps, { precision: 0 })}
                icon={<TrendingUp className="h-4 w-4" />}
              />
            )}
            {drive.elevation_gain != null && (
              <StatCard
                label={t('share.elevGain', 'Elevation Gain')}
                value={`${Math.round(convertElevation(drive.elevation_gain, distancePref))} ${elevPref}`}
                icon={<Mountain className="h-4 w-4" />}
              />
            )}
          </Grid>
        </FadeIn>

        {/* Vehicle badge */}
        {data.vehicle && (
          <FadeIn delay={0.1}>
            <GlassPanel className="p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-white/[0.05] flex items-center justify-center">
                <Zap className="h-4 w-4 text-[var(--theme-primary)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  Tesla {data.vehicle.model}
                </p>
                <p className="text-xs text-[var(--text-muted)]">{data.vehicle.color}</p>
              </div>
            </GlassPanel>
          </FadeIn>
        )}

        {/* Elevation profile */}
        {elevationData.length > 0 && (
          <FadeIn delay={0.15}>
            {/* chart-a11y:no-table dense per-sample shared-drive trace */}
            <ChartContainer
              title={t('share.elevation', 'Elevation Profile')}
              ariaLabel={t('share.elevation.aria', 'Shared drive elevation profile area chart by distance')}
              height={200}
            >
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={elevationData}>
                  <defs>
                    <ChartGradient id="elevGrad" color="var(--theme-primary)" />
                  </defs>
                  <CartesianGrid {...chartGrid} />
                  <XAxis
                    dataKey="distance"
                    {...axisTick}
                    tickFormatter={(v: number) => `${Math.round(v)} ${distancePref}`}
                  />
                  <YAxis {...axisTick} tickFormatter={(v: number) => `${Math.round(v)} ${elevPref}`} />
                  <Tooltip
                    contentStyle={{ background: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: 8 }}
                    labelFormatter={(v: number) => `${fmtNumber(v, 1)} ${distancePref}`}
                    formatter={(v: number) => [`${Math.round(v)} ${elevPref}`, t('share.elevTooltipLabel', 'Elevation')]}
                  />
                  <Area
                    {...AREA_DEFAULTS}
                    dataKey="elevation"
                    stroke="var(--theme-primary)"
                    fill="url(#elevGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
          </FadeIn>
        )}

        {/* Speed profile */}
        {speedData.length > 0 && (
          <FadeIn delay={0.2}>
            {/* chart-a11y:no-table dense per-sample shared-drive trace */}
            <ChartContainer
              title={t('share.speed', 'Speed Profile')}
              ariaLabel={t('share.speed.aria', 'Shared drive speed profile line chart by distance')}
              height={200}
            >
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={speedData}>
                  <CartesianGrid {...chartGrid} />
                  <XAxis
                    dataKey="distance"
                    {...axisTick}
                    tickFormatter={(v: number) => `${Math.round(v)} ${distancePref}`}
                  />
                  <YAxis {...axisTick} tickFormatter={(v: number) => `${Math.round(v)}`} />
                  <Tooltip
                    contentStyle={{ background: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: 8 }}
                    labelFormatter={(v: number) => `${fmtNumber(v, 1)} ${distancePref}`}
                    formatter={(v: number) => [`${Math.round(v)} ${speedPref}`, t('share.speedTooltipLabel', 'Speed')]}
                  />
                  <Line
                    {...AREA_DEFAULTS}
                    dataKey="speed"
                    stroke="#00f0ff"
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>
          </FadeIn>
        )}

        {/* No map data fallback */}
        {mapPoints.length <= 1 && elevationData.length === 0 && speedData.length === 0 && (
          <GlassPanel className="p-8">
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<MapPin className="h-8 w-8" />}
              message={t('share.noMapData', 'Route data is not available for this shared drive.')}
            />
          </GlassPanel>
        )}

        {/* Footer */}
        <FadeIn delay={0.25}>
          <div className="mt-8 pt-4 border-t border-[var(--border-subtle)] text-center text-[var(--text-muted)] text-xs space-y-1">
            <p>{t('share.footer', 'Shared via TeslaSync — Self-hosted Tesla Fleet Intelligence')}</p>
            <a
              href="https://github.com/ev-dev-labs/teslasync"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--theme-primary)]/60 hover:text-[var(--theme-primary)] transition-colors"
            >
              {t('share.learnMore', 'Learn more →')}
            </a>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
