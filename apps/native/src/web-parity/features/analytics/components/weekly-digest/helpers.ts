// Native parity port of
// web/src/features/analytics/components/weekly-digest/helpers.ts.
//
// Pure date/number utility module for the weekly-digest feature. Every function
// is engine-agnostic (Date, Math, Number, toLocaleString) and runs unchanged on
// Hermes — there is no DOM, Recharts, Leaflet, React, or web-UI dependency here.
// The two web imports are replaced with native-safe inline shims so the module
// is self-contained for the file-by-file port:
//   - `@/lib/numberFormat` fmtNumber -> inlined locale-aware formatter that
//     mirrors the web safeNumber + toLocaleString(minFrac=maxFrac) behaviour
//     (default precision 2), matching the shim used by sibling review slides.
//   - `./constants` CITY_PAIRS -> inlined verbatim `as const`. It is the only
//     symbol helpers.ts consumes from the constants barrel, and keeping it
//     `as const` preserves findCityPair's `(typeof CITY_PAIRS)[number]` literal
//     return type 1:1.

const DEFAULT_GLOBAL_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_GLOBAL_PRECISION;
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
}

const CITY_PAIRS = [
  {from: 'New York', to: 'Boston', km: 350},
  {from: 'LA', to: 'San Francisco', km: 615},
  {from: 'London', to: 'Paris', km: 460},
  {from: 'Berlin', to: 'Munich', km: 585},
  {from: 'Sydney', to: 'Melbourne', km: 880},
  {from: 'Tokyo', to: 'Osaka', km: 515},
] as const;

export function getWeekRange(offset: number): [Date, Date] {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay() + 1 + offset * 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return [start, end];
}

export function isInRange(dateStr: string, start: Date, end: Date): boolean {
  const d = new Date(dateStr);
  return d >= start && d <= end;
}

export function dayOfWeekIndex(dateStr: string): number {
  const d = new Date(dateStr);
  const day = d.getDay();
  return day === 0 ? 6 : day - 1; // Mon=0 ... Sun=6
}

export function pctChange(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function trendFor(
  current: number,
  previous: number,
  invertPositive = false,
): {direction: 'up' | 'down' | 'flat'; value: string; positive: boolean} {
  const diff = current - previous;
  const pct = pctChange(current, previous);
  if (Math.abs(diff) < 0.01) {
    return {direction: 'flat', value: '0%', positive: true};
  }
  const isUp = diff > 0;
  return {
    direction: isUp ? 'up' : 'down',
    value: `${isUp ? '+' : ''}${fmtNumber(pct, 1)}%`,
    positive: invertPositive ? !isUp : isUp,
  };
}

export function findCityPair(
  distanceKm: number,
): (typeof CITY_PAIRS)[number] | undefined {
  let best: (typeof CITY_PAIRS)[number] | undefined;
  let bestDiff = Infinity;
  for (const pair of CITY_PAIRS) {
    const diff = Math.abs(pair.km - distanceKm);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = pair;
    }
  }
  return best;
}
