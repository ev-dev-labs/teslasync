// Unit tests for the SQL Playground catalog KPI band.
//
// The band is a pure presentational surface fed two counts by the page. These
// tests cover BOTH exports:
//
//   - `safeCount(value)` — the null-safety guard that keeps a malformed count
//     (NaN from an empty reduce, a negative, a fractional) from ever surfacing
//     as "NaN" / "-3" / "3.5 tables" in the UI.
//   - `CatalogKpiBand` — the component itself: all four source metrics render
//     (invalid counts remain explicitly invalid), the labelled region
//     landmark exposes an accessible name, the numeric props are shown, the two
//     invariant cards (read-only access, SI units) are always present, and the
//     decorative icons are hidden from assistive tech.
//
// Preferences are deterministic; the actual raw bridge and Brief are retained.

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

const { unitPrefs } = vi.hoisted(() => ({
  unitPrefs: { locale: 'en-US', precision: 2 },
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));

import '@/i18n';
import { CatalogKpiBand, safeCount } from './CatalogKpiBand';

beforeEach(() => {
  unitPrefs.locale = 'en-US';
  unitPrefs.precision = 2;
});

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

    // Exactly four source metrics — no section is dropped.
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
  });

  it('uses the compact shared Brief grid without losing read-only or SI provenance', () => {
    const { container } = render(<CatalogKpiBand tableCount={5} columnCount={42} />);
    expect(container.querySelector('[data-operational-brief]')).toBeInTheDocument();
    expect(screen.getByRole('list')).toHaveClass('sm:grid-cols-2', 'md:grid-cols-3');
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(screen.getByText('SI units')).toBeInTheDocument();
    expect(screen.getByText('no writes possible')).toBeInTheDocument();
    expect(screen.getByText('m · s · Wh')).toBeInTheDocument();
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

  it('marks degenerate counts (NaN / negative) invalid instead of inventing zero', () => {
    const { container } = render(
      <CatalogKpiBand
        tableCount={Number.NaN}
        columnCount={-3}
      />,
    );

    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    expect(screen.queryByText('-3')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(container.querySelector('[data-operational-metric="tables"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(container.querySelector('[data-operational-metric="columns"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(screen.getByText('Invalid catalog counts')).toBeInTheDocument();
  });

  it('marks the decorative KPI icons aria-hidden so screen readers skip them', () => {
    const { container } = render(<CatalogKpiBand tableCount={5} columnCount={42} />);

    // One decorative icon per card; each must be hidden from assistive tech
    // because the label + value already convey the meaning.
    const hiddenIcons = container.querySelectorAll('[data-operational-metric] svg[aria-hidden="true"]');
    expect(hiddenIcons).toHaveLength(4);
  });

  it('retains source captions, raw count states and static coverage in the real Review details drawer', () => {
    const { container } = render(<CatalogKpiBand tableCount={5} columnCount={42} />);
    expect(container.querySelectorAll('[data-operational-metric][data-value-state="value"]')).toHaveLength(4);
    expect(container.querySelector('[data-operational-metric="tables"] [data-operational-value]')).toHaveTextContent('5');
    expect(screen.getByText('Bundled schema catalog · all entries')).toBeInTheDocument();
    expect(screen.getByText('Reference data · no live measurement')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Catalog overview details' });
    expect(within(drawer).getByText('read-only surfaces')).toBeInTheDocument();
    expect(within(drawer).getByText('across all tables')).toBeInTheDocument();
    expect(within(drawer).getByText('no writes possible')).toBeInTheDocument();
    expect(within(drawer).getByText('m · s · Wh')).toBeInTheDocument();
    expect(within(drawer).getByText(/Table and column counts come from the bundled curated SQL catalog/)).toBeInTheDocument();
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();
    const close = within(drawer).getAllByRole('button', { name: 'Close' });
    fireEvent.click(close[close.length - 1]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps fractional counts invalid while a measured zero remains a valid source value', () => {
    const { container } = render(<CatalogKpiBand tableCount={3.7} columnCount={0} />);
    expect(container.querySelector('[data-operational-metric="tables"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(container.querySelector('[data-operational-metric="columns"]')).toHaveAttribute('data-value-state', 'value');
    expect(container.querySelector('[data-operational-metric="columns"] [data-operational-value]')).toHaveTextContent('0');
  });

  it('formats raw integer totals using saved locale without adding fractional or storage units', () => {
    unitPrefs.locale = 'de-DE';
    unitPrefs.precision = 3;
    const { container } = render(<CatalogKpiBand tableCount={1200} columnCount={45000} />);
    expect(container.querySelector('[data-operational-metric="tables"] [data-operational-value]')).toHaveTextContent('1.200');
    expect(container.querySelector('[data-operational-metric="columns"] [data-operational-value]')).toHaveTextContent('45.000');
    expect(screen.getByText('SI units')).toBeInTheDocument();
    expect(screen.getByText('m · s · Wh')).toBeInTheDocument();
  });
});
