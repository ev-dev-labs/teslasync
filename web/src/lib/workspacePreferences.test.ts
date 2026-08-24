import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WORKSPACE_DENSITY_EVENT,
  WORKSPACE_RANGE_EVENT,
  dispatchWorkspaceDensity,
  dispatchWorkspaceRangePreset,
  isWorkspaceDensity,
  isWorkspaceRangePreset,
} from './workspacePreferences';

describe('workspacePreferences', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts only supported range and density values', () => {
    expect(isWorkspaceRangePreset('today')).toBe(true);
    expect(isWorkspaceRangePreset('all')).toBe(true);
    expect(isWorkspaceRangePreset('custom')).toBe(false);
    expect(isWorkspaceRangePreset(null)).toBe(false);

    expect(isWorkspaceDensity('compact')).toBe(true);
    expect(isWorkspaceDensity('spacious')).toBe(true);
    expect(isWorkspaceDensity('dense')).toBe(false);
    expect(isWorkspaceDensity(undefined)).toBe(false);
  });

  it('dispatches typed range and density events', () => {
    const rangeListener = vi.fn();
    const densityListener = vi.fn();
    window.addEventListener(WORKSPACE_RANGE_EVENT, rangeListener);
    window.addEventListener(WORKSPACE_DENSITY_EVENT, densityListener);

    dispatchWorkspaceRangePreset('30d');
    dispatchWorkspaceDensity('comfortable');

    expect(rangeListener).toHaveBeenCalledOnce();
    expect((rangeListener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      preset: '30d',
    });
    expect(densityListener).toHaveBeenCalledOnce();
    expect((densityListener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      density: 'comfortable',
    });

    window.removeEventListener(WORKSPACE_RANGE_EVENT, rangeListener);
    window.removeEventListener(WORKSPACE_DENSITY_EVENT, densityListener);
  });
});
