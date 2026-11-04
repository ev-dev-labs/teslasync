import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  verifiedChargeActivity, verifiedTelemetryChargeActivity,
  useVerifiedChargeActivity, useTelemetryChargeActivity,
} from './ChargeActivity';

const now = Date.parse('2026-10-29T21:00:00Z');
const source = {
  data: {
    live: true,
    freshness: 'fresh',
    observedAt: now - 1_000,
    verifiedFields: ['is_charging'],
    state: { is_charging: true },
  },
  dataUpdatedAt: now,
};

describe('verified charging activity', () => {
  it('expires verified activity at the observation boundary even if polling stops', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const { result, unmount } = renderHook(() => ({
        state: useVerifiedChargeActivity(source),
        telemetry: useTelemetryChargeActivity({
          data: { charging_state: 'Charging', ts: new Date(now - 1_000).toISOString() },
        }),
      }));
      expect(result.current).toEqual({ state: true, telemetry: true });
      act(() => { vi.advanceTimersByTime(119_000); });
      expect(result.current).toEqual({ state: false, telemetry: false });
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('requires fresh observation evidence for the charging field, not a recently completed poll', () => {
    expect(verifiedChargeActivity(source, now)).toBe(true);
    for (const data of [
      { ...source.data, verifiedFields: [] },
      { ...source.data, observedAt: null },
      { ...source.data, observedAt: now - 120_000 },
      { ...source.data, observedAt: now + 1 },
      { ...source.data, freshness: 'unknown' },
      { ...source.data, live: false },
      { ...source.data, state: { is_charging: false } },
      { ...source.data, state: { is_charging: null } },
    ]) {
      expect(verifiedChargeActivity({ ...source, data }, now)).toBe(false);
    }
  });

  it.each([
    { isError: true },
    { error: new Error('refresh failed') },
    { fetchStatus: 'paused' as const },
    { isLoading: true },
  ])('does not activate retained readings from an unhealthy source: %j', flags => {
    expect(verifiedChargeActivity({ ...source, ...flags }, now)).toBe(false);
  });

  it('only activates a timestamped current charging sample, never a historical total or completed charge', () => {
    const data = { charging_state: 'Charging', ts: new Date(now - 1_000).toISOString() };
    expect(verifiedTelemetryChargeActivity({ data }, now)).toBe(true);
    for (const sample of [
      { ...data, charging_state: 'Complete' },
      { ...data, charging_state: 'Disconnected' },
      { ...data, charging_state: null },
      { ...data, bms_fullcharge_complete: true },
      { ...data, ts: null },
      { ...data, ts: 'invalid' },
      { ...data, ts: new Date(now - 120_000).toISOString() },
    ]) {
      expect(verifiedTelemetryChargeActivity({ data: sample, dataUpdatedAt: now }, now)).toBe(false);
    }
    expect(verifiedTelemetryChargeActivity({ data, isError: true }, now)).toBe(false);
    expect(verifiedTelemetryChargeActivity({ data, fetchStatus: 'paused' }, now)).toBe(false);
  });
});
