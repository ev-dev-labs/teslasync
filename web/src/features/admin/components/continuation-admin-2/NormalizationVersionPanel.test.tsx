import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NormalizationSummary } from '@/types/admin-operator-confidence';
import { NormalizationVersionPanel } from './NormalizationVersionPanel';

describe('NormalizationVersionPanel', () => {
  it('keeps the legacy bucket first and distinguishes missing share from measured zero', () => {
    const normalization: NormalizationSummary = {
      required_version: 1, total_sample_count: 10, versioned_sample_count: 10, unversioned_sample_count: 0,
      coverage_pct: 100, coverage_state: 'measured',
      versions: [{ version: 1, sample_count: 10, share_pct: 100 }, { version: null, sample_count: 0, share_pct: null }, { version: 0, sample_count: 0, share_pct: 0 }],
    };
    render(<MemoryRouter><NormalizationVersionPanel normalization={normalization} loading={false} error={null} onRetry={() => {}} /></MemoryRouter>);
    const bars = screen.getAllByRole('progressbar');
    expect(bars[0]).toHaveAccessibleName('Legacy / unknown');
    expect(bars[0]).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByRole('progressbar', { name: 'v0' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('Share unknown')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Normalization version distribution' })).toBeInTheDocument();
  });
});
