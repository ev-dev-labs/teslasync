/**
 * Native web-parity port of `web/src/hooks/useRangeState.ts`.
 *
 * useRangeState — page-level date range state with URL sync, localStorage
 * memory, optional comparison-period resolution, and minDate-clamped "All
 * time" preset.
 *
 * Replaces the per-page boilerplate of:
 *   const [startDate, setStartDate] = useUrlString('from', defaultStart);
 *   const [endDate,   setEndDate]   = useUrlString('to',   defaultEnd);
 *   const setRangeBatch = useUrlBatch();
 *
 * Precedence on initial mount: **URL > localStorage > defaultPresetId > today**.
 * Restoring from localStorage is done with `replace` (no history entry).
 *
 * Why the asymmetric preset/calendar semantics matter:
 *   - Preset clicks (`setRange`) write {from,to} atomically and call onApply.
 *   - Calendar selections inside <RangePicker> stage internally and only
 *     reach this hook on Apply. There is no separate "staged" state here —
 *     <RangePicker> handles it.
 *
 * Native adaptations (the public API — `useRangeState` and the
 * `UseRangeStateOptions` / `RangeValue` / `UseRangeStateReturn` types — is
 * unchanged):
 *   - The web hook drove all range params through react-router-dom's
 *     `useSearchParams`, a DOM/history-backed store that does not exist in the
 *     native web-parity layer (there is no router and importing one is
 *     forbidden). The same `{from,to,compare}` key/value contract is preserved
 *     with an in-process `Map<string, string>` held in `useState`: the
 *     `params.get(key)` reads, the `setParams(updater, {replace})` atomic
 *     writes, and the custom `fromKey`/`toKey`/`compareKey` partitioning all
 *     behave identically. The `{replace}` option (a browser-history hint) is a
 *     no-op in-memory and is accepted only for call-site parity.
 *   - `localStorage` (browser-only) is reached through a `resolveStorage()`
 *     probe identical in spirit to this layer's other ports: if
 *     `globalThis.localStorage` is present (react-native-web in a real
 *     browser) it is used verbatim for 1:1 web parity; otherwise a
 *     module-level in-memory `Map` persists the range for the current native
 *     process. The web `typeof window === 'undefined'` SSR guards become this
 *     probe + fallback, so persistence never throws on device.
 *   - `@/lib/datePresets` (`DATE_PRESETS`, `getDatePreset`, `matchPresetId`,
 *     `resolveAllTimeStart`, `DatePresetRange`) and `@/lib/dateRange`
 *     (`calendarRangeToInstants` + its `localMidnightToInstant`/`tzOffsetMs`/
 *     `nextDay` helpers) do not exist in the native layer, so — following the
 *     established self-contained idiom the converted pages use (EnergyFlowPage
 *     / AlertsListPage inline the same `datePresets` resolve logic) — they are
 *     ported verbatim into this file. They rely only on `Date` math and
 *     `Intl.DateTimeFormat`, which the native runtime provides; `tzOffsetMs`
 *     keeps a try/catch (mirroring `useDateFormat`'s `ymdInTz`) so an Intl
 *     engine without `timeZone`/`formatToParts` support degrades to a UTC
 *     offset of 0 instead of throwing.
 *   - `Intl.DateTimeFormat().resolvedOptions().timeZone` resolves the device
 *     timezone exactly as on web, with the same `'UTC'` try/catch fallback.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* ──────────────────────────────────────────────────────────────────────────
 * Ported verbatim from web `@/lib/datePresets` (only the members this hook
 * imports: `DATE_PRESETS`, `getDatePreset`, `resolveAllTimeStart`,
 * `matchPresetId`, and the `DatePresetRange` type). `resolve(now?)` returns
 * ISO date strings (YYYY-MM-DD) using the supplied `now`'s LOCAL calendar day
 * (not UTC) so "Today" matches the user's wall-clock day even at 23:30 local.
 * ────────────────────────────────────────────────────────────────────────── */

export interface DatePresetRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

interface DatePreset {
  id: string;
  i18nKey: string;
  fallback: string;
  resolve: (now?: Date) => DatePresetRange;
}

