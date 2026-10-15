import { describe, expect, it } from 'vitest';
import type { EfficiencyBucket } from '@/api/hooks/useAnalytics';
import { interpolateRange, matrixTone, scenarioIcon } from './helpers';
import { severityTokens } from '@/lib/tokens';
import { isValidElement } from 'react';
import { Car, Shield, Snowflake, Zap } from 'lucide-react';

const bucket = (wh_km: number): EfficiencyBucket => ({
  temp_bucket: 'mild', speed_bucket: 'suburban', wh_km, samples: 3,
});

describe('projected range calculation', () => {
  it('identifies the learned bucket and retains first-match lookup rather than interpolation', () => {
    const result = interpolateRange([bucket(180.25), bucket(200)], 70, 20, 63.75, 75123.5);
    expect(result).toMatchObject({
      effWhKm: 180.3, rangeKm: 265.7, efficiencySource: 'learned-bucket',
      bucketStatus: 'valid', rangeInputsKnown: true, conditionsKnown: true,
    });
  });

  it('identifies the missing-bucket heuristic and retains the formula', () => {
    expect(interpolateRange([], 100, 20, 100, 80000)).toMatchObject({
      effWhKm: 187.5, rangeKm: 426.7,
      efficiencySource: 'heuristic', bucketStatus: 'missing',
    });
  });

  it.each([0, -10, NaN, Infinity, -Infinity])('identifies invalid bucket efficiency %s without changing the 170 guard', whKm => {
    expect(interpolateRange([bucket(whKm)], 70, 20, 100, 80000)).toMatchObject({
      effWhKm: 170, rangeKm: 470.6, efficiencySource: 'safety-default', bucketStatus: 'invalid',
    });

  });

  it.each([null, undefined])('distinguishes missing bucket efficiency (%s) from a measured zero', wh_km => {
    expect(interpolateRange([{ ...bucket(180), wh_km }], 70, 20, 50, 80000)).toMatchObject({
      effWhKm: 172.5, rangeKm: 231.9, efficiencySource: 'heuristic', bucketStatus: 'invalid',
    });
  });

  it.each([null, undefined, NaN, Infinity, -Infinity])('keeps missing/invalid energy inputs separate from measured zero (%s)', value => {
    for (const result of [
      interpolateRange([], 70, 20, value, 80000),
      interpolateRange([], 70, 20, 50, value),
    ]) {
      expect(result.rangeKm).toBe(0);
      expect(result.rangeInputsKnown).toBe(false);
    }
    expect(interpolateRange([], 70, 20, 0, 80000)).toMatchObject({ rangeKm: 0, rangeInputsKnown: true });
    expect(interpolateRange([], 70, 20, 50, 0)).toMatchObject({ rangeKm: 0, rangeInputsKnown: true });
  });

  it('retains signed temperatures, fractional inputs and the cold penalty', () => {
    expect(interpolateRange([], 70.5, -5.25, 50.5, 80000.5)).toMatchObject({
      effWhKm: 210.6, rangeKm: 191.8, conditionsKnown: true,
    });
    expect(interpolateRange([], 0, 0, 50, 80000)).toMatchObject({
      effWhKm: 167.5, rangeKm: 238.8, conditionsKnown: true,
    });
  });

  it('retains battery bounds and rejects negative capacity without treating it as measured zero', () => {
    expect(interpolateRange([], 70, 20, -5, 80000).rangeKm).toBe(0);
    expect(interpolateRange([], 70, 20, 105, 80000).rangeKm).toBe(463.8);
    expect(interpolateRange([], 70, 20, 50, -1)).toMatchObject({ rangeKm: 0, rangeInputsKnown: false });
  });

  it.each([null, undefined, NaN, Infinity, -Infinity])('marks missing/invalid conditions unknown (%s)', value => {
    expect(interpolateRange([], value, 20, 50, 80000)).toMatchObject({
      effWhKm: 170, efficiencySource: 'safety-default', conditionsKnown: false,
    });

    expect(interpolateRange([], 70, value, 50, 80000).conditionsKnown).toBe(false);
  });

  it.each([null, undefined])('accepts a missing matrix (%s) without inventing learned data', matrix => {
    expect(interpolateRange(matrix, 70, 20, 50, 80000)).toMatchObject({
      effWhKm: 172.5, rangeKm: 231.9, efficiencySource: 'heuristic', bucketStatus: 'missing',
    });
  });

  it('exposes invalid conditions even when comparison fallthrough selects a learned bucket', () => {
    expect(interpolateRange([{ ...bucket(190), speed_bucket: 'highway' }], NaN, 20, 50, 80000))
      .toMatchObject({ efficiencySource: 'learned-bucket', conditionsKnown: false });
  });

  it.each([
    [-0.1, 'freezing'], [0, 'cold'], [9.99, 'cold'],
    [10, 'mild'], [24.99, 'mild'], [25, 'hot'],
  ])('retains the temperature boundary %s', (temp, temp_bucket) => {
    expect(interpolateRange([{ ...bucket(190), temp_bucket }], 70, temp, 50, 80000).effWhKm).toBe(190);
  });

  it.each([[49.99, 'city'], [50, 'suburban'], [89.99, 'suburban'], [90, 'highway']])(
    'retains the speed boundary %s', (speed, speed_bucket) => {
      expect(interpolateRange([{ ...bucket(190), speed_bucket }], speed, 20, 50, 80000).effWhKm).toBe(190);
    },
  );
});

describe('existing projected range presentation helpers', () => {
  it('retains semantic tone thresholds', () => {
    expect([155, 155.1, 180, 180.1, 210, 210.1].map(matrixTone)).toEqual([
      severityTokens.success.bg, severityTokens.info.bg, severityTokens.info.bg,
      severityTokens.warn.bg, severityTokens.warn.bg, severityTokens.critical.bg,
    ]);
  });

  it.each([
    [['sentry'], -5, 100, Shield], [[], -5, 100, Snowflake],
    [[], 0, 100, Car], [[], 0, 90, Zap],
  ])('retains scenario icon priority for %s, %s, %s', (extras, temp_c, speed_kmh, icon) => {
    const result = scenarioIcon({
      name: 'test', extras, temp_c, speed_kmh, efficiency_wh_km: 180,
      range_km: 250, sample_count: 3,
    });
    expect(isValidElement(result) && result.type).toBe(icon);
  });
});
