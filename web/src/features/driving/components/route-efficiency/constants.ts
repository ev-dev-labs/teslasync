import { chartTokens } from '@/lib/tokens';

/**
 * Route-efficiency accent colors, pulled from the shared color-blind-safe
 * chart palette so the comparison bars, metric-bar fills, and per-card
 * gradient all stay consistent with the rest of the app and with each other.
 * best/avg/worst map to the green/cyan/red slots; mostDriven uses purple.
 */
export const ROUTE_EFF_COLORS = {
  best: chartTokens.series[1], // green — lowest consumption
  avg: chartTokens.series[5], // cyan — typical consumption
  worst: chartTokens.series[3], // red — highest consumption
  mostDriven: chartTokens.series[4], // purple — trip frequency
} as const;

/**
 * Cap on how many routes the comparison chart renders. The vertical bar
 * chart stays legible on a laptop viewport at ~10 rows; the full set is
 * always available in the route-card grid below.
 */
export const MAX_COMPARISON_ROUTES = 10;
