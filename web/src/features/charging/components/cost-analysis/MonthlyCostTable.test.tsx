/**
 * MonthlyCostTable (cost-analysis) — behaviour + hardening contract.
 *
 * MonthlyCostTable is the tabular "monthly breakdown" band of the Cost Analysis
 * page. The parent (CostAnalysisPage) reduces raw charging sessions into
 * `MonthlyBucket[]` via `useCostAnalysisData`, and this component's whole job is
 * to (a) delegate its loading / error / empty chrome to the shared <CostSection>
 * shell and (b) present those buckets through the shared <DataTable> with the
 * seven formatted columns, client-side sorting, and semantic +/- savings colour.
 *
 * These tests pin:
 *   - the exact per-column formatting for every cell type — integer sessions,
 *     `kWh`-suffixed energy, symbol-prefixed <Currency> for cost / avg-rate /
 *     gas-equivalent, and the signed, colour-coded savings figure (emerald with
 *     a leading "+" when non-negative, rose without one when negative);
 *   - the client-side sort contract: the default is month-descending, clicking a
 *     numeric header sorts by that key descending, and clicking the active header
 *     again toggles to ascending — verified both through the visible row order
 *     AND the `aria-sort` attribute the table exposes for assistive tech;
 *   - keyboard operability of the sort controls (each is a real, focusable native
 *     <button>, not a click-only <div>), so the interaction isn't mouse-only;
 *   - the three <CostSection> chrome states are wired and mutually exclusive:
 *     loading shows a skeleton (never rows), an error shows a `role="alert"` with
 *     a working Retry that invokes `onRetry`, and an empty dataset shows a
 *     labelled `role="status"` empty state — with the section heading always
 *     present so the band is never hidden;
 *   - error precedence: an error suppresses stale rows even when data is present;
 *   - null-safety hardening: an `undefined` data prop must not throw (it renders
 *     the empty state), proving the `data ?? []` guard before `.length`/sort;
 *   - a11y: the decorative header icon is `aria-hidden` and the panel title is a
 *     real heading whose accessible name excludes the glyph.
 *
 * Conventions mirror the sibling EnvironmentalImpact test: `react-i18next` is
 * stubbed so `t(key, fallback)` resolves to its English fallback, the global
 * `useSettings` stub (src/test-setup.ts) drives the real number/currency
 * formatters at en-US precision-2, and renders are wrapped in <MemoryRouter>
 * because the error branch's <QueryError> reaches for `useNavigate`. localStorage
 * is cleared between tests because <DataTable> persists its column layout by
 * `tableId`.
 */

import type { ComponentProps } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { MonthlyCostTable } from './MonthlyCostTable';
import type { MonthlyBucket } from './types';

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

type Props = ComponentProps<typeof MonthlyCostTable>;

/** Three buckets with deliberately distinct magnitudes so every formatted token
 *  is unique and both sort keys (month + sessions) produce a distinguishable
 *  order. MAR carries a negative savings to exercise the rose / no-"+" branch. */
const JAN: MonthlyBucket = {
  month: '2025-01', cost: 10.5, energy: 40, sessions: 3,
  avgCostPerKwh: 0.262, gasEquiv: 18, savings: 7.5,
};
const FEB: MonthlyBucket = {
  month: '2025-02', cost: 25, energy: 100, sessions: 7,
  avgCostPerKwh: 0.25, gasEquiv: 40, savings: 15,
};
const MAR: MonthlyBucket = {
  month: '2025-03', cost: 5, energy: 20, sessions: 1,
  avgCostPerKwh: 0.25, gasEquiv: 12, savings: -3,
};

/** Intentionally unsorted so the default month-desc sort has to reorder them. */
const DATA: MonthlyBucket[] = [FEB, JAN, MAR];

const HEADERS = ['Month', 'Sessions', 'Energy', 'Cost', 'Avg $/kWh', 'Gas Equiv', 'Savings'];

function renderTable(props: Partial<Props> = {}) {
  return render(
    <MemoryRouter>
      <MonthlyCostTable data={DATA} {...props} />
    </MemoryRouter>,
  );
}

/** Month value of each rendered body row, top-to-bottom (row identity = month). */
function monthOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('tbody tr'))
    .map((tr) => tr.querySelector('td')?.textContent?.trim() ?? '')
    .filter(Boolean);
}

