import { describe, expect, it } from 'vitest';

import {
  COMPARE_METRIC_SEMANTICS,
  assessDelta,
  pctChange,
} from './periodCompare';

describe('pctChange', () => {
  it('formats signed percentages', () => {
    expect(pctChange(150, 100)).toEqual({
      value: '+50.0%',
      positive: true,
      neutral: false,
    });
    expect(pctChange(50, 100).value).toBe('-50.0%');
    expect(pctChange(50, 100).positive).toBe(false);
  });

  it('marks zero baselines neutral instead of positive', () => {
    expect(pctChange(5, 0)).toEqual({
      value: '—',
      positive: true,
      neutral: true,
    });
  });
});

describe('assessDelta', () => {
  it('treats higher consumption as unfavorable for efficiency (Wh/km)', () => {
    expect(
      assessDelta(COMPARE_METRIC_SEMANTICS.efficiency, 210, 200).favorable,
    ).toBe(false);
    expect(
      assessDelta(COMPARE_METRIC_SEMANTICS.efficiency, 190, 200).favorable,
    ).toBe(true);
  });

  it('treats lower cost and energy as favorable', () => {
    expect(assessDelta(COMPARE_METRIC_SEMANTICS.cost, 80, 100).favorable).toBe(
      true,
    );
    expect(assessDelta(COMPARE_METRIC_SEMANTICS.cost, 120, 100).favorable).toBe(
      false,
    );
    expect(
      assessDelta(COMPARE_METRIC_SEMANTICS.energy, 120, 100).favorable,
    ).toBe(false);
  });

  it('treats more avoided CO2 as favorable', () => {
    expect(assessDelta(COMPARE_METRIC_SEMANTICS.co2, 60, 50).favorable).toBe(
      true,
    );
    expect(assessDelta(COMPARE_METRIC_SEMANTICS.co2, 40, 50).favorable).toBe(
      false,
    );
  });

  it('passes no judgment on neutral context metrics', () => {
    expect(
      assessDelta(COMPARE_METRIC_SEMANTICS.distance, 200, 100).favorable,
    ).toBeNull();
    expect(
      assessDelta(COMPARE_METRIC_SEMANTICS.drives, 50, 100).favorable,
    ).toBeNull();
  });

  it('passes no judgment on zero baselines and zero movement', () => {
    expect(assessDelta(COMPARE_METRIC_SEMANTICS.cost, 50, 0).favorable).toBeNull();
    expect(
      assessDelta(COMPARE_METRIC_SEMANTICS.cost, 100, 100).favorable,
    ).toBeNull();
  });
});

describe('COMPARE_METRIC_SEMANTICS', () => {
  it('covers every compared metric', () => {
    expect(Object.keys(COMPARE_METRIC_SEMANTICS).sort()).toEqual([
      'co2',
      'cost',
      'distance',
      'drives',
      'efficiency',
      'energy',
    ]);
  });
});
