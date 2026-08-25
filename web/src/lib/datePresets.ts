/**
 * Quick-select date range presets.
 *
 * `resolve(now?)` returns ISO date strings (YYYY-MM-DD) using the supplied
 * `now`'s LOCAL calendar day (not UTC) so that "Today" matches the user's
 * wall-clock day even at 23:30 local. When timezone-aware date helpers
 * land, swap `new Date()` for an `inTz(now, tz)` helper.
 */

export interface DatePresetRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

export interface DatePreset {
  id: string;
  i18nKey: string;
  fallback: string;
  resolve: (now?: Date) => DatePresetRange;
  /** Rolling scopes must be selected explicitly, not inferred from dates. */
  requiresExplicitSelection?: boolean;
}

/** Format a Date as YYYY-MM-DD using LOCAL calendar fields. */
function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const DATE_PRESETS: DatePreset[] = [
  {
    id: 'today',
    i18nKey: 'date.preset.today',
    fallback: 'Today',
    resolve: (now = new Date()) => ({ start: iso(now), end: iso(now) }),
  },
  {
    id: 'live',
    i18nKey: 'date.preset.live',
    fallback: 'Live',
    // Calendar-only APIs use today as the compatibility window. Consumers
    // using useRangeState's instant bounds receive a rolling five-minute
    // window instead.
    requiresExplicitSelection: true,
    resolve: (now = new Date()) => ({ start: iso(now), end: iso(now) }),
  },
  {
    id: '24h',
    i18nKey: 'date.preset.last24h',
    fallback: 'Last 24 hours',
    // A rolling 24-hour period can cross two local calendar days. Precise
    // instant bounds are resolved by useRangeState for APIs that accept them.
    requiresExplicitSelection: true,
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 1);
      return { start: iso(s), end: iso(now) };
    },
  },
  {
    id: 'yesterday',
    i18nKey: 'date.preset.yesterday',
    fallback: 'Yesterday',
    resolve: (now = new Date()) => {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { start: iso(y), end: iso(y) };
    },
  },
  {
    id: '7d',
    i18nKey: 'date.preset.last7',
    fallback: 'Last 7 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);
      return { start: iso(s), end: iso(now) };
    },
  },
  {
    id: '30d',
    i18nKey: 'date.preset.last30',
    fallback: 'Last 30 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 29);
      return { start: iso(s), end: iso(now) };
    },
  },
  {
    id: '90d',
    i18nKey: 'date.preset.last90',
    fallback: 'Last 90 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 89);
      return { start: iso(s), end: iso(now) };
    },
  },
  {
    id: 'mtd',
    i18nKey: 'date.preset.mtd',
    fallback: 'Month to date',
    resolve: (now = new Date()) => ({
      start: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: iso(now),
    }),
  },
  {
    id: 'qtd',
    i18nKey: 'date.preset.qtd',
    fallback: 'Quarter to date',
    resolve: (now = new Date()) => {
      const q = Math.floor(now.getMonth() / 3) * 3;
      return {
        start: iso(new Date(now.getFullYear(), q, 1)),
        end: iso(now),
      };
    },
  },
  {
    id: 'ytd',
    i18nKey: 'date.preset.ytd',
    fallback: 'Year to date',
    resolve: (now = new Date()) => ({
      start: iso(new Date(now.getFullYear(), 0, 1)),
      end: iso(now),
    }),
  },
  {
    id: 'lastMonth',
    i18nKey: 'date.preset.lastMonth',
    fallback: 'Last month',
    resolve: (now = new Date()) => {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      // Day 0 of the current month = last day of the previous month.
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: iso(s), end: iso(e) };
    },
  },
  {
    id: '1y',
    i18nKey: 'date.preset.last1y',
    fallback: 'Last year',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setFullYear(s.getFullYear() - 1);
      return { start: iso(s), end: iso(now) };
    },
  },
  {
    id: 'all',
    i18nKey: 'date.preset.all',
    fallback: 'All time',
    resolve: (now = new Date()) => ({ start: '2015-01-01', end: iso(now) }),
  },
];

/** Default chip set rendered when callers do not pass `presetIds`. */
export const DEFAULT_PRESET_IDS = ['today', '7d', '30d', 'mtd', 'ytd', 'all'] as const;

/** Lookup a preset by id (returns undefined when unknown). */
export function getDatePreset(id: string): DatePreset | undefined {
  return DATE_PRESETS.find(p => p.id === id);
}

/**
 * Resolve the start date for the "All time" preset. Defaults to
 * `'2015-01-01'` (≈ Tesla data history baseline) but can be clamped to a
 * smarter floor — typically the user's first data point — so a user whose
 * data starts in 2024 doesn't see 9 years of empty buckets.
 */
export function resolveAllTimeStart(minDate?: string): string {
  const baseline = '2015-01-01';
  if (!minDate) return baseline;
  return minDate > baseline ? minDate : baseline;
}

/**
 * Return the id of the preset whose resolved range matches (start, end), or
 * undefined if no preset matches. Caller passes `now` (or omits to use the
 * current wall clock).
 */
export function matchPresetId(start: string, end: string, now?: Date): string | undefined {
  for (const preset of DATE_PRESETS) {
    if (preset.requiresExplicitSelection) continue;
    const r = preset.resolve(now);
    if (r.start === start && r.end === end) return preset.id;
  }
  return undefined;
}
