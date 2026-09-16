import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useAnalysisWindow } from './useAnalysisWindow';

const presets = [7, 30];
describe('analysis scope', () => {
  it('restores bookmarked absolute bounds', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={['/?days=7&start=2026-01-01T00:00:00Z&end=2026-01-08T00:00:00Z']}>{children}</MemoryRouter>
    );
    const { result } = renderHook(() => useAnalysisWindow('days', presets, 7), { wrapper });
    expect(result.current.window.start).toBe('2026-01-01T00:00:00.000Z');
    expect(result.current.window.end).toBe('2026-01-08T00:00:00.000Z');
  });
  it('persists the preset and bounds without dropping vehicle scope', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={['/?vehicle_id=3']}>{children}</MemoryRouter>;
    const { result } = renderHook(() => ({ scope: useAnalysisWindow('days', presets, 7), location: useLocation() }), { wrapper });
    act(() => { result.current.scope.pickWindow(30); });
    const params = new URLSearchParams(result.current.location.search);
    expect(params.get('vehicle_id')).toBe('3');
    expect(params.get('days')).toBe('30');
    expect(Date.parse(params.get('end') ?? '') - Date.parse(params.get('start') ?? '')).toBe(30 * 24 * 3600000);
  });
});
