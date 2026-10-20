import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import { EfficiencyOverview } from './EfficiencyOverview';
import { buildEfficiencyModel } from './model';
import { fakeQuery, fakeStats, fakeUnits } from './fixtures';
import type { StatsPresentation } from './types';

vi.mock('@/components/charts', async () =>
  vi.importActual<typeof import('@/components/charts/LinearGauge')>('@/components/charts/LinearGauge'));
vi.mock('@/components/data-display', async () => ({
  ...await vi.importActual<typeof import('@/components/data-display/MetricBar')>('@/components/data-display/MetricBar'),
  ...await vi.importActual<typeof import('@/components/data-display/MetricCard')>('@/components/data-display/MetricCard'),
}));
vi.mock('@/components/layout', async () =>
  vi.importActual<typeof import('@/components/layout/layout-reference/LayoutCard')>(
    '@/components/layout/layout-reference/LayoutCard'));
vi.mock('./EfficiencySource', () => ({
  EfficiencySource: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function presentation(miles = false): StatsPresentation {
  const units = fakeUnits(miles);
  const stats = fakeStats({ totalDurationS: 18000 });
  return {
    stats, units, model: buildEfficiencyModel([], units.unitPrefs),
    source: { state: deriveDataState(fakeQuery(stats)), loading: false, malformed: false },
  };
}

function ratio(element: HTMLElement) {
  return Number(element.getAttribute('aria-valuenow')) / Number(element.getAttribute('aria-valuemax'));
}

describe('EfficiencyOverview physical display scales', () => {
  it('adopts the established layout category export and retains the real named card shell', () => {
    const source = readFileSync(join('src', 'features', 'driving', 'components', 'efficiency-modernization', 'EfficiencyOverview.tsx'), 'utf8');
    expect(source).toMatch(/import\s*\{\s*LayoutCard\s*\}\s*from\s*'@\/components\/layout'/);
    expect(source).not.toContain('@/components/layout/layout-reference');
    const { container } = render(<EfficiencyOverview {...presentation()} />);
    const title = screen.getByRole('heading', { name: 'Efficiency overview' });
    const card = container.querySelector('[data-card]');
    expect(container.querySelectorAll('[data-card]')).toHaveLength(1);
    expect(card).toHaveAttribute('aria-labelledby', title.id);
    expect(card).toHaveAccessibleName('Efficiency overview');
    expect(card).toHaveAttribute('data-card-size', 'full');
  });
  it.each([false, true])('preserves populated readings and ratios (miles=%s)', miles => {
    const props = presentation(miles);
    render(<EfficiencyOverview {...props} />);
    const speed = screen.getByRole('progressbar', { name: 'Avg speed' });
    const consumption = screen.getByRole('progressbar', { name: 'Avg consumption' });
    const gauge = screen.getByRole('meter', { name: 'Avg' });
    const speedFactor = miles ? 1 / 1.609344 : 1;
    const efficiencyFactor = miles ? 1.609344 : 1;

    expect(Number(speed.getAttribute('aria-valuenow'))).toBeCloseTo(60 * speedFactor);
    expect(Number(speed.getAttribute('aria-valuemax'))).toBeCloseTo(150 * speedFactor);
    expect(ratio(speed)).toBeCloseTo(0.4, 12);
    for (const element of [consumption, gauge]) {
      expect(Number(element.getAttribute('aria-valuenow'))).toBeCloseTo(200 * efficiencyFactor);
      expect(Number(element.getAttribute('aria-valuemax'))).toBeCloseTo(300 * efficiencyFactor);
      expect(ratio(element)).toBeCloseTo(2 / 3, 12);
    }
    expect(ratio(screen.getByRole('progressbar', { name: 'Regen ratio' }))).toBe(0.5);
    expect(ratio(screen.getByRole('progressbar', { name: 'Total drive time' }))).toBe(0.5);
    expect(speed).toHaveTextContent(miles ? '37 mph' : '60 km/h');
    expect(consumption).toHaveTextContent(miles ? '321.87 Wh/mi' : '200.00 Wh/km');
    expect(screen.getByRole('heading', { name: 'Efficiency overview' })).toBeInTheDocument();
  });

  it('uses the independent speed preference rather than the distance preference', () => {
    const props = presentation();
    props.units.unitPrefs.speed = 'mph';
    props.model = buildEfficiencyModel([], props.units.unitPrefs);
    render(<EfficiencyOverview {...props} />);
    const speed = screen.getByRole('progressbar', { name: 'Avg speed' });
    expect(Number(speed.getAttribute('aria-valuemax'))).toBeCloseTo(150 / 1.609344);
    expect(ratio(speed)).toBeCloseTo(0.4, 12);
    expect(speed).toHaveTextContent('37 mph');
    expect(screen.getByRole('progressbar', { name: 'Avg consumption' })).toHaveTextContent('200.00 Wh/km');
  });

  it('keeps measured zero distinct from missing or nonfinite fields', () => {
    const props = presentation(true);
    props.stats = fakeStats({ avgEfficiencyWhKm: 0, avgSpeedKmh: 0, regenRatio: 0, totalDurationS: 0 });
    const view = render(<EfficiencyOverview {...props} />);
    expect(screen.getAllByRole('progressbar')).toHaveLength(4);
    expect(ratio(screen.getByRole('progressbar', { name: 'Avg speed' }))).toBe(0);
    expect(ratio(screen.getByRole('meter', { name: 'Avg' }))).toBe(0);

    props.stats = fakeStats({
      avgEfficiencyWhKm: null, avgSpeedKmh: Number.NaN, regenRatio: null, totalDurationS: Number.POSITIVE_INFINITY,
    });
    view.rerender(<EfficiencyOverview {...props} />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.getByText('No efficiency summary available yet')).toBeInTheDocument();
    for (const label of ['Avg consumption', 'Avg speed', 'Regen ratio', 'Total drive time']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
