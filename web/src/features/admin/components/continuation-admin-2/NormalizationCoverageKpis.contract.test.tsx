import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps } from 'react';
import { NormalizationCoverageKpis } from './NormalizationCoverageKpis';

const BASE: ComponentProps<typeof NormalizationCoverageKpis> = {
  normalization: { required_version: 1, total_sample_count: 10, versioned_sample_count: 0,
    unversioned_sample_count: 10, coverage_pct: 0, coverage_state: 'measured', versions: [] },
  fields: [], windowMins: 60, hasSnapshot: true, sourceStatus: 'ok',
  loading: false, error: null, onRetry: () => {},
};

describe('NormalizationCoverageKpis actual refresh contract', () => {
  it('shows actual refreshing instead of loaded while keeping measured zero and every metric', () => {
    const { rerender } = render(<MemoryRouter><NormalizationCoverageKpis {...BASE} isRefreshing retained /></MemoryRouter>);
    const brief = screen.getByTestId('normalization-coverage-summary');
    expect(brief).toHaveTextContent('Refreshing source');
    expect(brief).not.toHaveTextContent('Source loaded');
    expect(brief).not.toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Showing retained measurements')).toBeInTheDocument();
    expect(brief.querySelectorAll('[data-operational-metric][data-value-state="value"]')).toHaveLength(6);
    expect(brief.querySelector('[data-operational-metric="normalization-coverage"]')).toHaveTextContent('0.00%');
    rerender(<MemoryRouter><NormalizationCoverageKpis {...BASE} isRefreshing={false} /></MemoryRouter>);
    expect(brief).toHaveTextContent('Source loaded');
    expect(brief).not.toHaveTextContent('Refreshing source');
    expect(screen.queryByText('Showing retained measurements')).not.toBeInTheDocument();
  });

  it('does not infer refreshing from retained measurements or loading on a populated source', () => {
    render(<MemoryRouter><NormalizationCoverageKpis {...BASE} sourceStatus="stale" retained loading /></MemoryRouter>);
    const brief = screen.getByTestId('normalization-coverage-summary');
    assertOperationalBriefDisclosure(brief, 'Retained source', { contains: true });
    expect(brief).not.toHaveTextContent('Refreshing source');
    expect(brief.querySelectorAll('[data-value-state="value"]')).toHaveLength(6);
  });

  it('keeps unknown coverage distinct from real zero counts during an actual refresh', () => {
    render(<MemoryRouter><NormalizationCoverageKpis {...BASE} isRefreshing retained
      normalization={{ required_version: 1, total_sample_count: 0, versioned_sample_count: 0,
        unversioned_sample_count: 0, coverage_pct: null, coverage_state: 'unknown', versions: [] }} /></MemoryRouter>);
    const brief = screen.getByTestId('normalization-coverage-summary');
    expect(brief).toHaveTextContent('Refreshing source');
    const coverage = brief.querySelector('[data-operational-metric="normalization-coverage"]');
    expect(coverage).toHaveAttribute('data-value-state', 'missing');
    expect(coverage).toHaveTextContent('Unknown');
    expect(coverage).not.toHaveTextContent('0.00%');
    expect(brief.querySelector('[data-operational-metric="normalization-total"]')).toHaveTextContent('0');
  });

  it('keeps initial loading distinct from refreshing when no measurement has arrived', () => {
    render(<MemoryRouter><NormalizationCoverageKpis {...BASE} normalization={undefined}
      hasSnapshot={false} sourceStatus="initial" isRefreshing={false} loading /></MemoryRouter>);
    const brief = screen.getByTestId('normalization-coverage-summary');
    assertOperationalBriefDisclosure(brief, 'Loading source', { contains: true });
    expect(brief).not.toHaveTextContent('Refreshing source');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
  });
});
