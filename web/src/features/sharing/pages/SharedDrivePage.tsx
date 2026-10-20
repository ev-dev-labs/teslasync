import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { BUTTON_BASE, BUTTON_VARIANTS, Icon, Logo, Text } from '@/components/ui';
import { ChartCard, LayoutCard, PageHeader } from '@/components/layout';
import { DataSourceNotice, EmptyState, Skeleton } from '@/components/feedback';
import {
  ChartTooltip, chartGrid, axisTick,
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
  AREA_DEFAULTS,
} from '@/components/charts';
import {
  MapContainer, Polyline, CircleMarker, Popup,
  MapTileLayer,
  type LatLngExpression,
} from '@/components/maps';
import { useSharedDrive } from '@/api/hooks/useSharing';
import { FadeIn } from '@/components/motion';
import { PublicDriveBrief } from '../components/operationalbrief-public';

import {
  convertDistanceFromSI,
  convertSpeedFromSI,
  type DistanceUnitPref,
} from '@/lib/unitConversion';
import { normalizeSharedDriveData, isSharedSession } from '@/types/sharing';
import { SharedSessionReport } from './SharedSessionReport';
import { usePublicDisplayFormatting } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { cn } from '@/lib/cn';
import { chartTokens } from '@/lib/tokens';
import { isApiError } from '@/api/client';

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
    <main className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
      <div className="text-center space-y-4 max-w-md px-4">
        <div className="w-16 h-16 mx-auto rounded-full bg-[var(--surface-2)] flex items-center justify-center">
          <Icon icon={MapPin} size="xl" className="text-[var(--text-muted)]" />
        </div>
        <PageHeader title={t('share.unavailable.title', 'Share link unavailable')} />
        <Text as="p" variant="bodySm" color="secondary">
          {t('share.unavailable.description', 'This shared drive link has expired or been revoked.')}
        </Text>
        <a
          href="/"
          className={cn(BUTTON_BASE, BUTTON_VARIANTS.secondary, 'min-h-11 min-w-11 px-4 py-2')}
        >
          {t('share.unavailable.home', 'Go to TeslaSync')}
        </a>
      </div>
    </main>
  );
}

function SharedDriveLoading() {
  const { t } = useTranslation();

  return (
    <main className="min-h-screen bg-[var(--bg-primary)]">
      <div
        role="status"
        aria-busy="true"
        aria-label={t('share.loading', 'Loading shared drive report…')}
      >
        <div className="w-full min-w-0 px-4 py-4">
          <PageHeader title={t('share.header', 'Shared drive report')} icon={<Logo />} />
        </div>
        <Skeleton className="h-[50vh] rounded-none" />
        <div className="w-full min-w-0 space-y-6 px-4 py-8">
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
    </main>
  );
}

/* ------------------------------------------------------------------ */
/*  SharedDrivePage                                                   */
/* ------------------------------------------------------------------ */

