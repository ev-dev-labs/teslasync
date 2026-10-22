/**
 * WidgetRankedList — behaviour, branch + hardening coverage.
 *
 * WidgetRankedList is a pure presentational primitive used across the
 * dashboard widgets to render a "top N" leaderboard: it sorts a list of
 * {@link RankedItem}s by `value` (descending), caps it, and draws each row in
 * the spec `rows` language — a title with an optional muted sublabel on the
 * left, a right-aligned value with an optional muted hint, an optional
 * leading status dot, and an optional status pill, separated by dividers. It
 * owns no data hooks and touches no network, so every render here is
 * deterministic from props alone.
 *
 * Surface under test:
 *   1. Ranking: input is sorted by `value` desc regardless of incoming order,
 *      the top-N are kept, and the caller's array is never mutated.
 *   2. Limits: the default cap (5 wide / 3 compact), the `maxItems` override,
 *      and the guard that a zero/negative cap collapses to the empty state
 *      instead of `Array.slice`'s negative-index footgun.
 *   3. Spec rows: divider-separated rows with no rank numerals and no
 *      background magnitude bars (the `showBars` / `barColor` props remain
 *      accepted for source compatibility but render nothing).
 *   4. Sublabel / hint: muted secondary lines under the label and value.
 *   5. Status dot: decorative (aria-hidden), one fill per state, with the
 *      state always named by adjacent text.
 *   6. Badges: each `variant` maps to the right shared <Badge> colour.
 *   7. Empty / null-safety: an empty list, an `undefined` list (typed
 *      non-null but undefined mid-fetch), and a zero cap all render the
 *      shared <EmptyState> (role="status") with the supplied message + icon
 *      rather than throwing or drawing a blank panel.
 *   8. Field null-safety: a missing `label` / `formattedValue` renders the
 *      em-dash placeholder; a non-finite `value` is coerced to 0 for sort
 *      safety while caller-formatted text is preserved.
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

/** Decorative nodes are the status dots (the only aria-hidden nodes emitted). */
function decorations(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[aria-hidden="true"]'));
}

/* ── Specs ────────────────────────────────────────────────────────── */

