import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SchemaKpis } from './SchemaKpis';
import type { SchemaDrift } from '@/types/admin-operator-confidence';
import type { SchemaSectionState } from './schemaPresentation';

afterEach(cleanup);

const drift: SchemaDrift = {
  has_drift: true,
  current: { sha256: 'current', table_count: 45, column_count: 125, index_count: 40 },
  expected: { sha256: 'seed', table_count: 42, column_count: 128, index_count: 40 },
  table_count_delta: 3, column_count_delta: -3, index_count_delta: 0,
  expected_generated_at: '2026-01-01T00:00:00Z',
};
const state: SchemaSectionState = { drift, isLoading: false, error: null, onRetry: vi.fn() };
const timeLimit = 'Observation time and complete analysis bounds are not supplied by this source.';
const response = 'Confirm migrations are applied, then restart the API to regenerate the seed fingerprint. '
  + 'If migrations are already current, investigate raw DDL that bypassed the migration system.';
const countChange = 'The live schema differs from the seed: Tables +3 · Columns -3.';
const hashChange = 'The live schema fingerprint differs from the seed even though object counts match — inspect column definitions or index expressions.';
const unknownChange = 'The live schema fingerprint differs from the seed. Object-count comparisons are unavailable; inspect the available fingerprints and confirm migrations before making changes.';
const missingChange = 'Restart the API to capture a seed fingerprint, then drift interpretation appears here.';

function openDetails() {
  fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
  return screen.getByRole('dialog', { name: 'Schema drift summary details' });
}

function field(dialog: HTMLElement, label: string) {
  const narrative = within(dialog).getByTestId('operational-narrative');
  return within(narrative).getByText(label).nextElementSibling?.textContent;
}

function values() {
  return [...screen.getByTestId('schema-drift-summary').querySelectorAll('[data-operational-value]')]
    .map(node => node.textContent);
}

function assertUnscored(dialog: HTMLElement) {
  expect(field(dialog, 'Likely cause')).toBe('Cause is not established by the available evidence.');
  expect(field(dialog, 'Why it matters')).toBe('No defensible impact statement is available.');
  const narrative = within(dialog).getByTestId('operational-narrative');
  expect(within(narrative).getByText('Not scored')).toHaveTextContent(/^Not scored$/);
  expect(within(narrative).getByText('No confidence basis was supplied.')).toHaveTextContent(/^No confidence basis was supplied\.$/);
  expect(narrative).not.toHaveTextContent(/High|Medium|Low|100%|healthy/i);
  expect(dialog).toHaveTextContent(timeLimit);
}

