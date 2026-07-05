import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { SnapshotRow } from './constants';
import { SignalSnapshotPanel } from './SignalSnapshotPanel';

/**
 * SignalSnapshotPanel — behaviour + hardening contract.
 *
 * The panel is the full-width "raw signal snapshot" band at the bottom of the
 * Powershare cockpit: a `DataTable` of {@link SnapshotRow}s (signal label, its
 * latest formatted value, and a relative "Updated" timestamp) wrapped in the
 * standard loading / error / empty scaffolding. These tests pin every facet the
 * page depends on:
 *
 *   - the section title + subtitle always render, so the band is never a blank
 *     void — even in loading, error, and empty states;
 *   - each row surfaces its label + value, a null `ts` renders the universal
 *     "—" placeholder (never a blank cell), and a real `ts` renders a titled
 *     timestamp carrying the canonical ISO string;
 *   - the three data states are mutually exclusive: `isLoading` shows a skeleton
 *     (no table), a query `error` shows an accessible Retry that invokes
 *     `onRetry`, and an empty result shows the "no signals yet" copy;
 *   - **the sort fix**: all three columns advertise `sortable: true`, so the
 *     header buttons must actually reorder the rows (label lexical, value
 *     lexical, timestamp chronological with a missing `ts` pinned last) and
 *     expose `aria-sort` — previously the columns rendered dead sort buttons
 *     because the panel never wired `sortKey`/`sortDir`/`onSort`;
 *   - null-safety: an `undefined` rows prop degrades to the empty state instead
 *     of throwing when the DataTable iterates.
 *
 * Conventions mirror the sibling `constants.test.tsx` / charging component
 * tests: `react-i18next` is stubbed so `t(key, fallback)` resolves to its
 * English fallback deterministically, `useSettings` / `useTimezone` come from
 * the global `src/test-setup.ts` stubs, and the error branch's `<QueryError>`
 * reaches for `useNavigate`, so every render is wrapped in a `<MemoryRouter>`.
 * The repo does not ship `@testing-library/user-event`, so header interaction
 * uses `fireEvent.click` — the established convention here.
 */

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

/**
 * Three rows whose label / value / timestamp orderings are each unambiguous so
 * a sort assertion can't pass by accident. Incoming order is deliberately
 * scrambled: [Bravo, Alpha, Charlie].
 */
function makeRows(): SnapshotRow[] {
  return [
    { key: 'b', label: 'Bravo', value: '5 kW', ts: '2026-05-05T12:02:00Z' }, // newest ts
    { key: 'a', label: 'Alpha', value: '2 kW', ts: null }, // no ts
    { key: 'c', label: 'Charlie', value: '9 kW', ts: '2026-05-05T12:00:00Z' }, // oldest ts
  ];
}

function renderPanel(props: Partial<ComponentProps<typeof SignalSnapshotPanel>> = {}) {
  const merged: ComponentProps<typeof SignalSnapshotPanel> = {
    rows: makeRows(),
    isLoading: false,
    error: null,
    onRetry: vi.fn(),
    ...props,
  };
  return {
    ...render(
      <MemoryRouter>
        <SignalSnapshotPanel {...merged} />
      </MemoryRouter>,
    ),
    onRetry: merged.onRetry,
  };
}

/** Labels of the rendered data rows, in DOM order (header row dropped). */
function labelOrder(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0].textContent?.trim() ?? '');
}

