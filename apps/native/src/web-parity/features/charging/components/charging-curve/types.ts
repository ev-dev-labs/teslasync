/**
 * Native parity port of
 * web/src/features/charging/components/charging-curve/types.ts.
 *
 * Pure TypeScript type definitions with no runtime behavior, no DOM, and no
 * imports — the web source is platform-agnostic, so every interface is ported
 * verbatim and is fully React Native compatible. These shapes describe the
 * charging-curve domain data (curve points, charger-type stats, monthly speed,
 * time-to-charge metrics, and summary stats) shared by the charging-curve
 * building blocks.
 */

export interface CurvePoint {
  soc: number;
  power: number;
}

export interface ChargerTypeStats {
  label: string;
  count: number;
  avgKw: number;
  avgKwh: number;
  avgDuration: number;
}

export interface MonthlySpeed {
  month: string;
  dcAvgKw: number;
  acAvgKw: number;
}

export interface TimeToChargeMetrics {
  avg10to80: number | null;
  avg20to80: number | null;
  fastest: { rate: number; id: number } | null;
  slowest: { rate: number; id: number } | null;
  yearlyTrend: { year: string; avg10to80: number; avg20to80: number; count: number }[];
}

export interface SummaryStats {
  totalSessions: number;
  totalEnergy: number;
  avgRate: number;
  peakRate: number;
  avgDuration: number;
  totalCost: number;
}
