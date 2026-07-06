/**
 * Pagination primitive contract tests.
 *
 * Locks in the user-facing behaviour every list page (DataTable, drives,
 * charging, alerts, locations, …) relies on:
 *   1. The landmark `<nav aria-label="Pagination">` wrapper and the polite
 *      live-region "Showing X–Y of Z" range read-out.
 *   2. First/Prev disable on the first page; Next/Last disable on the last —
 *      and each button fires `onPageChange` with the right target.
 *   3. The optional page-size selector only appears with `onPageSizeChange`,
 *      renders the configured options, and reports a NUMBER (not the raw
 *      string) on change.
 *   4. Edge/robustness cases that the harden pass fixed:
 *        - total = 0 → "Showing 0–0 of 0", a single page, everything disabled.
 *        - pageSize = 0 → falls back to the first option instead of dividing
 *          by zero and rendering "1 / Infinity" pages.
 *        - out-of-range page (too high / too low) clamps into [1, totalPages]
 *          so the range never reads backwards and the indicator stays sane.
 *   5. a11y: every icon-only control exposes an accessible name and the
 *      decorative chevrons are hidden from the a11y tree.
 *
 * `–` in the assertions is an EN DASH (U+2013) — matched via `\u2013` so the
 * expectation is encoding-proof.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// i18n stub — echo the English fallback and interpolate `{{var}}` from the
// options bag so the range caption + page indicator resolve to real numbers.
// Mirrors the SignalHistoryTable.test.tsx convention.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, vars?: Record<string, unknown>) => {
      let out = typeof fallback === 'string' ? fallback : key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

import { Pagination } from './Pagination';

interface RenderOpts {
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (p: number) => void;
  onPageSizeChange?: (s: number) => void;
  withSelector?: boolean;
  pageSizeOptions?: number[];
}

function renderPagination(opts: RenderOpts = {}) {
  const onPageChange = opts.onPageChange ?? vi.fn();
  const withSelector = opts.withSelector ?? true;
  const onPageSizeChange = withSelector ? opts.onPageSizeChange ?? vi.fn() : undefined;
  const { container } = render(
    <Pagination
      page={opts.page ?? 1}
      pageSize={opts.pageSize ?? 25}
      total={opts.total ?? 60}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      pageSizeOptions={opts.pageSizeOptions}
    />,
  );
  return { onPageChange, container };
}

const range = (container: HTMLElement) =>
  container.querySelector('[aria-live="polite"]')?.textContent;
const indicator = (container: HTMLElement) =>
  container.querySelector('[aria-current="page"]');

describe('Pagination', () => {
  it('renders a Pagination landmark with the live range and page indicator', () => {
    const { container } = renderPagination({ page: 1, pageSize: 25, total: 60 });

    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
    expect(range(container)).toBe('Showing 1\u201325 of 60');

    const ind = indicator(container);
    expect(ind?.textContent).toBe('1 / 3');
    expect(ind).toHaveAttribute('aria-label', 'Page 1 of 3');
  });

  it('reflects the current page in the range read-out on a middle page', () => {
    const { container } = renderPagination({ page: 2, pageSize: 25, total: 60 });
    // (2-1)*25+1 = 26 … min(2*25, 60) = 50
    expect(range(container)).toBe('Showing 26\u201350 of 60');
    expect(indicator(container)?.textContent).toBe('2 / 3');
  });

  it('clamps the range end to total on a partial final page', () => {
    const { container } = renderPagination({ page: 3, pageSize: 25, total: 60 });
    // (3-1)*25+1 = 51 … min(3*25=75, 60) = 60 — must NOT overshoot to 75.
    expect(range(container)).toBe('Showing 51\u201360 of 60');
    expect(indicator(container)?.textContent).toBe('3 / 3');
  });

  it('disables First and Previous on the first page while Next and Last stay enabled', () => {
    renderPagination({ page: 1, pageSize: 25, total: 60 });
    expect(screen.getByRole('button', { name: 'First page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Last page' })).toBeEnabled();
  });

  it('disables Next and Last on the final page while First and Previous stay enabled', () => {
    renderPagination({ page: 3, pageSize: 25, total: 60 });
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Last page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'First page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
  });

  it('invokes onPageChange with the correct target page for each nav button', () => {
    const { onPageChange } = renderPagination({ page: 2, pageSize: 25, total: 60 });

    fireEvent.click(screen.getByRole('button', { name: 'First page' }));
    expect(onPageChange).toHaveBeenLastCalledWith(1);

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPageChange).toHaveBeenLastCalledWith(1);

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenLastCalledWith(3);

    fireEvent.click(screen.getByRole('button', { name: 'Last page' }));
    expect(onPageChange).toHaveBeenLastCalledWith(3);

    expect(onPageChange).toHaveBeenCalledTimes(4);
  });

  it('renders the page-size selector only when onPageSizeChange is provided', () => {
    const { rerender } = render(
      <Pagination page={1} pageSize={25} total={60} onPageChange={vi.fn()} />,
    );
    expect(screen.queryByRole('combobox', { name: 'Rows per page' })).toBeNull();

    rerender(
      <Pagination
        page={1}
        pageSize={25}
        total={60}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toBeInTheDocument();
  });

  it('offers the default page-size options and reports a NUMBER on change', () => {
    const onPageSizeChange = vi.fn();
    renderPagination({ page: 1, pageSize: 25, total: 300, onPageSizeChange });

    const select = screen.getByRole('combobox', { name: 'Rows per page' });
    const labels = screen.getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual(['25 / page', '50 / page', '100 / page']);

    fireEvent.change(select, { target: { value: '50' } });
    // Strict equality — proves Number() conversion (would fail on the '50' string).
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
    expect(onPageSizeChange.mock.calls[0][0]).toBe(50);
  });

  it('honours a custom pageSizeOptions list', () => {
    renderPagination({ page: 1, pageSize: 10, total: 100, pageSizeOptions: [10, 20] });
    const labels = screen.getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual(['10 / page', '20 / page']);
    expect(screen.queryByRole('option', { name: '25 / page' })).toBeNull();
  });

  it('shows an empty range and a single page when total is zero', () => {
    const { container } = renderPagination({ page: 1, pageSize: 25, total: 0 });
    expect(range(container)).toBe('Showing 0\u20130 of 0');
    expect(indicator(container)?.textContent).toBe('1 / 1');
    // Nothing to page through — every direction is a dead end.
    expect(screen.getByRole('button', { name: 'First page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Last page' })).toBeDisabled();
  });

  it('guards a zero pageSize instead of producing Infinity pages', () => {
    const { container } = renderPagination({ page: 1, pageSize: 0, total: 50 });
    // Falls back to the first option (25) → ceil(50/25) = 2 pages, NOT Infinity.
    expect(indicator(container)?.textContent).toBe('1 / 2');
    expect(container.textContent).not.toContain('Infinity');
    expect(range(container)).toBe('Showing 1\u201325 of 50');
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('clamps an out-of-range page down to the last page', () => {
    const { container, onPageChange } = renderPagination({ page: 99, pageSize: 25, total: 60 });

    expect(indicator(container)?.textContent).toBe('3 / 3');
    // The range must not read backwards ("51–60", never "2451–60").
    expect(range(container)).toBe('Showing 51\u201360 of 60');
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Last page' })).toBeDisabled();

    // Previous steps back from the clamped page (2), not from 99.
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('clamps a below-range page up to the first page', () => {
    const { container } = renderPagination({ page: 0, pageSize: 25, total: 60 });
    expect(indicator(container)?.textContent).toBe('1 / 3');
    expect(screen.getByRole('button', { name: 'First page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  });

  it('exposes accessible names on every icon-only control and hides decorative icons', () => {
    const { container } = renderPagination({ page: 2, pageSize: 25, total: 60 });

    for (const name of ['First page', 'Previous page', 'Next page', 'Last page']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }

    // Each chevron is decorative and hidden from the a11y tree.
    const hiddenIcons = container.querySelectorAll('button svg[aria-hidden="true"]');
    expect(hiddenIcons.length).toBe(4);

    // The range read-out is a polite, atomic live region so paging announces
    // the new count without stealing focus.
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toHaveAttribute('aria-atomic', 'true');
  });
});
