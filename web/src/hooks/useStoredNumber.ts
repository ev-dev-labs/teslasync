import { useCallback, useEffect, useState } from 'react';

/**
 * A single persisted numeric preference (page-level knob) backed by
 * localStorage, with cross-tab updates via the `storage` event.
 *
 * Lighter than `useLocalStorageSync` (no broadcast-bus message type needed)
 * and lighter than the dedicated-store idiom (`useTripLogbook`) — use this
 * for lone scalar settings like a target value or a calibration offset.
 * Non-finite stored values fall back to `fallback`; writes ignore
 * non-finite input.
 */
export function useStoredNumber(
  key: string,
  fallback: number,
): [number, (next: number) => void] {
  const [value, setValue] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(key);
      const n = raw == null ? NaN : Number(raw);
      return Number.isFinite(n) ? n : fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      const n = e.newValue == null ? NaN : Number(e.newValue);
      setValue(Number.isFinite(n) ? n : fallback);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key, fallback]);

  const set = useCallback(
    (next: number) => {
      if (!Number.isFinite(next)) return;
      setValue(next);
      try {
        localStorage.setItem(key, String(next));
      } catch {
        // Privacy mode / quota — keep the in-memory value for this session.
      }
    },
    [key],
  );

  return [value, set];
}
