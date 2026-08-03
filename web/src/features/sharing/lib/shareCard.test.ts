import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import {
  computeShareStats,
  renderShareCardSvg,
  SHARE_CARD_THEMES,
} from './shareCard';

let nextId = 1;

function drive(over: Partial<Drive>): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: '2026-07-01T08:00:00Z',
    endTs: null,
    durationS: 1800,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 2000,
    regenEnergyWh: 300,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('computeShareStats', () => {
  it('aggregates distance, energy, regen, longest, and top speed', () => {
    const s = computeShareStats([
      drive({ distanceM: 30_000, maxSpeedMps: 40 }),
      drive({ distanceM: 10_000, maxSpeedMps: 25 }),
    ]);
    expect(s.drives).toBe(2);
    expect(s.distanceM).toBe(40_000);
    expect(s.energyUsedWh).toBe(4_000);
    expect(s.regenWh).toBe(600);
    expect(s.longestM).toBe(30_000);
    expect(s.maxSpeedMps).toBe(40);
    expect(s.whPerKm).toBe(100);
  });

  it('tolerates missing fields and empty input', () => {
    const s = computeShareStats([drive({ energyUsedWh: null, regenEnergyWh: null, maxSpeedMps: null })]);
    expect(s.energyUsedWh).toBe(0);
    expect(s.maxSpeedMps).toBeNull();
    expect(computeShareStats([]).whPerKm).toBeNull();
  });
});

describe('renderShareCardSvg', () => {
  const lines = [
    { label: 'Distance', value: '1,234 km' },
    { label: 'Drives', value: '87' },
  ];

  it('renders a standalone SVG with the theme colors and all lines', () => {
    const svg = renderShareCardSvg('July 2026', 'Model 3', lines, 'midnight');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain(SHARE_CARD_THEMES.midnight.bg);
    expect(svg).toContain('July 2026');
    expect(svg).toContain('1,234 km');
    expect(svg).toContain('Drives');
  });

  it('escapes XML-hostile characters in user-visible text', () => {
    const svg = renderShareCardSvg('<script>&"x"', 'a<b', [{ label: 'l&l', value: 'v<v' }], 'aurora');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;&amp;&quot;x&quot;');
    expect(svg).toContain('l&amp;l');
  });

  it('caps the grid at six lines and falls back on bad themes', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ label: `L${i}`, value: `V${i}` }));
    const svg = renderShareCardSvg('T', 'S', many, 'nope' as never);
    expect(svg).toContain('V5');
    expect(svg).not.toContain('V6');
    expect(svg).toContain(SHARE_CARD_THEMES.midnight.bg);
  });
});
