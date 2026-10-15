// Behavioural coverage for KVList — the shared definition-list primitive that
// renders label/value rows for the metadata panels across the app (vehicle
// config, trip overview, charging session, DLQ inspector, …).
//
// KVList is a pure prop-driven presenter (no network, no context, no
// interactions), so the contract worth pinning is:
//   - every row maps to a <dt>/<dd> pair inside a semantic <dl>, in order,
//   - non-string ReactNode values (elements, numbers) render through untouched,
//   - the `columns` prop toggles the two-column grid, and `className` merges,
//   - NULL SAFETY: a null / undefined `items` collection must not throw — it is
//     treated as empty (the regression TwinDetailPanel defends against upstream),
//   - the opt-in `emptyMessage` surfaces an accessible status region (never a
//     blank panel) and withholds the <dl>, while omitting it preserves the
//     backward-compatible empty <dl>,
//   - duplicate labels both render (stable per-index keys, no collision/loss).

import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { KVList, type KVItem } from './KVList';

afterEach(cleanup);

/** All rendered value cells (`<dd>`), in document order. */
function ddCells(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('dd'));
}

/** All rendered label cells (`<dt>`), in document order. */
function dtCells(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('dt'));
}

describe('KVList — rendering', () => {
  it('renders every item as a <dt>/<dd> pair inside a semantic <dl>', () => {
    const items: KVItem[] = [
      { label: 'Trip ID', value: '42' },
      { label: 'Vehicle', value: '#7' },
      { label: 'Drives', value: '3' },
    ];
    const { container } = render(<KVList items={items} />);

    const dl = container.querySelector('dl');
    expect(dl).not.toBeNull();

    // Three rows, each a dt + dd pair.
    expect(dtCells(container)).toHaveLength(3);
    expect(ddCells(container)).toHaveLength(3);

    // Labels and values are echoed verbatim.
    expect(screen.getByText('Trip ID')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('#7')).toBeInTheDocument();
  });

  it('preserves the order the items were supplied in', () => {
    const items: KVItem[] = [
      { label: 'First', value: 'a' },
      { label: 'Second', value: 'b' },
      { label: 'Third', value: 'c' },
    ];
    const { container } = render(<KVList items={items} />);

    expect(dtCells(container).map((el) => el.textContent)).toEqual(['First', 'Second', 'Third']);
    expect(ddCells(container).map((el) => el.textContent)).toEqual(['a', 'b', 'c']);
  });

  it('renders non-string ReactNode values (elements + numbers) untouched', () => {
    const items: KVItem[] = [
      { label: 'Badge', value: <span data-testid="badge-node">live</span> },
      { label: 'Count', value: 128 },
    ];
    const { container } = render(<KVList items={items} />);

    // Two rows regardless of value type.
    expect(ddCells(container)).toHaveLength(2);

    // The JSX element passes through and lands inside its <dd>.
    const node = screen.getByTestId('badge-node');
    expect(node).toBeInTheDocument();
    expect(node.closest('dd')).not.toBeNull();

    // Numeric values render as their string form (not blank, not "[object]").
    expect(screen.getByText('128')).toBeInTheDocument();
  });
});

describe('KVList — layout props', () => {
  it('defaults to a single stacked column (no two-column grid)', () => {
    const { container } = render(<KVList items={[{ label: 'K', value: 'V' }]} />);
    const dl = container.querySelector('dl') as HTMLElement;
    expect(dl).not.toBeNull();
    expect(dl.className).not.toContain('grid-cols-2');
  });

  it('applies the two-column grid classes when columns={2}', () => {
    const { container } = render(<KVList items={[{ label: 'K', value: 'V' }]} columns={2} />);
    const dl = container.querySelector('dl') as HTMLElement;
    expect(dl).toHaveClass('grid', 'grid-cols-2', 'gap-x-6');
  });

  it('merges a caller className onto the <dl> alongside the base classes', () => {
    const { container } = render(
      <KVList items={[{ label: 'K', value: 'V' }]} className="mt-4 custom-marker" />,
    );
    const dl = container.querySelector('dl') as HTMLElement;
    expect(dl).toHaveClass('custom-marker');
    expect(dl).toHaveClass('mt-4');
    // Base divider class is retained (tailwind-merge keeps non-conflicting utils).
    expect(dl).toHaveClass('divide-y');
  });
});

