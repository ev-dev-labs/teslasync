// Unit tests for the SQL Playground catalog KPI band.
//
// The band is a pure presentational surface fed two counts by the page. These
// tests cover BOTH exports:
//
//   - `safeCount(value)` — the null-safety guard that keeps a malformed count
//     (NaN from an empty reduce, a negative, a fractional) from ever surfacing
//     as "NaN" / "-3" / "3.5 tables" in the UI.
//   - `CatalogKpiBand` — the component itself: all four source metrics render
//     (invalid counts are omitted and counted as hidden instead of invented
//     as zero), the labelled region landmark exposes an accessible name, the
//     numeric props are shown, the two invariant cards (read-only access, SI
//     units) are always present, and the decorative icons are hidden from
//     assistive tech.
//
// The shared Brief discloses face-value only: labels + live values stay on
// the card face while subtitles, icons, scope, freshness, and provenance live
// in the Review-details drawer. Queries below are scoped per surface.
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

const SUBTITLES = [
  'read-only surfaces',
  'across all tables',
  'no writes possible',
  'm · s · Wh',
];

const METRIC_LABELS = [
  'Catalog tables',
  'Documented columns',
  'Access mode',
  'Storage units',
];

function openReviewDetails() {
  fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
  return screen.getByRole('dialog', { name: 'Catalog overview details' });
}

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

    // Labels live on the face next to their live values.
    expect(screen.getByText('Catalog tables')).toBeInTheDocument();
    expect(screen.getByText('Documented columns')).toBeInTheDocument();
    expect(screen.getByText('Access mode')).toBeInTheDocument();
    expect(screen.getByText('Storage units')).toBeInTheDocument();

    // Subtitles moved off the face into the Review-details drawer.
    for (const subtitle of SUBTITLES) {
      expect(screen.queryByText(subtitle)).not.toBeInTheDocument();
    }

    // Exactly four source metrics — no section is dropped.
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);

    const drawer = openReviewDetails();
    for (const subtitle of SUBTITLES) {
      expect(within(drawer).getByText(subtitle)).toBeInTheDocument();
    }
  });

  it('uses the compact shared Brief grid without losing read-only or SI provenance', () => {
    const { container } = render(<CatalogKpiBand tableCount={5} columnCount={42} />);
    expect(container.querySelector('[data-operational-brief]')).toBeInTheDocument();
    // Compact bank grid: four tiles balanced as two rows of two.
    expect(container.querySelector('[data-max-per-row]')).toHaveAttribute('data-max-per-row', '3');
    expect(
      Array.from(
        container.querySelectorAll('[data-operational-metric-bank]'),
        (row) => row.getAttribute('data-columns'),
      ),
    ).toEqual(['2', '2']);
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(screen.getByText('SI units')).toBeInTheDocument();
    expect(screen.queryByText('no writes possible')).not.toBeInTheDocument();
    expect(screen.queryByText('m · s · Wh')).not.toBeInTheDocument();
    const drawer = openReviewDetails();
    expect(within(drawer).getByText('no writes possible')).toBeInTheDocument();
    expect(within(drawer).getByText('m · s · Wh')).toBeInTheDocument();
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
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    // Invalid counts are omitted from the face — only the two invariant
    // metrics remain — instead of rendering a placeholder dash.
    expect(container.querySelector('[data-operational-metric="tables"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-operational-metric="columns"]')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(2);
    expect(screen.queryByText('Invalid catalog counts')).not.toBeInTheDocument();

    const drawer = openReviewDetails();
    expect(within(drawer).getByText('Invalid catalog counts')).toBeInTheDocument();
    expect(within(drawer).getByText('2 empty fields are hidden.')).toBeInTheDocument();
    expect(within(drawer).queryByText('—')).not.toBeInTheDocument();
    expect(within(drawer).queryByText('0')).not.toBeInTheDocument();
  });

  it('marks the decorative KPI icons aria-hidden so screen readers skip them', () => {
    const { container } = render(<CatalogKpiBand tableCount={5} columnCount={42} />);

    // The face shows label + value only; the decorative icons moved to the
    // drawer metric groups with the rest of the per-metric context.
    expect(container.querySelectorAll('[data-operational-metric] svg')).toHaveLength(0);
    const drawer = openReviewDetails();
    // One decorative icon per card; each must be hidden from assistive tech
    // because the label + value already convey the meaning.
    for (const label of METRIC_LABELS) {
      const group = within(drawer).getByRole('group', { name: label });
      expect(group.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
    }
  });

  it('retains source captions, raw count states and static coverage in the real Review details drawer', () => {
    const { container } = render(<CatalogKpiBand tableCount={5} columnCount={42} />);
    expect(container.querySelectorAll('[data-operational-metric][data-value-state="value"]')).toHaveLength(4);
    expect(container.querySelector('[data-operational-metric="tables"] [data-operational-value]')).toHaveTextContent('5');
    // Source captions live in the drawer header now, off the card face.
    expect(screen.queryByText('Bundled schema catalog · all entries')).not.toBeInTheDocument();
    expect(screen.queryByText('Reference data · no live measurement')).not.toBeInTheDocument();
    const drawer = openReviewDetails();
    expect(within(drawer).getByText('Bundled schema catalog · all entries')).toBeInTheDocument();
    expect(within(drawer).getByText('Reference data · no live measurement')).toBeInTheDocument();
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
    // The fractional count is omitted as invalid; the measured zero stays.
    expect(container.querySelector('[data-operational-metric="tables"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-operational-metric="columns"]')).toHaveAttribute('data-value-state', 'value');
    expect(container.querySelector('[data-operational-metric="columns"] [data-operational-value]')).toHaveTextContent('0');
    const drawer = openReviewDetails();
    expect(within(drawer).queryByRole('group', { name: 'Catalog tables' })).not.toBeInTheDocument();
    expect(within(drawer).getByRole('group', { name: 'Documented columns' })).toBeInTheDocument();
    expect(within(drawer).getByText('1 empty field is hidden.')).toBeInTheDocument();
  });

  it('formats raw integer totals using saved locale without adding fractional or storage units', () => {
    unitPrefs.locale = 'de-DE';
    unitPrefs.precision = 3;
    const { container } = render(<CatalogKpiBand tableCount={1200} columnCount={45000} />);
    expect(container.querySelector('[data-operational-metric="tables"] [data-operational-value]')).toHaveTextContent('1.200');
    expect(container.querySelector('[data-operational-metric="columns"] [data-operational-value]')).toHaveTextContent('45.000');
    expect(screen.getByText('SI units')).toBeInTheDocument();
    expect(screen.queryByText('m · s · Wh')).not.toBeInTheDocument();
    const drawer = openReviewDetails();
    expect(within(drawer).getByText('m · s · Wh')).toBeInTheDocument();
  });
});
