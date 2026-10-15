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
 *     gas-equivalent, and the signed savings figure (a leading "+" when
 *     non-negative, without one when negative) using theme-owned text;
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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { MonthlyCostTable } from './MonthlyCostTable';
import type { MonthlyBucket } from './types';
import { downloadJSON } from '@/lib/csvExport';

vi.mock('@/lib/csvExport', async () => ({
  ...await vi.importActual<typeof import('@/lib/csvExport')>('@/lib/csvExport'),
  downloadJSON: vi.fn(),
}));

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

const HEADERS = ['Month', 'Sessions', 'Energy', 'Cost', 'Avg $/kWh', 'Gas equiv', 'Savings'];

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
    expect(jan[2].textContent).toBe('40.00 kWh');
    expect(jan[3].textContent).toBe('$10.50');
    expect(jan[4].textContent).toBe('$0.26'); // precision=3 avg rate
    expect(jan[5].textContent).toBe('$18.00');

    // FEB: locale-grouped nothing needed, but distinct energy + 3-dp avg.
    const feb = rowCells(container, '2025-02');
    expect(feb[2].textContent).toBe('100.00 kWh');
    expect(feb[4].textContent).toBe('$0.25');

    expect(jan[3].querySelector('.text-cyan-300')).toBeNull();
  });

  it('signs the savings figure without depending on colour', () => {
    const { container } = renderTable();

    // Non-negative savings retain the explicit leading "+".
    const jan = rowCells(container, '2025-01');
    expect(jan[6].textContent).toBe('+$7.50');
    expect(jan[6].querySelector('.text-emerald-300')).toBeNull();
    expect(jan[6].querySelector('.text-rose-300')).toBeNull();

    // Negative savings retain the source sign, with no "+".
    const mar = rowCells(container, '2025-03');
    expect(mar[6].textContent).toBe('$-3.00');
    expect(mar[6].querySelector('.text-rose-300')).toBeNull();
    expect(mar[6].querySelector('.text-emerald-300')).toBeNull();
  });

  describe('MonthlyCostTable — mobile presentation preservation', () => {
    const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
    const resize = (width: number) => act(() => {
      observers.forEach(({ element, callback }) => callback(
        [{ target: element, contentRect: { width } } as ResizeObserverEntry],
        {} as ResizeObserver,
      ));
    });

    beforeEach(() => {
      observers.length = 0;
      vi.clearAllMocks();
      vi.stubGlobal('ResizeObserver', class {
        constructor(private callback: ResizeObserverCallback) {}
        observe(element: Element) { observers.push({ element, callback: this.callback }); }
        unobserve() {}
        disconnect() {}
      });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('opens all seven formatted fields by keyboard at 375px and restores focus', async () => {
      const user = userEvent.setup();
      const { container } = renderTable();
      resize(375);
      expect(container.querySelector('table')).toBeNull();
      const row = screen.getByRole('button', { name: JAN.month });
      expect(row).toHaveTextContent('$10.50');
      row.focus();
      await user.keyboard('{Enter}');
      const dialog = screen.getByRole('dialog');
      for (const header of HEADERS) expect(within(dialog).getByText(header)).toBeInTheDocument();
      expect(within(dialog).getAllByRole('definition').map(field => field.textContent)).toEqual([
        '2025-01', '3', '40.00 kWh', '$10.50', '$0.26', '$18.00', '+$7.50',
      ]);
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(row).toHaveFocus();
      resize(1024);
      expect(rowCells(container, JAN.month)).toHaveLength(7);
    });

    it('keeps every sort control keyboard-operable on mobile', async () => {
      const user = userEvent.setup();
      const { container } = renderTable();
      resize(375);
      for (const header of HEADERS) expect(screen.getByRole('button', { name: header })).toHaveClass('min-h-11');
      screen.getByRole('button', { name: 'Sessions' }).focus();
      await user.keyboard('{Enter}');
      const order = () => Array.from(container.querySelectorAll('[data-row-key]')).map(row => row.getAttribute('data-row-key'));
      expect(order()).toEqual([FEB.month, JAN.month, MAR.month]);
      await user.keyboard(' ');
      expect(order()).toEqual([MAR.month, JAN.month, FEB.month]);
    });

    it('exports all loaded rows and raw numeric fields rather than only the mobile page', async () => {
      const data = Array.from({ length: 30 }, (_, index) => ({
        ...JAN, month: `month-${String(index).padStart(2, '0')}`, cost: index + 0.125,
      }));
      const { container } = renderTable({ data });
      resize(375);
      expect(container.querySelectorAll('[data-row-key]')).toHaveLength(25);
      fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
      await waitFor(() => expect(downloadJSON).toHaveBeenCalledTimes(1));
      expect(vi.mocked(downloadJSON).mock.calls[0][1]).toEqual([...data].reverse());
      fireEvent.click(screen.getByRole('button', { name: /Load .* more/ }));
      expect(container.querySelectorAll('[data-row-key]')).toHaveLength(30);
      resize(1024);
      expect(monthOrder(container)).toHaveLength(25);
      expect(screen.getByRole('table')).toHaveAttribute('aria-label', 'Monthly cost breakdown');
    });
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
    const { container } = renderTable({ isLoading: true, error: new Error('stale') });

    expect(
      screen.getByRole('heading', { name: /monthly cost breakdown/i }),
    ).toBeInTheDocument();
    const skeleton = container.querySelector('[aria-hidden="true"][style]');
    expect(skeleton).not.toBeNull();
    expect(skeleton).toHaveClass('h-4', 'w-full', 'rounded', 'bg-[var(--skeleton-bg)]');
    expect(skeleton).toHaveAttribute('aria-hidden', 'true');
    expect(skeleton).toHaveStyle('height: 200px');
    expect(container.querySelector('.animate-pulse')).toBeNull();
    // No table headers/rows and no empty/error chrome while loading.
    expect(screen.queryByRole('button', { name: 'Sessions' })).toBeNull();
    expect(container.querySelector('tbody tr')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('40.00 kWh')).toBeNull();
    expect(screen.queryByText('$10.50')).toBeNull();
    expect(screen.queryByText('No monthly data available')).toBeNull();
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
    expect(container.querySelector('[class*="--skeleton-bg"]')).toBeNull();
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
    expect(screen.queryByText('40.00 kWh')).toBeNull();
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
