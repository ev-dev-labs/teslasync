import { formatDayKey, ymdInTz } from '@/lib/dateFormat';
import type { ActivityItem } from '@/types/activity';

export interface ActivityDayGroup {
  dayKey: string;
  label: string;
  items: ActivityItem[];
}

/**
 * Buckets a chronologically-ordered (occurred_at DESC) item list by local
 * calendar day, preserving the incoming order both across and within
 * buckets. `tz` should be the vehicle's IANA timezone when known so a
 * late-night drive groups under the day the driver experienced it, not UTC.
 */
export function groupActivityByDay(items: readonly ActivityItem[], tz?: string): ActivityDayGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, ActivityItem[]>();

  for (const item of items) {
    const d = new Date(item.occurred_at);
    const key = ymdInTz(d, tz) ?? 'unknown';
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(key, [item]);
      order.push(key);
    }
  }

  return order.map((dayKey) => ({
    dayKey,
    label: dayKey === 'unknown' ? '—' : formatDayKey(dayKey, { style: 'long' }),
    items: buckets.get(dayKey) ?? [],
  }));
}
