import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Route, Clock, Gauge, Battery, Zap, TrendingUp,
  MapPin, Navigation, Flag, Thermometer, BatteryCharging,
  Activity, ArrowUpRight, ArrowDownRight, Share2, Play,
} from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Button } from '@/components/ui/Button';
import {
  ChartContainer, ChartTooltip, ChartGradient,
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  ComposedChart, ReferenceLine, Legend,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { AnimatedNumber } from '@/components/data-display/AnimatedNumber';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FadeIn } from '@/components/motion/FadeIn';
import { StaggerContainer } from '@/components/motion/StaggerContainer';
import { StaggerItem } from '@/components/motion/StaggerItem';
import {
  MapContainer, Polyline, CircleMarker, Popup, useMap,
  MapTileLayer, MapInvalidator, MapLayerSwitcher,
  type MapStyle,
} from '@/components/maps';
import { useDrive } from '@/api/hooks/useDriving';
import { useVehicle } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDate, formatTime, formatDateTime } from '@/lib/dateFormat';
import { fmtNumber, fmtWithUnit, fmtInt, fmtPercent } from '@/lib/numberFormat';
import type { LatLngExpression } from 'leaflet';
import { latLngBounds } from 'leaflet';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function IconStatCard({ icon: Icon, color, value, label }: {
  icon: typeof Route; color: string; value: React.ReactNode; label: string;
}) {
  return (
    <GlassPanel className="p-4 text-center">
      <Icon className="h-4 w-4 mx-auto mb-1" style={{ color }} />
      <p className="text-lg font-bold text-[var(--text-primary)]">{value}</p>
      <p className="text-[10px] text-[var(--text-muted)]">{label}</p>
    </GlassPanel>
  );
}

function FitBounds({ trail }: { trail: LatLngExpression[] }) {
  const map = useMap();
  if (trail.length > 1) {
    const bounds = latLngBounds(
      trail.map((p) => (Array.isArray(p) ? [p[0] as number, p[1] as number] as [number, number] : [0, 0] as [number, number])),
    );
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
  } else if (trail.length === 1) {
    map.setView(trail[0] as [number, number], 15);
  }
  return null;
}

function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const LEGEND_STYLE = { fontSize: 10, color: '#9ca3af' } as const;

/* ------------------------------------------------------------------ */
/*  DriveDetailPage                                                   */
/* ------------------------------------------------------------------ */

