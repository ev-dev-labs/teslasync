export const LIMIT_OPTIONS = [
  { value: '50', label: '50' },
  { value: '100', label: '100' },
  { value: '250', label: '250' },
  { value: '500', label: '500' },
];

/**
 * Convert a `datetime-local` input value (`YYYY-MM-DDTHH:mm`, local time) to
 * an ISO-8601 UTC string for the API query. Returns `undefined` for empty or
 * unparseable input so a malformed value can never throw
 * `RangeError: Invalid time value` while `queryParams` is derived mid-render.
 */
export function toIsoOrUndefined(local: string): string | undefined {
  if (!local) return undefined;
  const ms = Date.parse(local);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}