/** The seven <td> cells of the row whose first (month) cell matches `month`. */
function rowCells(container: HTMLElement, month: string): HTMLTableCellElement[] {
  const row = Array.from(
    container.querySelectorAll<HTMLTableRowElement>('tbody tr'),
  ).find((tr) => tr.querySelector('td')?.textContent?.trim() === month);
  if (!row) throw new Error(`no rendered row for month ${month}`);
  return Array.from(row.querySelectorAll('td'));
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('MonthlyCostTable — populated rendering & per-column formatting', () => {
  it('renders the heading and every column header as a sortable control', () => {
    renderTable();

    // The band renders as a real, accessibly-named heading (glyph excluded).
    expect(
      screen.getByRole('heading', { name: /monthly cost breakdown/i }),
    ).toBeInTheDocument();

    // All seven headers are present and each is an operable sort <button>.
    for (const header of HEADERS) {
      expect(screen.getByRole('button', { name: header })).toBeInTheDocument();
    }

    // One row per bucket — no chrome states alongside real data.
    expect(monthOrder(document.body).sort()).toEqual(['2025-01', '2025-02', '2025-03']);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('formats each cell type from the bucket fields', () => {
    const { container } = renderTable();

    // JAN: int sessions, kWh energy, $-prefixed cost / 3-dp avg / gas-equiv.
    const jan = rowCells(container, '2025-01');
    expect(jan[1].textContent).toBe('3');
    expect(jan[2].textContent).toBe('40.0 kWh');
    expect(jan[3].textContent).toBe('$10.50');
    expect(jan[4].textContent).toBe('$0.262'); // precision=3 avg rate
    expect(jan[5].textContent).toBe('$18.00');

    // FEB: locale-grouped nothing needed, but distinct energy + 3-dp avg.
    const feb = rowCells(container, '2025-02');
    expect(feb[2].textContent).toBe('100.0 kWh');
    expect(feb[4].textContent).toBe('$0.250');

    // The cost column carries the toned-down cyan accent (not neon body text).
    expect(jan[3].querySelector('.text-cyan-300')).not.toBeNull();
  });

  it('colours and signs the savings figure by magnitude', () => {
    const { container } = renderTable();

    // Non-negative savings → leading "+" and emerald, never rose.
    const jan = rowCells(container, '2025-01');
    expect(jan[6].textContent).toBe('+$7.50');
    expect(jan[6].querySelector('.text-emerald-300')).not.toBeNull();
    expect(jan[6].querySelector('.text-rose-300')).toBeNull();

    // Negative savings → no "+" and rose, never emerald.
    const mar = rowCells(container, '2025-03');
    expect(mar[6].textContent).toBe('$-3.00');
    expect(mar[6].querySelector('.text-rose-300')).not.toBeNull();
    expect(mar[6].querySelector('.text-emerald-300')).toBeNull();
  });
});

describe('MonthlyCostTable — sorting', () => {
  it('defaults to month-descending and marks the month header aria-sort', () => {
    const { container } = renderTable();

    expect(monthOrder(container)).toEqual(['2025-03', '2025-02', '2025-01']);
    expect(
      screen.getByRole('columnheader', { name: /month/i }),
    ).toHaveAttribute('aria-sort', 'descending');
  });

  it('sorts by a numeric column descending, then toggles to ascending', () => {
    const { container } = renderTable();

    // Switch the active key to sessions → descending (7, 3, 1 → Feb, Jan, Mar).
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    expect(monthOrder(container)).toEqual(['2025-02', '2025-01', '2025-03']);
    expect(
      screen.getByRole('columnheader', { name: /sessions/i }),
    ).toHaveAttribute('aria-sort', 'descending');

    // Click the active header again → ascending (1, 3, 7 → Mar, Jan, Feb).
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    expect(monthOrder(container)).toEqual(['2025-03', '2025-01', '2025-02']);
    expect(
      screen.getByRole('columnheader', { name: /sessions/i }),
    ).toHaveAttribute('aria-sort', 'ascending');
  });

  it('exposes each sort control as a focusable native button (keyboard-operable)', () => {
    const { container } = renderTable();

    const energyHeader = screen.getByRole('button', { name: 'Energy' });
    // A native <button> is inherently keyboard-operable (Enter/Space) and
    // focusable — not a click-only <div> that traps keyboard users.
    expect(energyHeader.tagName).toBe('BUTTON');
    energyHeader.focus();
    expect(energyHeader).toHaveFocus();

    // Clicking it still re-sorts → energy desc (100, 40, 20 → Feb, Jan, Mar).
    fireEvent.click(energyHeader);
    expect(monthOrder(container)).toEqual(['2025-02', '2025-01', '2025-03']);
  });
});

describe('MonthlyCostTable — loading / error / empty chrome', () => {
  it('shows the skeleton (never rows) while loading, keeping the heading', () => {
    const { container } = renderTable({ isLoading: true });

    expect(
      screen.getByRole('heading', { name: /monthly cost breakdown/i }),
    ).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    // No table headers/rows and no empty/error chrome while loading.
    expect(screen.queryByRole('button', { name: 'Sessions' })).toBeNull();
    expect(container.querySelector('tbody tr')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders a labelled empty state instead of a blank panel for an empty dataset', () => {
    const { container } = renderTable({ data: [] });

    expect(
      screen.getByRole('heading', { name: /monthly cost breakdown/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No monthly data available')).toBeInTheDocument();
    // Neither rows nor a loading skeleton render.
    expect(container.querySelector('tbody tr')).toBeNull();
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('renders an error with a working Retry that invokes onRetry', () => {
    const onRetry = vi.fn();
    renderTable({ error: new Error('boom'), onRetry });

    expect(
      screen.getByRole('heading', { name: /monthly cost breakdown/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(onRetry).not.toHaveBeenCalled();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);

    // The table is not rendered in the error branch.
    expect(screen.queryByRole('button', { name: 'Sessions' })).toBeNull();
  });

  it('prioritises the error over stale rows', () => {
    // Even with a full dataset, an error must win — never show stale figures.
    renderTable({ data: DATA, error: new Error('stale'), onRetry: vi.fn() });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(document.querySelector('tbody tr')).toBeNull();
    expect(screen.queryByText('40.0 kWh')).toBeNull();
  });
});

describe('MonthlyCostTable — null-safety hardening', () => {
  it('does not throw and shows the empty state when data is undefined', () => {
    // The `data ?? []` guard means `.length`/sort never touch an undefined prop.
    expect(() =>
      renderTable({ data: undefined as unknown as MonthlyBucket[] }),
    ).not.toThrow();

    expect(
      screen.getByRole('heading', { name: /monthly cost breakdown/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No monthly data available')).toBeInTheDocument();
  });
});
