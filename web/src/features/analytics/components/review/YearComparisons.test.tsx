/**
 * YearComparisons — "fun facts" tiles contract + hardening tests.
 *
 * YearComparisons turns the Year-in-Review `comparisons` array into a grid of
 * emoji/label/value tiles. It owns exactly one branch: an EmptyState when there
 * is nothing to show (null / undefined / [] / an array of only null holes),
 * otherwise a labelled `role="list"` of `role="listitem"` tiles.
 *
 * Facets covered:
 *   1. Empty — null, undefined, and [] all collapse to the same EmptyState
 *      (role="status") with the translated copy; no list is rendered.
 *   2. Malformed — an array whose only entries are null/undefined is treated as
 *      empty (regression guard: pre-hardening reading `.label` on a null row
 *      threw and blanked the panel).
 *   3. Populated — every comparison renders as a labelled listitem with its
 *      emoji (decorative / aria-hidden), label, and value.
 *   4. Null-safety — a row missing `value` / `emoji` still renders (value falls
 *      back to the "—" placeholder) instead of printing "undefined" or crashing.
 *   5. Duplicate labels — two rows sharing a label both render and do NOT trip
 *      React's duplicate-key warning (regression guard for the composite key).
 *   6. a11y — the grid is a `list` landmark, the tiles are `listitem`s, and the
 *      emoji is hidden from assistive tech.
 *
 * `react-i18next` is stubbed so `t(key, 'Default')` yields the English default.
 * The component pulls no data hooks and renders no <Link>, so no QueryClient /
 * Router provider is needed. Nothing touches the network.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import { YearComparisons } from './YearComparisons';
import type { YearReviewComparison } from '@/api/types';

const EMPTY_COPY = 'No fun facts available for this year yet';
const PLACEHOLDER = '—';

function fact(
  overrides: Partial<YearReviewComparison> = {},
): YearReviewComparison {
  return { label: 'Trips to the Moon', value: '0.003×', emoji: '🌙', ...overrides };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('YearComparisons — empty branch', () => {
  it('renders the EmptyState (and no list) when comparisons is null', () => {
    render(<YearComparisons comparisons={null} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(EMPTY_COPY)).toBeInTheDocument();
    // The grid must not render alongside the empty branch.
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('treats undefined and [] the same as null (both collapse to the EmptyState)', () => {
    const { rerender } = render(<YearComparisons comparisons={undefined} />);
    expect(screen.getByText(EMPTY_COPY)).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();

    rerender(<YearComparisons comparisons={[]} />);
    expect(screen.getByText(EMPTY_COPY)).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('treats an array of only null/undefined holes as empty without crashing (regression guard)', () => {
    // Pre-hardening, `.map((item) => item.label)` over a null row threw and
    // blanked the whole panel; the `.filter(Boolean)` now absorbs it.
    const malformed = [null, undefined] as unknown as YearReviewComparison[];

    expect(() =>
      render(<YearComparisons comparisons={malformed} />),
    ).not.toThrow();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(EMPTY_COPY)).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});

describe('YearComparisons — populated branch', () => {
  const items = [
    fact({ label: 'Trips to the Moon', value: '0.003×', emoji: '🌙' }),
    fact({ label: 'Marathons', value: '12 runs', emoji: '🏃' }),
    fact({ label: 'Cups of coffee', value: '410', emoji: '☕' }),
  ];

  it('renders one labelled listitem per comparison, each with its label and value', () => {
    render(<YearComparisons comparisons={items} />);

    const list = screen.getByRole('list');
    const tiles = within(list).getAllByRole('listitem');
    expect(tiles).toHaveLength(3);

    expect(screen.getByText('Trips to the Moon')).toBeInTheDocument();
    expect(screen.getByText('0.003×')).toBeInTheDocument();
    expect(screen.getByText('Marathons')).toBeInTheDocument();
    expect(screen.getByText('410')).toBeInTheDocument();

    // Populated ⇒ definitely not the empty branch.
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('marks the emoji as decorative (aria-hidden) so assistive tech skips it', () => {
    render(
      <YearComparisons
        comparisons={[fact({ emoji: '🌙', label: 'Moon', value: '1' })]}
      />,
    );

    const emoji = screen.getByText('🌙');
    expect(emoji).toHaveAttribute('aria-hidden', 'true');
    // The meaningful text (label/value) stays visible to the reader.
    expect(screen.getByText('Moon')).toBeInTheDocument();
  });
});

describe('YearComparisons — null-safety', () => {
  it('renders the "—" placeholder for a row missing value/emoji instead of "undefined"', () => {
    const partial = [{ label: 'Only a label' }] as unknown as YearReviewComparison[];

    render(<YearComparisons comparisons={partial} />);

    expect(screen.getByText('Only a label')).toBeInTheDocument();
    // Missing value collapses to the placeholder — never the literal "undefined".
    expect(screen.getByText(PLACEHOLDER)).toBeInTheDocument();
    expect(screen.queryByText('undefined')).toBeNull();
    // Still a real tile, not the empty branch.
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });
});

describe('YearComparisons — duplicate labels', () => {
  it('renders both same-labelled rows and emits no React duplicate-key warning (composite-key guard)', () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const dupes = [
      fact({ label: 'Distance', value: '10,000 km', emoji: '🛣️' }),
      fact({ label: 'Distance', value: '2× the equator', emoji: '🌍' }),
    ];

    render(<YearComparisons comparisons={dupes} />);

    // Both same-labelled tiles survive (the index disambiguates the key).
    expect(screen.getAllByText('Distance')).toHaveLength(2);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    // Both distinct values render — neither row was dropped by a key clash.
    expect(screen.getByText('10,000 km')).toBeInTheDocument();
    expect(screen.getByText('2× the equator')).toBeInTheDocument();

    // Pre-hardening `key={item.label}` logged
    // "Encountered two children with the same key" here.
    const sawDupKeyWarning = errorSpy.mock.calls.some((args) =>
      args.some((a) => typeof a === 'string' && a.includes('same key')),
    );
    expect(sawDupKeyWarning).toBe(false);
  });
});
