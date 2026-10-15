import { cleanup, render, screen, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { typography } from '@/lib/tokens';
import type { Drive } from '@/types/driving';
import { analyzeArrivalReliability } from '../../lib/arrivalReliability';
import { ArrivalReliabilityMethodology } from './ArrivalReliabilityMethodology';

const english = createInstance();
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: english.getFixedT('en') }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtInt: (value: number) => new Intl.NumberFormat('en-US').format(value),
  }),
}));

beforeAll(async () => { await english.init({ lng: 'en', resources: {} }); });
afterEach(cleanup);

const now = Date.parse('2026-08-08T12:00:00Z');
const drives: Drive[] = [1, 2, 3].map(id => ({
  id, vehicleId: 7,
  startTs: `2026-08-0${id}T12:00:00Z`,
  endTs: `2026-08-0${id}T12:30:00Z`,
  durationS: 1800, distanceM: 20000,
  startAddress: 'Home', endAddress: 'Office',
  startLat: null, startLon: null, endLat: null, endLon: null,
  startBatteryPct: null, endBatteryPct: null,
  energyUsedWh: null, regenEnergyWh: null,
  avgSpeedMps: null, maxSpeedMps: null, avgPowerW: null,
  outsideTempAvgC: null, insideTempAvgC: null,
  score: null, endedStatus: 'completed', createdAt: '', updatedAt: '',
}));

const titles = [
  'Observed route allowance',
  'Timing consistency index',
  'Robust spread and percentiles',
  'Route-normalized profiles',
  'Vehicle-local calendar',
  'Directional route matching',
  'Sample gates and support',
  'Inputs and interpretation limits',
];

describe('ArrivalReliabilityMethodology', () => {
  it('uses neutral shared typography and decorative icon roles without decorative accent chrome', () => {
    const analysis = analyzeArrivalReliability(drives, now, 'UTC');
    const { container } = render(
      <ArrivalReliabilityMethodology analysis={analysis} timeZone="UTC" />,
    );
    expect(screen.getByRole('heading', { name: 'Methodology and limitations' }))
      .toHaveClass(...typography.role.panelTitle.split(' '));
    for (const title of titles) {
      expect(screen.getByRole('heading', { name: title }))
        .toHaveClass(...typography.role.subhead.split(' '));
    }
    const icons = container.querySelectorAll('svg');
    expect(icons).toHaveLength(9);
    for (const icon of icons) {
      expect(icon).toHaveClass(typography.color.secondary, 'shrink-0');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon).toHaveAttribute('focusable', 'false');
    }
    for (const body of container.querySelectorAll('article p')) {
      expect(body).toHaveClass(...typography.role.bodySm.split(' '));
    }
    expect(container.querySelector('[class*="cyan-"], [class*="neon"], [class*="glow"]')).toBeNull();
  });

  it.each([
    { state: 'populated', history: drives },
    { state: 'empty', history: [] },
  ])('retains all eight complete explanations for $state history', ({ history }) => {
    const analysis = analyzeArrivalReliability(history, now, 'America/Los_Angeles', {
      minRouteSamples: 3, minWindowSamples: 2, historyLimit: 2500,
    });
    render(<ArrivalReliabilityMethodology analysis={analysis} timeZone="America/Los_Angeles" />);
    const section = screen.getByTestId('arrival-methodology');
    const articles = section.querySelectorAll('article');
    expect(articles).toHaveLength(8);
    titles.forEach((title, index) => {
      expect(within(articles[index]).getByRole('heading', { name: title })).toBeInTheDocument();
      expect(articles[index].querySelector('p')?.textContent?.length).toBeGreaterThan(100);
    });
    expect(section).toHaveTextContent('allowance = route p50 + max(5 minutes, 10% of route p50)');
    expect(section).toHaveTextContent('0.65 × observed within-allowance share');
    expect(section).toHaveTextContent('Scaled MAD = 1.4826');
    expect(section).toHaveTextContent('capped at 1,000');
    expect(section).toHaveTextContent('use America/Los_Angeles');
    expect(section).toHaveTextContent('reverse travel is a different route');
    expect(section).toHaveTextContent('at least 3 and 2 samples');
    expect(section).toHaveTextContent('limited to 2,500 rows');
    expect(section).toHaveTextContent('no holdout calibration has been performed');
    expect(section).toHaveTextContent('no arrival outcome is promised');
  });
});
