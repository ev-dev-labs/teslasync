/**
 * FieldQualityTable — per-field quality + provenance table.
 *
 * Contract pinned here:
 *   - rows are worst-first by composite score;
 *   - each row exposes the quality severity, freshness, largest gap and
 *     duplicate ratio alongside the field's attested / unattested counts;
 *   - a field whose coverage could not be measured renders "Unknown" and the
 *     Unknown trust badge — never a fabricated 0.0%;
 *   - a partially-attested field is visibly distinct from a fully-attested one;
 *   - the panel shell always renders: loading → skeleton, empty → explicit
 *     empty state, error → QueryError with a working Retry.
 */
import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { FieldQualityTable } from './FieldQualityTable';
import { ApiError } from '@/lib/resilience';
import type { DataQualityFieldScore } from '@/types/admin-operator-confidence';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, opts?: Record<string, unknown>) => {
      let out = typeof fallback === 'string' ? fallback : key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

function makeField(overrides: Partial<DataQualityFieldScore> = {}): DataQualityFieldScore {
  return {
    field: 'VehicleSpeed',
    sample_count: 100,
    last_seen_at: '2026-08-29T12:00:00Z',
    freshness_seconds: 10,
    max_gap_seconds: 30,
    duplicate_ratio: 0,
    versioned_sample_count: 100,
    unversioned_sample_count: 0,
    normalization_coverage_pct: 100,
    normalization_coverage_state: 'measured',
    composite_score: 100,
    severity: 'ok',
    ...overrides,
  };
}

const FIELDS: DataQualityFieldScore[] = [
  makeField({ field: 'HealthyField', composite_score: 95, severity: 'ok' }),
  makeField({
    field: 'PartialField',
    composite_score: 55,
    severity: 'warn',
    sample_count: 400,
    versioned_sample_count: 300,
    unversioned_sample_count: 100,
    normalization_coverage_pct: 75,
    normalization_coverage_state: 'measured',
    freshness_seconds: 120,
    max_gap_seconds: 3600,
    duplicate_ratio: 0.25,
  }),
  makeField({
    field: 'UnmeasuredField',
    composite_score: 12,
    severity: 'critical',
    sample_count: 0,
    versioned_sample_count: 0,
    unversioned_sample_count: 0,
    normalization_coverage_pct: null,
    normalization_coverage_state: 'unknown',
  }),
];

function renderTable(props: Partial<Parameters<typeof FieldQualityTable>[0]> = {}) {
  return render(
    <MemoryRouter>
      <FieldQualityTable
        fields={FIELDS}
        loading={false}
        error={null}
        onRetry={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );
}

function rowFor(name: string): HTMLElement {
  const cell = screen.getByText(name);
  const row = cell.closest('tr');
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe('FieldQualityTable', () => {
  it('always renders the panel shell and column headers', () => {
    renderTable();
    expect(screen.getByText('Per-field quality and provenance')).toBeInTheDocument();
    for (const header of [
      'Field',
      'Quality',
      'Freshness',
      'Max gap',
      'Duplicates',
      'Attested',
      'Unattested',
      'Coverage',
    ]) {
      expect(screen.getAllByText(header).length).toBeGreaterThan(0);
    }
  });

  it('orders rows worst-first by composite score', () => {
    renderTable();
    const rendered = screen
      .getAllByRole('row')
      .map((r) => r.textContent ?? '')
      .filter((text) => /Field/.test(text));
    const order = ['UnmeasuredField', 'PartialField', 'HealthyField'].map((f) =>
      rendered.findIndex((text) => text.includes(f)),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it('renders "Unknown" — not 0.0% — for a field with no coverage measurement', () => {
    renderTable();
    const row = rowFor('UnmeasuredField');
    // Scope to the trailing Coverage cell: sibling cells legitimately carry a
    // measured "0.0%" duplicate ratio, which is NOT the value under test.
    const cells = within(row).getAllByRole('cell');
    const coverageCell = cells[cells.length - 1];
    expect(within(coverageCell).getAllByText('Unknown').length).toBeGreaterThan(0);
    expect(within(coverageCell).queryByText(/%$/)).not.toBeInTheDocument();
  });

  it('makes partial / unattested coverage visible with real counts', () => {
    renderTable();
    const row = rowFor('PartialField');
    expect(within(row).getByText('75.0%')).toBeInTheDocument();
    expect(within(row).getByText('Partially attested')).toBeInTheDocument();
    expect(within(row).getByText('300')).toBeInTheDocument();
    expect(within(row).getByText('100')).toBeInTheDocument();
    expect(within(row).getByText('400 samples')).toBeInTheDocument();
  });

  it('renders the three quality axes for a degraded field', () => {
    renderTable();
    const row = rowFor('PartialField');
    expect(within(row).getByText('2m')).toBeInTheDocument(); // freshness 120s
    expect(within(row).getByText('1h')).toBeInTheDocument(); // max gap 3600s
    expect(within(row).getByText('25.0%')).toBeInTheDocument(); // duplicate ratio
  });

  it('marks a fully attested field as complete', () => {
    renderTable();
    const row = rowFor('HealthyField');
    expect(within(row).getByText('100.0%')).toBeInTheDocument();
    expect(within(row).getByText('Fully attested')).toBeInTheDocument();
  });

  it('shows an explicit empty state when no fields were scored', () => {
    renderTable({ fields: [] });
    expect(screen.getByText('No field scores')).toBeInTheDocument();
    expect(
      screen.getByText(/No signal fields were persisted during this scoring window/i),
    ).toBeInTheDocument();
    // Panel shell stays mounted.
    expect(screen.getByText('Per-field quality and provenance')).toBeInTheDocument();
  });

  it('shows a skeleton while the first fetch is in flight', () => {
    renderTable({ fields: [], loading: true });
    expect(screen.queryByText('No field scores')).not.toBeInTheDocument();
    expect(screen.getByText('Per-field quality and provenance')).toBeInTheDocument();
  });

  it('renders the error branch with a working retry and keeps the panel mounted', () => {
    const onRetry = vi.fn();
    renderTable({ fields: [], error: new ApiError('boom', 500), onRetry });

    expect(screen.getByText('Per-field quality and provenance')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
