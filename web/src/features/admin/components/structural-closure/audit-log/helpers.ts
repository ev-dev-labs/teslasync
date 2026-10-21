import { toZonedDatetimeStr } from '@/lib/dateFormat';

export const LIMIT_OPTIONS = [
  { value: '50', label: '50' },
  { value: '100', label: '100' },
  { value: '250', label: '250' },
  { value: '500', label: '500' },
];

export function toDateTimeInput(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return toZonedDatetimeStr(date, timezone);
}

/** Reject nonexistent civil minutes; an ambiguous DST minute uses its first occurrence. */
export function toIsoOrUndefined(local: string, timezone?: string): string | undefined {
  if (!local) return undefined;
  if (!timezone) {
    const ms = Date.parse(local);
    return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return undefined;
  const anchor = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(anchor) || new Date(anchor).toISOString().slice(0, 16) !== local) return undefined;
  const candidates = [-86_400_000, 0, 86_400_000].map((delta) => {
    const sample = anchor + delta;
    const civil = toDateTimeInput(new Date(sample).toISOString(), timezone);
    return anchor - (Date.parse(`${civil}:00Z`) - sample);
  }).filter((candidate) => toDateTimeInput(new Date(candidate).toISOString(), timezone) === local);
  return candidates.length ? new Date(Math.min(...candidates)).toISOString() : undefined;
}
