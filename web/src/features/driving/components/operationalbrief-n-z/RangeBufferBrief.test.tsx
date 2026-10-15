import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { analyzeRangeBuffer } from '../../lib/rangeBuffer';
import type { RangeBufferQueryState } from '../range-buffer/types';
import type { UnitPref } from '@/lib/unitConversion';
import { RangeBufferSummaryBrief } from './RangeBufferSummaryBrief';

const unitPrefs: UnitPref = {
  distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
  energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
};
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({ unitPrefs }) }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));

function renderBand(kind: 'arrivals' | 'context' | 'support' | 'accounting', overrides: Partial<RangeBufferQueryState> = {}) {
  const result = analyzeRangeBuffer([], Date.parse('2026-08-01T00:00:00Z'), 'UTC');
  const onThresholdChange = vi.fn();
  const state: RangeBufferQueryState = {
    vehicleSelected: true, isLoading: false, isResolved: true,
    error: null, refreshError: null, onRetry: vi.fn(), ...overrides,
  };
  render(<MemoryRouter><RangeBufferSummaryBrief
    kind={kind} result={result} state={state} locale="en-US" scope="2026-07-01 — 2026-08-01 (UTC)"
    thresholdPct={20} onThresholdChange={onThresholdChange} formatDistance={(raw) => `${(raw ?? 0) / 1000} km`}
  /></MemoryRouter>);
  return { onThresholdChange };
}

describe('Range Buffer — raw summary ownership', () => {
  it('keeps a successful empty returned count at zero while arrival percentiles remain missing', () => {
    renderBand('arrivals');
    const brief = screen.getByTestId('range-buffer-kpis-brief');
    expect(brief.querySelector('[data-operational-metric="included"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief.querySelector('[data-operational-metric="included"] [data-operational-value]')).toHaveTextContent('0');
    expect(brief.querySelector('[data-operational-metric="median"]')).toHaveAttribute('data-value-state', 'missing');
    expect(screen.getByText('No drives were returned for this vehicle-local date window.')).toBeInTheDocument();
    expect(within(brief).getByText('2026-07-01 — 2026-08-01 (UTC)')).toBeInTheDocument();
  });

  it('retains the actual planning-threshold control instead of replacing it with drawer-only text', () => {
    const { onThresholdChange } = renderBand('arrivals');
    fireEvent.change(screen.getByRole('combobox', { name: 'Arrival battery planning threshold' }), { target: { value: '30' } });
    expect(onThresholdChange).toHaveBeenCalledWith(30);
  });

  it('does not fabricate returned-count zero while loading or unresolved', () => {
    renderBand('accounting', { isLoading: true, isResolved: false });
    const brief = screen.getByTestId('range-buffer-accounting-brief');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief.querySelector('[data-operational-metric="returned"]')).toHaveAttribute('data-value-state', 'missing');
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
  });

  it('preserves the source row-accounting invariant beside the real details drawer', () => {
    renderBand('accounting');
    expect(screen.getByText('0 returned = 0 included + 0 incomplete + 0 invalid time/order + 0 future-dated + 0 invalid arrival SoC.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('unparseable or end before start')).toBeInTheDocument();
  });
});
