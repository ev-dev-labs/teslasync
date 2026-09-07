import { describe, expect, it } from 'vitest';

import type { ParkTruth, VampireSplit } from '@/types/teslaPhysics';
import { deriveVampireCulprits } from './vampireCulprits';

const park = (overrides: Partial<ParkTruth> = {}): ParkTruth => ({
  confirmed_park: true,
  park_confirmed_at: '2026-04-01T04:00:00Z',
  neutral_rolling: false,
  sentry_reported: true,
  sentry_counted: true,
  cabin_overheat_reported: false,
  cabin_overheat_counted: false,
  preconditioning_reported: false,
  preconditioning_counted: false,
  rejected: [],
  honesty: 'Park confirmed.',
  ...overrides,
});

const split = (overrides: Partial<VampireSplit> = {}): VampireSplit => ({
  vehicle_id: 1,
  complete_plugged: [],
  unplugged: [],
  complete_plugged_drain_pct: 0.4,
  unplugged_drain_pct: 1.8,
  honesty: 'Split uses confirmed Park windows.',
  ...overrides,
});

describe('deriveVampireCulprits', () => {
  it('names Sentry as tonight’s action when counted', () => {
    const report = deriveVampireCulprits(park(), split());
    expect(report.tonight).toBe('sentry');
    expect(report.culprits.find((row) => row.id === 'unplugged_leak')?.drainPct).toBe(1.8);
  });

  it('does not invent culprits without park or split', () => {
    const report = deriveVampireCulprits(undefined, undefined);
    expect(report.tonight).toBe('unknown');
    expect(report.culprits.every((row) => !row.active)).toBe(true);
  });
});
