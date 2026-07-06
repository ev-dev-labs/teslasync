/**
 * Pure derivations for the "My Activity" page. Everything the redesigned page
 * visualises is computed from the single `UserActivityEntry[]` payload returned
 * by `GET /users/me/activity` — no extra endpoints are invented.
 *
 * Keeping the math in a framework-free module makes each transform trivially
 * unit-testable and keeps the page/sub-components focused on presentation.
 */
import type { UserActivityEntry } from '@/types/admin';
import { getActivityVisual } from '@/lib/activityIcons';
import { ymdInTz, formatDayKey } from '@/lib/dateFormat';
import { chartTokens } from '@/lib/tokens';

/** Sentinel key for entries whose `entity_type` is null. */
export const OTHER_CATEGORY = '__other__';

const SERIES = chartTokens.series;
const seriesColor = (i: number): string => SERIES[i % SERIES.length];

export interface ActivityKpis {
  /** Total activity entries in the window. */
  total: number;
  /** Distinct calendar days that had at least one entry. */
  activeDays: number;
  /** Distinct raw action strings. */
  actionTypes: number;
  /** Distinct `entity_type:entity_id` pairs touched. */
  entitiesTouched: number;
  /** ISO timestamp of the most recent entry, or null when empty. */
  lastActivityTs: string | null;
}

export interface TrendPoint {
  /** `YYYY-MM-DD` day key. */
  day: string;
  /** Short human label, e.g. "Apr 4". */
  label: string;
  /** Entries recorded on this day. */
  count: number;
}

export interface BreakdownSlice {
  /** Stable identity (raw action or entity_type). */
  key: string;
  /** Display label for categories (already humanised). */
  label: string;
  /** Optional i18n key + fallback for action slices. */
  i18nKey?: string;
  fallback?: string;
  count: number;
  /** Share of the grand total, 0..100. */
  percent: number;
  /** Colour-blind-safe series colour (hex). */
  color: string;
}

export interface HourPoint {
  /** Local hour, 0..23. */
  hour: number;
  /** Zero-padded label, "00".."23". */
  label: string;
  count: number;
}

export interface MyActivityAnalytics {
  kpis: ActivityKpis;
  dailyTrend: TrendPoint[];
  topActions: BreakdownSlice[];
  byCategory: BreakdownSlice[];
  byHour: HourPoint[];
}

const MAX_TREND_DAYS = 366;

/** Parse a `YYYY-MM-DD` key into UTC-midnight millis, or null when malformed. */
function ymdToUtcMillis(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Format UTC-midnight millis back into a `YYYY-MM-DD` key. */
function utcMillisToYmd(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

/**
 * Inclusive list of `YYYY-MM-DD` keys between two day keys. Returns an empty
 * list when the range is inverted or unparseable, and is capped so a huge
 * hand-edited range can't blow up the chart.
 */
function enumerateDays(startKey: string, endKey: string): string[] {
  const start = ymdToUtcMillis(startKey);
  const end = ymdToUtcMillis(endKey);
  if (start == null || end == null || end < start) return [];
  const days: string[] = [];
  for (let cur = start; cur <= end && days.length < MAX_TREND_DAYS; cur += 86_400_000) {
    days.push(utcMillisToYmd(cur));
  }
  return days;
}

/** Humanise an entity_type like `charging_session` → `Charging session`. */
function humaniseCategory(raw: string): string {
  const words = raw.replace(/[_-]+/g, ' ').trim();
  if (!words) return raw;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Derive every metric the My Activity page renders from the raw entries plus
 * the active date range (used to draw a gap-filled daily trend so the chart
 * spans the whole selected window even on quiet days).
 */
export function deriveMyActivityAnalytics(
  entries: readonly UserActivityEntry[] | null | undefined,
  range: { start: string; end: string } | null | undefined,
): MyActivityAnalytics {
  const safe = Array.isArray(entries) ? entries : [];
  const total = safe.length;

  const dayCounts = new Map<string, number>();
  const actionCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const entitySet = new Set<string>();
  const byHour: HourPoint[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: String(h).padStart(2, '0'),
    count: 0,
  }));

  let lastActivityTs: string | null = null;
  let lastMs = Number.NEGATIVE_INFINITY;

  for (const entry of safe) {
    const ts = entry?.ts ?? '';
    const date = ts ? new Date(ts) : null;
    const valid = date != null && !Number.isNaN(date.getTime());

    if (valid) {
      const dayKey = ymdInTz(date);
      if (dayKey) dayCounts.set(dayKey, (dayCounts.get(dayKey) ?? 0) + 1);
      const hour = date.getHours();
      if (hour >= 0 && hour < 24) byHour[hour].count += 1;
      const ms = date.getTime();
      if (ms > lastMs) {
        lastMs = ms;
        lastActivityTs = ts;
      }
    }

    const action = (entry?.action ?? '').trim() || 'unknown';
    actionCounts.set(action, (actionCounts.get(action) ?? 0) + 1);

    // Treat null, undefined, and blank/whitespace-only entity types uniformly
    // as the "other" bucket (mirroring the `action` handling above) so a stray
    // empty string can't spawn a label-less category slice or inflate the
    // distinct-entity count.
    const entityType = (entry?.entity_type ?? '').trim();
    const category = entityType || OTHER_CATEGORY;
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);

    if (entityType) {
      entitySet.add(`${entityType}:${entry?.entity_id ?? ''}`);
    }
  }

  const kpis: ActivityKpis = {
    total,
    activeDays: dayCounts.size,
    actionTypes: actionCounts.size,
    entitiesTouched: entitySet.size,
    lastActivityTs,
  };

  const dailyTrend: TrendPoint[] = enumerateDays(range?.start ?? '', range?.end ?? '').map((day) => ({
    day,
    label: formatDayKey(day, { style: 'short' }),
    count: dayCounts.get(day) ?? 0,
  }));

  const pct = (count: number): number => (total > 0 ? (count / total) * 100 : 0);

  const topActions: BreakdownSlice[] = [...actionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([action, count], i) => {
      const visual = getActivityVisual(action);
      return {
        key: action,
        label: visual.fallback,
        i18nKey: visual.i18nKey,
        fallback: visual.fallback,
        count,
        percent: pct(count),
        color: seriesColor(i),
      };
    });

  const byCategory: BreakdownSlice[] = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([category, count], i) => {
      const isOther = category === OTHER_CATEGORY;
      return {
        key: category,
        label: isOther ? '' : humaniseCategory(category),
        i18nKey: isOther ? 'activity.myActivity.byCategory.other' : undefined,
        fallback: isOther ? 'System / other' : undefined,
        count,
        percent: pct(count),
        color: seriesColor(i),
      };
    });

  return { kpis, dailyTrend, topActions, byCategory, byHour };
}
