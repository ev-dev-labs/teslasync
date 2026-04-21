import { useMemo } from 'react';
import { useDrive } from '@/api/hooks/useDriving';
import { useVehicle } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import type { LatLngExpression } from 'leaflet';
import type { ChartDataPoint, DriveStats, RoutePoint, SpeedSegment, SpeedHistogramBucket } from './types';

export function useDriveDetailData(id: string) {
  const { data: drive, isLoading, error } = useDrive(id);
  const { data: vehicle } = useVehicle(String(drive?.vehicleId ?? ''));
  const {
    convertDistance, convertSpeed, convertTemp, convertPressure,
  } = useSettings();

  /* ---- Route data ---- */
  const routeSource = useMemo<RoutePoint[]>(() => {
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
  const speedSegments = useMemo<SpeedSegment[]>(() => {
    const segs: SpeedSegment[] = [];
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
  const chartData = useMemo<ChartDataPoint[]>(() => {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- positions may have snake_case fallback fields
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
  const stats = useMemo<DriveStats | null>(() => {
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

    const firstWithRange = chartData.find((d) => d.idealRange != null || d.ratedRange != null);
    const lastWithRange = [...chartData].reverse().find((d) => d.idealRange != null || d.ratedRange != null);
    const startRange = firstWithRange ? (firstWithRange.idealRange ?? firstWithRange.ratedRange) : null;
    const endRange = lastWithRange ? (lastWithRange.idealRange ?? lastWithRange.ratedRange) : null;

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
  const speedHistData = useMemo<SpeedHistogramBucket[]>(() => {
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

  return {
    drive: drive ?? null,
    vehicle: vehicle ?? null,
    isLoading,
    error,
    chartData,
    stats,
    trail,
    startPos,
    endPos,
    centerPos,
    speedSegments,
    speedHistData,
  };
}
