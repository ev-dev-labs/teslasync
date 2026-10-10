import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PhysicsLedger } from '@/api/types';
import { DynamicsPanel } from '../physics-ledger/DynamicsPanel';
import { ThermalPanel } from '../physics-ledger/ThermalPanel';
import { RangePanel } from '../physics-ledger/RangePanel';
import { TiresPanel } from '../physics-ledger/TiresPanel';
import { ParkingCoverageMethodology } from '../parking-analytics/ParkingCoverageMethodology';
import { UtilizationMethodology } from '../utilization/UtilizationMethodology';
import { summarizeParking } from '../../lib/parkingDwell';
import { summarizeUtilization } from '../../lib/utilization';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallback?: string | { defaultValue?: string },
      values?: Record<string, unknown>,
    ) =>
      Object.entries(values ?? {}).reduce((text, [name, value]) =>
        text.replaceAll(`{{${name}}}`, String(value)),
      (typeof fallback === 'string' ? fallback : fallback?.defaultValue) ?? key),
    i18n: { language: 'en' },
  }),
}));

const ledger: PhysicsLedger = {
  vehicle_id: 7, kind: 'range', start: '2026-10-01T00:00:00Z', end: '2026-10-01T01:00:00Z',
  dynamics: null, drive: null, charge: null, park: null, thermal: null,
  range: null, tires: null, epochs: [], unknown_intervals: [], unknown_hours: 0,
  black_box: [], truncated: false, honesty: 'Bounded source, not lifetime evidence.',
};
const state = { isLoading: false, error: null, onRetry: vi.fn() };
const window = {
  rangeStart: '2026-10-01', rangeEnd: '2026-10-01',
  asOfMs: Date.parse('2026-10-02T00:00:00Z'), historyLimit: 1000,
};

