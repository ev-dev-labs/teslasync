import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAlertContext } from '../useAlertContext';

function withRouter(initialEntries: string[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>;
  };
}

describe('useAlertContext', () => {
  it('returns nulls and hasContext=false when no params present', () => {
    const { result } = renderHook(() => useAlertContext(), {
      wrapper: withRouter(['/battery']),
    });
    expect(result.current.vehicleId).toBeNull();
    expect(result.current.timestamp).toBeNull();
    expect(result.current.signal).toBeNull();
    expect(result.current.timeWindow).toBeNull();
    expect(result.current.hasContext).toBe(false);
  });

  it('parses vehicle_id, t, signal and computes a ±30min window', () => {
    const { result } = renderHook(() => useAlertContext(), {
      wrapper: withRouter([
        '/battery?vehicle_id=12&t=2026-04-30T13:00:00.000Z&signal=BatteryLevel',
      ]),
    });
    expect(result.current.vehicleId).toBe(12);
    expect(result.current.timestamp).toBe('2026-04-30T13:00:00.000Z');
    expect(result.current.signal).toBe('BatteryLevel');
    expect(result.current.timeWindow).toEqual({
      from: '2026-04-30T12:30:00.000Z',
      to: '2026-04-30T13:30:00.000Z',
    });
    expect(result.current.hasContext).toBe(true);
  });

  it('returns null vehicleId when the param is non-numeric', () => {
    const { result } = renderHook(() => useAlertContext(), {
      wrapper: withRouter(['/battery?vehicle_id=oops']),
    });
    expect(result.current.vehicleId).toBeNull();
  });

  it('returns null timeWindow when the timestamp is invalid', () => {
    const { result } = renderHook(() => useAlertContext(), {
      wrapper: withRouter(['/battery?t=not-a-date']),
    });
    expect(result.current.timestamp).toBe('not-a-date');
    expect(result.current.timeWindow).toBeNull();
    // Even an invalid timestamp counts as context (the URL was decorated).
    expect(result.current.hasContext).toBe(true);
  });

  it('hasContext is true when at least one param is present', () => {
    const { result } = renderHook(() => useAlertContext(), {
      wrapper: withRouter(['/battery?signal=BatteryLevel']),
    });
    expect(result.current.signal).toBe('BatteryLevel');
    expect(result.current.hasContext).toBe(true);
  });
});
