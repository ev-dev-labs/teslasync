/**
 * useRangeState — page-level date range state with URL sync, localStorage
 * memory, optional comparison-period resolution, and minDate-clamped "All
 * time" preset.
 *
 * Replaces the per-page boilerplate of:
 *   const [startDate, setStartDate] = useUrlString('from', defaultStart);
 *   const [endDate,   setEndDate]   = useUrlString('to',   defaultEnd);
 *   const setRangeBatch = useUrlBatch();
 *
 * Precedence on initial mount:
 * **URL > shared range > page localStorage > defaultPresetId > today**.
 * Restoring from storage is done with `replace` (no history entry).
 *
 * Why the asymmetric preset/calendar semantics matter:
 *   - Preset clicks (`setRange`) write {from,to} atomically and call onApply.
 *   - Calendar selections inside <RangePicker> stage internally and only
 *     reach this hook on Apply. There is no separate "staged" state here —
 *     <RangePicker> handles it.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DATE_PRESETS,
  getDatePreset,
  matchPresetId,
  resolveAllTimeStart,
  type DatePresetRange,
} from '@/lib/datePresets';
import { calendarRangeToInstants } from '@/lib/dateRange';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const SHARED_RANGE_STORAGE_KEY = 'teslasync.date-range.v1';

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
   * `startInstant` / `endInstantExclusive`. Defaults to the browser's
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
  /** Atomic setter — writes from/to in one navigation. */
  setRange: (range: RangeValue) => void;
  /** Writes the range and related URL keys in one navigation. */
  setRangeWithUrlUpdates: (
    range: RangeValue,
    urlUpdates: Record<string, string | null | undefined>,
  ) => void;
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

function clampRange(range: RangeValue, minDate: string | undefined): RangeValue {
  if (!minDate || range.start >= minDate) return range;
  if (range.end < minDate) return { start: minDate, end: minDate };
  return { start: minDate, end: range.end };
}

function loadFromStorage(storageKey: string | undefined): RangeValue | null {
  if (!storageKey || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.start !== 'string' ||
      typeof record.end !== 'string' ||
      !isValidIsoDate(record.start) ||
      !isValidIsoDate(record.end) ||
      record.start > record.end
    ) {
      return null;
    }
    return { start: record.start, end: record.end };
  } catch {
    return null;
  }
}

function saveToStorage(storageKey: string | undefined, value: RangeValue) {
  if (!storageKey || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // URL state remains authoritative when browser storage is unavailable.
  }
}

function applyUrlUpdates(
  params: URLSearchParams,
  updates?: Record<string, string | null | undefined>,
) {
  if (!updates) return;
  for (const [key, value] of Object.entries(updates)) {
    if (value == null || value === '') {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }
}

/**
 * Compute the previous period of equal length immediately preceding [start, end].
 * For a 7-day window, returns the 7 days before that. End boundary is exclusive
 * of `start` (i.e. previous period ends one day before `start`).
 */
function computeComparePrev(start: string, end: string): RangeValue | undefined {
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

export function useRangeState(opts: UseRangeStateOptions = {}): UseRangeStateReturn {
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

  const [params, setParams] = useSearchParams();

  const urlStart = params.get(fromKey);
  const urlEnd = params.get(toKey);
  const urlCompare = params.get(compareKey);

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

  const sharedStored = loadFromStorage(SHARED_RANGE_STORAGE_KEY);
  const pageStored = loadFromStorage(persistKey);
  const stored = sharedStored ?? pageStored;
  const urlRange: RangeValue | null =
    isValidIsoDate(urlStart) &&
    isValidIsoDate(urlEnd) &&
    urlStart <= urlEnd
      ? { start: urlStart, end: urlEnd }
      : null;

  // Resolve the effective range synchronously to avoid rendering a page
  // default before the inherited selection is restored into the URL.
  const effective = useMemo<RangeValue>(() => {
    if (urlRange) return clampRange(urlRange, minDate);
    if (stored) return clampRange(stored, minDate);
    return fallback;
  }, [
    urlRange?.start,
    urlRange?.end,
    stored?.start,
    stored?.end,
    minDate,
    fallback,
  ]);

  // Seed the shared preference from explicit URLs or legacy page storage,
  // then expose inherited storage in the URL for bookmarks and copied links.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    if (urlRange) {
      saveToStorage(SHARED_RANGE_STORAGE_KEY, urlRange);
      return;
    }

    if (!stored) return;
    const pageStoredIsFallback =
      pageStored?.start === fallback.start && pageStored?.end === fallback.end;
    if (!sharedStored && pageStored && !pageStoredIsFallback) {
      saveToStorage(SHARED_RANGE_STORAGE_KEY, pageStored);
    }
    const inherited = clampRange(stored, minDate);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(fromKey, inherited.start);
        next.set(toKey, inherited.end);
        return next;
      },
      { replace: true },
    );
  }, [
    urlRange?.start,
    urlRange?.end,
    stored?.start,
    stored?.end,
    sharedStored?.start,
    sharedStored?.end,
    pageStored?.start,
    pageStored?.end,
    fallback.start,
    fallback.end,
    minDate,
    fromKey,
    toKey,
    setParams,
  ]);

  // Keep the page key current as a backward-compatible migration fallback.
  useEffect(() => {
    saveToStorage(persistKey, effective);
  }, [persistKey, effective.start, effective.end]);

  const commitRange = useCallback(
    (
      range: RangeValue,
      urlUpdates?: Record<string, string | null | undefined>,
    ) => {
      if (
        !isValidIsoDate(range.start) ||
        !isValidIsoDate(range.end) ||
        range.start > range.end
      ) {
        throw new Error(
          `useRangeState: invalid date range "${range.start}" to "${range.end}"`,
        );
      }

      const pageRange = clampRange(range, minDate);
      saveToStorage(SHARED_RANGE_STORAGE_KEY, range);
      saveToStorage(persistKey, pageRange);
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          applyUrlUpdates(next, urlUpdates);
          next.set(fromKey, pageRange.start);
          next.set(toKey, pageRange.end);
          return next;
        },
        { replace: true },
      );
    },
    [setParams, fromKey, toKey, minDate, persistKey],
  );

  const setRange = useCallback(
    (range: RangeValue) => commitRange(range),
    [commitRange],
  );

  const setRangeWithUrlUpdates = useCallback(
    (
      range: RangeValue,
      urlUpdates: Record<string, string | null | undefined>,
    ) => commitRange(range, urlUpdates),
    [commitRange],
  );

  const setPreset = useCallback(
    (id: string) => {
      const preset = getDatePreset(id);
      if (!preset) return;
      const r: DatePresetRange = preset.resolve();
      setRange(r);
    },
    [setRange],
  );

  const setCompare = useCallback(
    (next: boolean) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
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
    const preset = getDatePreset(defaultPresetId) ?? getDatePreset('30d');
    const defaultRange = preset?.resolve() ?? DATE_PRESETS[3].resolve();
    saveToStorage(SHARED_RANGE_STORAGE_KEY, defaultRange);
    saveToStorage(persistKey, clampRange(defaultRange, minDate));
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(fromKey);
        next.delete(toKey);
        next.delete(compareKey);
        return next;
      },
      { replace: true },
    );
  }, [
    setParams,
    fromKey,
    toKey,
    compareKey,
    defaultPresetId,
    persistKey,
    minDate,
  ]);

  const compare = enableCompare && urlCompare === 'true';
  const comparePrev = useMemo(
    () => (compare ? computeComparePrev(effective.start, effective.end) : undefined),
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
    setRangeWithUrlUpdates,
    setPreset,
    setCompare,
    reset,
  };
}
