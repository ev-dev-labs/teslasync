import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NormalizationCoverageKpis } from './NormalizationCoverageKpis';

describe('NormalizationCoverageKpis', () => {
  it('does not invent sample, critical-field or window counts when the subsystem never answered', () => {
    render(<MemoryRouter><NormalizationCoverageKpis normalization={undefined} fields={[]} windowMins={undefined}
      hasSnapshot={false} loading={false} error={null} onRetry={() => {}} /></MemoryRouter>);
    const region = screen.getByRole('region', { name: 'Normalization coverage totals' });
    expect(within(region).getAllByText('—').length).toBe(5);
    expect(within(region).queryByText('0')).not.toBeInTheDocument();
    expect(within(region).queryByText('Window: 0 min')).not.toBeInTheDocument();
    expect(within(region).getAllByText('Unknown').length).toBeGreaterThanOrEqual(2);
  });

  it('renders all six canonical metrics, textual contract version, and server window without dropping context', () => {
    const { container } = render(<MemoryRouter><NormalizationCoverageKpis
      normalization={{ required_version: 1, total_sample_count: 1000, versioned_sample_count: 800,
        unversioned_sample_count: 200, coverage_pct: 80, coverage_state: 'measured', versions: [] }}
      fields={[]} windowMins={60} windowStart="2026-10-01T10:00:00Z" windowEnd="2026-10-01T11:00:00Z"
      hasSnapshot loading={false} error={null} onRetry={() => {}} /></MemoryRouter>);
    const strip = screen.getByTestId('normalization-coverage-summary');
    expect(strip).toHaveAttribute('data-operational-brief');
    expect(strip).toHaveTextContent('2026-10-01T10:00:00Z through 2026-10-01T11:00:00Z UTC (inclusive end)');
    expect(strip).toHaveTextContent('no exclusive upper bound is attested');
    const tiles = [...container.querySelectorAll('[data-operational-metric]')];
    expect(tiles).toHaveLength(6);
    expect(tiles.map(tile => tile.querySelector('[data-operational-value]')?.textContent)).toEqual(['1,000', '800', '200', '80.00%', 'v1', '0']);
    expect(strip).toHaveTextContent('Window: 60 min');
    expect(strip).toHaveTextContent('Rows carrying a normalization version');
    expect(strip).toHaveTextContent('Legacy or below-contract provenance');
    expect(strip).toHaveTextContent('800 of 1,000 rows');
    expect(strip).toHaveTextContent('Minimum attested SI contract');
    expect(strip).toHaveTextContent('Composite score below 50');
  });

  it('keeps coverage unknown on zero samples while preserving real zero counts', () => {
    const { container } = render(<MemoryRouter><NormalizationCoverageKpis
      normalization={{ required_version: 1, total_sample_count: 0, versioned_sample_count: 0,
        unversioned_sample_count: 0, coverage_pct: null, coverage_state: 'unknown', versions: [] }}
      fields={[]} windowMins={60} hasSnapshot loading={false} error={null} onRetry={() => {}} /></MemoryRouter>);
    const counts = [...container.querySelectorAll('[data-operational-metric]')]
      .filter(tile => !['normalization-coverage', 'normalization-required'].includes(tile.getAttribute('data-operational-metric') ?? ''));
    expect(counts).toHaveLength(4);
    for (const tile of counts) {
      expect(tile).toHaveAttribute('data-value-state', 'value');
      expect(tile.querySelector('[data-operational-value]')).toHaveTextContent('0');
    }
    const coverage = container.querySelector('[data-operational-metric="normalization-coverage"]');
    expect(coverage).toHaveAttribute('data-value-state', 'missing');
    expect(coverage).toHaveTextContent('Unknown');
    expect(coverage).toHaveTextContent('No samples were observed in this window');
  });

  it('keeps six labelled loading tiles mounted and retains measurements during a refresh', () => {
    const props = { normalization: { required_version: 1, total_sample_count: 10, versioned_sample_count: 10,
      unversioned_sample_count: 0, coverage_pct: 100, coverage_state: 'measured' as const, versions: [] },
    fields: [], windowMins: 60, error: null, onRetry: () => {} };
    const { container, rerender } = render(<MemoryRouter><NormalizationCoverageKpis {...props}
      normalization={undefined} loading hasSnapshot={false} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(screen.getByTestId('normalization-coverage-summary')).toHaveAttribute('aria-busy', 'true');
    rerender(<MemoryRouter><NormalizationCoverageKpis {...props} loading hasSnapshot retained /></MemoryRouter>);
    expect(container.querySelectorAll('[data-operational-metric][data-value-state="value"]')).toHaveLength(6);
    expect(screen.getByTestId('normalization-coverage-summary')).toHaveTextContent('Retained source');
  });
  it('opens the shared Review details drawer with the coverage scope still present', () => {
    render(<MemoryRouter><NormalizationCoverageKpis normalization={undefined} fields={[]}
      windowMins={undefined} hasSnapshot={false} loading={false} error={null} onRetry={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('normalization-coverage-summary')).toHaveTextContent('scoring window bounds');
  });
});