/** Format a Date as YYYY-MM-DD using LOCAL calendar fields. */
function presetIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DATE_PRESETS: DatePreset[] = [
  {
    id: 'today',
    i18nKey: 'date.preset.today',
    fallback: 'Today',
    resolve: (now = new Date()) => ({
      start: presetIso(now),
      end: presetIso(now),
    }),
  },
  {
    id: 'yesterday',
    i18nKey: 'date.preset.yesterday',
    fallback: 'Yesterday',
    resolve: (now = new Date()) => {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { start: presetIso(y), end: presetIso(y) };
    },
  },
  {
    id: '7d',
    i18nKey: 'date.preset.last7',
    fallback: 'Last 7 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);
      return { start: presetIso(s), end: presetIso(now) };
    },
  },
  {
    id: '30d',
    i18nKey: 'date.preset.last30',
    fallback: 'Last 30 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 29);
      return { start: presetIso(s), end: presetIso(now) };
    },
  },
  {
    id: '90d',
    i18nKey: 'date.preset.last90',
    fallback: 'Last 90 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 89);
      return { start: presetIso(s), end: presetIso(now) };
    },
  },
  {
    id: 'mtd',
    i18nKey: 'date.preset.mtd',
    fallback: 'Month to date',
    resolve: (now = new Date()) => ({
      start: presetIso(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: presetIso(now),
    }),
  },
  {
    id: 'qtd',
    i18nKey: 'date.preset.qtd',
    fallback: 'Quarter to date',
    resolve: (now = new Date()) => {
      const q = Math.floor(now.getMonth() / 3) * 3;
      return {
        start: presetIso(new Date(now.getFullYear(), q, 1)),
        end: presetIso(now),
      };
    },
  },
  {
    id: 'ytd',
    i18nKey: 'date.preset.ytd',
    fallback: 'Year to date',
    resolve: (now = new Date()) => ({
      start: presetIso(new Date(now.getFullYear(), 0, 1)),
      end: presetIso(now),
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
      return { start: presetIso(s), end: presetIso(e) };
    },
  },
  {
    id: '1y',
    i18nKey: 'date.preset.last1y',
    fallback: 'Last year',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setFullYear(s.getFullYear() - 1);
      return { start: presetIso(s), end: presetIso(now) };
    },
  },
  {
    id: 'all',
    i18nKey: 'date.preset.all',
    fallback: 'All time',
    resolve: (now = new Date()) => ({
      start: '2015-01-01',
      end: presetIso(now),
    }),
  },
];

/** Lookup a preset by id (returns undefined when unknown). */
function getDatePreset(id: string): DatePreset | undefined {
  return DATE_PRESETS.find(p => p.id === id);
}

/**
 * Resolve the start date for the "All time" preset. Defaults to
 * `'2015-01-01'` (≈ Tesla data history baseline) but can be clamped to a
 * smarter floor — typically the user's first data point — so a user whose
 * data starts in 2024 doesn't see 9 years of empty buckets.
 */
function resolveAllTimeStart(minDate?: string): string {
  const baseline = '2015-01-01';
  if (!minDate) return baseline;
  return minDate > baseline ? minDate : baseline;
}

/**
 * Return the id of the preset whose resolved range matches (start, end), or
 * undefined if no preset matches. Caller passes `now` (or omits to use the
 * current wall clock).
 */
function matchPresetId(
  start: string,
  end: string,
  now?: Date,
): string | undefined {
  for (const preset of DATE_PRESETS) {
    const r = preset.resolve(now);
    if (r.start === start && r.end === end) return preset.id;
  }
  return undefined;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Ported verbatim from web `@/lib/dateRange` (calendar-day -> API instant).
 * The user's date picker speaks calendar-day strings (`YYYY-MM-DD`) scoped to
 * a display timezone; the API speaks absolute RFC 3339 instants. The window is
 * half-open `[startInstant, endInstantExclusive)`; the boundary is the local
 * midnight of the supplied IANA `timezone`.
 * ────────────────────────────────────────────────────────────────────────── */

interface CalendarRange {
  /** Local-calendar start day, `YYYY-MM-DD`. */
  startDate: string;
  /** Local-calendar end day (inclusive), `YYYY-MM-DD`. */
  endDate: string;
  /** IANA timezone the dates are interpreted in (e.g. `America/Los_Angeles`). */
  timezone: string;
}

interface InstantRange {
  /** RFC 3339 instant of `startDate`'s local midnight. */
  startInstant: string;
  /** RFC 3339 instant of the day AFTER `endDate`'s local midnight (exclusive). */
  endInstantExclusive: string;
}

/**
 * Returns the UTC instant of `YYYY-MM-DD T 00:00:00` interpreted in the given
 * IANA timezone. Uses an `Intl.DateTimeFormat` round-trip which is correct
 * across DST transitions.
 */
function localMidnightToInstant(date: string, timezone: string): Date {
  const [yStr, mStr, dStr] = date.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    throw new Error(`localMidnightToInstant: invalid date "${date}"`);
  }

  // Start with the UTC instant for the same wall-clock; then correct by the
  // offset between that wall-clock as seen in `timezone` and the same
  // wall-clock as seen in UTC. A second pass catches the rare DST-edge case
  // where the first correction crosses a transition.
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const offsetMs = tzOffsetMs(guess, timezone);
  const corrected = guess - offsetMs;
  const offset2 = tzOffsetMs(corrected, timezone);
  return new Date(guess - offset2);
}

