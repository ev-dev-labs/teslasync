import { describe, expect, it } from 'vitest';
import { createInstance } from 'i18next';

import type { ParkTruth, VampireSplit } from '@/types/teslaPhysics';
import { deriveDataState } from '@/api/dataState';
import en from '@/i18n/en.json';
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
  it('returns a stable explanation descriptor without inventing external text', () => {
    const report = deriveVampireCulprits(undefined, undefined);
    expect(report.honesty).toEqual({ key: 'vampireDrain.culprit.honesty', args: {} });
    expect(report.externalHonesty).toEqual([]);
    expect(deriveVampireCulprits(park(), split()).honesty).toEqual(report.honesty);
  });

  it('localizes the complete explanation at display while preserving arbitrary source text', async () => {
    const parkHonesty = '  External {{message}} <Park> text.  ';
    const splitHonesty = 'Texte externe : fenêtre mesurée.';
    const report = deriveVampireCulprits(
      park({ honesty: parkHonesty }), split({ honesty: splitHonesty }),
    );
    expect(report.externalHonesty).toEqual([parkHonesty, splitHonesty]);
    const i18n = createInstance();
    await i18n.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: { translation: en },
        fr: { translation: { vampireDrain: { culprit: { honesty: 'Explication complète traduite.' } } } },
      },
    });
    expect(i18n.t(report.honesty.key, report.honesty.args)).toBe(
      'Sentry, cabin overheat, and preconditioning only count after confirmed Park. Drain percentages are parked windows, not invented watt-hours.',
    );
    await i18n.changeLanguage('fr');
    expect([...report.externalHonesty, i18n.t(report.honesty.key, report.honesty.args)].join(' '))
      .toBe(`${parkHonesty} ${splitHonesty} Explication complète traduite.`);
    expect(report.tonight).toBe('sentry');
    expect(report.culprits[4].drainPct).toBe(1.8);
  });

  it('names Sentry as tonight’s action when counted', () => {
    const report = deriveVampireCulprits(park(), split());
    expect(report.tonight).toBe('sentry');
    expect(report.culprits.find((row) => row.id === 'unplugged_leak')?.drainPct).toBe(1.8);
  });

  it('does not invent culprits without park or split', () => {
    const report = deriveVampireCulprits(undefined, undefined);
    expect(report.tonight).toBe('unknown');
    expect(report.culprits.every((row) => !row.active)).toBe(true);
    expect(report.culprits.slice(0, 3).every((row) => row.status === 'unconfirmed')).toBe(true);
    expect(report.culprits.every((row) => row.evidence === 'missing')).toBe(true);
  });

  it.each([
    { confirmed_park: false, neutral_rolling: false },
    { confirmed_park: true, neutral_rolling: true },
  ])('does not count a reported feature without eligible Park: %j', (overrides) => {
    const report = deriveVampireCulprits(park(overrides), undefined);
    expect(report.culprits[0]).toMatchObject({
      reported: true, parkEligible: false, active: false,
      attribution: 'unconfirmed', status: 'unconfirmed', drainPct: null,
    });
    expect(report.tonight).toBe('unknown');
  });

  it('distinguishes reported On but not counted from confirmed Off', () => {
    const report = deriveVampireCulprits(park({ sentry_counted: false }), undefined);
    expect(report.culprits[0]).toMatchObject({
      reported: true, parkEligible: true, active: false,
      attribution: 'not-counted', status: 'not-counted',
    });
    expect(report.culprits[1]).toMatchObject({
      reported: false, parkEligible: true, active: false, status: 'off',
    });
  });

  it('keeps each reported feature separate from its counted flag', () => {
    const report = deriveVampireCulprits(park({
      sentry_reported: false, sentry_counted: true,
      cabin_overheat_reported: true, cabin_overheat_counted: false,
      preconditioning_reported: true, preconditioning_counted: true,
    }), undefined);
    expect(report.culprits.slice(0, 3).map((row) => row.status))
      .toEqual(['off', 'not-counted', 'on']);
    expect(report.tonight).toBe('precondition');
    expect(report.culprits.slice(0, 3).every((row) => row.drainPct === null)).toBe(true);
  });

  it.each(['fetching', 'paused'] as const)('carries %s without data as unknown, not Off', (fetchStatus) => {
    const source = deriveDataState<ParkTruth>({ isPending: true, fetchStatus }, { provenance: 'live' });
    const report = deriveVampireCulprits(source, undefined);
    expect(report.culprits[0]).toMatchObject({
      active: false, reported: null, parkEligible: null, status: 'unconfirmed',
      evidence: 'missing', source: { status: 'initial', provenance: 'unknown' },
    });
    expect(report.culprits[0].source).toBe(source);
    expect(report.culprits[0].source.isRefreshBlocked).toBe(fetchStatus === 'paused');
    expect(report.tonight).toBe('unknown');
  });

  it('keeps successful empty windows distinct from a measured zero', () => {
    const empty = split({ complete_plugged_drain_pct: null, unplugged_drain_pct: 0 });
    const source = deriveDataState({ data: empty, isSuccess: true }, { provenance: 'historical' });
    const report = deriveVampireCulprits(undefined, source);
    expect(report.culprits[3]).toMatchObject({
      drainPct: null, active: false, attribution: 'missing', status: 'missing', evidence: 'missing',
    });
    expect(report.culprits[4]).toMatchObject({
      drainPct: 0, active: false, attribution: 'measured', status: 'measured', evidence: 'historical',
    });
    expect(report.culprits[4].source.status).toBe('ok');
    expect(report.tonight).toBe('unknown');
  });

  it('retains bytes and independent source trust on refresh failure and recovery', () => {
    const retainedPark = park();
    const retainedSplit = split();
    const before = JSON.stringify({ retainedPark, retainedSplit });
    const error = new Error('Refresh failed');
    const failedPark = deriveDataState(
      { data: retainedPark, error, dataUpdatedAt: 100 },
      { provenance: 'live', now: () => 200 },
    );
    const healthySplit = deriveDataState({ data: retainedSplit }, { provenance: 'historical' });
    const report = deriveVampireCulprits(failedPark, healthySplit);
    expect(report.culprits[0]).toMatchObject({
      reported: true, active: true, attribution: 'counted', evidence: 'stale',
      source: { provenance: 'cached', status: 'stale', refreshError: error, updatedAt: 100 },
    });
    expect(report.culprits[0].source.data).toBe(retainedPark);
    expect(report.culprits[3]).toMatchObject({ drainPct: 0.4, evidence: 'historical' });
    expect(report.tonight).toBe('plugged_complete');

    const failedSplit = deriveDataState(
      { data: retainedSplit, error }, { provenance: 'historical' },
    );
    const failed = deriveVampireCulprits(failedPark, failedSplit);
    expect(failed.culprits[4]).toMatchObject({ drainPct: 1.8, active: true, evidence: 'stale' });
    expect(failed.culprits[4].source.data).toBe(retainedSplit);
    expect(failed.tonight).toBe('unknown');

    const recoveredPark = deriveDataState({ data: retainedPark, isSuccess: true }, { provenance: 'live' });
    const recovered = deriveVampireCulprits(recoveredPark, healthySplit);
    expect(recovered.culprits[0]).toMatchObject({
      evidence: 'live', source: { status: 'ok', refreshError: null },
    });
    expect(recovered.culprits[4].evidence).toBe('historical');
    expect(recovered.tonight).toBe('sentry');
    expect(JSON.stringify({ retainedPark, retainedSplit })).toBe(before);
  });

  it('preserves retained reported state while refresh is paused', () => {
    const source = deriveDataState(
      { data: park(), fetchStatus: 'paused' }, { provenance: 'live' },
    );
    const report = deriveVampireCulprits(source, undefined);
    expect(report.culprits[0]).toMatchObject({
      status: 'on', active: true, evidence: 'stale',
      source: { isRefreshBlocked: true, refreshError: null },
    });
    expect(report.tonight).toBe('unknown');
  });

  it.each([NaN, Infinity, -Infinity])('does not invent drain for non-finite %s', (value) => {
    const report = deriveVampireCulprits(undefined, split({ unplugged_drain_pct: value }));
    expect(report.culprits[4]).toMatchObject({ drainPct: null, evidence: 'missing', status: 'missing' });
  });
});
