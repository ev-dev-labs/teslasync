// Native parity port of
// web/src/features/analytics/components/weekly-digest/constants.ts.
//
// Pure TypeScript constants for the Analytics Weekly Digest — no DOM, React, or
// browser APIs — so every exported name, shape, and literal value is ported
// 1:1 from the web source. Only the two colour imports are remapped for the
// native parity tree (contract rules 4 & 5):
//
//   - `@/components/charts` CHART_COLORS (web L1) -> the native web-parity charts
//     barrel, which re-exports the identical CB-safe Okabe-Ito palette
//     (CHART_COLORS[0] === '#0072B2'), so ALERT_SEVERITY_COLORS.info is
//     unchanged.
//   - `@/lib/colors` STATUS_COLORS (web L2) -> inlined locally because lib/colors
//     has no native parity port yet; the exact web literals are copied so
//     ALERT_SEVERITY_COLORS.warning / .critical keep their precise visual intent.

import {CHART_COLORS} from '../../../../components/charts';

// Exact copy of web `@/lib/colors` STATUS_COLORS (traffic-light status
// indicators). Kept as a full object so ALERT_SEVERITY_COLORS reads identically
// to the web source.
const STATUS_COLORS = {
  good: '#10b981',
  warning: '#f59e0b',
  critical: '#ef4444',
} as const;

export const DAY_LABELS = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
] as const;

export const CITY_PAIRS = [
  {from: 'New York', to: 'Boston', km: 350},
  {from: 'LA', to: 'San Francisco', km: 615},
  {from: 'London', to: 'Paris', km: 460},
  {from: 'Berlin', to: 'Munich', km: 585},
  {from: 'Sydney', to: 'Melbourne', km: 880},
  {from: 'Tokyo', to: 'Osaka', km: 515},
] as const;

export const ALERT_SEVERITY_COLORS: Record<string, string> = {
  info: CHART_COLORS[0],
  warning: STATUS_COLORS.warning,
  critical: STATUS_COLORS.critical,
};

export const CO2_PER_KWH_GASOLINE_KG = 0.21;
