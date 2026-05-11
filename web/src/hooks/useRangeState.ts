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
 * Precedence on initial mount: **URL > localStorage > defaultPresetId > today**.
 * Restoring from localStorage is done with `replace` (no history entry).
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
}

export interface RangeValue {
  start: string;
  end: string;
}

export interface UseRangeStateReturn {
  start: string;
  end: string;
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
  if (!persistKey || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(persistKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RangeValue> | null;
    if (!parsed || !isValidIsoDate(parsed.start) || !isValidIsoDate(parsed.end)) return null;
    if (parsed.start > parsed.end) return null;
    return { start: parsed.start, end: parsed.end };
  } catch {
    return null;
  }
}

function saveToStorage(persistKey: string | undefined, value: RangeValue) {
  if (!persistKey || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(persistKey, JSON.stringify(value));
  } catch {
    /* storage full / disabled — silently ignore */
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

  // Resolve the effective range using URL > localStorage > fallback.
  const effective = useMemo<RangeValue>(() => {
    if (isValidIsoDate(urlStart) && isValidIsoDate(urlEnd) && urlStart <= urlEnd) {
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
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(fromKey, start);
        next.set(toKey, end);
        return next;
      },
      { replace: true },
    );
    // Intentionally only run on mount — see ref guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on every effective change.
  useEffect(() => {
    saveToStorage(persistKey, effective);
  }, [persistKey, effective.start, effective.end]);

  const setRange = useCallback(
    (range: RangeValue) => {
      const start = clampToMin(range.start, minDate);
      const end = clampToMin(range.end, minDate);
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
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
  }, [setParams, fromKey, toKey, compareKey]);

  const compare = enableCompare && urlCompare === 'true';
  const comparePrev = useMemo(
    () => (compare ? computeComparePrev(effective.start, effective.end) : undefined),
    [compare, effective.start, effective.end],
  );

  const presetId = useMemo(
    () => matchPresetId(effective.start, effective.end),
    [effective.start, effective.end],
  );

  return {
    start: effective.start,
    end: effective.end,
    presetId,
    compare,
    comparePrev,
    setRange,
    setPreset,
    setCompare,
    reset,
  };
}
