import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Text } from '@/components/ui/Typography';
import type { Drive } from '@/types/driving';
import {
  avgGrade,
  computePeriodStats,
  dailyTrend,
  getEnergyIntensityWhPerKm,
  gradeFromEfficiency,
  gradeFromNumeric,
} from '../drivesAggregation';

function drive(overrides: Partial<Drive> = {}): Drive {
  return {
    id: 1,
    vehicleId: 1,
    startTs: '2026-05-10T10:00:00Z',
    endTs: '2026-05-10T10:30:00Z',
    durationS: 1_800,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: null,
    endBatteryPct: null,
    energyUsedWh: 1_000,
    regenEnergyWh: null,
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '2026-05-10T10:00:00Z',
    updatedAt: '2026-05-10T10:30:00Z',
    ...overrides,
  };
}

describe('drive grade display roles preserve domain boundaries', () => {
  it.each([
    [129.999, 'A+', 4.5, 'success'],
    [130, 'A', 4, 'success'],
    [159.999, 'A', 4, 'success'],
    [160, 'B', 3, 'info'],
    [189.999, 'B', 3, 'info'],
    [190, 'C', 2, 'warning'],
    [219.999, 'C', 2, 'warning'],
    [220, 'D', 1, 'danger'],
  ] as const)('keeps efficiency %s at grade %s and weight %s', (value, label, numeric, role) => {
    expect(gradeFromEfficiency(value)).toEqual({
      label, numeric, color: `var(--semantic-${role})`,
    });
  });

  it.each([
    [4.25, 'A+', 4.5, 'success'],
    [4.249, 'A', 4, 'success'],
    [3.5, 'A', 4, 'success'],
    [3.499, 'B', 3, 'info'],
    [2.5, 'B', 3, 'info'],
    [2.499, 'C', 2, 'warning'],
    [1.5, 'C', 2, 'warning'],
    [1.499, 'D', 1, 'danger'],
  ] as const)('keeps numeric %s at grade %s and weight %s', (value, label, numeric, role) => {
    expect(gradeFromNumeric(value)).toEqual({
      label, numeric, color: `var(--semantic-${role})`,
    });
  });

  it('retains every grade identity, order and round-trip weight', () => {
    const grades = [120, 150, 180, 210, 250, null].map(gradeFromEfficiency);
    expect(grades.map(({ label }) => label)).toEqual(['A+', 'A', 'B', 'C', 'D', '—']);
    expect(grades.map(({ numeric }) => numeric)).toEqual([4.5, 4, 3, 2, 1, null]);
    for (const grade of grades) {
      expect(gradeFromNumeric(grade.numeric)).toEqual(grade);
    }
  });

  it('does not reinterpret measured zero or signed finite direct inputs', () => {
    expect(gradeFromEfficiency(0)).toEqual(gradeFromEfficiency(120));
    expect(gradeFromEfficiency(-1)).toEqual(gradeFromEfficiency(120));
    expect(gradeFromNumeric(0)).toEqual(gradeFromNumeric(1));
    expect(gradeFromNumeric(-1)).toEqual(gradeFromNumeric(1));
  });

  it('preserves the direct efficiency NaN and infinity behavior, without silently repairing it', () => {
    expect(gradeFromEfficiency(Number.NaN)).toEqual(gradeFromEfficiency(220));
    expect(gradeFromEfficiency(Number.POSITIVE_INFINITY)).toEqual(gradeFromEfficiency(220));
    expect(gradeFromEfficiency(Number.NEGATIVE_INFINITY)).toEqual(gradeFromEfficiency(120));
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'retains unknown numeric input %s as unweighted muted ink',
    (value) => {
      expect(gradeFromNumeric(value)).toEqual({
        label: '—', numeric: null, color: 'var(--text-muted)',
      });
    },
  );

  it('retains missing efficiency as unknown rather than measured zero', () => {
    expect(gradeFromEfficiency(null)).toEqual({
      label: '—', numeric: null, color: 'var(--text-muted)',
    });
    expect(gradeFromEfficiency(null)).not.toEqual(gradeFromEfficiency(0));
  });
});

describe('grade palette leaves canonical SI measurement and aggregation intact', () => {
  it.each([null, undefined, 0, -1, 999, Number.NaN, Number.POSITIVE_INFINITY])(
    'retains an ungradable distance of %s',
    (distanceM) => {
      expect(getEnergyIntensityWhPerKm(distanceM, 130)).toBeNull();
    },
  );

  it.each([null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'retains an ungradable measured energy of %s',
    (energyUsedWh) => {
      expect(getEnergyIntensityWhPerKm(1_000, energyUsedWh)).toBeNull();
    },
  );

  it('keeps the exact 1 km quality floor and Wh/km arithmetic', () => {
    expect(getEnergyIntensityWhPerKm(1_000, 130)).toBe(130);
    expect(getEnergyIntensityWhPerKm(40_000, 7_000)).toBe(175);
    expect(gradeFromEfficiency(getEnergyIntensityWhPerKm(1_000, 130)).label).toBe('A');
  });

  it('preserves distance-weighted grade, SI totals, coverage and daily numeric values', () => {
    const drives = [
      drive(),
      drive({ id: 2, distanceM: 30_000, energyUsedWh: 6_000, durationS: 3_600 }),
      drive({ id: 3, distanceM: 15_000, energyUsedWh: null }),
      drive({ id: 4, distanceM: 0, energyUsedWh: 0 }),
    ];
    expect(avgGrade(drives)).toEqual(gradeFromEfficiency(175));
    expect(computePeriodStats(drives)).toMatchObject({
      count: 4,
      totalDistanceM: 55_000,
      totalDurationS: 9_000,
      totalEnergyWh: 7_000,
      avgEfficiencyWhKm: 175,
      bestEfficiencyWhKm: 100,
      avgGradeNumeric: 3,
      energyMeasuredCount: 2,
      efficiencyMeasuredCount: 2,
    });
    expect(dailyTrend(drives, 'score', 'UTC')).toEqual([{ date: '2026-05-10', value: 3 }]);
    expect(dailyTrend(drives, 'efficiency', 'UTC')).toEqual([{ date: '2026-05-10', value: 175 }]);
  });

  it('keeps absent, measured-zero and nonfinite energy ungraded at the measurement boundary', () => {
    const drives = [
      drive({ energyUsedWh: null }),
      drive({ id: 2, energyUsedWh: 0 }),
      drive({ id: 3, energyUsedWh: Number.NaN }),
    ];
    expect(avgGrade(drives)).toEqual(gradeFromEfficiency(null));
    expect(avgGrade([])).toEqual(gradeFromEfficiency(null));
    expect(computePeriodStats(drives)).toMatchObject({
      totalEnergyWh: 0,
      avgEfficiencyWhKm: null,
      avgGradeNumeric: null,
      energyMeasuredCount: 0,
      efficiencyMeasuredCount: 0,
    });
    expect(dailyTrend(drives, 'score', 'UTC')).toEqual([]);
  });
});

describe('existing grade color consumers accept semantic CSS roles', () => {
  const colors = [120, 150, 180, 210, 250, null].map((value) => gradeFromEfficiency(value).color);

  it('uses roles already defined for dark, light and forced-color modes', () => {
    const css = readFileSync(resolve(process.cwd(), 'src', 'index.css'), 'utf8');
    const dark = css.slice(0, css.indexOf(':root.light-mode {'));
    const lightStart = css.indexOf(':root.light-mode {');
    const light = css.slice(lightStart, css.indexOf('}', lightStart));
    const forced = css.slice(css.indexOf('@media (forced-colors: active) {'));
    const provider = readFileSync(
      resolve(process.cwd(), 'src', 'components', 'ui', 'ThemeProvider.tsx'), 'utf8',
    );
    for (const color of colors) {
      const variable = color.slice(4, -1);
      const definition = new RegExp(`${variable}:\\s*[^;]+;`);
      expect(dark).toMatch(definition);
      if (variable === '--text-muted') {
        expect(provider).toContain("root.style.setProperty('--text-muted', accessibleMutedForeground(mode))");
      } else {
        expect(light).toMatch(definition);
      }
      expect(forced).toMatch(definition);
    }
  });

  it.each(colors)('retains CSS color %s through the existing Text style forwarding', (color) => {
    const markup = renderToStaticMarkup(createElement(Text, {
      as: 'span', style: { color }, children: 'B',
    }));
    expect(markup).toContain(`style="color:${color}"`);
    const container = document.createElement('div');
    container.innerHTML = markup;
    expect(container.firstElementChild?.getAttribute('style')).toBe(`color:${color}`);
    expect((container.firstElementChild as HTMLSpanElement).style.color).toBe(color);
  });

  it('retains direct DOM color assignment for DriveCard without hex parsing or alpha concatenation', () => {
    const card = readFileSync(
      resolve(process.cwd(), 'src', 'features', 'driving', 'components', 'DriveCard.tsx'), 'utf8',
    );
    const sticky = readFileSync(
      resolve(process.cwd(), 'src', 'features', 'driving', 'components', 'drives-orchestrator', 'DrivesStickySummary.tsx'),
      'utf8',
    );
    expect(card).toContain('style={{ color: score.color }}');
    expect(sticky).toContain('style={{ color: avgGrade.color }}');
    expect(card.match(/score\.color/g)).toHaveLength(1);
    expect(sticky.match(/avgGrade\.color/g)).toHaveLength(1);
    for (const color of colors) {
      const span = document.createElement('span');
      span.style.color = color;
      expect(span.style.color).toBe(color);
    }
  });
});