describe('Physical ledger summary source preservation', () => {
  it('keeps all four shells and missing measures when independent domains were not returned', () => {
    render(<MemoryRouter>
      <DynamicsPanel ledger={ledger} /><ThermalPanel ledger={ledger} />
      <RangePanel ledger={ledger} /><TiresPanel ledger={ledger} />
    </MemoryRouter>);
    for (const id of ['dynamics', 'thermal', 'range', 'tires']) {
      const brief = screen.getByTestId(`ledger-${id}-summary`);
      expect(brief).toHaveAttribute('data-operational-brief');
      expect(brief.querySelectorAll('[data-value-state="missing"]').length).toBeGreaterThan(0);
      expect(within(brief).getByText('Partial source coverage')).toBeInTheDocument();
    }
  });

  it('retains zero, negative energy and known mass with source metadata in the real Review drawer', () => {
    render(<MemoryRouter><DynamicsPanel status="stale" ledger={{ ...ledger, dynamics: {
      points: [], mass_kg: 2000, mass_source: 'configured source', regen_wh: 0,
      friction_brake_wh: -1.25, unknown: false, honesty: 'Signed returned energy.',
    } }} /></MemoryRouter>);
    const brief = screen.getByTestId('ledger-dynamics-summary');
    expect(within(brief).getByText('Retained after refresh failure')).toBeInTheDocument();
    expect(brief.querySelector('[data-operational-metric="regen"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief.querySelector('[data-operational-metric="friction"]')).toHaveAttribute('data-value-state', 'value');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('configured source')).toBeInTheDocument();
    expect(within(drawer).getAllByText(/Signed returned energy/).length).toBeGreaterThan(0);
  });

  it('keeps zero thermal readings, negative correlation, null corners and real zero pressure separate', () => {
    render(<MemoryRouter>
      <ThermalPanel ledger={{ ...ledger, thermal: {
        pack_min_c: 0, pack_max_c: null, pack_start_c: null, pack_end_c: null,
        inside_c: -5, outside_c: null, heat_vs_power_r: -0.5,
        unknown: false, honesty: 'Sensor coverage differs by field.',
      } }} />
      <TiresPanel ledger={{ ...ledger, tires: {
        fl_kpa: 0, fr_kpa: null, rl_kpa: 290, rr_kpa: null, imbalance_kpa: 290,
        unknown: false, honesty: 'Only returned corners.',
      } }} />
    </MemoryRouter>);
    const thermal = screen.getByTestId('ledger-thermal-summary');
    const tires = screen.getByTestId('ledger-tires-summary');
    expect(thermal.querySelector('[data-operational-metric="min"]')).toHaveAttribute('data-value-state', 'value');
    expect(thermal.querySelector('[data-operational-metric="max"]')).toHaveAttribute('data-value-state', 'missing');
    expect(thermal.querySelector('[data-operational-metric="correlation"]')).toHaveTextContent('-0.50');
    expect(tires.querySelector('[data-operational-metric="fl"]')).toHaveAttribute('data-value-state', 'value');
    expect(tires.querySelector('[data-operational-metric="fr"]')).toHaveAttribute('data-value-state', 'missing');
  });

  it('never derives a true range or zero-fills missing estimators and implied efficiency', () => {
    render(<MemoryRouter><RangePanel ledger={{ ...ledger, range: {
      rated_m: 0, est_m: null, ideal_m: null, energy_wh: 0, implied_wh_per_m: null,
      spread_m: null, disagree: false, unknown: true, honesty: 'No calibrated forecast.',
    } }} /></MemoryRouter>);
    const brief = screen.getByTestId('ledger-range-summary');
    expect(brief.querySelector('[data-operational-metric="rated"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief.querySelector('[data-operational-metric="typical"]')).toHaveAttribute('data-value-state', 'missing');
    expect(brief.querySelector('[data-operational-metric="implied"]')).toHaveAttribute('data-value-state', 'missing');
    expect(within(brief).getByText('Partial source coverage')).toBeInTheDocument();
  });
});

describe('Coverage accounting brief boundaries', () => {
  it('keeps genuine successful empty parking counts, unknown location share and existing browse action', () => {
    const summary = summarizeParking([], {
      nowMs: window.asOfMs, rangeStart: window.rangeStart, rangeEnd: window.rangeEnd,
      timeZone: 'UTC', rowLimit: 1000,
    });
    render(<MemoryRouter><ParkingCoverageMethodology summary={summary} state={state}
      rangeStart={window.rangeStart} rangeEnd={window.rangeEnd} sourceStatus="ok" hasSource /></MemoryRouter>);
    const brief = screen.getByTestId('parking-coverage-summary');
    expect(brief.querySelector('[data-operational-metric="returned"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief.querySelector('[data-operational-metric="located"]')).toHaveAttribute('data-value-state', 'missing');
    expect(screen.getByRole('link', { name: 'Browse drives' })).toHaveAttribute('href', '/drives');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('0 located · 0 missing')).toBeInTheDocument();
  });

  it('does not present empty model defaults as source counts during unresolved utilization loading', () => {
    const summary = summarizeUtilization([], null, window);
    render(<MemoryRouter><UtilizationMethodology summary={summary} historyLimit={1000}
      state={{ ...state, isLoading: true }} sourceStatus="initial" hasSource={false} /></MemoryRouter>);
    const brief = screen.getByTestId('utilization-coverage-summary');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief.querySelectorAll('[data-value-state="missing"]')).toHaveLength(4);
    expect(screen.getByRole('status', { name: 'Loading utilization analysis' })).toBeInTheDocument();
  });

  it('retains timestamp/field methodology tables and a stale source status without zeroing a returned payload', () => {
    const summary = summarizeUtilization([], null, window);
    render(<MemoryRouter><UtilizationMethodology summary={summary} historyLimit={1000}
      state={state} sourceStatus="stale" hasSource /></MemoryRouter>);
    const brief = screen.getByTestId('utilization-coverage-summary');
    expect(within(brief).getByText('Retained after refresh failure')).toBeInTheDocument();
    expect(brief.querySelector('[data-operational-metric="returned"]')).toHaveAttribute('data-value-state', 'value');
    expect(screen.getByRole('list', { name: 'Methodology notes' })).toHaveTextContent('canonical meters and watt-hours');
  });
});