// EXCEPTION: public share route is chrome-less so unauthenticated recipients see only the branded report.
export default function SharedDrivePage() {
  const { fmtNumber, unitPrefs, formatDistance, formatSpeed } = usePublicDisplayFormatting();
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation();
  const query = useSharedDrive(token ?? '');
  const { data: rawData, isLoading, error, dataUpdatedAt } = query;
  const [deniedVersions, setDeniedVersions] = useState(() => new Map<string, number>());
  // Public authorization failures invalidate disclosure, not just freshness.
  // Clearing an error or pausing a retry must never resurrect the denied cache.
  const tokenDenied = isApiError(error) && [401, 403, 404, 410].includes(error.status);
  const deniedVersion = deniedVersions.get(token ?? '');
  if (tokenDenied && (deniedVersion === undefined || dataUpdatedAt > deniedVersion)) {
    setDeniedVersions(previous => new Map(previous).set(token ?? '', dataUpdatedAt));
  }
  const revalidated = !error && query.isSuccess && dataUpdatedAt > (deniedVersion ?? Infinity);
  if (revalidated) {
    setDeniedVersions(previous => {
      const next = new Map(previous);
      next.delete(token ?? '');
      return next;
    });
  }
  const cacheDenied = deniedVersion !== undefined
    && !revalidated;
  const unavailable = !token || tokenDenied || cacheDenied;
  const hasReport = rawData != null;
  const initialLoading = !hasReport && isLoading && query.fetchStatus !== 'paused';
  // Never expose backend error text, token values, or authenticated diagnostics
  // on the public report. Shared feedback supplies localized recovery copy.
  const sourceNotice = (
    <DataSourceNotice sources={[{
      id: 'shared-report',
      label: t('share.header', 'Shared drive report'),
      query: { ...query, data: rawData ?? undefined, error: undefined, isError: Boolean(error) },
    }]} />
  );
  // One /s/:token route serves both link kinds: session payloads branch to
  // their own report before drive normalization (which would see no drive).
  const driveRaw = isSharedSession(rawData) ? undefined : rawData;
  const data = useMemo(() => normalizeSharedDriveData(driveRaw), [driveRaw]);
  const distancePref = unitPrefs.distance;
  const speedPref = unitPrefs.speed;
  const elevPref = elevationLabel(distancePref);
  const effPref = efficiencyUnit(distancePref);
  usePageTitle(
    unavailable
      ? t('share.unavailable.title', 'Share link unavailable')
      : initialLoading
      ? t('share.header', 'Shared drive report')
      : !data && !isSharedSession(rawData) && !error && query.fetchStatus !== 'paused'
        ? t('share.unavailable.title', 'Share link unavailable')
        : isSharedSession(rawData)
          ? t('share.sessionHeader', 'Shared charging report')
          : t('share.header', 'Shared drive report'),
  );
  const displayValue = (value: unknown, unit: string) =>
    typeof value === 'number' && Number.isFinite(value) ? `${fmtNumber(value)} ${unit}` : '—';

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
  const elevationExportData = useMemo(
    () => (data?.elevation_profile ?? []).map(p => ({ distance_m: p.distance_m, elevation_m: p.elevation_m })),
    [data?.elevation_profile],
  );
  const speedExportData = useMemo(
    () => (data?.speed_profile ?? []).map(p => ({ distance_m: p.distance_m, speed_mps: p.speed_mps })),
    [data?.speed_profile],
  );

  /* ---- Loading state ---- */
  if (unavailable) {
    return <ExpiredShareView />;
  }
  if (initialLoading) {
    return <SharedDriveLoading />;
  }

  if (!hasReport && (error || query.fetchStatus === 'paused')) {
    return (
      <main className="min-h-screen bg-[var(--bg-primary)]">
        <div className="w-full min-w-0 space-y-4 px-4 py-4">
          <PageHeader title={t('share.header', 'Shared drive report')} icon={<Logo />} />
          {sourceNotice}
        </div>
      </main>
    );
  }

  /* ---- Session share branch ---- */
  if (isSharedSession(rawData)) {
    return <main>{sourceNotice}<SharedSessionReport data={rawData} /></main>;
  }

  /* ---- Error / expired ---- */
  if (!data) {
    return <ExpiredShareView />;
  }

  const drive = data.drive;

  return (
    <main className="min-h-screen bg-[var(--bg-primary)]">
      <div className="w-full min-w-0 px-4 py-4">
        {sourceNotice}
        <PageHeader
          title={data.title}
          icon={<Logo />}
          metadataActions={<Text variant="caption">{t('share.header', 'Shared drive report')}</Text>}
          contextActions={
            <>
              <Text variant="caption">{drive.date}</Text>
              {drive.start_address && drive.end_address && (
                <Text variant="caption">{drive.start_address} → {drive.end_address}</Text>
              )}
            </>
          }
        />
        {data.description && (
          <Text as="p" variant="bodySm" color="secondary">{data.description}</Text>
        )}
      </div>

      {/* Hero map */}
      {mapPoints.length > 1 ? (
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
                pathOptions={{ color: chartTokens.series[0], weight: 2, opacity: 0.8 }}
              />
              {startPos && (
                <CircleMarker
                  center={startPos}
                  radius={6}
                  pathOptions={{ color: chartTokens.series[0], weight: 2, fill: false }}
                >
                  <Popup>
                    <Text variant="bodySm">{t('share.traceStart', 'Start of disclosed trace')}</Text>
                  </Popup>
                </CircleMarker>
              )}
              {endPos && (
                <CircleMarker
                  center={endPos}
                  radius={6}
                  pathOptions={{ color: chartTokens.series[0], weight: 2, fillColor: chartTokens.series[0], fillOpacity: 1 }}
                >
                  <Popup>
                    <Text variant="bodySm">{t('share.traceEnd', 'End of disclosed trace')}</Text>
                  </Popup>
                </CircleMarker>
              )}
            </MapContainer>
          </div>
          <div className="flex flex-wrap justify-between gap-2 bg-[var(--surface-1)] px-4 py-2">
            <Text variant="caption">{t('share.traceStart', 'Start of disclosed trace')} ○</Text>
            <Text variant="caption">{t('share.traceEnd', 'End of disclosed trace')} ●</Text>
          </div>
        </FadeIn>
      ) : (
        <div className="w-full min-w-0 px-4">
          <LayoutCard title={t('share.route', 'Route')}>
            <EmptyState /* no-action: public recipients cannot request private geometry */
              message={t('share.routeNotIncluded', 'The route was not included in this share.')}
            />
          </LayoutCard>
        </div>
      )}

      {/* Content */}
      <div className="w-full min-w-0 px-4 py-8 space-y-6">
        {/* Owner-shared measurements */}
        <FadeIn delay={0.05}>
          <PublicDriveBrief
            drive={drive}
            preferences={{ units: unitPrefs, currency: { kind: 'symbol', value: '' } }}
            formatDistance={formatDistance}
            formatSpeed={formatSpeed}
            fmtNumber={fmtNumber}
            formatEfficiency={raw => `${fmtNumber(toEfficiencyDisplay(raw * METERS_PER_KM, distancePref))} ${effPref}`}
            formatElevation={raw => `${fmtNumber(convertElevation(raw, distancePref))} ${elevPref}`}
          />
        </FadeIn>

        {/* Vehicle badge */}
        {data.vehicle && (
          <FadeIn delay={0.1}>
            <LayoutCard title={`Tesla ${data.vehicle.model}`}>
              <Text as="p" variant="caption">{data.vehicle.color}</Text>
            </LayoutCard>
          </FadeIn>
        )}

        {/* Elevation profile */}
        {elevationData.length > 0 ? (
          <FadeIn delay={0.15}>
            <ChartCard
              size="standard"
              toolbar
              exportable
              title={t('share.elevation', 'Elevation profile')}
              ariaLabel={t('share.elevationAria', 'Shared drive elevation profile area chart by distance')}
              data={elevationData}
              dataColumns={[
                { key: 'distance', label: t('share.distance', 'Distance'), format: value => displayValue(value, distancePref) },
                { key: 'elevation', label: t('share.elevTooltipLabel', 'Elevation'), format: value => displayValue(value, elevPref) },
              ]}
              exportData={elevationExportData}
              height={200}
            >
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={elevationData}>
                  <CartesianGrid {...chartGrid} />
                  <XAxis
                    dataKey="distance"
                    {...axisTick}
                    tickFormatter={(v: number) => `${fmtNumber(v)} ${distancePref}`}
                  />
                  <YAxis {...axisTick} tickFormatter={(v: number) => `${fmtNumber(Math.round(v) + 0, 0)} ${elevPref}`} />
                  <Tooltip
                    content={<ChartTooltip
                      labelFormatter={value => displayValue(value, distancePref)}
                      valueFormatter={value => displayValue(value, elevPref)}
                    />}
                  />
                  <Area
                    {...AREA_DEFAULTS}
                    dataKey="elevation"
                    name={t('share.elevTooltipLabel', 'Elevation')}
                    stroke={chartTokens.series[0]}
                    strokeWidth={2}
                    fill={chartTokens.series[0]}
                    fillOpacity={0.08}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </FadeIn>
        ) : (
          <LayoutCard title={t('share.elevation', 'Elevation profile')}>
            <EmptyState /* no-action: only owner-disclosed profile data may be shown */
              message={t('share.elevationNotIncluded', 'The elevation profile was not included in this share.')}
            />
          </LayoutCard>
        )}

        {/* Speed profile */}
        {speedData.length > 0 ? (
          <FadeIn delay={0.2}>
            <ChartCard
              size="standard"
              toolbar
              exportable
              title={t('share.speed', 'Speed profile')}
              ariaLabel={t('share.speedAria', 'Shared drive speed profile line chart by distance')}
              data={speedData}
              dataColumns={[
                { key: 'distance', label: t('share.distance', 'Distance'), format: value => displayValue(value, distancePref) },
                { key: 'speed', label: t('share.speedTooltipLabel', 'Speed'), format: value => displayValue(value, speedPref) },
              ]}
              exportData={speedExportData}
              height={200}
            >
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={speedData}>
                  <CartesianGrid {...chartGrid} />
                  <XAxis
                    dataKey="distance"
                    {...axisTick}
                    tickFormatter={(v: number) => `${fmtNumber(v)} ${distancePref}`}
                  />
                  <YAxis {...axisTick} tickFormatter={(v: number) => fmtNumber(Math.round(v) + 0, 0)} />
                  <Tooltip
                    content={<ChartTooltip
                      labelFormatter={value => displayValue(value, distancePref)}
                      valueFormatter={value => displayValue(value, speedPref)}
                    />}
                  />
                  <Line
                    {...AREA_DEFAULTS}
                    dataKey="speed"
                    name={t('share.speedTooltipLabel', 'Speed')}
                    stroke={chartTokens.series[0]}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </FadeIn>
        ) : (
          <LayoutCard title={t('share.speed', 'Speed profile')}>
            <EmptyState /* no-action: only owner-disclosed profile data may be shown */
              message={t('share.speedNotIncluded', 'The speed profile was not included in this share.')}
            />
          </LayoutCard>
        )}

        {/* Footer */}
        <FadeIn delay={0.25}>
          <div className="mt-8 pt-4 border-t border-[var(--border-subtle)] text-center space-y-1">
            <Text as="p" variant="caption">{t('share.footer', 'Shared via TeslaSync — self-hosted Tesla fleet intelligence')}</Text>
            <a
              href="https://github.com/ev-dev-labs/teslasync"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(BUTTON_BASE, BUTTON_VARIANTS.ghost, 'min-h-11 min-w-11 px-4 py-2')}
            >
              <Text variant="bodySm" color="secondary">{t('share.learnMore', 'Learn more →')}</Text>
            </a>
          </div>
        </FadeIn>
      </div>
    </main>
  );
}