describe('KVList — null safety', () => {
  it('does not throw and renders no rows when items is undefined', () => {
    let container!: HTMLElement;
    expect(() => {
      container = render(<KVList items={undefined} />).container;
    }).not.toThrow();

    expect(ddCells(container)).toHaveLength(0);
    // Backward-compatible: with no emptyMessage the empty <dl> is preserved.
    expect(container.querySelector('dl')).not.toBeNull();
  });

  it('does not throw and renders no rows when items is null', () => {
    let container!: HTMLElement;
    expect(() => {
      container = render(<KVList items={null} />).container;
    }).not.toThrow();
    expect(ddCells(container)).toHaveLength(0);
  });

  it('renders an empty <dl> (no rows, no status) for an empty array without a message', () => {
    const { container } = render(<KVList items={[]} />);
    expect(container.querySelector('dl')).not.toBeNull();
    expect(ddCells(container)).toHaveLength(0);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('KVList — empty state', () => {
  it('shows the accessible status message and withholds the <dl> when items is empty', () => {
    const { container } = render(
      <KVList items={[]} emptyMessage="No configuration data available" />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('No configuration data available');
    // The list itself is replaced by the placeholder — no empty <dl> or rows.
    expect(container.querySelector('dl')).toBeNull();
    expect(ddCells(container)).toHaveLength(0);
  });

  it('ignores emptyMessage and renders the rows when items is present', () => {
    const { container } = render(
      <KVList items={[{ label: 'Trim', value: 'P100D' }]} emptyMessage="No data" />,
    );

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('No data')).toBeNull();
    expect(screen.getByText('P100D')).toBeInTheDocument();
    expect(container.querySelector('dl')).not.toBeNull();
  });

  it('treats a null items collection with an emptyMessage as empty (status, no throw)', () => {
    expect(() => render(<KVList items={null} emptyMessage="Nothing yet" />)).not.toThrow();
    expect(screen.getByRole('status')).toHaveTextContent('Nothing yet');
  });
});

describe('KVList — edge cases', () => {
  it('renders both rows when two items share the same label (stable per-index keys)', () => {
    const items: KVItem[] = [
      { label: 'Sensor', value: 'front' },
      { label: 'Sensor', value: 'rear' },
    ];
    const { container } = render(<KVList items={items} />);

    // A label-only key would collide and drop/merge a row; per-index keys keep both.
    expect(dtCells(container)).toHaveLength(2);
    expect(ddCells(container).map((el) => el.textContent)).toEqual(['front', 'rear']);
    expect(screen.getByText('front')).toBeInTheDocument();
    expect(screen.getByText('rear')).toBeInTheDocument();
  });
});

describe('KVList — extended row content and identity', () => {
  it('accepts a readonly collection without mutating its rows or order', () => {
    const first = Object.freeze({ id: 'first', label: 'First', value: 'a' });
    const second = Object.freeze({ id: 'second', label: 'Second', value: 'b' });
    const items: readonly KVItem[] = Object.freeze([first, second]);
    const { container, rerender } = render(<KVList items={items} />);

    rerender(<KVList items={items} layout="stacked" />);

    expect(items).toEqual([first, second]);
    expect(items[0]).toBe(first);
    expect(dtCells(container).map((cell) => cell.textContent)).toEqual(['First', 'Second']);
    expect(ddCells(container).map((cell) => cell.textContent)).toEqual(['a', 'b']);
  });

  it('retains explicit row, label, value and focused descendant identity on reorder and relabel', () => {
    const { container, rerender } = render(
      <KVList items={[
        { id: 'charge', label: 'Charge', value: 'Ready' },
        { id: 0, label: 'Vehicle', value: <a href="#vehicle">Open vehicle</a> },
      ]} />,
    );
    const chargeLabel = dtCells(container)[0];
    const chargeValue = ddCells(container)[0];
    const label = dtCells(container)[1];
    const value = ddCells(container)[1];
    const row = label.parentElement;
    const link = screen.getByRole('link', { name: 'Open vehicle' });
    link.focus();
    expect(link).toHaveFocus();

    rerender(
      <KVList items={[
        { id: 0, label: 'Fahrzeug', value: <a href="#vehicle">Open vehicle</a> },
        { id: 'charge', label: 'Laden', value: 'Bereit' },
      ]} />,
    );

    expect(dtCells(container)[0]).toBe(label);
    expect(ddCells(container)[0]).toBe(value);
    expect(dtCells(container)[1]).toBe(chargeLabel);
    expect(ddCells(container)[1]).toBe(chargeValue);
    expect(label.parentElement).toBe(row);
    expect(label).toHaveTextContent('Fahrzeug');
    expect(screen.getByRole('link', { name: 'Open vehicle' })).toBe(link);
    expect(link).toHaveFocus();
    expect(row).not.toHaveAttribute('id');
  });

  it('renders rich labels, leading content and rich values within the same semantic pair', () => {
    const { container } = render(
      <KVList items={[{
        id: 'battery',
        leading: <span aria-hidden="true" data-testid="leading-node">◉</span>,
        label: <strong data-testid="rich-label">Battery <em>status</em></strong>,
        value: <span data-testid="rich-value">Healthy <small>verified</small></span>,
      }]} />,
    );
    const label = dtCells(container)[0];
    expect(label).toContainElement(screen.getByTestId('rich-label'));
    expect(label).toContainElement(screen.getByTestId('leading-node'));
    expect(ddCells(container)[0]).toContainElement(screen.getByTestId('rich-value'));
    expect(container.querySelectorAll('dl > div')).toHaveLength(1);
    expect(dtCells(container)).toHaveLength(1);
    expect(ddCells(container)).toHaveLength(1);
    expect(container.querySelector('[id]')).toBeNull();
    expect(container.textContent).not.toContain('[object Object]');
  });

  it('uses index fallback for rich labels instead of coercing them into row identity', () => {
    const { container, rerender } = render(
      <KVList items={[{ label: <strong>English label</strong>, value: 'v' }]} />,
    );
    const row = dtCells(container)[0].parentElement;
    rerender(<KVList items={[{ label: <em>Translated label</em>, value: 'v' }]} />);

    expect(dtCells(container)[0].parentElement).toBe(row);
    expect(screen.getByText('Translated label')).toBeInTheDocument();
    expect(container.querySelector('[id]')).toBeNull();
  });

  it('preserves string-label/index fallback when no explicit ID is supplied', () => {
    const { container, rerender } = render(<KVList items={[{ label: 'Label', value: 'v' }]} />);
    const row = dtCells(container)[0].parentElement;
    rerender(<KVList items={[{ label: 'Label', value: 'updated' }]} />);
    expect(dtCells(container)[0].parentElement).toBe(row);

    rerender(<KVList items={[{ label: 'Translated', value: 'updated' }]} />);
    expect(dtCells(container)[0].parentElement).not.toBe(row);
  });

  it('keeps explicit string/number IDs distinct from each other and legacy fallback keys', () => {
    const { container } = render(<KVList items={[
      { id: 1, label: 'Repeated', value: 'numeric' },
      { id: '1', label: 'Repeated', value: 'string' },
      { id: 'Repeated-3', label: 'Repeated', value: 'explicit' },
      { label: 'Repeated', value: 'fallback' },
    ]} />);
    expect(ddCells(container).map((cell) => cell.textContent))
      .toEqual(['numeric', 'string', 'explicit', 'fallback']);
  });
});

describe('KVList — opt-in wrapping and row layouts', () => {
  it('retains exact default inline row and typography classes for both column counts', () => {
    const { container, rerender } = render(<KVList items={[{ label: 'K', value: 'V' }]} />);
    for (const columns of [1, 2] as const) {
      rerender(<KVList items={[{ label: 'K', value: 'V' }]} columns={columns} />);
      expect(dtCells(container)[0].parentElement)
        .toHaveClass('flex justify-between py-2', { exact: true });
      expect(dtCells(container)[0])
        .toHaveClass('text-sm text-[var(--text-muted)]', { exact: true });
      expect(ddCells(container)[0])
        .toHaveClass('text-sm font-medium text-[var(--text-primary)]', { exact: true });
      expect(container.querySelector('dl')).not.toHaveClass('@container/kv-list');
      expect(container.querySelector('dl')?.className).toBe(columns === 2
        ? 'divide-y divide-gray-200 dark:divide-gray-700 grid grid-cols-2 gap-x-6'
        : 'divide-y divide-gray-200 dark:divide-gray-700');
    }
  });

  it('opts inline rows into non-truncating wrapping only when requested', () => {
    const { container } = render(<KVList items={[{ label: 'K', value: 'V' }]} wrap />);
    expect(dtCells(container)[0].parentElement)
      .toHaveClass('flex', 'justify-between', 'min-w-0', 'gap-3');
    for (const cell of [...dtCells(container), ...ddCells(container)]) {
      expect(cell).toHaveClass('min-w-0', 'max-w-full', 'whitespace-normal', '[overflow-wrap:anywhere]', 'flex-1');
      expect(cell).not.toHaveClass('truncate', 'overflow-hidden', 'whitespace-nowrap');
    }
    expect(ddCells(container)[0]).toHaveClass('text-end');
  });

  it('stacks rows and wraps both cells even when wrap is false', () => {
    const { container } = render(
      <KVList items={[{ label: 'K', value: 'V' }]} layout="stacked" wrap={false} columns={2} />,
    );
    expect(container.querySelector('dl')).toHaveClass('grid', 'grid-cols-2', 'gap-x-6');
    expect(dtCells(container)[0].parentElement).toHaveClass('flex', 'flex-col', 'min-w-0', 'gap-1');
    expect(dtCells(container)[0]).toHaveClass('whitespace-normal', '[overflow-wrap:anywhere]');
    expect(ddCells(container)[0]).toHaveClass('whitespace-normal', '[overflow-wrap:anywhere]');
    expect(ddCells(container)[0]).not.toHaveClass('text-end');
  });

  it('responds to allocated list width with named container queries, not viewport breakpoints', () => {
    const { container, rerender } = render(
      <KVList items={[{ label: 'K', value: 'V' }]} layout="responsive" />,
    );
    for (const columns of [1, 2] as const) {
      rerender(<KVList items={[{ label: 'K', value: 'V' }]} layout="responsive" columns={columns} />);
      const row = dtCells(container)[0].parentElement;
      const threshold = columns === 2 ? '49.5rem' : '24rem';
      expect(container.querySelector('dl')).toHaveClass('@container/kv-list');
      expect(row).toHaveClass('grid', 'grid-cols-1', 'min-w-0', 'gap-x-3', 'gap-y-1');
      expect(row).toHaveClass(`@[${threshold}]/kv-list:grid-cols-2`);
      expect(ddCells(container)[0]).toHaveClass(`@[${threshold}]/kv-list:text-end`);
      expect(row?.className).not.toMatch(/(?:^|\s)(?:sm|md|lg|xl):/);
      for (const cell of [...dtCells(container), ...ddCells(container)]) {
        expect(cell).toHaveClass('min-w-0', 'whitespace-normal', '[overflow-wrap:anywhere]');
      }
    }
  });

  it('retains complete long labels and values with wrapping contracts in every opt-in mode', () => {
    const label = 'Long translated label '.repeat(30) + 'L'.repeat(150);
    const value = 'Caller formatted value '.repeat(30) + 'V'.repeat(150);
    const { container, rerender } = render(<KVList items={[{ label, value }]} wrap />);

    for (const layout of ['inline', 'stacked', 'responsive'] as const) {
      rerender(<KVList items={[{
        label: <span data-testid="long-label">{label}</span>,
        leading: <span aria-hidden="true">◉</span>,
        value: <span data-testid="long-value">{value}</span>,
      }]} layout={layout} wrap />);
      expect(screen.getByTestId('long-label').textContent).toBe(label);
      expect(screen.getByTestId('long-value').textContent).toBe(value);
      expect(screen.getByTestId('long-label').parentElement)
        .toHaveClass('min-w-0', 'whitespace-normal', '[overflow-wrap:anywhere]');
      for (const cell of [...dtCells(container), ...ddCells(container)]) {
        expect(cell).toHaveClass('min-w-0', 'max-w-full', '[overflow-wrap:anywhere]');
        expect(cell).not.toHaveClass('truncate', 'overflow-hidden', 'whitespace-nowrap');
      }
    }
  });

  it('preserves empty-list and nullable-value semantics in all row layouts', () => {
    const { container, rerender } = render(<KVList items={null} />);
    for (const layout of ['inline', 'stacked', 'responsive'] as const) {
      rerender(<KVList items={undefined} layout={layout} />);
      expect(container.querySelector('dl')).not.toBeNull();
      expect(dtCells(container)).toHaveLength(0);
      expect(ddCells(container)).toHaveLength(0);
      expect(screen.queryByRole('status')).toBeNull();

      rerender(<KVList items={[]} layout={layout} emptyMessage="Nothing yet" />);
      expect(screen.getByRole('status')).toHaveTextContent('Nothing yet');
      expect(container.querySelector('dl')).toBeNull();

      rerender(<KVList items={[{ label: null, value: null }]} layout={layout} />);
      expect(dtCells(container)).toHaveLength(1);
      expect(ddCells(container)).toHaveLength(1);
      expect(dtCells(container)[0]).toBeEmptyDOMElement();
      expect(ddCells(container)[0]).toBeEmptyDOMElement();
    }
  });
});
