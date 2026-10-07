/**
 * WidgetRankedList — behaviour, branch + hardening coverage.
 *
 * WidgetRankedList is a pure presentational primitive used across the
 * dashboard widgets to render a "top N" leaderboard: it sorts a list of
 * {@link RankedItem}s by `value` (descending), caps it, and draws each row
 * with a rank number, label, optional badge, formatted value, and an
 * optional proportional background bar. It owns no data hooks and touches no
 * network, so every render here is deterministic from props alone.
 *
 * Surface under test:
 *   1. Ranking: input is sorted by `value` desc regardless of incoming order,
 *      the top-N are kept, and the caller's array is never mutated.
 *   2. Limits: the default cap (5 wide / 3 compact), the `maxItems` override,
 *      and the guard that a zero/negative cap collapses to the empty state
 *      instead of `Array.slice`'s negative-index footgun.
 *   3. Bars: shown by default, hidden when `compact` or `showBars={false}`,
 *      width proportional to the max value, decorative (aria-hidden), and
 *      clamped to [0,100] so a negative reading never yields a negative width.
 *   4. Badges: each `variant` maps to the right shared <Badge> colour.
 *   5. Empty / null-safety: an empty list, an `undefined` list (typed
 *      non-null but undefined mid-fetch), and a zero cap all render the
 *      shared <EmptyState> (role="status") with the supplied message + icon
 *      rather than throwing or drawing a blank panel.
 *   6. Field null-safety: a missing `label` / `formattedValue` renders the
 *      em-dash placeholder; a non-finite `value` is coerced to 0.
 *
 * Convention: `@testing-library/user-event` is intentionally NOT a dependency
 * of this codebase (see web/package.json) and this widget exposes no
 * interactive controls, so there are no interactions to drive — every case is
 * a render + query assertion, consistent with the other dashboard tests.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WidgetRankedList, type RankedItem } from './WidgetRankedList';
import { BADGE_VARIANTS } from '@/components/ui';

/* ── Fixtures ─────────────────────────────────────────────────────── */

function makeItem(overrides: Partial<RankedItem> = {}): RankedItem {
  const value = overrides.value ?? 0;
  return {
    id: overrides.id ?? overrides.label ?? String(value),
    label: overrides.label ?? 'Item',
    value,
    formattedValue: overrides.formattedValue ?? String(value),
    ...overrides,
  };
}

/** N items labelled A, B, C… with descending values 100, 90, 80… */
function makeSeries(count: number): RankedItem[] {
  return Array.from({ length: count }, (_, i) =>
    makeItem({
      id: i,
      label: String.fromCharCode(65 + i),
      value: 100 - i * 10,
      formattedValue: `${100 - i * 10}`,
    }),
  );
}

/** Decorative bars are the only aria-hidden nodes the widget emits. */
function bars(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[aria-hidden="true"]'));
}

/* ── Specs ────────────────────────────────────────────────────────── */

