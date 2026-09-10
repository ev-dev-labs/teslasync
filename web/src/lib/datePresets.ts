import { addCivilDays, civilDateInTimeZone } from './dateRange';

/**
 * Quick-select date range presets.
 *
 * `resolve(now?, timeZone?)` returns ISO date strings (YYYY-MM-DD). Without
 * `timeZone` it uses the browser's local calendar day. Vehicle-centric
 * pages pass the vehicle IANA tz so "Today" is that vehicle's civil day
 * through exclusive tomorrow midnight — a UTC host at 02:00 must not
 * drop a still-current PDT evening.
 */

export interface DatePresetRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

export interface DatePreset {
  id: string;
  i18nKey: string;
  fallback: string;
  resolve: (now?: Date, timeZone?: string) => DatePresetRange;
  /** Rolling scopes must be selected explicitly, not inferred from dates. */
  requiresExplicitSelection?: boolean;
}

/** Format a Date as YYYY-MM-DD using LOCAL calendar fields. */
function isoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function iso(d: Date, timeZone?: string): string {
  if (timeZone) return civilDateInTimeZone(d, timeZone);
  return isoLocal(d);
}

function addDays(now: Date, days: number, timeZone?: string): string {
  if (timeZone) return addCivilDays(civilDateInTimeZone(now, timeZone), days);
  const s = new Date(now);
  s.setDate(s.getDate() + days);
  return isoLocal(s);
}

function monthStart(now: Date, timeZone?: string): string {
  const civil = iso(now, timeZone);
  return `${civil.slice(0, 7)}-01`;
}

function quarterStart(now: Date, timeZone?: string): string {
  const civil = iso(now, timeZone);
  const y = Number(civil.slice(0, 4));
  const m = Number(civil.slice(5, 7));
  const q = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(q).padStart(2, '0')}-01`;
}

function yearStart(now: Date, timeZone?: string): string {
  return `${iso(now, timeZone).slice(0, 4)}-01-01`;
}

function lastMonthRange(now: Date, timeZone?: string): DatePresetRange {
  const firstThis = monthStart(now, timeZone);
  const lastPrev = addCivilDays(firstThis, -1);
  return { start: `${lastPrev.slice(0, 7)}-01`, end: lastPrev };
}

export const DATE_PRESETS: DatePreset[] = [
  {
    id: 'today',
    i18nKey: 'date.preset.today',
    fallback: 'Today',
    resolve: (now = new Date(), timeZone?) => ({
      start: iso(now, timeZone),
      end: iso(now, timeZone),
    }),
  },
  {
    id: 'live',
    i18nKey: 'date.preset.live',
    fallback: 'Live',
    requiresExplicitSelection: true,
    resolve: (now = new Date(), timeZone?) => ({
      start: iso(now, timeZone),
      end: iso(now, timeZone),
    }),
  },
  {
    id: '24h',
    i18nKey: 'date.preset.last24h',
    fallback: 'Last 24 hours',
    requiresExplicitSelection: true,
    resolve: (now = new Date(), timeZone?) => ({
      start: addDays(now, -1, timeZone),
      end: iso(now, timeZone),
    }),
  },
  {
    id: 'yesterday',
    i18nKey: 'date.preset.yesterday',
    fallback: 'Yesterday',
    resolve: (now = new Date(), timeZone?) => {
      const y = addDays(now, -1, timeZone);
      return { start: y, end: y };
    },
  },
  {
    id: '7d',
    i18nKey: 'date.preset.last7',
    fallback: 'Last 7 days',
    resolve: (now = new Date(), timeZone?) => ({
      start: addDays(now, -6, timeZone),
      end: iso(now, timeZone),
    }),
  },
  {
    id: '30d',
    i18nKey: 'date.preset.last30',
    fallback: 'Last 30 days',
    resolve: (now = new Date(), timeZone?) => ({
      start: addDays(now, -29, timeZone),
      end: iso(now, timeZone),
    }),
  },
  {
    id: '90d',
    i18nKey: 'date.preset.last90',
    fallback: 'Last 90 days',
    resolve: (now = new Date(), timeZone?) => ({
      start: addDays(now, -89, timeZone),
      end: iso(now, timeZone),
    }),
  },
  {
    id: 'mtd',
    i18nKey: 'date.preset.mtd',
    fallback: 'Month to date',
    resolve: (now = new Date(), timeZone?) => ({
      start: monthStart(now, timeZone),
      end: iso(now, timeZone),
    }),
  },
  {
    id: 'qtd',
    i18nKey: 'date.preset.qtd',
    fallback: 'Quarter to date',
    resolve: (now = new Date(), timeZone?) => ({
      start: quarterStart(now, timeZone),
      end: iso(now, timeZone),
    }),
  },
  {
    id: 'ytd',
    i18nKey: 'date.preset.ytd',
    fallback: 'Year to date',
    resolve: (now = new Date(), timeZone?) => ({
      start: yearStart(now, timeZone),
      end: iso(now, timeZone),
    }),
  },
  {
    id: 'lastMonth',
    i18nKey: 'date.preset.lastMonth',
    fallback: 'Last month',
    resolve: (now = new Date(), timeZone?) => lastMonthRange(now, timeZone),
  },
  {
    id: '1y',
    i18nKey: 'date.preset.last1y',
    fallback: 'Last year',
    resolve: (now = new Date(), timeZone?) => {
      if (!timeZone) {
        const s = new Date(now);
        s.setFullYear(s.getFullYear() - 1);
        return { start: isoLocal(s), end: isoLocal(now) };
      }
      const civil = civilDateInTimeZone(now, timeZone);
      const y = Number(civil.slice(0, 4)) - 1;
      return { start: `${y}${civil.slice(4)}`, end: civil };
    },
  },
  {
    id: 'all',
    i18nKey: 'date.preset.all',
    fallback: 'All time',
    resolve: (now = new Date(), timeZone?) => ({
      start: '2015-01-01',
      end: iso(now, timeZone),
    }),
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
