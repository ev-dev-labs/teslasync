// Unit tests for the SQL Playground catalog KPI band.
//
// The band is a pure presentational surface fed two counts by the page. These
// tests cover BOTH exports:
//
//   - `safeCount(value)` — the null-safety guard that keeps a malformed count
//     (NaN from an empty reduce, a negative, a fractional) from ever surfacing
//     as "NaN" / "-3" / "3.5 tables" in the UI.
//   - `CatalogKpiBand` — the component itself: the four KPI cards always render
//     (no section is hidden when a count is degenerate), the labelled region
//     landmark exposes an accessible name, the numeric props are shown, the two
//     invariant cards (read-only access, SI units) are always present, and the
//     decorative icons are hidden from assistive tech.
//
// No network is touched — the band fetches nothing, so a bare render() (no
// QueryClient / Router) is sufficient. `@/i18n` is imported so the t()
// default-value fallbacks resolve deterministically.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import '@/i18n';
import { CatalogKpiBand, safeCount } from './CatalogKpiBand';

describe('safeCount', () => {
  it('clamps nullish, non-finite, and negative inputs to 0', () => {
    expect(safeCount(undefined)).toBe(0);
    expect(safeCount(null)).toBe(0);
    expect(safeCount(Number.NaN)).toBe(0);
    expect(safeCount(Number.POSITIVE_INFINITY)).toBe(0);
    expect(safeCount(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(safeCount(-1)).toBe(0);
    expect(safeCount(-0.5)).toBe(0);
  });

  it('floors fractional counts and passes valid non-negative integers through unchanged', () => {
    expect(safeCount(0)).toBe(0);
    expect(safeCount(5)).toBe(5);
    expect(safeCount(128)).toBe(128);
    // A count is a whole number — fractional input is truncated, never rounded up.
    expect(safeCount(3.7)).toBe(3);
    expect(safeCount(3.2)).toBe(3);
  });
});

describe('CatalogKpiBand', () => {
  it('renders a labelled "Catalog overview" region as a landmark', () => {
    render(<CatalogKpiBand tableCount={5} columnCount={42} />);

    const region = screen.getByRole('region', { name: /catalog overview/i });
    expect(region).toBeInTheDocument();
    expect(region.tagName.toLowerCase()).toBe('section');
  });

  it('always renders all four KPI cards with their labels and subtitles', () => {
    const { container } = render(<CatalogKpiBand tableCount={5} columnCount={42} />);

    // Labels
    expect(screen.getByText('Catalog tables')).toBeInTheDocument();
    expect(screen.getByText('Documented columns')).toBeInTheDocument();
    expect(screen.getByText('Access mode')).toBeInTheDocument();
    expect(screen.getByText('Storage units')).toBeInTheDocument();

    // Subtitles
    expect(screen.getByText('read-only surfaces')).toBeInTheDocument();
    expect(screen.getByText('across all tables')).toBeInTheDocument();
    expect(screen.getByText('no writes possible')).toBeInTheDocument();
    expect(screen.getByText('m · s · Wh')).toBeInTheDocument();

    // Exactly four metric cards — no section is dropped.
    expect(container.querySelectorAll('[data-role="metric-label"]')).toHaveLength(4);
  });

  it('renders the numeric counts passed via props', () => {
    render(<CatalogKpiBand tableCount={5} columnCount={42} />);

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders the invariant read-only + SI-units cards regardless of the counts', () => {
    render(<CatalogKpiBand tableCount={0} columnCount={0} />);

    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(screen.getByText('SI units')).toBeInTheDocument();
    // Both counts are a legitimate 0 — the cards must still render "0".
    expect(screen.getAllByText('0')).toHaveLength(2);
  });

  it('coerces degenerate counts (NaN / negative) to 0 instead of leaking "NaN" or "-3"', () => {
    render(
      <CatalogKpiBand
        tableCount={Number.NaN}
        columnCount={-3 as unknown as number}
      />,
    );

    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    expect(screen.queryByText('-3')).not.toBeInTheDocument();
    // Both malformed counts collapse to the safe "0" display.
    expect(screen.getAllByText('0')).toHaveLength(2);
  });

  it('marks the decorative KPI icons aria-hidden so screen readers skip them', () => {
    const { container } = render(<CatalogKpiBand tableCount={5} columnCount={42} />);

    // One decorative icon per card; each must be hidden from assistive tech
    // because the label + value already convey the meaning.
    const hiddenIcons = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(hiddenIcons).toHaveLength(4);
  });
});
