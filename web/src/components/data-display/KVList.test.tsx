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