describe('WidgetRankedList', () => {
  it('sorts items by value descending and numbers the ranks 1..N', () => {
    render(
      <WidgetRankedList
        items={[
          makeItem({ id: 'a', label: 'Alpha', value: 10, formattedValue: '10' }),
          makeItem({ id: 'b', label: 'Bravo', value: 30, formattedValue: '30' }),
          makeItem({ id: 'c', label: 'Charlie', value: 20, formattedValue: '20' }),
        ]}
      />,
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    // Highest value first, lowest last — independent of input order.
    expect(rows[0]).toHaveTextContent('Bravo');
    expect(rows[1]).toHaveTextContent('Charlie');
    expect(rows[2]).toHaveTextContent('Alpha');
    // Rank prefixes are 1-based and in render order.
    expect(rows[0].textContent).toContain('1');
    expect(rows[1].textContent).toContain('2');
    expect(rows[2].textContent).toContain('3');
  });

  it('does not mutate the caller-supplied items array', () => {
    const items = [
      makeItem({ id: 'a', label: 'Alpha', value: 10 }),
      makeItem({ id: 'b', label: 'Bravo', value: 30 }),
    ];
    const original = [...items];

    render(<WidgetRankedList items={items} />);

    // Sorting happens on an internal copy; the prop array keeps its order.
    expect(items).toEqual(original);
    expect(items[0].label).toBe('Alpha');
  });

  it('caps at 5 rows by default and keeps the highest-valued items', () => {
    render(<WidgetRankedList items={makeSeries(8)} />);

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    // A(100)…E(60) survive; F(50) and below are trimmed.
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('E')).toBeInTheDocument();
    expect(screen.queryByText('F')).not.toBeInTheDocument();
  });

  it('caps at 3 rows and hides bars in compact mode', () => {
    const { container } = render(<WidgetRankedList items={makeSeries(8)} compact />);

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    // compact implies hideBars — no decorative bar nodes at all.
    expect(bars(container)).toHaveLength(0);
  });

  it('honours an explicit maxItems over the default and picks the top values', () => {
    render(
      <WidgetRankedList
        maxItems={2}
        items={[
          makeItem({ id: 'a', label: 'Alpha', value: 10 }),
          makeItem({ id: 'b', label: 'Bravo', value: 90 }),
          makeItem({ id: 'c', label: 'Charlie', value: 50 }),
          makeItem({ id: 'd', label: 'Delta', value: 5 }),
        ]}
      />,
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('Bravo')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  });

  it('renders one decorative, aria-hidden bar per row with a proportional width', () => {
    const { container } = render(
      <WidgetRankedList
        items={[
          makeItem({ id: 'a', label: 'Alpha', value: 100, formattedValue: '100' }),
          makeItem({ id: 'b', label: 'Bravo', value: 50, formattedValue: '50' }),
          makeItem({ id: 'c', label: 'Charlie', value: 25, formattedValue: '25' }),
        ]}
      />,
    );

    const rendered = bars(container);
    expect(rendered).toHaveLength(3);
    // Width is value/maxValue — top row full, others proportional.
    expect(rendered[0].style.width).toBe('100%');
    expect(rendered[1].style.width).toBe('50%');
    expect(rendered[2].style.width).toBe('25%');
  });

  it('omits bars when showBars is false but still renders rows', () => {
    const { container } = render(
      <WidgetRankedList items={makeSeries(3)} showBars={false} />,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(bars(container)).toHaveLength(0);
  });

  it('applies a custom barColor class to the decorative bar', () => {
    const { container } = render(
      <WidgetRankedList
        items={[makeItem({ id: 'a', label: 'Alpha', value: 40, barColor: 'bg-emerald-400' })]}
      />,
    );

    const [bar] = bars(container);
    expect(bar).toHaveClass('bg-emerald-400');
    // The default blue is replaced, not appended.
    expect(bar).not.toHaveClass('bg-blue-400');
  });

  it('maps each badge variant to the matching shared Badge colour', () => {
    render(
      <WidgetRankedList
        items={[
          makeItem({ id: 's', label: 'S', value: 4, badge: { text: 'Good', variant: 'success' } }),
          makeItem({ id: 'w', label: 'W', value: 3, badge: { text: 'Warn', variant: 'warning' } }),
          makeItem({ id: 'e', label: 'E', value: 2, badge: { text: 'Bad', variant: 'error' } }),
          makeItem({ id: 'n', label: 'N', value: 1, badge: { text: 'Meh', variant: 'neutral' } }),
        ]}
      />,
    );

    expect(screen.getByText('Good')).toHaveClass('bg-green-100');
    expect(screen.getByText('Warn')).toHaveClass('bg-yellow-100');
    // 'error' → the Badge's `danger` variant (red).
    expect(screen.getByText('Bad')).toHaveClass('bg-red-100');
    expect(screen.getByText('Meh')).toHaveClass(BADGE_VARIANTS.neutral);
  });

  it('renders the empty state (role=status) with a default message when the list is empty', () => {
    render(<WidgetRankedList items={[]} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No data available')).toBeInTheDocument();
    // No rows are drawn.
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('surfaces a custom empty message and icon', () => {
    render(
      <WidgetRankedList
        items={[]}
        emptyMessage="Nothing ranked yet"
        emptyIcon={<span data-testid="empty-icon">icon</span>}
      />,
    );

    expect(screen.getByText('Nothing ranked yet')).toBeInTheDocument();
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
  });

  it('is null-safe against an undefined items prop (renders empty, never throws)', () => {
    // The prop is typed non-null, but callers pass raw hook data that can be
    // undefined mid-fetch — the guard must not let `[...items]` explode.
    const items = undefined as unknown as RankedItem[];

    expect(() => render(<WidgetRankedList items={items} />)).not.toThrow();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('collapses a zero or negative maxItems to the empty state', () => {
    const { rerender } = render(
      <WidgetRankedList items={makeSeries(4)} maxItems={0} />,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();

    // A negative cap must not become a negative slice that leaks rows.
    rerender(<WidgetRankedList items={makeSeries(4)} maxItems={-2} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('coerces a non-finite value to 0 so the bar width never becomes NaN%', () => {
    const { container } = render(
      <WidgetRankedList
        items={[
          makeItem({ id: 'ok', label: 'Ok', value: 100, formattedValue: '100' }),
          makeItem({ id: 'bad', label: 'Bad', value: Number.NaN, formattedValue: '—' }),
        ]}
      />,
    );

    const rendered = bars(container);
    expect(rendered).toHaveLength(2);
    // NaN collapses to 0 → a 0% bar rather than the literal string "NaN%".
    expect(rendered[1].style.width).toBe('0%');
    expect(rendered[1].style.width).not.toContain('NaN');
  });

  it('clamps a negative value to a 0% bar width', () => {
    const { container } = render(
      <WidgetRankedList
        items={[
          makeItem({ id: 'p', label: 'Pos', value: 100, formattedValue: '100' }),
          makeItem({ id: 'n', label: 'Neg', value: -50, formattedValue: '-50' }),
        ]}
      />,
    );

    const rendered = bars(container);
    // -50 / 100 → -50% would be an invalid width; it is clamped to 0%.
    expect(rendered[1].style.width).toBe('0%');
  });

  it('falls back to an em-dash for a missing label or formatted value', () => {
    render(
      <WidgetRankedList
        items={[
          {
            id: 1,
            label: undefined as unknown as string,
            value: 5,
            formattedValue: undefined as unknown as string,
          },
        ]}
      />,
    );

    // Exactly two placeholders: the label slot and the value slot.
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getByRole('listitem')).toBeInTheDocument();
  });

  it('exposes proper list semantics (a list wrapping list items)', () => {
    render(<WidgetRankedList items={makeSeries(2)} />);

    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});
