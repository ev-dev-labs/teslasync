import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  SelectedVehicleProvider,
  useSelectedVehicleStore,
  __SELECTED_VEHICLE_STORAGE_KEY__,
} from '../selectedVehicle';
import {
  resetProductPreferences,
  updateProductPreferences,
} from '@/lib/productPreferences';

const STORAGE_KEY = __SELECTED_VEHICLE_STORAGE_KEY__;

function wrapper({ children }: { children: ReactNode }) {
  return <SelectedVehicleProvider>{children}</SelectedVehicleProvider>;
}

describe('SelectedVehicleProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetProductPreferences();
  });

  afterEach(() => {
    resetProductPreferences();
    window.localStorage.clear();
  });

  it('starts with null when localStorage is empty', () => {
    const { result } = renderHook(() => useSelectedVehicleStore(), { wrapper });
    expect(result.current.vehicleId).toBeNull();
  });

  it('hydrates from localStorage on mount', () => {
    window.localStorage.setItem(STORAGE_KEY, '42');
    const { result } = renderHook(() => useSelectedVehicleStore(), { wrapper });
    expect(result.current.vehicleId).toBe(42);
  });

  it('uses an explicit default vehicle ahead of the last active vehicle', () => {
    window.localStorage.setItem(STORAGE_KEY, '42');
    updateProductPreferences({ defaultVehicleId: 99 });
    const { result } = renderHook(() => useSelectedVehicleStore(), {
      wrapper,
    });
    expect(result.current.vehicleId).toBe(99);
  });

  it('ignores garbage values in localStorage', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not-a-number');
    const { result } = renderHook(() => useSelectedVehicleStore(), { wrapper });
    expect(result.current.vehicleId).toBeNull();
  });

  it('ignores non-positive ids in localStorage', () => {
    window.localStorage.setItem(STORAGE_KEY, '0');
    const { result } = renderHook(() => useSelectedVehicleStore(), { wrapper });
    expect(result.current.vehicleId).toBeNull();
  });

  it('setVehicleId updates state and persists to localStorage', () => {
    const { result } = renderHook(() => useSelectedVehicleStore(), { wrapper });
    act(() => {
      result.current.setVehicleId(7);
    });
    expect(result.current.vehicleId).toBe(7);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('7');
  });

  it('setVehicleId(null) clears the persisted value', () => {
    window.localStorage.setItem(STORAGE_KEY, '7');
    const { result } = renderHook(() => useSelectedVehicleStore(), { wrapper });
    act(() => {
      result.current.setVehicleId(null);
    });
    expect(result.current.vehicleId).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('responds to cross-tab storage events', () => {
    const { result } = renderHook(() => useSelectedVehicleStore(), { wrapper });
    expect(result.current.vehicleId).toBeNull();
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: STORAGE_KEY, newValue: '99' }),
      );
    });
    expect(result.current.vehicleId).toBe(99);
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: STORAGE_KEY, newValue: null }),
      );
    });
    expect(result.current.vehicleId).toBeNull();
  });

  it('returns a no-op fallback when used outside the provider', () => {
    // The hook is documented to degrade gracefully when no provider is
    // mounted (see useSelectedVehicle.ts), so isolated test renders of
    // page components that read it don't crash.
    const Probe = () => {
      const { vehicleId, setVehicleId } = useSelectedVehicleStore();
      return (
        <div data-testid="probe-vid" data-vid={String(vehicleId)}>
          {typeof setVehicleId === 'function' ? 'fn' : 'not-fn'}
        </div>
      );
    };
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('probe-vid').dataset.vid).toBe('null');
    expect(getByTestId('probe-vid').textContent).toBe('fn');
  });
});
