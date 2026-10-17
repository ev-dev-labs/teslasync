import { describe, expect, it } from 'vitest';
import { gaugeTone } from '@/lib/tokens';
import { fakeDrive, fakeUnits } from './fixtures';
import { buildEfficiencyModel, efficiencyColor, EFFICIENCY_GAUGE_MAX_WH_PER_KM } from './model';

describe('efficiencyColor semantic palette', () => {
  // Five ordered raw-Wh/km bands; every boundary stays visually distinct.
  it.each([
    [100, gaugeTone.success],
    [139.9, gaugeTone.success],
    [140, gaugeTone.info],
    [169.9, gaugeTone.info],
    [170, gaugeTone.neutral],
    [199.9, gaugeTone.neutral],
    [200, gaugeTone.warning],
    [239.9, gaugeTone.warning],
    [240, gaugeTone.danger],
    [999, gaugeTone.danger],
  ])('uses the restrained band tone for %s Wh/km', (wh, color) => {
    expect(efficiencyColor(wh)).toBe(color);
    expect(efficiencyColor(wh)).toMatch(/^var\(--(semantic-|text-secondary)/);
  });

  it('keeps the gauge ceiling in Wh/km', () => {
    expect(EFFICIENCY_GAUGE_MAX_WH_PER_KM).toBe(300);
  });
});

describe('populated efficiency model preservation', () => {
  it.each([false, true])('preserves range, series and SI color classification with miles=%s', miles => {
    const prefs = fakeUnits(miles).unitPrefs;
    const start = '2026-10-02T00:00:00Z';
    const end = '2026-10-03T00:00:00Z';
    const included = fakeDrive({ startTs: start, outsideTempAvgC: 10 });
    const rows = [
      fakeDrive({ id: 2, startTs: end }),
      included,
      fakeDrive({ id: 3, startTs: '2026-10-01T23:59:59Z' }),
    ];
    const model = buildEfficiencyModel(rows, prefs, start, end);

    expect(model.filteredDrives).toEqual([included]);
    expect(model.dailyTrend).toEqual([{
      date: expect.any(String),
      efficiency: miles ? 241 : 150,
      distance: model.toDistanceDisplay(50000),
    }]);
    expect(model.speedVsEff).toEqual([{
      speed: miles ? 45 : 72,
      efficiency: miles ? 241 : 150,
    }]);
    expect(model.tempVsEff).toEqual([{
      temp: miles ? 50 : 10,
      efficiency: miles ? 241 : 150,
    }]);
    expect(model.speedDist).toEqual([{
      range: miles ? '30–60 mph' : '60–90 km/h',
      avgEffWhKm: 150,
      avgEff: miles ? 241 : 150,
      count: 1,
    }]);
    expect(efficiencyColor(model.speedDist[0].avgEffWhKm)).toBe(gaugeTone.info);
    expect(model.tempBuckets).toEqual([{
      range: miles ? '50–68°F' : '10–20°C',
      count: 1,
      avgEff: 150,
      totalDist: 50000,
      avgSpeed: 20,
    }]);
    expect(prefs).toEqual(fakeUnits(miles).unitPrefs);
    expect(rows).toHaveLength(3);
  });

  it('retains the newest 30 eligible drives in reversed trend order', () => {
    const rows = Array.from({ length: 31 }, (_, index) =>
      fakeDrive({ id: index + 1, energyUsedWh: (100 + index) * 50 }));
    const model = buildEfficiencyModel(rows, fakeUnits().unitPrefs);

    expect(model.dailyTrend.map(point => point.efficiency)).toEqual(
      Array.from({ length: 30 }, (_, index) => 129 - index),
    );
    expect(model.speedVsEff).toHaveLength(31);
    expect(model.tempVsEff).toHaveLength(31);
  });
});
