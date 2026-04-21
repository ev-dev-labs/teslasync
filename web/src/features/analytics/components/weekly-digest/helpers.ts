import { fmtNumber } from '@/lib/numberFormat';
import { CITY_PAIRS } from './constants';

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
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function trendFor(
  current: number,
  previous: number,
  invertPositive = false,
): { direction: 'up' | 'down' | 'flat'; value: string; positive: boolean } {
  const diff = current - previous;
  const pct = pctChange(current, previous);
  if (Math.abs(diff) < 0.01) {
    return { direction: 'flat', value: '0%', positive: true };
  }
  const isUp = diff > 0;
  return {
    direction: isUp ? 'up' : 'down',
    value: `${isUp ? '+' : ''}${fmtNumber(pct, 1)}%`,
    positive: invertPositive ? !isUp : isUp,
  };
}

export function findCityPair(distanceKm: number): (typeof CITY_PAIRS)[number] | undefined {
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
