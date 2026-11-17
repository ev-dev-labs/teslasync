import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { setAppDesignTestProfile } from '@/components/feedback/appDesignCss.test-utils';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { buildCarbonIntelligence } from '../../lib/carbonIntelligence';
import { carbonQueryState, type CarbonQueryLike } from '../carbon-intelligence/queryState';
import type { CarbonDisplay } from '../carbon-intelligence/types';
import { CarbonScoreBrief } from './CarbonScoreBrief';

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: 'km', speed: 'km/h', temperature: '°C',
    pressure: 'kPa', energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US' } }),
}));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));

const number = (raw: number | null | undefined) => raw == null ? '—' : raw.toFixed(2);
const display: CarbonDisplay = {
  energyUnit: 'kWh', energyValue: raw => raw / 1000,
  formatEnergy: number, formatDistance: number, formatKg: number, formatSignedKg: number,
  formatIntensity: number, formatPercent: number, formatNumber: number,
  formatHour: number, formatMonth: raw => raw,
};
function show(score: unknown, sessions = 4, overrides: Partial<CarbonQueryLike> = {}, enabled = true) {
  const lifetime = {
    total_energy_kwh: 10, total_co2_kg: 3, gas_equiv_co2_kg: 4, co2_saved_kg: 1,
    green_score: score, sessions_scored: sessions, monthly: [],
  };
  const analysis = buildCarbonIntelligence({
    intensity: undefined, periodSummary: undefined, lifetimeSummary: lifetime, recommendation: undefined,
    window: { startLabel: '2026-01-01', endLabel: '2026-06-30', startInstant: '2026-01-01T00:00:00Z',
      endInstantExclusive: '2026-07-01T00:00:00Z', timezone: 'UTC' },
  });
  const state = carbonQueryState({ data: lifetime, isSuccess: true, isLoading: false,
    isPending: false, isError: false, error: null, isFetching: false, fetchStatus: 'idle',
    ...overrides }, enabled, vi.fn());
  return {
    analysis,
    ...render(<MemoryRouter><CarbonScoreBrief analysis={analysis} display={display}
      states={{ intensity: state, period: state, lifetime: state, recommendation: state }} /></MemoryRouter>),
  };
}

describe('CarbonScoreBrief native gauge preservation', () => {
  it.each([0, 50, 100])('keeps the real %s score, full scale, fill geometry and quantitative color through every design', score => {
    const view = show(score, 4, { isError: true, error: new Error('retained refresh failed'), isSuccess: false });
    const before = JSON.stringify(view.analysis);
    const meter = screen.getByRole('meter', { name: 'Lifetime green score' });
    expect(meter).toHaveAttribute('aria-valuenow', String(score));
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter.closest('[data-app-part="card"]')).not.toBeNull();
    const track = meter.querySelector('[data-chart-gauge-track]')!;
    const fill = meter.querySelector('[data-chart-gauge-fill]') as HTMLElement;
    expect(track).toHaveClass('h-3');
    expect(fill.style.width).toBe(`${score}%`);
    const originalPaint = fill.getAttribute('style');
    expect(originalPaint).toContain('background-color:');
    expect(screen.getByText('100 maps to the model minimum; 0 maps to the model maximum.')).toBeInTheDocument();
    expect(screen.getByText(/not evidence of renewable generation, marginal emissions, location, or a causal schedule benefit/))
      .toBeInTheDocument();
    expect(screen.getByText(/most recently loaded evidence remains visible/)).toBeInTheDocument();
    view.container.setAttribute('data-app-design-preview', '');
    for (const pack of PACK_IDS) {
      setAppDesignTestProfile(view.container, pack);
      const release = observeAppDesignScopes(view.container);
      try {
        expect(fill.getAttribute('style')).toBe(originalPaint);
        expect(track).toHaveClass('h-3');
        expect(meter).toHaveAttribute('aria-valuenow', String(score));
      } finally { release(); }
    }
    expect(JSON.stringify(view.analysis)).toBe(before);
  });

  it.each([
    { score: 101, sessions: 4, message: /returned score failed validation/ },
    { score: NaN, sessions: 4, message: /returned score failed validation/ },
    { score: null, sessions: 4, message: /returned score failed validation/ },
    { score: 0, sessions: 0, message: /No scored lifetime charging sessions/ },
  ])('does not turn unsupported score $score with $sessions sessions into a zero meter', ({ score, sessions, message }) => {
    show(score, sessions);
    const band = screen.getByTestId('carbon-green-timing-score');
    expect(within(band).getByText(message)).toBeInTheDocument();
    expect(within(band).queryByRole('meter')).not.toBeInTheDocument();
    expect(band.querySelector('[data-chart-gauge-fill]')).toBeNull();
  });

  it('does not expose a populated analysis as source evidence while disabled or initially loading', () => {
    const view = show(50, 4, {}, false);
    expect(screen.getByText(/Select a vehicle to load this vehicle-dependent evidence/)).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    view.unmount();
    show(50, 4, { data: undefined, isLoading: true, isSuccess: false, isFetching: true });
    expect(screen.getByRole('status', { name: 'Loading carbon evidence' })).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });
});