export default function DriveDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  usePageTitle(t('driveDetail.title', 'Drive Detail'));

  const { data: drive, isLoading, error } = useDrive(id ?? '');
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark');
  const { data: vehicle } = useVehicle(String(drive?.vehicleId ?? ''));

  const {
    convertDistance, convertSpeed, convertTemp, convertEfficiency, convertPressure,
    distanceUnit, speedUnit, tempUnit, efficiencyUnit, pressureUnit, isMiles,
  } = useSettings();

  /* ---- Route data ---- */
  const routeSource = useMemo(() => {
    if (!drive) return [];
    const tele = drive.telemetry ?? [];
    const pos = drive.positions ?? [];
    if (tele.length > 0) {
      return tele
        .filter((tp) => tp.latitude != null && tp.longitude != null && (tp.latitude !== 0 || tp.longitude !== 0))
        .map((tp) => ({ lat: tp.latitude!, lng: tp.longitude!, speed: tp.speed ?? 0 }));
    }
    return pos
      .filter((p) => p.latitude !== 0 || p.longitude !== 0)
      .map((p) => ({ lat: p.latitude, lng: p.longitude, speed: p.speed ?? 0 }));
  }, [drive]);

  const trail: LatLngExpression[] = useMemo(() => routeSource.map((p) => [p.lat, p.lng]), [routeSource]);
  const startPos = trail[0] as [number, number] | undefined;
  const endPos = trail.length > 1 ? (trail[trail.length - 1] as [number, number]) : undefined;
  const centerPos: [number, number] = startPos
    ?? (drive?.startLatitude && drive?.startLongitude ? [drive.startLatitude, drive.startLongitude] : [47.6, -122.3]);

  /* Speed-colored segments */
  const speedSegments = useMemo(() => {
    const segs: { positions: LatLngExpression[]; color: string }[] = [];
    for (let i = 1; i < routeSource.length; i++) {
      const prev = routeSource[i - 1];
      const curr = routeSource[i];
      let color = '#10b981';
      if (curr.speed >= 100) color = '#ef4444';
      else if (curr.speed >= 60) color = '#f59e0b';
      else if (curr.speed >= 30) color = '#00f0ff';
      segs.push({ positions: [[prev.lat, prev.lng], [curr.lat, curr.lng]], color });
    }
    return segs;
  }, [routeSource]);

  /* ---- Chart data ---- */
  const chartData = useMemo(() => {
    if (!drive) return [];
    const tele = drive.telemetry ?? [];
    if (tele.length > 0) {
      return tele.map((tp) => ({
        time: new Date(tp.createdAt ?? tp.created_at ?? tp.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        speed: convertSpeed(tp.speed ?? 0),
        battery: tp.batteryLevel ?? 0,
        elevation: tp.elevation ?? 0,
        power: tp.power ?? 0,
        outsideTemp: tp.outsideTemp != null ? convertTemp(tp.outsideTemp) : null,
        insideTemp: tp.insideTemp != null ? convertTemp(tp.insideTemp) : null,
        driverTemp: tp.driverTemp != null ? convertTemp(tp.driverTemp) : null,
        passengerTemp: tp.passengerTemp != null ? convertTemp(tp.passengerTemp) : null,
        idealRange: tp.idealRange != null ? convertDistance(tp.idealRange) : null,
        ratedRange: tp.ratedRange != null ? convertDistance(tp.ratedRange) : null,
        estRange: tp.estRange != null ? convertDistance(tp.estRange) : null,
        odometer: tp.odometer != null ? convertDistance(tp.odometer) : null,
        soc: tp.soc,
        usableSoc: tp.usableSoc,
        tireFl: tp.tirePressureFl != null ? convertPressure(tp.tirePressureFl) : null,
        tireFr: tp.tirePressureFr != null ? convertPressure(tp.tirePressureFr) : null,
        tireRl: tp.tirePressureRl != null ? convertPressure(tp.tirePressureRl) : null,
        tireRr: tp.tirePressureRr != null ? convertPressure(tp.tirePressureRr) : null,
        climateOn: tp.isClimateOn ?? null,
        fanStatus: tp.fanStatus ?? null,
      }));
    }
    return (drive.positions ?? []).map((p: any) => ({
      time: new Date(p.createdAt ?? p.created_at ?? p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      speed: convertSpeed(p.speed ?? 0),
      battery: p.batteryLevel ?? p.battery_level ?? 0,
      elevation: p.elevation ?? 0,
      power: p.power ?? 0,
      outsideTemp: (p.outsideTemp ?? p.outside_temp) != null ? convertTemp(p.outsideTemp ?? p.outside_temp) : null,
      insideTemp: (p.insideTemp ?? p.inside_temp) != null ? convertTemp(p.insideTemp ?? p.inside_temp) : null,
      driverTemp: null as number | null,
      passengerTemp: null as number | null,
      idealRange: (p.idealRange ?? p.ideal_range) != null ? convertDistance(p.idealRange ?? p.ideal_range) : null,
      ratedRange: (p.ratedRange ?? p.rated_range) != null ? convertDistance(p.ratedRange ?? p.rated_range) : null,
      estRange: null as number | null,
      odometer: p.odometer != null ? convertDistance(p.odometer) : null,
      soc: null as number | null,
      usableSoc: null as number | null,
      tireFl: null as number | null,
      tireFr: null as number | null,
      tireRl: null as number | null,
      tireRr: null as number | null,
      climateOn: p.isClimateOn ?? null,
      fanStatus: p.fanStatus ?? null,
    }));
  }, [drive, convertSpeed, convertTemp, convertDistance, convertPressure]);

  /* ---- Computed stats ---- */
  const stats = useMemo(() => {
    if (!drive) return null;
    const maxSpd = drive.speedMax != null ? convertSpeed(drive.speedMax) : 0;
    const avgSpd = drive.speedAvg != null ? convertSpeed(drive.speedAvg) : 0;
    const minSpd = drive.speedMin != null ? convertSpeed(drive.speedMin) : 0;
    const powerMax = drive.powerMax ?? 0;
    const powerMin = drive.powerMin ?? 0;
    const avgPower = chartData.length > 0
      ? chartData.reduce((s, d) => s + d.power, 0) / chartData.length
      : (powerMax + powerMin) / 2;
    const durationH = (drive.durationMin ?? 0) / 60;
    const energyWh = Math.abs(avgPower) * durationH * 1000;
    const regenWh = chartData.length > 0
      ? chartData.filter((d) => d.power < 0).reduce((s, d) => s + Math.abs(d.power), 0) * (durationH / chartData.length) * 1000
      : 0;
    const consumptionWhKm = drive.distance > 0 ? energyWh / drive.distance : 0;
    const elevGain = drive.elevationGain ?? chartData.reduce((sum, d, i) => {
      if (i === 0) return 0;
      const diff = d.elevation - chartData[i - 1].elevation;
      return diff > 0 ? sum + diff : sum;
    }, 0);
    const elevLoss = drive.elevationLoss ?? chartData.reduce((sum, d, i) => {
      if (i === 0) return 0;
      const diff = d.elevation - chartData[i - 1].elevation;
      return diff < 0 ? sum + Math.abs(diff) : sum;
    }, 0);

    const outsideTemps = chartData.filter((d) => d.outsideTemp !== null).map((d) => d.outsideTemp!);
    const insideTemps = chartData.filter((d) => d.insideTemp !== null).map((d) => d.insideTemp!);
    const driverTemps = chartData.filter((d) => d.driverTemp !== null).map((d) => d.driverTemp!);
    const passengerTemps = chartData.filter((d) => d.passengerTemp !== null).map((d) => d.passengerTemp!);
    const avgOutsideTemp = outsideTemps.length > 0 ? outsideTemps.reduce((a, b) => a + b, 0) / outsideTemps.length : null;
    const avgInsideTemp = insideTemps.length > 0 ? insideTemps.reduce((a, b) => a + b, 0) / insideTemps.length : null;
    const hasAnyTemp = outsideTemps.length > 0 || insideTemps.length > 0 || driverTemps.length > 0 || passengerTemps.length > 0;

    const climateOnCount = chartData.filter((d) => d.climateOn === true).length;
    const climateOffCount = chartData.filter((d) => d.climateOn === false).length;
    const climateStatus = climateOnCount > 0 ? (climateOnCount >= climateOffCount ? 'On' : 'Mostly Off') : (climateOffCount > 0 ? 'Off' : null);
    const fanValues = chartData.map((d) => d.fanStatus).filter((v): v is number => v != null);
    const avgFanSpeed = fanValues.length > 0 ? fanValues.reduce((a, b) => a + b, 0) / fanValues.length : null;
    const maxFanSpeed = fanValues.length > 0 ? Math.max(...fanValues) : null;

    const startRange = chartData.length > 0 ? (chartData[0].idealRange ?? chartData[0].ratedRange) : null;
    const endRange = chartData.length > 0 ? (chartData[chartData.length - 1].idealRange ?? chartData[chartData.length - 1].ratedRange) : null;

    const odometerStart = drive.startOdometer != null ? convertDistance(drive.startOdometer) : (chartData.length > 0 ? (chartData[0].odometer ?? 0) : 0);
    const odometerEnd = drive.endOdometer != null ? convertDistance(drive.endOdometer) : (chartData.length > 0 ? (chartData[chartData.length - 1].odometer ?? 0) : 0);

    const hasTirePressure = chartData.some((d) => d.tireFl !== null || d.tireFr !== null || d.tireRl !== null || d.tireRr !== null);

    const efficiencyPctPer100 = drive.distance > 0 && drive.startBatteryLevel != null && drive.endBatteryLevel != null
      ? (drive.startBatteryLevel - drive.endBatteryLevel) / convertDistance(drive.distance) * 10
      : null;

    return {
      maxSpd, avgSpd, minSpd, powerMax, powerMin, avgPower,
      energyWh, regenWh, consumptionWhKm, elevGain, elevLoss,
      avgOutsideTemp, avgInsideTemp, hasAnyTemp,
      insideTemps, outsideTemps, driverTemps, passengerTemps,
      climateStatus, avgFanSpeed, maxFanSpeed,
      startRange, endRange, odometerStart, odometerEnd,
      hasTirePressure, efficiencyPctPer100,
    };
  }, [drive, chartData, convertSpeed, convertDistance]);

  /* ---- Speed histogram ---- */
  const speedHistData = useMemo(() => {
    if (chartData.length === 0) return [];
    const defs = [
      { min: 0, max: convertSpeed(20) },
      { min: convertSpeed(20), max: convertSpeed(40) },
      { min: convertSpeed(40), max: convertSpeed(60) },
      { min: convertSpeed(60), max: convertSpeed(80) },
      { min: convertSpeed(80), max: convertSpeed(100) },
      { min: convertSpeed(100), max: convertSpeed(120) },
      { min: convertSpeed(120), max: 9999 },
    ];
    const buckets = defs.map((d) => ({
      range: d.max >= 9999 ? `${fmtNumber(d.min)}+` : `${fmtNumber(d.min)}–${fmtNumber(d.max)}`,
      count: 0,
    }));
    chartData.forEach((d) => {
      const idx = defs.findIndex((def) => d.speed >= def.min && d.speed < def.max);
      if (idx >= 0) buckets[idx].count++;
    });
    return buckets
      .filter((b) => b.count > 0)
      .map((b) => ({ range: b.range, pct: chartData.length > 0 ? Math.round((b.count / chartData.length) * 100) : 0 }));
  }, [chartData, convertSpeed]);

  /* ---- Share handler ---- */
  const handleShare = () => {
    if (!drive || !stats) return;
    const text = `🚙 ${t('driveDetail.sharePrefix', 'Drove')} ${fmtNumber(convertDistance(drive.distance))} ${distanceUnit} ${t('driveDetail.shareIn', 'in')} ${formatDuration(drive.durationMin)}. ${t('driveDetail.shareBattery', 'Battery')}: ${drive.startBatteryLevel ?? '?'}% → ${drive.endBatteryLevel ?? '?'}%. ${t('driveDetail.shareMaxSpeed', 'Max speed')}: ${fmtInt(stats.maxSpd)} ${speedUnit}`;
    navigator.clipboard.writeText(text);
  };

  /* ---- Loading skeleton ---- */
  if (isLoading) {
    return (
      <div className="space-y-6 p-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="flex-1 space-y-2"><Skeleton className="h-7 w-48" /><Skeleton className="h-4 w-32" /></div>
        </div>
        <Skeleton className="h-36" />
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64 sm:h-80" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-72" /><Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  return (
    <PageContainer
      title={t('driveDetail.title', 'Drive Detail')}
      error={error as Error | null}
    >
      {drive && stats && (
        <>
          {/* Header with back nav */}
          <FadeIn>
            <div className="flex items-center gap-4">
              <Link to="/drives" className="rounded-xl p-2.5 text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-primary)] transition-all">
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div className="flex-1">
                <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] flex items-center gap-3">
                  <Route className="h-6 w-6 text-cyan-400" />
                  {drive.startAddress && drive.endAddress
                    ? <>{drive.startAddress} → {drive.endAddress}</>
                    : t('driveDetail.title', 'Drive Details')}
                </h1>
                <p className="text-sm text-[var(--text-muted)] mt-0.5">
                  {vehicle?.display_name || t('driveDetail.vehicle', 'Vehicle')} · {formatDate(drive.startDate)} · {formatTime(drive.startDate)}
                  {drive.endDate && ` → ${formatTime(drive.endDate)}`}
                </p>
              </div>
              <Link to={`/drives/${id}/replay`}>
                <Button variant="ghost" size="sm" icon={<Play className="h-4 w-4" />}>
                  {t('driveDetail.replay', 'Replay')}
                </Button>
              </Link>
              <Button variant="ghost" size="sm" onClick={handleShare} icon={<Share2 className="h-4 w-4" />}>
                {t('driveDetail.share', 'Share')}
              </Button>
            </div>
          </FadeIn>

          {/* Hero Gauges */}
          <FadeIn>
            <GlassPanel className="p-6 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/[0.02] to-purple-500/[0.02]" />
              <div className="relative flex flex-wrap items-center gap-6 lg:gap-10 justify-center">
                <RadialGauge
                  value={Math.round(convertDistance(drive.distance))}
                  max={Math.max(convertDistance(drive.distance) * 1.5, 100)}
                  label={t('driveDetail.distance', 'Distance')}
                  unit={distanceUnit}
                  color="#00f0ff"
                  size={110}
                />
                <RadialGauge
                  value={Math.round(stats.maxSpd)}
                  max={convertSpeed(250)}
                  label={t('driveDetail.maxSpeed', 'Max Speed')}
                  unit={speedUnit}
                  color="#a855f7"
                  size={110}
                />
                <RadialGauge
                  value={Math.round(drive.durationMin ?? 0)}
                  max={Math.max((drive.durationMin ?? 0) * 1.5, 60)}
                  label={t('driveDetail.duration', 'Duration')}
                  unit="min"
                  color="#f59e0b"
                  size={110}
                />
                <RadialGauge
                  value={Math.round(convertEfficiency(stats.consumptionWhKm))}
                  max={Math.max(convertEfficiency(stats.consumptionWhKm) * 1.5, 300)}
                  label={t('driveDetail.consumption', 'Consumption')}
                  unit={efficiencyUnit}
                  color="#ef4444"
                  size={110}
                />
                {stats.efficiencyPctPer100 != null && (
                  <RadialGauge
                    value={Number(fmtNumber(stats.efficiencyPctPer100))}
                    max={30}
                    label={t('driveDetail.efficiency', 'Efficiency')}
                    unit={isMiles ? '%/100mi' : '%/100km'}
                    color="#10b981"
                    size={110}
                  />
                )}
              </div>
            </GlassPanel>
          </FadeIn>

          {/* Drive Timeline Bar */}
          <FadeIn>
            <GlassPanel className="p-4">
              <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] mb-2">
                <span className="flex items-center gap-1 text-green-400">
                  <Flag className="h-3 w-3" />{formatTime(drive.startDate)}
                </span>
                <span className="text-[var(--text-muted)]">{formatDuration(drive.durationMin)}</span>
                <span className="flex items-center gap-1 text-red-400">
                  <Flag className="h-3 w-3" />{drive.endDate ? formatTime(drive.endDate) : t('driveDetail.inProgress', 'In progress')}
                </span>
              </div>
              <div className="h-3 rounded-full overflow-hidden bg-[var(--surface-2)]">
                <div className="h-full w-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400" />
              </div>
            </GlassPanel>
          </FadeIn>

          {/* Stat Cards */}
          <StaggerContainer className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            <StaggerItem><IconStatCard icon={Route} color="#00f0ff" value={<AnimatedNumber value={convertDistance(drive.distance)} decimals={1} suffix={` ${distanceUnit}`} />} label={t('driveDetail.distance', 'Distance')} /></StaggerItem>
            <StaggerItem><IconStatCard icon={Clock} color="#f59e0b" value={formatDuration(drive.durationMin)} label={t('driveDetail.duration', 'Duration')} /></StaggerItem>
            <StaggerItem><IconStatCard icon={Gauge} color="#a855f7" value={<AnimatedNumber value={stats.maxSpd} suffix={` ${speedUnit}`} />} label={t('driveDetail.maxSpeed', 'Max Speed')} /></StaggerItem>
            <StaggerItem><IconStatCard icon={TrendingUp} color="#10b981" value={<AnimatedNumber value={stats.avgSpd} suffix={` ${speedUnit}`} />} label={t('driveDetail.avgSpeed', 'Avg Speed')} /></StaggerItem>
            <StaggerItem><IconStatCard icon={Battery} color="#10b981" value={`${fmtInt(drive.socStart ?? drive.startBatteryLevel)}% → ${fmtInt(drive.socEnd ?? drive.endBatteryLevel)}%`} label={t('driveDetail.soc', 'SOC')} /></StaggerItem>
            <StaggerItem><IconStatCard icon={Zap} color="#f59e0b" value={fmtWithUnit(stats.powerMax, 'kW')} label={t('driveDetail.maxPower', 'Max Power')} /></StaggerItem>
            <StaggerItem><IconStatCard icon={Navigation} color="#10b981" value={<AnimatedNumber value={Math.round(stats.elevGain)} suffix=" m ↑" />} label={t('driveDetail.elevGain', 'Elev. Gain')} /></StaggerItem>
            <StaggerItem><IconStatCard icon={Navigation} color="#ef4444" value={<AnimatedNumber value={Math.round(stats.elevLoss)} suffix=" m ↓" />} label={t('driveDetail.elevLoss', 'Elev. Loss')} /></StaggerItem>
          </StaggerContainer>

          {/* Battery Heater Status */}
          {drive.batteryHeaterOn != null && (
            <FadeIn>
              <GlassPanel className="p-3">
                <div className="flex items-center justify-center gap-2 text-xs">
                  <BatteryCharging className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-[var(--text-secondary)]">{t('driveDetail.batteryHeater', 'Battery Heater')}:</span>
                  <span className={drive.batteryHeaterOn ? 'text-amber-400 font-medium' : 'text-[var(--text-muted)]'}>
                    {drive.batteryHeaterOn ? t('driveDetail.active', 'Active') : t('driveDetail.off', 'Off')}
                  </span>
                </div>
              </GlassPanel>
            </FadeIn>
          )}

          {/* More Details */}
          <FadeIn>
            <GlassPanel className="p-5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
                <Activity className="h-4 w-4 text-cyan-400" /> {t('driveDetail.moreDetails', 'More Details')}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
                <div className="text-center">
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.odometer', 'Odometer (From → To)')}</p>
                  <p className="text-lg font-bold text-cyan-400">
                    {drive.startOdometer && drive.endOdometer
                      ? `${fmtNumber(convertDistance(drive.startOdometer))} → ${fmtNumber(convertDistance(drive.endOdometer))}`
                      : '—'}{' '}
                    <span className="text-xs text-[var(--text-muted)]">{distanceUnit}</span>
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">
                    {t('driveDetail.rangeStartEnd', 'Range (Start → End)')}
                  </p>
                  <p className="text-lg font-bold text-green-400">
                    {stats.startRange != null
                      ? `${fmtNumber(stats.startRange)} → ${stats.endRange != null ? fmtNumber(stats.endRange) : '?'}`
                      : '—'}{' '}
                    <span className="text-xs text-[var(--text-muted)]">{distanceUnit}</span>
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.elevSummary', 'Elevation Summary')}</p>
                  <div className="text-base font-bold">
                    <span className="text-green-400 flex items-center justify-center gap-1"><ArrowUpRight className="h-3 w-3" />{fmtNumber(stats.elevGain)} m</span>
                    <span className="text-red-400 flex items-center justify-center gap-1"><ArrowDownRight className="h-3 w-3" />{fmtNumber(stats.elevLoss)} m</span>
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.energyConsumed', 'Energy Consumed')}</p>
                  <p className="text-lg font-bold text-amber-400">
                    {stats.energyWh > 1000 ? fmtWithUnit(stats.energyWh / 1000, 'kWh') : `${fmtNumber(stats.energyWh)} Wh`}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.energyRecovered', 'Energy Recovered')}</p>
                  <p className="text-lg font-bold text-green-400">
                    {stats.regenWh > 1000 ? fmtWithUnit(stats.regenWh / 1000, 'kWh') : `${fmtNumber(stats.regenWh)} Wh`}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.consumptionRate', 'Consumption')}</p>
                  <p className="text-lg font-bold text-purple-400">
                    {stats.consumptionWhKm > 0 ? `${fmtNumber(convertEfficiency(stats.consumptionWhKm))}` : '—'}{' '}
                    <span className="text-xs text-[var(--text-muted)]">{efficiencyUnit}</span>
                  </p>
                </div>

              </div>
              <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="text-center">
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.avgPower', 'Avg Power')}</p>
                  <p className="text-lg font-bold text-amber-400">{fmtNumber(stats.avgPower)} <span className="text-xs text-[var(--text-muted)]">kW</span></p>
                </div>
                {stats.avgOutsideTemp !== null && (
                  <div className="text-center">
                    <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.avgOutsideTemp', 'Avg Outside Temp')}</p>
                    <p className="text-lg font-bold text-blue-400">{fmtNumber(stats.avgOutsideTemp)}{tempUnit}</p>
                  </div>
                )}
                {stats.avgInsideTemp !== null && (
                  <div className="text-center">
                    <p className="text-[10px] text-[var(--text-muted)] mb-1">
                      {t('driveDetail.avgInsideTemp', 'Avg Inside Temp')}
                    </p>
                    <p className="text-lg font-bold text-orange-400">
                      {fmtNumber(stats.avgInsideTemp)}{tempUnit}
                    </p>
                  </div>
                )}
                <div className="text-center">
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.minSpeed', 'Min Speed')}</p>
                  <p className="text-lg font-bold text-[var(--text-secondary)]">{fmtInt(stats.minSpd)} {speedUnit}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.batteryUsed', 'Battery Used')}</p>
                  <p className="text-lg font-bold text-amber-400">
                    {drive.startBatteryLevel != null && drive.endBatteryLevel != null
                      ? `${drive.startBatteryLevel - drive.endBatteryLevel}%`
                      : '—'}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.netEnergy', 'Net Consumption')}</p>
                  <p className="text-lg font-bold text-cyan-400">
                    {(stats.energyWh - stats.regenWh) > 1000
                      ? fmtWithUnit((stats.energyWh - stats.regenWh) / 1000, 'kWh')
                      : `${fmtNumber(stats.energyWh - stats.regenWh)} Wh`}
                  </p>
                </div>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* Energy Summary */}
          <FadeIn>
            <GlassPanel className="p-5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
                <BatteryCharging className="h-4 w-4 text-green-400" /> {t('driveDetail.energySummary', 'Energy Summary')}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-center">
                <div>
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.energyConsumed', 'Energy Consumed')}</p>
                  <p className="text-lg font-bold text-amber-400">{stats.energyWh > 1000 ? fmtWithUnit(stats.energyWh / 1000, 'kWh') : `${fmtNumber(stats.energyWh)} Wh`}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.energyRecovered', 'Energy Recovered')}</p>
                  <p className="text-lg font-bold text-green-400">{stats.regenWh > 1000 ? fmtWithUnit(stats.regenWh / 1000, 'kWh') : `${fmtNumber(stats.regenWh)} Wh`}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.netConsumption', 'Net Consumption')}</p>
                  <p className="text-lg font-bold text-cyan-400">{(stats.energyWh - stats.regenWh) > 1000 ? fmtWithUnit((stats.energyWh - stats.regenWh) / 1000, 'kWh') : `${fmtNumber(stats.energyWh - stats.regenWh)} Wh`}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.efficiency', 'Efficiency')}</p>
                  <p className="text-lg font-bold text-purple-400">{stats.consumptionWhKm > 0 ? `${fmtNumber(convertEfficiency(stats.consumptionWhKm))} ${efficiencyUnit}` : '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.batteryUsed', 'Battery Used')}</p>
                  <p className="text-lg font-bold text-amber-400">
                    {drive.startBatteryLevel != null && drive.endBatteryLevel != null ? `${drive.startBatteryLevel - drive.endBatteryLevel}%` : '—'}
                    <span className="text-xs text-[var(--text-muted)] ml-1">{drive.startBatteryLevel ?? '?'}% → {drive.endBatteryLevel ?? '?'}%</span>
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.rangeUsed', 'Range Used')}</p>
                  <p className="text-lg font-bold text-green-400">
                    {drive.startRangeKm != null && drive.endRangeKm != null
                      ? `${fmtNumber(convertDistance(drive.startRangeKm - drive.endRangeKm))} ${distanceUnit}`
                      : '—'}
                  </p>
                </div>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* Route Map */}
          <FadeIn>
            <GlassPanel className="overflow-hidden">
              <div className="p-4 pb-0">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-3">
                  <MapPin className="h-4 w-4 text-cyan-400" /> {t('driveDetail.route', 'Route')}
                </h3>
              </div>
              {trail.length > 0 ? (
                <>
                  <div className="h-64 sm:h-80 lg:h-96 relative">
                    <MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />
                    <MapContainer center={centerPos} zoom={trail.length > 1 ? 13 : 3} scrollWheelZoom className="h-full w-full">
                      <MapTileLayer style={mapStyle} />
                      <MapInvalidator />
                      <FitBounds trail={trail} />
                      {speedSegments.map((seg, i) => (
                        <Polyline key={i} positions={seg.positions} pathOptions={{ color: seg.color, weight: 4, opacity: 0.8 }} />
                      ))}
                      {startPos && (
                        <CircleMarker center={startPos} radius={8} pathOptions={{ color: '#10b981', fillColor: '#10b981', fillOpacity: 1, weight: 2 }}>
                          <Popup><span className="text-xs font-bold">{t('driveDetail.start', 'Start')}</span><br /><span className="text-xs">{formatDateTime(drive.startDate)}</span></Popup>
                        </CircleMarker>
                      )}
                      {endPos && (
                        <CircleMarker center={endPos} radius={8} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1, weight: 2 }}>
                          <Popup><span className="text-xs font-bold">{t('driveDetail.end', 'End')}</span><br /><span className="text-xs">{drive.endDate ? formatDateTime(drive.endDate) : t('driveDetail.inProgress', 'In progress')}</span></Popup>
                        </CircleMarker>
                      )}
                    </MapContainer>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3 text-xs">
                    <span className="flex items-center gap-1.5 text-green-400"><Flag className="h-3 w-3" /> {t('driveDetail.start', 'Start')}: {formatTime(drive.startDate)}</span>
                    {trail.length > 1 && (
                      <div className="flex items-center gap-3 text-[var(--text-muted)]">
                        <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded bg-emerald-500" /> &lt;{fmtNumber(convertSpeed(30))}</span>
                        <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded bg-cyan-400" /> {fmtNumber(convertSpeed(30))}–{fmtNumber(convertSpeed(60))}</span>
                        <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded bg-amber-500" /> {fmtNumber(convertSpeed(60))}–{fmtNumber(convertSpeed(100))}</span>
                        <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded bg-red-500" /> &gt;{fmtNumber(convertSpeed(100))}</span>
                        <span>{speedUnit}</span>
                      </div>
                    )}
                    {drive.endDate && (
                      <span className="flex items-center gap-1.5 text-red-400"><Flag className="h-3 w-3" /> {t('driveDetail.end', 'End')}: {formatTime(drive.endDate)}</span>
                    )}
                  </div>
                </>
              ) : (
                <div className="h-64 sm:h-80 flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
                  <MapPin className="h-10 w-10 opacity-30" />
                  <p className="text-sm">{t('driveDetail.noRouteData', 'No route data available for this drive')}</p>
                </div>
              )}
            </GlassPanel>
          </FadeIn>

          {/* Journey Details */}
          <FadeIn>
            <GlassPanel className="p-5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
                <Navigation className="h-4 w-4 text-cyan-400" /> {t('driveDetail.journeyDetails', 'Journey Details')}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center gap-2 text-green-400 mb-1">
                    <MapPin className="h-4 w-4" /> {t('driveDetail.start', 'Start')}
                  </div>
                  <p className="font-bold text-[var(--text-primary)] text-sm">
                    {drive.startAddress
                      ? drive.startAddress
                      : drive.startLatitude && drive.startLongitude
                        ? <span className="font-mono">{fmtNumber(drive.startLatitude)}°{drive.startLatitude >= 0 ? 'N' : 'S'}, {fmtNumber(Math.abs(drive.startLongitude))}°{drive.startLongitude >= 0 ? 'E' : 'W'}</span>
                        : t('driveDetail.noAddress', 'No address data')}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">{formatDateTime(drive.startDate)}</p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {t('driveDetail.battery', 'Battery')}: {drive.startBatteryLevel ?? '?'}%
                    {drive.startRangeKm != null && (
                      <> · {t('driveDetail.range', 'Range')}: {fmtNumber(convertDistance(drive.startRangeKm))} {distanceUnit}</>
                    )}
                  </p>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-red-400 mb-1">
                    <Flag className="h-4 w-4" /> {t('driveDetail.destination', 'Destination')}
                  </div>
                  <p className="font-bold text-[var(--text-primary)] text-sm">
                    {drive.endAddress
                      ? drive.endAddress
                      : drive.endLatitude && drive.endLongitude
                        ? <span className="font-mono">{fmtNumber(drive.endLatitude)}°{drive.endLatitude >= 0 ? 'N' : 'S'}, {fmtNumber(Math.abs(drive.endLongitude))}°{drive.endLongitude >= 0 ? 'E' : 'W'}</span>
                        : drive.endDate ? t('driveDetail.noAddress', 'No address data') : t('driveDetail.inProgress', 'In progress')}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">{drive.endDate ? formatDateTime(drive.endDate) : t('driveDetail.inProgress', 'In progress')}</p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {t('driveDetail.battery', 'Battery')}: {drive.endBatteryLevel ?? '?'}%
                    {drive.endRangeKm != null && (
                      <> · {t('driveDetail.range', 'Range')}: {fmtNumber(convertDistance(drive.endRangeKm))} {distanceUnit}</>
                    )}
                  </p>
                </div>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* === Charts === */}
              {/* Comprehensive drive chart */}
              <FadeIn>
                <ChartContainer title={t('driveDetail.driveChart', 'Drive Overview')} height={320}>
                  {chartData.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                      <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} interval="preserveStartEnd" />
                      <YAxis yAxisId="power" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} unit=" kW" />
                      <YAxis yAxisId="speed" hide />
                      <Tooltip content={<ChartTooltip />} />
                      <ReferenceLine yAxisId="power" y={0} stroke="rgba(255,255,255,0.1)" />
                      <Area yAxisId="speed" type="monotone" dataKey="speed" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.08} strokeWidth={1.5} name={`${t('driveDetail.speed', 'Speed')} (${speedUnit})`} />
                      {chartData.some((d) => d.idealRange !== null) && (
                        <Line yAxisId="speed" type="monotone" dataKey="idealRange" stroke="#c084fc" strokeWidth={1} dot={false} name={`${t('driveDetail.rangeIdeal', 'Range ideal')} (${distanceUnit})`} strokeDasharray="4 2" />
                      )}
                      {chartData.some((d) => d.estRange !== null || d.ratedRange !== null) && (
                        <Line yAxisId="speed" type="monotone" dataKey={chartData.some((d) => d.estRange !== null) ? 'estRange' : 'ratedRange'} stroke="#a855f7" strokeWidth={1} dot={false} name={`${t('driveDetail.rangeEst', 'Range est.')} (${distanceUnit})`} strokeDasharray="4 2" />
                      )}
                      <Line yAxisId="speed" type="monotone" dataKey="battery" stroke="#84cc16" strokeWidth={1.5} dot={false} name={`${t('driveDetail.soc', 'SOC')} %`} />
                      {chartData.some((d) => d.usableSoc !== null) && (
                        <Line yAxisId="speed" type="monotone" dataKey="usableSoc" stroke="#22d3ee" strokeWidth={1} dot={false} name={`${t('driveDetail.usableSoc', 'Usable SOC')} %`} />
                      )}
                      <Line yAxisId="power" type="monotone" dataKey="power" stroke="#f59e0b" strokeWidth={2} dot={false} name={`${t('driveDetail.power', 'Power')} kW`} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
                      <Activity className="h-8 w-8 opacity-20" />
                      <p className="text-xs">{t('driveDetail.noChartData', 'No telemetry data available')}</p>
                    </div>
                  )}
                </ChartContainer>
                {/* Rich legend with Mean/Max/Min stats */}
                {chartData.length > 1 && (() => {
                  const statFn = (vals: (number | null)[]) => {
                    const v = vals.filter((x): x is number => x != null);
                    if (v.length === 0) return null;
                    return { mean: v.reduce((a, b) => a + b, 0) / v.length, max: Math.max(...v), min: Math.min(...v) };
                  };
                  const speedS = statFn(chartData.map((d) => d.speed));
                  const idealRangeS = statFn(chartData.map((d) => d.idealRange));
                  const estRangeS = statFn(chartData.map((d) => d.estRange ?? d.ratedRange));
                  const powerS = statFn(chartData.map((d) => d.power));
                  const socS = statFn(chartData.map((d) => d.battery > 0 ? d.battery : null));
                  const usableSocS = statFn(chartData.map((d) => d.usableSoc));
                  type LegendItem = { color: string; dash?: boolean; label: string; mean: string; max: string; min: string };
                  const items: LegendItem[] = [];
                  if (speedS) items.push({ color: '#3b82f6', label: t('driveDetail.speed', 'Speed'), mean: `${fmtNumber(speedS.mean)} ${speedUnit}`, max: `${fmtNumber(speedS.max)} ${speedUnit}`, min: `${fmtInt(speedS.min)} ${speedUnit}` });
                  if (idealRangeS) items.push({ color: '#c084fc', dash: true, label: t('driveDetail.rangeIdeal', 'Range (ideal)'), mean: `${fmtInt(idealRangeS.mean)} ${distanceUnit}`, max: `${fmtInt(idealRangeS.max)} ${distanceUnit}`, min: `${fmtInt(idealRangeS.min)} ${distanceUnit}` });
                  if (estRangeS) items.push({ color: '#a855f7', dash: true, label: t('driveDetail.rangeEst', 'Range (est.)'), mean: `${fmtInt(estRangeS.mean)} ${distanceUnit}`, max: `${fmtInt(estRangeS.max)} ${distanceUnit}`, min: `${fmtInt(estRangeS.min)} ${distanceUnit}` });
                  if (socS) items.push({ color: '#84cc16', label: t('driveDetail.soc', 'SOC'), mean: fmtPercent(socS.mean), max: fmtPercent(socS.max), min: fmtPercent(socS.min) });
                  if (usableSocS) items.push({ color: '#22d3ee', label: t('driveDetail.usableSoc', 'Usable SOC'), mean: fmtPercent(usableSocS.mean), max: fmtPercent(usableSocS.max), min: fmtPercent(usableSocS.min) });
                  if (powerS) items.push({ color: '#f59e0b', label: t('driveDetail.power', 'Power'), mean: fmtWithUnit(powerS.mean, 'kW'), max: fmtWithUnit(powerS.max, 'kW'), min: fmtWithUnit(powerS.min, 'kW') });
                  if (drive.batteryHeaterOn != null) items.push({ color: '#ef4444', dash: true, label: t('driveDetail.batteryHeater', 'Battery Heater'), mean: drive.batteryHeaterOn ? 'On' : 'Off', max: drive.batteryHeaterOn ? 'On' : 'Off', min: drive.batteryHeaterOn ? 'On' : 'Off' });
                  return items.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[10px] leading-tight">
                      {items.map((item) => (
                        <span key={item.label} className="flex items-center gap-1.5 whitespace-nowrap">
                          <span className="inline-block w-4 border-t-2" style={{ borderColor: item.color, borderStyle: item.dash ? 'dashed' : 'solid' }} />
                          <strong style={{ color: item.color }}>{item.label}</strong>
                          <span className="text-[var(--text-muted)]">Mean: {item.mean}</span>
                          <span className="text-[var(--text-muted)]">Max: {item.max}</span>
                          <span className="text-[var(--text-muted)]">Min: {item.min}</span>
                        </span>
                      ))}
                    </div>
                  ) : null;
                })()}
              </FadeIn>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* SOC over time */}
                <FadeIn>
                  <ChartContainer title={t('driveDetail.socOverTime', 'SOC % Over Time')} height={220}>
                    {chartData.length > 1 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                        <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                        <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                        <Tooltip content={<ChartTooltip />} />
                        <defs><ChartGradient id="socGrad" color="#10b981" /></defs>
                        <Area type="monotone" dataKey="battery" stroke="#10b981" fill="url(#socGrad)" strokeWidth={2} name={`${t('driveDetail.soc', 'SOC')} %`} />
                      </AreaChart>
                    </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
                        <Activity className="h-8 w-8 opacity-20" />
                        <p className="text-xs">{t('driveDetail.noChartData', 'No telemetry data available')}</p>
                      </div>
                    )}
                  </ChartContainer>
                </FadeIn>

                {/* Elevation profile */}
                <FadeIn>
                  <ChartContainer title={t('driveDetail.elevProfile', 'Elevation Profile')} height={220}>
                    {chartData.length > 1 ? (
                    <>
                    <div className="flex items-center gap-4 mb-2 text-xs">
                      <span className="flex items-center gap-1 text-green-400"><ArrowUpRight className="h-3 w-3" />{fmtNumber(stats.elevGain)} m {t('driveDetail.gain', 'gain')}</span>
                      <span className="flex items-center gap-1 text-red-400"><ArrowDownRight className="h-3 w-3" />{fmtNumber(stats.elevLoss)} m {t('driveDetail.loss', 'loss')}</span>
                      <span className="text-[var(--text-muted)]">{t('driveDetail.net', 'Net')}: {fmtNumber(stats.elevGain - stats.elevLoss)} m</span>
                    </div>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                        <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                        <YAxis yAxisId="elev" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                        <YAxis yAxisId="speed" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend wrapperStyle={LEGEND_STYLE} />
                        <Area yAxisId="elev" type="monotone" dataKey="elevation" stroke="#10b981" fill="#10b981" fillOpacity={0.2} strokeWidth={2} name={`${t('driveDetail.elevation', 'Elevation')} (m)`} />
                        <Line yAxisId="speed" type="monotone" dataKey="speed" stroke="#a855f7" strokeWidth={1.5} dot={false} name={`${t('driveDetail.speed', 'Speed')} (${speedUnit})`} strokeOpacity={0.6} />
                      </ComposedChart>
                    </ResponsiveContainer>
                    </>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
                        <Activity className="h-8 w-8 opacity-20" />
                        <p className="text-xs">{t('driveDetail.noChartData', 'No telemetry data available')}</p>
                      </div>
                    )}
                  </ChartContainer>
                </FadeIn>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Temperature chart */}
                <FadeIn>
                  <GlassPanel className="p-6">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
                      <Thermometer className="h-4 w-4 text-orange-400" /> {t('driveDetail.temperatures', 'Temperatures')}
                    </h3>
                    {stats.hasAnyTemp && (
                    <div className="grid grid-cols-3 gap-3 mb-4">
                        {stats.avgOutsideTemp != null && (
                          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                            <p className="text-[9px] text-[var(--text-muted)]">{t('driveDetail.outsideTemp', 'Outside Temperature')}</p>
                            <p className="text-sm font-bold text-blue-400">{fmtNumber(stats.avgOutsideTemp)}{tempUnit}</p>
                          </div>
                        )}
                        {stats.avgInsideTemp != null && (
                          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                            <p className="text-[9px] text-[var(--text-muted)]">{t('driveDetail.insideTemp', 'Inside Temperature')}</p>
                            <p className="text-sm font-bold text-orange-400">{fmtNumber(stats.avgInsideTemp)}{tempUnit}</p>
                          </div>
                        )}
                        {stats.driverTemps.length > 0 && (
                          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                            <p className="text-[9px] text-[var(--text-muted)]">{t('driveDetail.driverTemp', 'Driver Temperature')}</p>
                            <p className="text-sm font-bold text-rose-400">{fmtNumber(stats.driverTemps.reduce((a, b) => a + b, 0) / stats.driverTemps.length)}{tempUnit}</p>
                          </div>
                        )}
                        {stats.passengerTemps.length > 0 && (
                          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                            <p className="text-[9px] text-[var(--text-muted)]">{t('driveDetail.passengerTemp', 'Passenger Temperature')}</p>
                            <p className="text-sm font-bold text-purple-400">{fmtNumber(stats.passengerTemps.reduce((a, b) => a + b, 0) / stats.passengerTemps.length)}{tempUnit}</p>
                          </div>
                        )}
                        {stats.climateStatus != null && (
                          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                            <p className="text-[9px] text-[var(--text-muted)]">{t('driveDetail.climate', 'Climate')}</p>
                            <p className={`text-sm font-bold ${stats.climateStatus === 'On' ? 'text-green-400' : 'text-[var(--text-muted)]'}`}>{stats.climateStatus}</p>
                          </div>
                        )}
                        {stats.maxFanSpeed != null && (
                          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                            <p className="text-[9px] text-[var(--text-muted)]">{t('driveDetail.fanStatus', 'Fan Status')}</p>
                            <p className="text-sm font-bold text-cyan-400">{t('driveDetail.avg', 'Avg')} {fmtInt(stats.avgFanSpeed)} · Max {stats.maxFanSpeed}</p>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="h-56">
                      {chartData.length > 1 && stats.hasAnyTemp ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                            <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                            <Tooltip content={<ChartTooltip />} />
                            <Legend wrapperStyle={LEGEND_STYLE} />
                            {stats.outsideTemps.length > 0 && (
                              <Line type="monotone" dataKey="outsideTemp" stroke="#3b82f6" strokeWidth={2} dot={false} name={`${t('driveDetail.outside', 'Outside')} ${tempUnit}`} connectNulls />
                            )}
                            {stats.insideTemps.length > 0 && (
                              <Line type="monotone" dataKey="insideTemp" stroke="#f97316" strokeWidth={2} dot={false} name={`${t('driveDetail.inside', 'Inside')} ${tempUnit}`} connectNulls />
                            )}
                            {stats.driverTemps.length > 0 && (
                              <Line type="monotone" dataKey="driverTemp" stroke="#fb7185" strokeWidth={2} dot={false} name={`${t('driveDetail.driver', 'Driver')} ${tempUnit}`} connectNulls />
                            )}
                            {stats.passengerTemps.length > 0 && (
                              <Line type="monotone" dataKey="passengerTemp" stroke="#a855f7" strokeWidth={2} dot={false} name={`${t('driveDetail.passenger', 'Passenger')} ${tempUnit}`} connectNulls />
                            )}
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
                          <Activity className="h-8 w-8 opacity-20" />
                          <p className="text-xs">{t('driveDetail.noChartData', 'No telemetry data available')}</p>
                        </div>
                      )}
                    </div>
                  </GlassPanel>
                </FadeIn>

                {/* Speed histogram */}
                <FadeIn>
                  <ChartContainer title={t('driveDetail.speedHistogram', 'Speed Histogram')} height={220}>
                    {speedHistData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={speedHistData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                        <XAxis dataKey="range" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                        <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="pct" fill="#a855f7" name={`% ${t('driveDetail.ofDrive', 'of drive')}`} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
                        <Activity className="h-8 w-8 opacity-20" />
                        <p className="text-xs">{t('driveDetail.noChartData', 'No telemetry data available')}</p>
                      </div>
                    )}
                  </ChartContainer>
                </FadeIn>
              </div>

              {/* Power Profile */}
              <FadeIn>
                <ChartContainer title={t('driveDetail.powerProfile', 'Power Profile')} height={220}>
                  {chartData.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                      <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <Tooltip content={<ChartTooltip />} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                      <defs><ChartGradient id="powerGrad" color="#f59e0b" /></defs>
                      <Area type="monotone" dataKey="power" stroke="#f59e0b" fill="url(#powerGrad)" strokeWidth={2} name={`${t('driveDetail.power', 'Power')} kW`} />
                    </AreaChart>
                  </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
                      <Activity className="h-8 w-8 opacity-20" />
                      <p className="text-xs">{t('driveDetail.noChartData', 'No telemetry data available')}</p>
                    </div>
                  )}
                </ChartContainer>
                {chartData.length > 1 && (
                <div className="mt-3 flex items-center justify-center gap-6 text-xs text-[var(--text-secondary)]">
                  <span>{t('driveDetail.maxPower', 'Max Power')}: <strong className="text-amber-400">{fmtInt(stats.powerMax)} kW</strong></span>
                  <span>{t('driveDetail.maxRegen', 'Max Regen')}: <strong className="text-cyan-400">{fmtInt(stats.powerMin)} kW</strong></span>
                  <span>{t('driveDetail.avgLabel', 'Avg')}: <strong className="text-[var(--text-primary)]">{fmtNumber(stats.avgPower)} kW</strong></span>
                </div>
                )}
              </FadeIn>

              {/* Tire Pressure During Drive */}
              {(() => {
                const tpVals = (key: 'tireFl' | 'tireFr' | 'tireRl' | 'tireRr') => {
                  const vals = chartData.map((d) => d[key]).filter((v): v is number => v != null && v > 0);
                  return { min: vals.length > 0 ? Math.min(...vals) : null, max: vals.length > 0 ? Math.max(...vals) : null };
                };
                const fl = tpVals('tireFl'), fr = tpVals('tireFr'), rl = tpVals('tireRl'), rr = tpVals('tireRr');
                const tpStats = [
                  { label: t('driveDetail.frontLeft', 'Front Left'), color: '#3b82f6', ...fl },
                  { label: t('driveDetail.frontRight', 'Front Right'), color: '#10b981', ...fr },
                  { label: t('driveDetail.rearLeft', 'Rear Left'), color: '#f59e0b', ...rl },
                  { label: t('driveDetail.rearRight', 'Rear Right'), color: '#ef4444', ...rr },
                ];
                return (
                  <FadeIn>
                    <GlassPanel className="p-6">
                      <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
                        <Activity className="h-4 w-4 text-cyan-400" /> {t('driveDetail.tirePressure', 'Tire Pressure During Drive')}
                      </h3>
                      {stats.hasTirePressure ? (
                        <>
                          <div className="grid grid-cols-4 gap-3 mb-4">
                            {tpStats.map((tp) => (
                              <div key={tp.label} className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                                <p className="text-[9px] text-[var(--text-muted)]">{tp.label}</p>
                                <p className="text-sm font-bold" style={{ color: tp.color }}>
                                  {tp.min != null ? `${fmtNumber(tp.min)}–${fmtNumber(tp.max!)} ${pressureUnit}` : '—'}
                                </p>
                              </div>
                            ))}
                          </div>
                          <div className="h-56">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={chartData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                                <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                                <Tooltip content={<ChartTooltip />} />
                                <Legend wrapperStyle={LEGEND_STYLE} />
                                {chartData.some((d) => d.tireFl !== null) && (
                                  <Line type="monotone" dataKey="tireFl" stroke="#3b82f6" strokeWidth={2} dot={false} name={`FL (${pressureUnit})`} connectNulls />
                                )}
                                {chartData.some((d) => d.tireFr !== null) && (
                                  <Line type="monotone" dataKey="tireFr" stroke="#10b981" strokeWidth={2} dot={false} name={`FR (${pressureUnit})`} connectNulls />
                                )}
                                {chartData.some((d) => d.tireRl !== null) && (
                                  <Line type="monotone" dataKey="tireRl" stroke="#f59e0b" strokeWidth={2} dot={false} name={`RL (${pressureUnit})`} connectNulls />
                                )}
                                {chartData.some((d) => d.tireRr !== null) && (
                                  <Line type="monotone" dataKey="tireRr" stroke="#ef4444" strokeWidth={2} dot={false} name={`RR (${pressureUnit})`} connectNulls />
                                )}
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </>
                      ) : (
                        <div className="h-56 flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
                          <Activity className="h-8 w-8 opacity-20" />
                          <p className="text-xs">{t('driveDetail.noChartData', 'No telemetry data available')}</p>
                        </div>
                      )}
                    </GlassPanel>
                  </FadeIn>
                );
              })()}
        </>
      )}
    </PageContainer>
  );
}