function tzOffsetMs(instantMs: number, timezone: string): number {
  // Format the instant as wall-clock components in `timezone`, then re-encode
  // those components as a UTC instant — the difference is the tz offset at
  // that instant. The try/catch (added for native parity, mirroring
  // useDateFormat's `ymdInTz`) degrades to a 0 offset (treat as UTC) when the
  // Intl engine lacks `timeZone`/`formatToParts` support, rather than throwing.
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const parts = dtf.formatToParts(new Date(instantMs));
    const get = (type: string) =>
      Number(parts.find(p => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    );
    return asUtc - instantMs;
  } catch {
    return 0;
  }
}

/** Convert a calendar range to half-open API instants. */
function calendarRangeToInstants(range: CalendarRange): InstantRange {
  const start = localMidnightToInstant(range.startDate, range.timezone);
  const endNext = nextDay(range.endDate);
  const endExclusive = localMidnightToInstant(endNext, range.timezone);
  return {
    startInstant: start.toISOString(),
    endInstantExclusive: endExclusive.toISOString(),
  };
}

function nextDay(date: string): string {
  const [yStr, mStr, dStr] = date.split('-');
  const d = new Date(Date.UTC(Number(yStr), Number(mStr) - 1, Number(dStr)));
  d.setUTCDate(d.getUTCDate() + 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Native-safe key/value persistence (web `window.localStorage` replacement).
 * Uses the real browser store when reachable (react-native-web in a browser),
 * else a per-process in-memory `Map`.
 * ────────────────────────────────────────────────────────────────────────── */

interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const memoryStorage = new Map<string, string>();

function resolveStorage(): WebStorageLike {
  const g = globalThis as { localStorage?: WebStorageLike };
  const ls = g.localStorage;
  if (
    ls &&
    typeof ls.getItem === 'function' &&
    typeof ls.setItem === 'function'
  ) {
    return ls;
  }
  return {
    getItem: key => memoryStorage.get(key) ?? null,
    setItem: (key, value) => {
      memoryStorage.set(key, value);
    },
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * In-memory search-param store (react-router-dom `useSearchParams`
 * replacement). Models the `{from,to,compare}` key/value contract with a
 * `Map<string, string>`; `replace` is a no-op (no native history stack).
 * ────────────────────────────────────────────────────────────────────────── */

type SearchParams = ReadonlyMap<string, string>;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface UseRangeStateOptions {
  /**
   * Preset id to use when neither URL nor localStorage yields a range.
   * Defaults to `'30d'`.
   */
  defaultPresetId?: string;
  /**
   * URL query keys. Defaults: `from`, `to`, `compare`.
   * Pages using non-default keys (e.g. notifications uses `?dateFrom`) can
   * override either or both.
   */
  fromKey?: string;
  toKey?: string;
  compareKey?: string;
  /**
   * localStorage key used to remember the user's last-selected range on this
   * page. When omitted, no persistence happens. Recommended: dotted key like
   * `'charging.list.range'`.
   */
  persistKey?: string;
  /**
   * Lower bound for the "All time" preset and for clamping any restored or
   * user-supplied range. Falls back to `2015-01-01` when not provided.
   * Pass the user's first data point for a smarter "All time" semantic.
   */
  minDate?: string;
  /**
   * When true, exposes the `compare` flag and the `comparePrev` window
   * (the same-length window immediately preceding `[start, end]`).
   * Defaults to `false` so unused UI doesn't appear on opt-in pages.
   */
  enableCompare?: boolean;
  /**
   * IANA timezone the calendar dates are interpreted in when computing
   * `startInstant` / `endInstantExclusive`. Defaults to the device's
   * resolved timezone. Vehicle-centric pages should pass the vehicle's
   * IANA tz (via `useTimezone('vehicle')`) so the API filter spans the
   * user's intended wall-clock window — sending UTC midnight silently
   * dropped today's local rows for any user not on UTC.
   */
  timezone?: string;
}

export interface RangeValue {
  start: string;
  end: string;
}

export interface UseRangeStateReturn {
  start: string;
  end: string;
  /**
   * RFC 3339 instant of `start`'s local midnight in the configured tz.
   * Pass directly to API hooks — never the raw `start` calendar string.
   */
  startInstant: string;
  /**
   * RFC 3339 instant of the day AFTER `end`'s local midnight (exclusive)
   * in the configured tz. Half-open `[startInstant, endInstantExclusive)`
   * is the canonical API window; inclusive end-of-day is a footgun.
   */
  endInstantExclusive: string;
  /** IANA timezone used to compute `startInstant`/`endInstantExclusive`. */
  timezone: string;
  /** Derived id from {@link matchPresetId} (undefined for custom ranges). */
  presetId: string | undefined;
  /** When `enableCompare` is true: whether the user opted into comparison. */
  compare: boolean;
  /** When `compare` is true: the previous period of equal length. */
  comparePrev: RangeValue | undefined;
  /** Atomic setter — writes from/to in a single navigation. */
  setRange: (range: RangeValue) => void;
  /** Set range by preset id; falls back to current range when id is unknown. */
  setPreset: (id: string) => void;
  /** Toggle/set the comparison flag. */
  setCompare: (next: boolean) => void;
  /** Clear all range params (reverts to the default preset). */
  reset: () => void;
}

function isValidIsoDate(s: string | null | undefined): s is string {
  if (!s || !ISO_DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00`);
  return !Number.isNaN(t);
}

function clampToMin(date: string, minDate: string | undefined): string {
  if (!minDate) return date;
  return date < minDate ? minDate : date;
}

function loadFromStorage(persistKey: string | undefined): RangeValue | null {
  if (!persistKey) return null;
  try {
    const raw = resolveStorage().getItem(persistKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RangeValue> | null;
    if (!parsed || !isValidIsoDate(parsed.start) || !isValidIsoDate(parsed.end))
      return null;
    if (parsed.start > parsed.end) return null;
    return { start: parsed.start, end: parsed.end };
  } catch {
    return null;
  }
}

function saveToStorage(persistKey: string | undefined, value: RangeValue) {
  if (!persistKey) return;
  try {
    resolveStorage().setItem(persistKey, JSON.stringify(value));
  } catch {
    /* storage full / disabled — silently ignore */
  }
}

/**
 * Compute the previous period of equal length immediately preceding [start, end].
 * For a 7-day window, returns the 7 days before that. End boundary is exclusive
 * of `start` (i.e. previous period ends one day before `start`).
 */
function computeComparePrev(
  start: string,
  end: string,
): RangeValue | undefined {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return undefined;
  const ms = e.getTime() - s.getTime();
  const prevEnd = new Date(s.getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - ms);
  const iso = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  return { start: iso(prevStart), end: iso(prevEnd) };
}

export function useRangeState(
  opts: UseRangeStateOptions = {},
): UseRangeStateReturn {
  const {
    defaultPresetId = '30d',
    fromKey = 'from',
    toKey = 'to',
    compareKey = 'compare',
    persistKey,
    minDate,
    enableCompare = false,
    timezone,
  } = opts;

  const [params, setParamsState] = useState<SearchParams>(
    () => new Map<string, string>(),
  );

  // Mirrors react-router-dom's `setParams(updater, { replace })`. The native
  // store has no history stack, so the `replace` hint is accepted purely for
  // call-site parity and intentionally ignored.
  const setParams = useCallback(
    (
      updater: (prev: SearchParams) => Map<string, string>,
      _options?: { replace?: boolean },
    ): void => {
      setParamsState(prev => updater(prev));
    },
    [],
  );

  const urlStart = params.get(fromKey) ?? null;
  const urlEnd = params.get(toKey) ?? null;
  const urlCompare = params.get(compareKey) ?? null;

  // Lazily compute the resolved fallback once per render. The default preset's
  // `resolve()` is cheap (Date math), so re-running it is fine and ensures
  // "today"-style presets stay live without a re-render loop.
  const fallback = useMemo<RangeValue>(() => {
    const preset = getDatePreset(defaultPresetId) ?? getDatePreset('30d');
    if (preset?.id === 'all') {
      // Honor minDate even on the default preset.
      const r = preset.resolve();
      return { start: resolveAllTimeStart(minDate), end: r.end };
    }
    return preset?.resolve() ?? DATE_PRESETS[3].resolve();
  }, [defaultPresetId, minDate]);

  // Resolve the effective range using URL > localStorage > fallback.
  const effective = useMemo<RangeValue>(() => {
    if (
      isValidIsoDate(urlStart) &&
      isValidIsoDate(urlEnd) &&
      urlStart <= urlEnd
    ) {
      return {
        start: clampToMin(urlStart, minDate),
        end: clampToMin(urlEnd, minDate),
      };
    }
    return fallback;
  }, [urlStart, urlEnd, minDate, fallback]);

  // Restore from localStorage exactly once on mount when URL is empty.
  // The ref guard prevents re-restoration when the user later clears the URL.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (isValidIsoDate(urlStart) && isValidIsoDate(urlEnd)) return;
    const stored = loadFromStorage(persistKey);
    if (!stored) return;
    const start = clampToMin(stored.start, minDate);
    const end = clampToMin(stored.end, minDate);
    if (start === fallback.start && end === fallback.end) return;
    setParams(
      prev => {
        const next = new Map(prev);
        next.set(fromKey, start);
        next.set(toKey, end);
        return next;
      },
      { replace: true },
    );
    // Intentionally only run on mount — see ref guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on every effective change. Deps intentionally track the start/end
  // values (not the `effective` object identity) so persistence only fires on a
  // real range change, exactly as the web source did.
  useEffect(() => {
    saveToStorage(persistKey, effective);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistKey, effective.start, effective.end]);

  const setRange = useCallback(
    (range: RangeValue) => {
      const start = clampToMin(range.start, minDate);
      const end = clampToMin(range.end, minDate);
      setParams(
        prev => {
          const next = new Map(prev);
          next.set(fromKey, start);
          next.set(toKey, end);
          return next;
        },
        { replace: true },
      );
    },
    [setParams, fromKey, toKey, minDate],
  );

  const setPreset = useCallback(
    (id: string) => {
      const preset = getDatePreset(id);
      if (!preset) return;
      const r: DatePresetRange =
        preset.id === 'all'
          ? { start: resolveAllTimeStart(minDate), end: preset.resolve().end }
          : preset.resolve();
      setRange(r);
    },
    [setRange, minDate],
  );

  const setCompare = useCallback(
    (next: boolean) => {
      setParams(
        prev => {
          const p = new Map(prev);
          if (next) p.set(compareKey, 'true');
          else p.delete(compareKey);
          return p;
        },
        { replace: true },
      );
    },
    [setParams, compareKey],
  );

  const reset = useCallback(() => {
    setParams(
      prev => {
        const next = new Map(prev);
        next.delete(fromKey);
        next.delete(toKey);
        next.delete(compareKey);
        return next;
      },
      { replace: true },
    );
  }, [setParams, fromKey, toKey, compareKey]);

  const compare = enableCompare && urlCompare === 'true';
  const comparePrev = useMemo(
    () =>
      compare ? computeComparePrev(effective.start, effective.end) : undefined,
    [compare, effective.start, effective.end],
  );

  const presetId = useMemo(
    () => matchPresetId(effective.start, effective.end),
    [effective.start, effective.end],
  );

  const resolvedTimezone = useMemo(() => {
    if (timezone && timezone.trim()) return timezone;
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }, [timezone]);

  const { startInstant, endInstantExclusive } = useMemo(
    () =>
      calendarRangeToInstants({
        startDate: effective.start,
        endDate: effective.end,
        timezone: resolvedTimezone,
      }),
    [effective.start, effective.end, resolvedTimezone],
  );

  return {
    start: effective.start,
    end: effective.end,
    startInstant,
    endInstantExclusive,
    timezone: resolvedTimezone,
    presetId,
    compare,
    comparePrev,
    setRange,
    setPreset,
    setCompare,
    reset,
  };
}
