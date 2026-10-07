/**
 * Drive-detail view models — the data contract between the producer
 * (`useDriveDetailData`) and the drive-detail chart / panel consumers
 * (`DriveOverviewChart`, `HeroGauges`, `ElevationChart`, `RouteMapSection`, …).
 *
 * Unit discipline (Phase-42/48, ADR-004): telemetry and drive aggregates are
 * stored and read as strict SI (metres, m/s, °C, Pa, Wh). These view models sit
 * at the display boundary, so any field whose doc says "display unit" has
 * ALREADY been converted from SI via `useUnits()` + the `…FromSI` converters in
 * `@/lib/unitConversion`. Consumers must render these values verbatim and MUST
 * NOT re-convert them. Fields explicitly documented as SI (elevation metres,
 * energy Wh, `RoutePoint.speed` m/s) intentionally stay raw because downstream
 * maths (elevation deltas, energy totals, colour banding) depends on the SI
 * magnitude, not the user's display preference.
 */
import type { LatLngExpression } from '@/components/maps';

/**
 * One sample of the drive time-series feeding every drive-detail chart. Required
 * numeric fields are coalesced to `0` by the producer (never `undefined`/`NaN`);
 * optional fields are `null` when the underlying telemetry sample lacks them.
 */
export interface ChartDataPoint {
  /** Pre-formatted timestamp label for the chart X axis. */
  time: string;
  /** Speed in the user's display unit (km/h or mph), converted from SI m/s. */
  speed: number;
  /** Battery state of charge as a percentage (0–100). */
  battery: number;
  /** Elevation in metres (SI, raw) — differenced to derive gain/loss. */
  elevation: number;
  /** Instantaneous power in kW; sign preserved (negative = regen). */
  power: number;
  /** Ambient temp in the display unit (°C/°F) from SI °C; `null` if absent. */
  outsideTemp: number | null;
  /** Cabin temp in the display unit (°C/°F) from SI °C; `null` if absent. */
  insideTemp: number | null;
  /** Driver-zone setpoint in the display unit; `null` if absent. */
  driverTemp: number | null;
  /** Passenger-zone setpoint in the display unit; `null` if absent. */
  passengerTemp: number | null;
  /** Ideal range in the display distance unit (km/mi) from SI m; `null` if absent. */
  idealRange: number | null;
  /** Rated range in the display distance unit from SI m; `null` if absent. */
  ratedRange: number | null;
  /** Estimated range in the display distance unit from SI m; `null` if absent. */
  estRange: number | null;
  /** Odometer in the display distance unit from SI m; `null` if absent. */
  odometer: number | null;
  /** State of charge percentage; `null` if absent. */
  soc: number | null;
  /** Usable state of charge percentage; `null` if absent. */
  usableSoc: number | null;
  /** Front-left tyre pressure in the display unit (bar/psi/kPa); `null` if absent. */
  tireFl: number | null;
  /** Front-right tyre pressure in the display unit; `null` if absent. */
  tireFr: number | null;
  /** Rear-left tyre pressure in the display unit; `null` if absent. */
  tireRl: number | null;
  /** Rear-right tyre pressure in the display unit; `null` if absent. */
  tireRr: number | null;
  /** HVAC on/off; `null` when the sample carries no climate state. */
  climateOn: boolean | null;
  /** Raw fan-speed step; `null` if absent. */
  fanStatus: number | null;
}

/**
 * Aggregate statistics for a single drive, derived from its `ChartDataPoint[]`
 * plus the drive record. Array fields are the per-sample series used for
 * sparklines; nullable scalars are `null` when no contributing sample exists.
 */
export interface DriveStats {
  /** Max speed in the display unit (km/h or mph). */
  maxSpd: number;
  /** Average speed in the display unit. */
  avgSpd: number;
  /** Minimum *non-zero* speed in the display unit (0 if every sample is 0). */
  minSpd: number;
  /** Peak drive power in kW (most positive sample). */
  powerMax: number;
  /** Peak regen power in kW (most negative sample). */
  powerMin: number;
  /** Average power in kW. */
  avgPower: number;
  /** Energy consumed in watt-hours (Wh, SI). */
  energyWh: number;
  /** Energy recovered via regen in watt-hours (Wh, SI). */
  regenWh: number;
  /** Consumption in watt-hours per kilometre (Wh/km — always metric distance). */
  consumptionWhKm: number;
  /** Cumulative elevation gain in metres (SI). */
  elevGain: number;
  /** Cumulative elevation loss in metres (SI). */
  elevLoss: number;
  /** Mean ambient temp in the display unit; `null` when no samples. */
  avgOutsideTemp: number | null;
  /** Mean cabin temp in the display unit; `null` when no samples. */
  avgInsideTemp: number | null;
  /** True when any temperature series has at least one sample. */
  hasAnyTemp: boolean;
  /** Cabin temp series (display unit) for the sparkline. */
  insideTemps: number[];
  /** Ambient temp series (display unit) for the sparkline. */
  outsideTemps: number[];
  /** Driver-zone setpoint series (display unit). */
  driverTemps: number[];
  /** Passenger-zone setpoint series (display unit). */
  passengerTemps: number[];
  /** Human label: `'On' | 'Mostly Off' | 'Off'`, or `null` when unknown. */
  climateStatus: string | null;
  /** Mean fan-speed step; `null` when no samples. */
  avgFanSpeed: number | null;
  /** Peak fan-speed step; `null` when no samples. */
  maxFanSpeed: number | null;
  /** First known range in the display distance unit; `null` when none. */
  startRange: number | null;
  /** Last known range in the display distance unit; `null` when none. */
  endRange: number | null;
  /** First non-zero odometer reading in the display distance unit (0 if unknown). */
  odometerStart: number;
  /** Last non-zero odometer reading in the display distance unit (0 if unknown). */
  odometerEnd: number;
  /** True when any tyre-pressure sample exists. */
  hasTirePressure: boolean;
  /** Battery percent consumed per 100 display-distance units; `null` if not derivable. */
  efficiencyPctPer100: number | null;
}

/**
 * A single point along the driven route. `speed` stays in SI m/s (raw
 * telemetry) because the map colour bands compare against the SI
 * `SPEED_SEGMENT_*_MPS` thresholds — see `constants.ts`.
 */
export interface RoutePoint {
  /** Latitude in decimal degrees. */
  lat: number;
  /** Longitude in decimal degrees. */
  lng: number;
  /** Speed in metres per second (SI, raw). */
  speed: number;
  /** Source observation time used to place approximate counter evidence. */
  timestamp: string | null;
}

/** A polyline segment of the route, coloured by the speed band it falls in. */
export interface SpeedSegment {
  /** `[start, end]` lat/lng pair joining consecutive route points. */
  positions: LatLngExpression[];
  /** Hex colour for the band (green → cyan → amber → red). */
  color: string;
}

/** One bar of the speed-distribution histogram. */
export interface SpeedHistogramBucket {
  /** Band label in the user's display speed unit (e.g. `"20–40"`, `"120+"`). */
  range: string;
  /** Share of samples in this band, as an integer percentage (0–100). */
  pct: number;
}