describe('SignalSnapshotPanel — structure + data states', () => {
  it('renders the title, subtitle, and one table row per signal', () => {
    renderPanel();

    expect(screen.getByText('Signal Snapshot')).toBeInTheDocument();
    expect(screen.getByText('Latest raw Powershare telemetry')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();

    // Every signal's label + value flows through to a cell.
    for (const row of makeRows()) {
      expect(screen.getByText(row.label)).toBeInTheDocument();
      expect(screen.getByText(row.value)).toBeInTheDocument();
    }
    expect(labelOrder()).toEqual(['Bravo', 'Alpha', 'Charlie']);
  });

  it('renders the "—" placeholder for a null ts and a titled ISO timestamp otherwise', () => {
    renderPanel();

    // Alpha has ts: null — its Updated cell must show the universal em-dash,
    // never a blank cell.
    const alphaRow = screen.getByText('Alpha').closest('tr') as HTMLElement;
    expect(within(alphaRow).getByText('—')).toBeInTheDocument();

    // Bravo has a real ts — the DateTime renders a span titled with the exact
    // canonical ISO string (time-independent, unlike its relative display text).
    const bravoRow = screen.getByText('Bravo').closest('tr') as HTMLElement;
    expect(within(bravoRow).queryByText('—')).not.toBeInTheDocument();
    expect(screen.getByTitle(/^2026-05-05T12:02:00/)).toBeInTheDocument();
  });

  it('shows the empty message and keeps the section visible when no signals have arrived', () => {
    renderPanel({ rows: [] });

    expect(screen.getByText('No Powershare signals received yet.')).toBeInTheDocument();
    // Title band always renders — the section is never hidden behind the data.
    expect(screen.getByText('Signal Snapshot')).toBeInTheDocument();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  });

  it('renders a loading skeleton (no table) while the queries are in flight', () => {
    renderPanel({ isLoading: true, rows: [] });

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('No Powershare signals received yet.')).not.toBeInTheDocument();
    // The band header still shows so the layout doesn't collapse.
    expect(screen.getByText('Signal Snapshot')).toBeInTheDocument();
  });

  it('surfaces an accessible retry in the error state that invokes onRetry', () => {
    const { onRetry } = renderPanel({ error: new Error('boom'), rows: [] });

    // No stale/empty table leaks through the error branch.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('is null-safe: undefined rows degrade to the empty state instead of crashing', () => {
    // A contract violation upstream must not blank the page or throw when the
    // DataTable iterates — `rows ?? []` guards the map/length.
    renderPanel({ rows: undefined as unknown as SnapshotRow[] });

    expect(screen.getByText('No Powershare signals received yet.')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Signal Snapshot')).toBeInTheDocument();
  });
});

describe('SignalSnapshotPanel — sortable columns are actually wired', () => {
  it('exposes keyboard-operable sort buttons for every sortable column', () => {
    renderPanel();

    // Each header is a real <button> (focusable, keyboard-operable) — the
    // affordance the `sortable: true` columns promise.
    expect(screen.getByRole('button', { name: 'Signal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Value' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Updated' })).toBeInTheDocument();

    // Nothing is sorted until the user asks — the incoming order is preserved
    // and no column advertises an aria-sort direction yet.
    expect(screen.getByRole('columnheader', { name: 'Signal' })).not.toHaveAttribute('aria-sort');
    expect(labelOrder()).toEqual(['Bravo', 'Alpha', 'Charlie']);
  });

  it('reorders rows by label and toggles direction on repeated clicks', () => {
    renderPanel();

    // First click on a fresh column sorts descending (useSortToggle default).
    fireEvent.click(screen.getByRole('button', { name: 'Signal' }));
    expect(labelOrder()).toEqual(['Charlie', 'Bravo', 'Alpha']);
    expect(screen.getByRole('columnheader', { name: 'Signal' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    // Second click flips to ascending.
    fireEvent.click(screen.getByRole('button', { name: 'Signal' }));
    expect(labelOrder()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(screen.getByRole('columnheader', { name: 'Signal' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('sorts the value column lexically when its header is clicked', () => {
    renderPanel();

    // Descending on first click: '9 kW' > '5 kW' > '2 kW'.
    fireEvent.click(screen.getByRole('button', { name: 'Value' }));
    expect(labelOrder()).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });

  it('sorts by timestamp with a missing ts pinned to the end', () => {
    renderPanel();

    // Descending on first click: newest → oldest, and Alpha (null ts) is pinned
    // last rather than poisoning the comparison.
    fireEvent.click(screen.getByRole('button', { name: 'Updated' }));
    const order = labelOrder();
    expect(order).toEqual(['Bravo', 'Charlie', 'Alpha']);
    expect(order[order.length - 1]).toBe('Alpha');
  });
});
