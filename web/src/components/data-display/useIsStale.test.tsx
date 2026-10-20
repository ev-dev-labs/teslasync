/**
 * useIsStale — stale/offline thresholds and the observation-age label used
 * inside evidence text.
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useIsStale } from './useIsStale';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v)),
        fallback,
      );
    },
  }),
}));

const BASE = new Date('2026-07-05T12:00:00.000Z').getTime();

/** ISO timestamp for a datum sampled `secondsAgo` seconds before the frozen clock. */
const ago = (secondsAgo: number): string => new Date(BASE - secondsAgo * 1000).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useIsStale', () => {
  it('reports a fresh timestamp as neither stale nor offline', () => {
    const { result } = renderHook(() => useIsStale(ago(30)));
    expect(result.current.isStale).toBe(false);
    expect(result.current.isOffline).toBe(false);
    expect(result.current.ageLabel).toBe('30s ago');
  });

  it('flags a stale-but-online timestamp', () => {
    const { result } = renderHook(() => useIsStale(ago(300)));
    expect(result.current.isStale).toBe(true);
    expect(result.current.isOffline).toBe(false);
    expect(result.current.ageLabel).toBe('5m ago');
  });

  it('flags an offline timestamp as both stale and offline', () => {
    const { result } = renderHook(() => useIsStale(ago(1200)));
    expect(result.current.isStale).toBe(true);
    expect(result.current.isOffline).toBe(true);
    expect(result.current.ageLabel).toBe('20m ago');
  });

  it('honours a custom stale threshold', () => {
    const { result } = renderHook(() => useIsStale(ago(30), 20));
    expect(result.current.isStale).toBe(true);
    expect(result.current.isOffline).toBe(false);
  });

  it('honours a custom offline threshold', () => {
    const { result } = renderHook(() => useIsStale(ago(300), 120, 200));
    expect(result.current.isStale).toBe(true);
    expect(result.current.isOffline).toBe(true);
  });

  it('reports a null timestamp as unknown with an em-dash label', () => {
    const { result } = renderHook(() => useIsStale(null));
    expect(result.current.isStale).toBe(false);
    expect(result.current.isOffline).toBe(false);
    expect(result.current.ageLabel).toBe('—');
  });

  it('degrades a malformed timestamp to a safe em-dash (never NaN)', () => {
    const { result } = renderHook(() => useIsStale('nonsense'));
    expect(result.current.isStale).toBe(false);
    expect(result.current.isOffline).toBe(false);
    expect(result.current.ageLabel).toBe('—');
    expect(result.current.ageLabel).not.toContain('NaN');
  });
});
