/**
 * useRangeState — page-level date range state with URL sync, localStorage
 * preference, optional comparison-period resolution, and minDate clamping.
 *
 * Replaces the per-page boilerplate of:
 *   const [startDate, setStartDate] = useUrlString('from', defaultStart);
 *   const [endDate,   setEndDate]   = useUrlString('to',   defaultEnd);
 *   const setRangeBatch = useUrlBatch();
 *
 * Precedence on initial mount:
 * **URL > shared preference > page preference > defaultPresetId > 7 days**.
 * URL ranges are navigation-specific and never overwrite the global
 * preference unless the user commits a new picker selection.
 *
 * Why the asymmetric preset/calendar semantics matter:
 *   - Preset clicks (`setRange`) write {from,to} atomically and call onApply.
 *   - Calendar selections inside <RangePicker> stage internally and only
 *     reach this hook on Apply. There is no separate "staged" state here —
 *     <RangePicker> handles it.
 */

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  getDatePreset,
  matchPresetId,
  type DatePresetRange,
} from '@/lib/datePresets';
import { calendarRangeToInstants } from '@/lib/dateRange';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_PRESET_ID = '7d';
const RANGE_PREFERENCE_VERSION = 2;

export const SHARED_RANGE_STORAGE_KEY = 'teslasync.date-range.v2';

export interface UseRangeStateOptions {
  /**
   * Preset id to use when neither URL nor a stored preference yields a range.
   * Defaults to `'7d'`.
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
   * Optional page-specific backup for the shared date-range preference.
   * Recommended: a dotted key like `'charging.list.range'`.
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

interface StoredRangePreference extends RangeValue {
  version: typeof RANGE_PREFERENCE_VERSION;
  presetId?: string;
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
  /** Atomic setter — writes from/to and the shared preference. */
  setRange: (range: RangeValue, presetId?: string) => void;
  /** Writes the range and related URL keys in one navigation. */
  setRangeWithUrlUpdates: (
    range: RangeValue,
    urlUpdates: Record<string, string | null | undefined>,
    presetId?: string,
  ) => void;
  /** Reset the range and update related URL keys in one navigation. */
  resetWithUrlUpdates: (
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

function getFallbackPreset(id: string) {
  const preset = getDatePreset(id) ?? getDatePreset(DEFAULT_PRESET_ID);
  if (!preset) {
    throw new Error(`useRangeState: missing "${DEFAULT_PRESET_ID}" date preset`);
  }
  return preset;
}

function loadFromStorage(
  storageKey: string | undefined,
): StoredRangePreference | null {
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
      record.version !== RANGE_PREFERENCE_VERSION ||
      !isValidIsoDate(record.start) ||
      !isValidIsoDate(record.end) ||
      record.start > record.end
    ) {
      return null;
    }
    const presetId =
      typeof record.presetId === 'string' && getDatePreset(record.presetId)
        ? record.presetId
        : undefined;
    return {
      version: RANGE_PREFERENCE_VERSION,
      start: record.start,
      end: record.end,
      ...(presetId ? { presetId } : {}),
    };
  } catch {
    return null;
  }
}

function saveToStorage(
  storageKey: string | undefined,
  value: StoredRangePreference,
) {
  if (!storageKey || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // URL state remains authoritative when browser storage is unavailable.
  }
}

function resolvePreference(preference: StoredRangePreference): RangeValue {
  const preset = preference.presetId
    ? getDatePreset(preference.presetId)
    : undefined;
  return preset?.resolve() ?? {
    start: preference.start,
    end: preference.end,
  };
}

function createPreference(
  range: RangeValue,
  requestedPresetId?: string,
): StoredRangePreference {
  const presetId =
    requestedPresetId && getDatePreset(requestedPresetId)
      ? requestedPresetId
      : matchPresetId(range.start, range.end);
  return {
    version: RANGE_PREFERENCE_VERSION,
    start: range.start,
    end: range.end,
    ...(presetId ? { presetId } : {}),
  };
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
    defaultPresetId = DEFAULT_PRESET_ID,
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
  const fallback = useMemo<RangeValue>(
    () => clampRange(getFallbackPreset(defaultPresetId).resolve(), minDate),
    [defaultPresetId, minDate],
  );

  const sharedPreference = loadFromStorage(SHARED_RANGE_STORAGE_KEY);
  const pagePreference = loadFromStorage(persistKey);
  const storedPreference = sharedPreference ?? pagePreference;
  const storedRange = storedPreference
    ? resolvePreference(storedPreference)
    : null;
  const urlRange: RangeValue | null =
    isValidIsoDate(urlStart) &&
    isValidIsoDate(urlEnd) &&
    urlStart <= urlEnd
      ? { start: urlStart, end: urlEnd }
      : null;

  // Resolve synchronously so inherited preferences never flash the page
  // fallback before the first paint.
  const effective = useMemo<RangeValue>(() => {
    if (urlRange) return clampRange(urlRange, minDate);
    if (storedRange) return clampRange(storedRange, minDate);
    return fallback;
  }, [
    urlRange?.start,
    urlRange?.end,
    storedRange?.start,
    storedRange?.end,
    minDate,
    fallback,
  ]);

  const commitRange = useCallback(
    (
      range: RangeValue,
      urlUpdates?: Record<string, string | null | undefined>,
      presetId?: string,
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
      const preference = createPreference(range, presetId);
      saveToStorage(SHARED_RANGE_STORAGE_KEY, preference);
      saveToStorage(persistKey, preference);
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
    (range: RangeValue, presetId?: string) =>
      commitRange(range, undefined, presetId),
    [commitRange],
  );

  const setRangeWithUrlUpdates = useCallback(
    (
      range: RangeValue,
      urlUpdates: Record<string, string | null | undefined>,
      presetId?: string,
    ) => commitRange(range, urlUpdates, presetId),
    [commitRange],
  );

  const setPreset = useCallback(
    (id: string) => {
      const preset = getDatePreset(id);
      if (!preset) return;
      const r: DatePresetRange = preset.resolve();
      setRange(r, id);
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

  const resetWithUrlUpdates = useCallback((
    urlUpdates: Record<string, string | null | undefined>,
  ) => {
    const preset = getFallbackPreset(defaultPresetId);
    const defaultRange = preset.resolve();
    const preference = createPreference(defaultRange, preset.id);
    saveToStorage(SHARED_RANGE_STORAGE_KEY, preference);
    saveToStorage(persistKey, preference);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        applyUrlUpdates(next, urlUpdates);
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
  ]);

  const reset = useCallback(
    () => resetWithUrlUpdates({}),
    [resetWithUrlUpdates],
  );

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
    resetWithUrlUpdates,
    setPreset,
    setCompare,
    reset,
  };
}
