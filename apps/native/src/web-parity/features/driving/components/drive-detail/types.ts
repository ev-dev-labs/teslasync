/**
 * Native parity port of
 * web/src/features/driving/components/drive-detail/types.ts.
 *
 * Pure TypeScript type definitions with no runtime behavior and no DOM — the
 * web source is platform-agnostic, so every interface is ported verbatim and is
 * fully React Native compatible. These shapes describe the drive-detail domain
 * data (per-sample chart points, aggregate drive statistics, route geometry,
 * speed-colored polyline segments, and the speed histogram) shared by the
 * drive-detail building blocks.
 *
 * The web source imports `LatLngExpression` from `@/components/maps`. The native
 * parity barrel at web-parity/components/maps re-declares that Leaflet type as a
 * native-safe union, so we import it from there (type-only — no runtime/Leaflet
 * dependency is pulled in).
 */

import type { LatLngExpression } from '../../../../components/maps';

export interface ChartDataPoint {
  time: string;
  speed: number;
  battery: number;
  elevation: number;
  power: number;
  outsideTemp: number | null;
  insideTemp: number | null;
  driverTemp: number | null;
  passengerTemp: number | null;
  idealRange: number | null;
  ratedRange: number | null;
  estRange: number | null;
  odometer: number | null;
  soc: number | null;
  usableSoc: number | null;
  tireFl: number | null;
  tireFr: number | null;
  tireRl: number | null;
  tireRr: number | null;
  climateOn: boolean | null;
  fanStatus: number | null;
}

export interface DriveStats {
  maxSpd: number;
  avgSpd: number;
  minSpd: number;
  powerMax: number;
  powerMin: number;
  avgPower: number;
  energyWh: number;
  regenWh: number;
  consumptionWhKm: number;
  elevGain: number;
  elevLoss: number;
  avgOutsideTemp: number | null;
  avgInsideTemp: number | null;
  hasAnyTemp: boolean;
  insideTemps: number[];
  outsideTemps: number[];
  driverTemps: number[];
  passengerTemps: number[];
  climateStatus: string | null;
  avgFanSpeed: number | null;
  maxFanSpeed: number | null;
  startRange: number | null;
  endRange: number | null;
  odometerStart: number;
  odometerEnd: number;
  hasTirePressure: boolean;
  efficiencyPctPer100: number | null;
}

export interface RoutePoint {
  lat: number;
  lng: number;
  speed: number;
}

export interface SpeedSegment {
  positions: LatLngExpression[];
  color: string;
}

export interface SpeedHistogramBucket {
  range: string;
  pct: number;
}
