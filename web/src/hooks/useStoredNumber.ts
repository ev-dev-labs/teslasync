import { useCallback, useEffect, useState } from 'react';

/**
 * A single persisted numeric preference (page-level knob) backed by
 * localStorage, with cross-tab updates via the `storage` event.
 *
 * Lighter than `useLocalStorageSync` (no broadcast-bus message type needed)
 * and lighter than the dedicated-store idiom (`useTripLogbook`) — use this
 * for lone scalar settings like a target value or a calibration offset.
 * Non-finite stored values fall back to `fallback`; writes ignore
 * non-finite input. The third tuple entry retains the raw saved value for
 * callers with domain-specific admission and recovery requirements.
 */
export function useStoredNumber(
  key: string,
  fallback: number,
): [number, (next: number) => void, string | null] {
  function read() {
    try {
      const raw = localStorage.getItem(key);
      const n = raw == null ? NaN : Number(raw);
      return { key, raw, value: Number.isFinite(n) ? n : fallback };
    } catch {
      return { key, raw: null, value: fallback };
    }
  }
  const [snapshot, setSnapshot] = useState(read);
  // Synchronize before descendants render, not in an effect with the old value.
  const current = snapshot.key === key ? snapshot : read();
  if (snapshot.key !== key) setSnapshot(current);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      const n = e.newValue == null ? NaN : Number(e.newValue);
      setSnapshot({ key, raw: e.newValue, value: Number.isFinite(n) ? n : fallback });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key, fallback]);

  const set = useCallback(
    (next: number) => {
      if (!Number.isFinite(next)) return;
      setSnapshot((previous) => previous.key === key
        ? { key, raw: String(next), value: next }
        : previous);
      try {
        localStorage.setItem(key, String(next));
      } catch {
        // Privacy mode / quota — keep the in-memory value for this session.
      }
    },
    [key],
  );

  return [current.value, set, current.raw];
}
