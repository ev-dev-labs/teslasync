import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { DataQualityFieldScore } from '@/types/admin-operator-confidence';
import { FieldQualityTable } from './FieldQualityTable';

function field(name: string, score: number): DataQualityFieldScore {
  return {
    field: name, sample_count: 10, last_seen_at: '2026-10-05T18:00:00Z',
    freshness_seconds: 0, max_gap_seconds: 0, duplicate_ratio: 0, versioned_sample_count: 10, unversioned_sample_count: 0,
    normalization_coverage_pct: null, normalization_coverage_state: 'unknown', composite_score: score, severity: score < 50 ? 'critical' : 'ok',
  };
}

describe('FieldQualityTable', () => {
  it('keeps worst-first ordering, complete provenance columns and measured zeros without mutating the source', () => {
    const fields = [field('HealthyField', 100), field('CriticalField', 20)];
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><FieldQualityTable fields={fields}
      loading={false} error={null} onRetry={() => {}} /></MemoryRouter></QueryClientProvider>);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('CriticalField');
    expect(within(table).getAllByRole('columnheader').map((node) => node.textContent).join(' ')).toMatch(/Attested.*Unattested.*Coverage/);
    expect(within(table).getAllByText('Unknown').length).toBeGreaterThanOrEqual(2);
    expect(fields.map((item) => item.field)).toEqual(['HealthyField', 'CriticalField']);
  });
});