describe('SchemaKpis source and details parity', () => {
  it('explains known signed drift and preserves the same operands in the real drawer', () => {
    render(<SchemaKpis state={state} isDrifted />);
    expect(values()).toEqual(['Drift detected', '+3', '-3', '0']);
    const drawer = openDetails();
    expect(field(drawer, 'What changed')).toBe(countChange);
    expect(field(drawer, 'Recommended response')).toBe(response);
    expect(drawer).not.toHaveTextContent('No current attention items.');
    expect(within(drawer).getByText('Drift detected')).toHaveTextContent(/^Drift detected$/);
    expect(within(drawer).getByText('What this means')).toHaveTextContent(/^What this means$/);
    expect(within(drawer).getByText('+3')).toHaveTextContent(/^\+3$/);
    expect(within(drawer).getByText('-3')).toHaveTextContent(/^-3$/);
    expect(within(drawer).getByText('0')).toHaveTextContent(/^0$/);
    expect(within(drawer).getByText('45 current · 42 expected')).toHaveTextContent(/^45 current · 42 expected$/);
    expect(within(drawer).getByText('125 current · 128 expected')).toHaveTextContent(/^125 current · 128 expected$/);
    expect(within(drawer).getByText('40 current · 40 expected')).toHaveTextContent(/^40 current · 40 expected$/);
    expect(within(drawer).getByText('Match')).toHaveTextContent(/^Match$/);
    assertUnscored(drawer);
    expect(drift.table_count_delta).toBe(3);
    expect(drift.column_count_delta).toBe(-3);
  });

  it('explains hash-only drift without treating measured zero deltas as clean', () => {
    const hashOnly: SchemaDrift = { ...drift, current: { ...drift.expected, sha256: 'different' },
      table_count_delta: 0, column_count_delta: 0, index_count_delta: 0 };
    render(<SchemaKpis state={{ ...state, drift: hashOnly }} isDrifted />);
    expect(values()).toEqual(['Drift detected', '0', '0', '0']);
    const drawer = openDetails();
    expect(field(drawer, 'What changed')).toBe(hashChange);
    expect(field(drawer, 'Recommended response')).toBe(response);
    expect(drawer).not.toHaveTextContent('No current attention items.');
    expect(within(drawer).getAllByText('Match')).toHaveLength(3);
    expect(drawer).not.toHaveTextContent('No drift');
    assertUnscored(drawer);
  });

  it('keeps measured clean zero separate from unavailable evidence', () => {
    const clean: SchemaDrift = { ...drift, has_drift: false, current: { ...drift.expected },
      table_count_delta: 0, column_count_delta: 0, index_count_delta: 0 };
    render(<SchemaKpis state={{ ...state, drift: clean }} isDrifted={false} />);
    expect(values()).toEqual(['No drift', '0', '0', '0']);
    const drawer = openDetails();
    expect(field(drawer, 'What changed')).toBe('No drift');
    expect(field(drawer, 'Recommended response')).toBe('No action is recommended from this evidence alone.');
    expect(within(drawer).getByText('No current attention items.')).toHaveTextContent(/^No current attention items\.$/);
    expect(drawer).not.toHaveTextContent('Not measured');
    expect(drawer).not.toHaveTextContent('Drift detected');
    assertUnscored(drawer);
  });

  it('keeps unknown comparisons unknown without fabricating matched counts or a cause', () => {
    const unavailable: SchemaDrift = { ...drift, table_count_delta: Number.NaN,
      column_count_delta: Number.NaN, index_count_delta: Number.NaN, expected_generated_at: '' };
    render(<SchemaKpis state={{ ...state, drift: unavailable }} isDrifted />);
    expect(values()).toEqual(['Drift detected', '—', '—', '—']);
    const drawer = openDetails();
    expect(field(drawer, 'What changed')).toBe(unknownChange);
    expect(field(drawer, 'Recommended response')).toBe(response);
    expect(drawer).not.toHaveTextContent('No current attention items.');
    expect(drawer).not.toHaveTextContent('Match');
    expect(drawer).not.toHaveTextContent('NaN');
    expect(drawer).not.toHaveTextContent(hashChange);
    assertUnscored(drawer);
  });

  it('reports missing evidence in Attention instead of inventing a clean verdict', () => {
    render(<SchemaKpis state={{ ...state, drift: null }} isDrifted={false} />);
    expect(values()).toEqual(['—', '—', '—', '—']);
    const drawer = openDetails();
    expect(field(drawer, 'What changed')).toBe(missingChange);
    expect(field(drawer, 'Recommended response')).toBe(missingChange);
    expect(drawer).toHaveTextContent('Not measured');
    expect(drawer).not.toHaveTextContent('No current attention items.');
    expect(drawer).not.toHaveTextContent('No drift');
    expect(drawer).not.toHaveTextContent('Drift detected');
    expect(drawer).not.toHaveTextContent('Match');
    expect(drawer).toHaveTextContent('No supporting records were supplied.');
    assertUnscored(drawer);
  });

  it('preserves retained drift during refresh and updates the open drawer from the replacement snapshot', () => {
    const { rerender } = render(<SchemaKpis state={{ ...state, isLoading: true }} isDrifted retained />);
    const strip = screen.getByTestId('schema-drift-summary');
    expect(strip.closest('[data-retained]')).toHaveAttribute('data-retained', 'true');
    expect(strip).not.toHaveAttribute('aria-busy');
    expect(values()).toEqual(['Drift detected', '+3', '-3', '0']);
    const drawer = openDetails();
    expect(field(drawer, 'What changed')).toBe(countChange);
    expect(field(drawer, 'Recommended response')).toBe(response);
    expect(drawer).toHaveTextContent('Retained evidence');
    expect(drawer).not.toHaveTextContent('No current attention items.');
    assertUnscored(drawer);
    const replacement: SchemaDrift = { ...drift, has_drift: false, current: { ...drift.expected },
      table_count_delta: 0, column_count_delta: 0, index_count_delta: 0 };
    rerender(<SchemaKpis state={{ ...state, drift: replacement }} isDrifted={false} />);
    expect(values()).toEqual(['No drift', '0', '0', '0']);
    expect(field(drawer, 'What changed')).toBe('No drift');
    expect(field(drawer, 'Recommended response')).toBe('No action is recommended from this evidence alone.');
    expect(drawer).toHaveTextContent('No current attention items.');
    expect(drawer).not.toHaveTextContent(countChange);
    expect(drawer).not.toHaveTextContent('Retained evidence');
    expect(strip.closest('[data-retained]')).toHaveAttribute('data-retained', 'false');
  });

  it('withholds a verdict during initial loading without inventing source health', () => {
    render(<SchemaKpis state={{ ...state, drift: null, isLoading: true }} isDrifted={false} />);
    expect(values()).toEqual([]);
    expect(screen.getByTestId('schema-drift-summary')).toHaveAttribute('aria-busy', 'true');
    const drawer = openDetails();
    expect(field(drawer, 'What changed')).toBe(missingChange);
    expect(drawer).not.toHaveTextContent('No drift');
    expect(drawer).not.toHaveTextContent('No current attention items.');
    assertUnscored(drawer);
  });

  it('does not promote a seed capture timestamp into a current-schema observation', () => {
    render(<SchemaKpis state={state} isDrifted />);
    const drawer = openDetails();
    const narrative = within(drawer).getByTestId('operational-narrative');
    const evidence = within(narrative).getByText('Supporting evidence').nextElementSibling;
    expect(evidence).not.toBeNull();
    expect(evidence).toHaveTextContent(countChange);
    expect(evidence).toHaveTextContent('Current schema vs recorded seed');
    expect(evidence?.querySelector('span')).toHaveTextContent(/^Current schema vs recorded seed$/);
    expect(drift.expected_generated_at).toBe('2026-01-01T00:00:00Z');
    assertUnscored(drawer);
  });

  it('keeps retained drift and its response visible when a refresh fails and retry remains available', () => {
    const onRetry = vi.fn();
    render(<MemoryRouter>
      <SchemaKpis state={{ ...state, error: new Error('Refresh failed'), onRetry }} isDrifted retained />
    </MemoryRouter>);
    expect(values()).toEqual(['Drift detected', '+3', '-3', '0']);
    const drawer = openDetails();
    expect(field(drawer, 'What changed')).toBe(countChange);
    expect(field(drawer, 'Recommended response')).toBe(response);
    expect(drawer).toHaveTextContent('Retained evidence');
    expect(drawer).not.toHaveTextContent('No current attention items.');
    assertUnscored(drawer);
    fireEvent.click(within(drawer).getByText('Close'));
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