describe('WidgetRankedList', () => {
  it('sorts items by value descending without rank numerals', () => {
    const { container } = render(
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
    // Spec divider rows carry no rank numerals and no decorative bars.
    expect(rows[0].textContent).toBe('Bravo30');
    expect(decorations(container)).toHaveLength(0);
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

  it('caps at 3 rows in compact mode', () => {
    render(<WidgetRankedList items={makeSeries(8)} compact />);

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
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

  it('renders divider rows with no background magnitude bars', () => {
    const { container } = render(
      <WidgetRankedList
        items={[
          makeItem({ id: 'a', label: 'Alpha', value: 100, formattedValue: '100' }),
          makeItem({ id: 'b', label: 'Bravo', value: 50, formattedValue: '50' }),
          makeItem({ id: 'c', label: 'Charlie', value: 25, formattedValue: '25' }),
        ]}
      />,
    );

    // No decorative bars: magnitude is carried by the numeric value alone.
    expect(decorations(container)).toHaveLength(0);
    // Divider rows, not cards: every row carries the bottom border, the last
    // one removes it.
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toHaveClass('border-b');
    }
    expect(rows[2]).toHaveClass('last:border-b-0');
  });

  it('ignores the deprecated showBars and barColor props without rendering bars', () => {
    const { container } = render(
      <WidgetRankedList
        showBars={false}
        items={[makeItem({ id: 'a', label: 'Alpha', value: 40, barColor: 'bg-emerald-400' })]}
      />,
    );

    // Props remain accepted for source compatibility; rows still render.
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(decorations(container)).toHaveLength(0);
    expect(container.querySelector('.bg-emerald-400')).toBeNull();
  });

  it('maps each badge variant to the matching shared Badge colour', () => {
    render(
      <WidgetRankedList
        items={[
          makeItem({ id: 's', label: 'S', value: 4, badge: { text: 'Good', variant: 'success' } }),
          makeItem({ id: 'w', label: 'W', value: 3, badge: { text: 'Warn', variant: 'warning' } }),
          makeItem({ id: 'e', label: 'E', value: 2, badge: { text: 'Bad', variant: 'error' } }),
          makeItem({ id: 'n', label: 'N', value: 1, badge: { text: 'Meh', variant: 'neutral' } }),
          makeItem({ id: 'i', label: 'I', value: 0, badge: { text: 'Info', variant: 'info' } }),
        ]}
      />,
    );

    expect(screen.getByText('Good')).toHaveClass('bg-[var(--semantic-success-bg)]');
    expect(screen.getByText('Warn')).toHaveClass('bg-[var(--semantic-warning-bg)]');
    // 'error' → the Badge's `danger` variant (red).
    expect(screen.getByText('Bad')).toHaveClass('bg-[var(--semantic-danger-bg)]');
    expect(screen.getByText('Meh')).toHaveClass(BADGE_VARIANTS.neutral);
    expect(screen.getByText('Info')).toHaveClass('bg-[var(--semantic-info-bg)]');
  });

  it('renders a muted sublabel under the label and a hint under the value', () => {
    render(
      <WidgetRankedList
        items={[
          makeItem({
            id: 'a',
            label: 'Bellevue, WA',
            sublabel: 'Oct 12 · 24 min',
            value: 38,
            formattedValue: '38 kWh',
            hint: '$15.20',
          }),
        ]}
      />,
    );

    expect(screen.getByText('Oct 12 · 24 min')).toHaveClass('text-[var(--text-muted)]');
    expect(screen.getByText('$15.20')).toHaveClass('text-[var(--text-muted)]');
    // The headline value stays prominent and tabular.
    expect(screen.getByText('38 kWh')).toHaveClass('font-semibold', 'tabular-nums');
  });

  it('renders one decorative status dot per state while the text names the state', () => {
    const { container } = render(
      <WidgetRankedList
        order="source"
        items={[
          makeItem({ id: 'ok', label: 'Flowing', value: 3, formattedValue: '3 kW', status: 'success' }),
          makeItem({ id: 'warn', label: 'Paused', value: 2, formattedValue: '0 kW', status: 'warning' }),
          makeItem({ id: 'bad', label: 'Fault', value: 1, formattedValue: '—', status: 'error' }),
          makeItem({ id: 'info', label: 'Scheduled', value: 0, formattedValue: '22:00', status: 'info' }),
        ]}
      />,
    );

    const dots = decorations(container);
    expect(dots).toHaveLength(4);
    expect(dots[0]).toHaveClass('bg-[var(--semantic-success)]');
    expect(dots[1]).toHaveClass('bg-[var(--semantic-warning)]');
    expect(dots[2]).toHaveClass('bg-[var(--semantic-danger)]');
    expect(dots[3]).toHaveClass('bg-[var(--semantic-info)]');
    // Meaning never travels by color alone.
    expect(screen.getByText('Flowing')).toBeInTheDocument();
    expect(screen.getByText('Fault')).toBeInTheDocument();
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

  it('coerces a non-finite value to 0 for sort safety while keeping caller text', () => {
    render(
      <WidgetRankedList
        items={[
          makeItem({ id: 'ok', label: 'Ok', value: 100, formattedValue: '100' }),
          makeItem({ id: 'bad', label: 'Bad', value: Number.NaN, formattedValue: '—' }),
        ]}
      />,
    );

    // NaN collapses to 0 for ordering; the caller's placeholder text survives.
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Ok');
    expect(rows[1]).toHaveTextContent('Bad—');
  });

  it('renders a negative reading as a plain row without clamping artifacts', () => {
    render(
      <WidgetRankedList
        items={[
          makeItem({ id: 'p', label: 'Pos', value: 100, formattedValue: '100' }),
          makeItem({ id: 'n', label: 'Neg', value: -50, formattedValue: '-50' }),
        ]}
      />,
    );

    expect(screen.getByText('-50')).toBeInTheDocument();
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

  it('accepts frozen readonly items without mutating their order or readings', () => {
    const items: readonly RankedItem[] = Object.freeze([
      Object.freeze(makeItem({ id: 'unknown', label: 'Unknown', value: null, formattedValue: 'Unavailable' })),
      Object.freeze(makeItem({ id: 'low', label: 'Low', value: 10 })),
      Object.freeze(makeItem({ id: 'high', label: 'High', value: 30 })),
    ]);
    const { rerender } = render(<WidgetRankedList items={items} />);

    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('High');
    expect(rows[1]).toHaveTextContent('Low');
    expect(rows[2]).toHaveTextContent('Unknown');
    expect(items.map((item) => item.id)).toEqual(['unknown', 'low', 'high']);
    expect(items[0].value).toBeNull();

    rerender(<WidgetRankedList items={items} order="source" />);
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Unknown');
    expect(items.map((item) => item.id)).toEqual(['unknown', 'low', 'high']);
    expect(items[0].value).toBeNull();
  });

  it('preserves caller source rank and unknown placement without sorting by magnitude', () => {
    render(
      <WidgetRankedList
        order="source"
        items={[
          makeItem({ id: 'unknown', label: 'Caller first', value: null, formattedValue: 'Pending' }),
          makeItem({ id: 'low', label: 'Caller second', value: -10, formattedValue: 'Low effort' }),
          makeItem({ id: 'high', label: 'Caller third', value: 100, formattedValue: 'High effort' }),
        ]}
      />,
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Caller first');
    expect(rows[0]).toHaveTextContent('Pending');
    expect(rows[1]).toHaveTextContent('Caller second');
    expect(rows[2]).toHaveTextContent('Caller third');
  });

  it('keeps null and missing readings as unknown rows while measured zero stays a row', () => {
    const missing: RankedItem = {
      id: 'missing',
      label: 'Missing',
      formattedValue: 'Not reported',
    };
    render(
      <WidgetRankedList
        order="source"
        items={[
          makeItem({ id: 'null', label: 'Null', value: null, formattedValue: 'Unknown' }),
          missing,
          makeItem({ id: 'zero', label: 'Measured zero', value: 0, formattedValue: '0 visits' }),
          makeItem({ id: 'positive', label: 'Positive', value: 20, formattedValue: '20 visits' }),
        ]}
      />,
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('Null');
    expect(rows[0]).toHaveTextContent('Unknown');
    expect(rows[1]).toHaveTextContent('Missing');
    expect(rows[1]).toHaveTextContent('Not reported');
    expect(rows[2]).toHaveTextContent('Measured zero');
    expect(rows[2]).toHaveTextContent('0 visits');
  });

  it('defaults to finite descending order with unknowns after zero and negative readings', () => {
    render(
      <WidgetRankedList
        items={[
          makeItem({ id: 'unknown', label: 'Unknown', value: null, formattedValue: 'No reading' }),
          makeItem({ id: 'negative', label: 'Negative', value: -5, formattedValue: '-5' }),
          makeItem({ id: 'zero', label: 'Zero', value: 0, formattedValue: '0' }),
          makeItem({ id: 'positive', label: 'Positive', value: 10, formattedValue: '10' }),
        ]}
      />,
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('Positive');
    expect(rows[1]).toHaveTextContent('Zero');
    expect(rows[2]).toHaveTextContent('Negative');
    expect(rows[3]).toHaveTextContent('Unknown');
  });

  it('retains malformed-number zero safety and formatted text without treating null as zero', () => {
    render(
      <WidgetRankedList
        order="source"
        items={[
          makeItem({ id: 'nan', label: 'Malformed', value: Number.NaN, formattedValue: 'Invalid reading' }),
          makeItem({ id: 'infinite', label: 'Infinite', value: Infinity, formattedValue: 'Out of range' }),
          makeItem({ id: 'negative-infinite', label: 'Negative infinite', value: -Infinity, formattedValue: 'Invalid range' }),
          makeItem({ id: 'unknown', label: 'Unknown', value: null, formattedValue: 'Not measured' }),
        ]}
      />,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText('Invalid reading')).toBeInTheDocument();
    expect(screen.getByText('Out of range')).toBeInTheDocument();
    expect(screen.getByText('Invalid range')).toBeInTheDocument();
    expect(screen.getByText('Not measured')).toBeInTheDocument();
  });

  it('keeps all-unknown rows with caller labels instead of an empty state', () => {
    render(
      <WidgetRankedList
        items={[
          makeItem({ id: 'first', label: 'First', value: null, formattedValue: 'Unknown' }),
          makeItem({ id: 'second', label: 'Second', value: undefined, formattedValue: 'Pending' }),
        ]}
      />,
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('First');
    expect(rows[1]).toHaveTextContent('Second');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('wraps long rich labels and formatted evidence without hiding badges or values', () => {
    const label = 'A long caller-owned route label with all destination evidence retained';
    const formattedValue = 'Unavailable until the complete source reading arrives';
    render(
      <WidgetRankedList
        wrapContent
        items={[makeItem({
          id: 'rich',
          label,
          labelContent: <span><strong>{label}</strong><span> · Caller metadata</span></span>,
          value: null,
          formattedValue,
          badge: { text: 'Pending', variant: 'neutral' },
        })]}
      />,
    );

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText('· Caller metadata')).toBeInTheDocument();
    const labelSlot = screen.getByText(label).parentElement?.parentElement;
    expect(labelSlot).toHaveClass('whitespace-normal', 'break-words');
    expect(labelSlot).not.toHaveClass('truncate');
    expect(screen.getByText(formattedValue)).toHaveClass('whitespace-normal', 'break-words');
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('retains default truncated labels and non-wrapping formatted values', () => {
    render(<WidgetRankedList items={[makeItem({ label: 'Default label', formattedValue: 'Formatted value' })]} />);

    expect(screen.getByText('Default label')).toHaveClass('truncate');
    expect(screen.getByText('Formatted value')).not.toHaveClass('whitespace-normal');
  });

  it('applies caller limits to source order including unknown rows and compact overrides', () => {
    const items = [
      makeItem({ id: 'unknown', label: 'First unknown', value: null, formattedValue: 'Pending' }),
      ...makeSeries(7),
    ];
    const { rerender } = render(
      <WidgetRankedList items={items} order="source" maxItems={2} />,
    );

    let rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('First unknown');
    expect(rows[1]).toHaveTextContent('A');
    expect(screen.queryByText('B')).not.toBeInTheDocument();

    rerender(<WidgetRankedList items={items} order="source" compact maxItems={7} />);
    rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(7);
    expect(rows[0]).toHaveTextContent('First unknown');
    expect(rows[6]).toHaveTextContent('F');
    expect(screen.queryByText('G')).not.toBeInTheDocument();
  });
});
