import { describe, expect, it, vi } from 'vitest';
import { firmwareImpactState } from './firmwareImpactState';

describe('firmware comparisons require both real source answers', () => {
  it('keeps exact histories through either or both background refresh failures', () => {
    const drives = [{ id: 1, energyUsedWh: 4500, distanceM: 30000 }];
    const updates = [{ version: '2026.20', installedAt: '2026-04-01' }];
    const failure = new Error('offline');
    for (const [driveFailure, updateFailure] of [[true, false], [false, true], [true, true]]) {
      const state = firmwareImpactState(
        { data: drives, error: driveFailure ? failure : null, isFetching: true },
        { data: updates, error: updateFailure ? failure : null },
      );
      expect(state.drives.data).toBe(drives);
      expect(state.updates.data).toBe(updates);
      expect(state.hasInputs).toBe(true);
      expect(state.retained).toBe(true);
      expect(state.loading).toBe(false);
      expect(state.fatalError).toBeNull();
    }
  });

  it('does not discard a successful neighbor or invent its absent counterpart', () => {
    const drives = [{ id: 1 }];
    const retry = vi.fn();
    const failure = new Error('updates unavailable');
    const state = firmwareImpactState(
      { data: drives },
      { error: failure, isError: true, refetch: retry },
    );
    expect(state.drives.data).toBe(drives);
    expect(state.updates.data).toBeUndefined();
    expect(state.hasInputs).toBe(false);
    expect(state.fatalError).toBe(failure);
    state.updates.retry?.();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('an initial failure takes priority over the other source still loading', () => {
    const failure = new Error('drive history unavailable');
    const state = firmwareImpactState({ error: failure }, { isPending: true });
    expect(state.fatalError).toBe(failure);
    expect(state.loading).toBe(false);
  });

  it('resolved empty histories are known answers, not initial failures', () => {
    const state = firmwareImpactState({ data: [] }, { data: [] });
    expect(state.hasInputs).toBe(true);
    expect(state.fatalError).toBeNull();
    expect(state.loading).toBe(false);
  });

  it('does not treat a pending or offline missing source as an empty history', () => {
    const state = firmwareImpactState({ data: [] }, { isPending: true, fetchStatus: 'paused' });
    expect(state.hasInputs).toBe(false);
    expect(state.updates.hasData).toBe(false);
    expect(state.loading).toBe(true);
    expect(state.fatalError).toBeNull();
  });

  it('retains both sources during paused refresh without requiring an error', () => {
    const state = firmwareImpactState({ data: [], fetchStatus: 'paused' }, { data: [] });
    expect(state.retained).toBe(true);
    expect(state.hasInputs).toBe(true);
    expect(state.fatalError).toBeNull();
  });
});
